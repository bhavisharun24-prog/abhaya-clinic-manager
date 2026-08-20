from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Depends
from typing import Optional, List
import json
import os
import shutil
import uuid
from datetime import datetime, date
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from backend.db import get_db_connection, get_next_patient_id, verify_password, hash_password
from backend.models.password_reset import create_reset_token, verify_reset_token
from backend.websocket import manager

router = APIRouter()

UPLOAD_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "uploads")
if not os.path.exists(UPLOAD_DIR):
    os.makedirs(UPLOAD_DIR, exist_ok=True)

def save_uploaded_file(file: UploadFile) -> Optional[str]:
    if not file or not file.filename:
        return None
    ext = os.path.splitext(file.filename)[1]
    filename = f"file-{uuid.uuid4()}{ext}"
    dest = os.path.join(UPLOAD_DIR, filename)
    with open(dest, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
    return f"/uploads/{filename}"


def _safe_json_loads(value, fallback):
    if value in (None, ""):
        return fallback
    if isinstance(value, (dict, list)):
        return value
    try:
        return json.loads(value)
    except Exception:
        return fallback


def _normalize_prescription_payload(payload):
    data = _safe_json_loads(payload, {}) if not isinstance(payload, dict) else payload
    medicines = data.get("medicines", [])
    if isinstance(medicines, dict):
        medicines = medicines.get("medicines", [])
    if not isinstance(medicines, list):
        medicines = []
    return {
        "medicines": medicines,
        "chief_complaints": data.get("chief_complaints", []),
        "vitals": data.get("vitals", {}),
        "clinical_findings": data.get("clinical_findings", {}),
        "diagnosis": data.get("diagnosis", ""),
        "consultation_fee": int(data.get("consultation_fee", 400) or 400),
        "prescription_date": data.get("prescription_date", datetime.now().strftime("%Y-%m-%d")),
    }


def _money(value) -> Decimal:
    try:
        amount = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        raise HTTPException(status_code=400, detail="Amount must be a valid number")
    if not amount.is_finite() or amount < 0:
        raise HTTPException(status_code=400, detail="Amount must be a non-negative number")
    return amount.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _medicine_quantity(medicine) -> int:
    try:
        quantity = int(medicine.get("quantity") or medicine.get("duration") or 1)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail=f"Invalid quantity for {medicine.get('name', 'medicine')}")
    if quantity < 1:
        raise HTTPException(status_code=400, detail="Medicine quantity must be at least 1")
    return quantity


def _validated_medicines(cursor, medicines):
    if not isinstance(medicines, list):
        raise HTTPException(status_code=400, detail="Medicines must be a list")
    if not medicines:
        raise HTTPException(status_code=400, detail="At least one medicine is required")
    validated = []
    rows_by_id = {}
    quantities_by_id = {}
    total = Decimal("0.00")
    for medicine in medicines:
        name = str(medicine.get("name", "")).strip() if isinstance(medicine, dict) else ""
        if not name:
            raise HTTPException(status_code=400, detail="Every medicine must have a name")
        quantity = _medicine_quantity(medicine)
        row = cursor.execute(
            "SELECT id, name, stock_quantity, unit_price FROM medicines WHERE lower(name) = lower(?)",
            (name,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=400, detail=f"Medicine not found: {name}")
        rows_by_id[row["id"]] = row
        quantities_by_id[row["id"]] = quantities_by_id.get(row["id"], 0) + quantity
        unit_price = _money(row["unit_price"])
        total += unit_price * quantity
        validated.append((row, quantity, unit_price))
    for row_id, row in rows_by_id.items():
        if row["stock_quantity"] < quantities_by_id[row_id]:
            raise HTTPException(status_code=400, detail=f"Insufficient stock for {row['name']}")
    return validated, total.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _enrich_prescription_row(row):
    entry = dict(row)
    payload = _normalize_prescription_payload(entry.get("medicines"))
    entry["payload"] = payload
    entry["medicines"] = payload["medicines"]
    entry["chief_complaints"] = payload["chief_complaints"]
    entry["vitals"] = payload["vitals"]
    entry["clinical_findings"] = payload["clinical_findings"]
    entry["diagnosis"] = payload["diagnosis"]
    entry["consultation_fee"] = payload["consultation_fee"]
    entry["prescription_date"] = payload["prescription_date"]
    return entry

@router.post("/register")
def register_user(payload: dict):
    username = payload.get("username")
    password = payload.get("password")
    role = payload.get("role")
    if not username or not password or not role:
        raise HTTPException(status_code=400, detail="username, password, and role are required")
    conn = get_db_connection()
    cursor = conn.cursor()
    hashed = hash_password(password)
    try:
        cursor.execute("INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)", (username, hashed, role))
        conn.commit()
    except Exception as e:
        conn.close()
        raise HTTPException(status_code=400, detail="User creation failed: " + str(e))
    conn.close()
    return {"message": "User created", "user": {"username": username, "role": role}}

@router.post("/login")
def login(payload: dict):
    username = payload.get("username")
    role = payload.get("role")
    password = payload.get("password")

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users WHERE username = ? AND role = ?", (username, role))
    user = cursor.fetchone()
    conn.close()

    if not user:
        raise HTTPException(status_code=401, detail="Invalid username or role")

    if password and not verify_password(password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid password")

    return {
        "message": "Login successful",
        "user": {
            "id": user["id"],
            "username": user["username"],
            "role": user["role"]
        }
    }

@router.get("/users")
def list_users():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id, username, role FROM users ORDER BY role, username")
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]

@router.put("/users/{user_id}/password")
def change_password(user_id: int, payload: dict):
    current_password = payload.get("current_password")
    new_password = payload.get("new_password")
    if not current_password or not new_password:
        raise HTTPException(status_code=400, detail="Current and new password are required")

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users WHERE id = ?", (user_id,))
    user = cursor.fetchone()
    if not user or not verify_password(current_password, user["password_hash"]):
        conn.close()
        raise HTTPException(status_code=401, detail="Current password is incorrect")

    cursor.execute("UPDATE users SET password_hash = ? WHERE id = ?", (hash_password(new_password), user_id))
    conn.commit()
    conn.close()
    return {"message": "Password updated"}

@router.put("/users/{user_id}/username")
def change_username(user_id: int, payload: dict):
    current_password = payload.get("current_password")
    new_username = payload.get("new_username")
    if not current_password or not new_username:
        raise HTTPException(status_code=400, detail="Current password and new username are required")

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users WHERE id = ?", (user_id,))
    user = cursor.fetchone()
    if not user or not verify_password(current_password, user["password_hash"]):
        conn.close()
        raise HTTPException(status_code=401, detail="Current password is incorrect")

    cursor.execute("UPDATE users SET username = ? WHERE id = ?", (new_username, user_id))
    conn.commit()
    conn.close()
    return {"message": "Username updated"}

# 2. Patient Search with Autocomplete
@router.get("/patients/search")
def search_patients(q: str = ""):
    if not q:
        return []
    conn = get_db_connection()
    cursor = conn.cursor()
    term = f"%{q}%"
    sql = """
        SELECT DISTINCT p.id, p.name, p.age, p.gender, p.contact, p.photo_path, p.dob, p.address, p.mobile, p.weight, p.regn_no,
               date(p.created_at) as registration_date,
               (
                   SELECT MAX(v.date)
                   FROM visits v
                   WHERE v.patient_id = p.id
               ) as latest_visit_date
        FROM patients p
        LEFT JOIN visits v ON v.patient_id = p.id
        WHERE p.id LIKE ?
           OR p.name LIKE ?
           OR p.contact LIKE ?
           OR p.address LIKE ?
           OR p.mobile LIKE ?
           OR p.regn_no LIKE ?
           OR date(p.created_at) LIKE ?
           OR v.date LIKE ?
        LIMIT 15
    """
    cursor.execute(sql, (term, term, term, term, term, term, term, term))
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]

# 3. Get Patient Details, visits, latest prescription
@router.get("/patients/{id}")
def get_patient_details(id: str):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM patients WHERE id = ?", (id,))
    patient = cursor.fetchone()
    if not patient:
        conn.close()
        raise HTTPException(status_code=404, detail="Patient not found")

    cursor.execute("SELECT * FROM visits WHERE patient_id = ? ORDER BY date DESC, id DESC", (id,))
    visits = [dict(v) for v in cursor.fetchall()]

    cursor.execute("""
        SELECT p.*, pat.name as patient_name
        FROM prescriptions p
        JOIN patients pat ON p.patient_id = pat.id
        WHERE p.patient_id = ?
        ORDER BY p.created_at DESC
    """, (id,))
    prescriptions = [_enrich_prescription_row(row) for row in cursor.fetchall()]

    conn.close()
    return {
        "patient": dict(patient),
        "visits": visits,
        "prescriptions": prescriptions,
        "documents": json.loads(patient["documents"] or "[]") if patient["documents"] else [],
        "latestPrescription": prescriptions[0] if prescriptions else None
    }

# 4. Create New Patient
@router.post("/patients")
def create_patient(
    name: str = Form(...),
    age: int = Form(...),
    gender: str = Form(...),
    contact: str = Form(...),
    medical_history: Optional[str] = Form(None),
    dob: Optional[str] = Form(None),
    address: Optional[str] = Form(None),
    mobile: Optional[str] = Form(None),
    weight: Optional[str] = Form(None),
    photo: Optional[UploadFile] = File(None)
):
    photo_path = save_uploaded_file(photo) if photo else None
    patient_id = get_next_patient_id()
    regn_no = patient_id

    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            """INSERT INTO patients (id, name, age, gender, contact, medical_history, photo_path, dob, address, mobile, weight, regn_no)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (patient_id, name, age, gender, contact, medical_history, photo_path, dob, address, mobile or contact, weight, regn_no)
        )
        conn.commit()
    except Exception as e:
        conn.close()
        raise HTTPException(status_code=500, detail=f"Database error: {e}")

    conn.close()
    return {
        "id": patient_id,
        "name": name,
        "age": age,
        "gender": gender,
        "contact": contact,
        "medical_history": medical_history,
        "photo_path": photo_path,
        "dob": dob,
        "address": address,
        "mobile": mobile or contact,
        "weight": weight,
        "regn_no": regn_no
    }


@router.put("/patients/{id}")
def update_patient(id: str, payload: dict):
    allowed_fields = {
        "name": "name",
        "age": "age",
        "gender": "gender",
        "contact": "contact",
        "medical_history": "medical_history",
        "dob": "dob",
        "address": "address",
        "mobile": "mobile",
        "weight": "weight",
        "regn_no": "regn_no",
    }
    updates = []
    values = []
    for key, column in allowed_fields.items():
        if key in payload:
            updates.append(f"{column} = ?")
            values.append(payload[key])
    if not updates:
        raise HTTPException(status_code=400, detail="No valid patient fields supplied")

    values.append(id)
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(f"UPDATE patients SET {', '.join(updates)} WHERE id = ?", values)
    conn.commit()
    cursor.execute("SELECT * FROM patients WHERE id = ?", (id,))
    patient = cursor.fetchone()
    conn.close()
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")
    return dict(patient)

# 5. Upload Patient Document
@router.post("/patients/{id}/upload")
def upload_patient_document(id: str, document: UploadFile = File(...)):
    doc_path = save_uploaded_file(document)
    if not doc_path:
        raise HTTPException(status_code=400, detail="Failed to upload file")

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT documents FROM patients WHERE id = ?", (id,))
    row = cursor.fetchone()
    docs = []
    if row and row["documents"]:
        try:
            docs = json.loads(row["documents"])
        except Exception:
            docs = []
    docs.append(doc_path)
    cursor.execute("UPDATE patients SET documents = ? WHERE id = ?", (json.dumps(docs), id))
    conn.commit()
    conn.close()
    return {"filePath": doc_path, "documents": docs}

# 6. Frequent/Recent Patients List
@router.get("/reports/frequent-visits")
def frequent_visits():
    conn = get_db_connection()
    cursor = conn.cursor()
    sql = """
        SELECT p.id, p.name, p.age, p.gender, p.contact, COUNT(v.id) as visit_count
        FROM patients p
        LEFT JOIN visits v ON p.id = v.patient_id
        GROUP BY p.id
        ORDER BY visit_count DESC, p.id ASC
    """
    cursor.execute(sql)
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]

# 7. Log Visit & Create Prescription
@router.post("/prescriptions")
async def create_prescription(
    patient_id: str = Form(...),
    doctor_notes: Optional[str] = Form(None),
    medicines: str = Form(...),
    consultation_fee: int = Form(400),
    prescription_image: Optional[UploadFile] = File(None),
    chief_complaints: Optional[str] = Form(None),
    vitals: Optional[str] = Form(None),
    clinical_findings: Optional[str] = Form(None),
    diagnosis: Optional[str] = Form(None),
    prescription_date: Optional[str] = Form(None)
):
    image_path = save_uploaded_file(prescription_image) if prescription_image else None
    today = prescription_date or datetime.now().strftime("%Y-%m-%d")

    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT COUNT(*) as count FROM visits WHERE patient_id = ?", (patient_id,))
        row = cursor.fetchone()
        visit_number = (row["count"] if row else 0) + 1

        cursor.execute(
            "INSERT INTO visits (patient_id, date, doctor_notes, visit_number) VALUES (?, ?, ?, ?)",
            (patient_id, today, doctor_notes, visit_number)
        )
        visit_id = cursor.lastrowid

        payload = _normalize_prescription_payload({
            "medicines": _safe_json_loads(medicines, []),
            "consultation_fee": consultation_fee,
            "chief_complaints": _safe_json_loads(chief_complaints, []),
            "vitals": _safe_json_loads(vitals, {}),
            "clinical_findings": _safe_json_loads(clinical_findings, {}),
            "diagnosis": diagnosis or "",
            "prescription_date": today,
        })

        cursor.execute(
            """INSERT INTO prescriptions (visit_id, patient_id, medicines, consultation_fee, status, attached_image_path)
               VALUES (?, ?, ?, ?, 'sent', ?)""",
            (visit_id, patient_id, json.dumps(payload), consultation_fee, image_path)
        )
        prescription_id = cursor.lastrowid
        conn.commit()

        cursor.execute(
            """SELECT p.*, pat.name as patient_name, pat.age as patient_age, pat.gender as patient_gender
               FROM prescriptions p
               JOIN patients pat ON p.patient_id = pat.id
               WHERE p.id = ?""",
            (prescription_id,)
        )
        rx_row = cursor.fetchone()
        conn.close()

        rx_data = _enrich_prescription_row(rx_row)

        await manager.broadcast("NEW_PRESCRIPTION", rx_data)
        return rx_data

    except Exception as e:
        conn.close()
        raise HTTPException(status_code=500, detail=f"Database error: {e}")

# 8. Get Pending / Sent Prescriptions for Pharmacist verification queue
@router.put("/prescriptions/{id}")
async def update_prescription(id: int, payload: dict):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM prescriptions WHERE id = ?", (id,))
    rx = cursor.fetchone()
    if not rx:
        conn.close()
        raise HTTPException(status_code=404, detail="Prescription not found")

    current_data = _normalize_prescription_payload(rx["medicines"])
    current_data.update({
        "medicines": payload.get("medicines", current_data.get("medicines", [])),
        "consultation_fee": payload.get("consultation_fee", current_data.get("consultation_fee", 400)),
        "chief_complaints": payload.get("chief_complaints", current_data.get("chief_complaints", [])),
        "vitals": payload.get("vitals", current_data.get("vitals", {})),
        "clinical_findings": payload.get("clinical_findings", current_data.get("clinical_findings", {})),
        "diagnosis": payload.get("diagnosis", current_data.get("diagnosis", "")),
        "prescription_date": payload.get("prescription_date", current_data.get("prescription_date", datetime.now().strftime("%Y-%m-%d")))
    })
    cursor.execute(
        "UPDATE prescriptions SET medicines = ?, consultation_fee = ? WHERE id = ?",
        (json.dumps(current_data), int(current_data.get("consultation_fee", 400) or 400), id)
    )
    conn.commit()
    conn.close()
    return {"message": "Prescription updated", "id": id}

@router.get("/prescriptions/pending")
def get_pending_prescriptions():
    conn = get_db_connection()
    cursor = conn.cursor()
    sql = """
        SELECT p.*, pat.name as patient_name, pat.age as patient_age, pat.gender as patient_gender,
               pat.address as patient_address, pat.mobile as patient_mobile, pat.weight as patient_weight,
               pat.regn_no as patient_regn_no, pat.dob as patient_dob
        FROM prescriptions p
        JOIN patients pat ON p.patient_id = pat.id
        WHERE p.status IN ('sent', 'verified')
        ORDER BY p.created_at ASC
    """
    cursor.execute(sql)
    rows = cursor.fetchall()
    conn.close()
    return [_enrich_prescription_row(r) for r in rows]

# 9. Verify Prescription
@router.put("/prescriptions/{id}/verify")
async def verify_prescription(id: int):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM prescriptions WHERE id = ?", (id,))
    rx = cursor.fetchone()
    if not rx:
        conn.close()
        raise HTTPException(status_code=404, detail="Prescription not found")

    cursor.execute("UPDATE prescriptions SET status = 'verified' WHERE id = ?", (id,))
    conn.commit()
    conn.close()

    await manager.broadcast("PRESCRIPTION_UPDATED", {"id": id, "status": "verified"})
    return {"message": "Prescription verified", "id": id}

# 10. Generate Bill & Complete
@router.post("/bills")
async def generate_bill(payload: dict):
    prescription_id = payload.get("prescription_id")
    patient_name = payload.get("patient_name")
    patient_id = payload.get("patient_id")
    payment_method = payload.get("payment_method")
    verified_by = payload.get("verified_by")
    source_type = payload.get("source_type", "prescription")
    medicines_payload = payload.get("medicines")
    details = payload.get("details", {})
    today = datetime.now().strftime("%Y-%m-%d")

    if payment_method not in {"cash", "upi"}:
        raise HTTPException(status_code=400, detail="Payment method must be cash or upi")
    if not verified_by:
        raise HTTPException(status_code=400, detail="verified_by is required")

    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        bill_details = {}
        medicine_total = Decimal("0.00")
        consultation_fee = Decimal("0.00")

        if prescription_id:
            cursor.execute("""
                SELECT p.id, p.status, p.medicines, p.consultation_fee, p.patient_id,
                       pat.name, pat.age, pat.gender, pat.address, pat.mobile, pat.weight, pat.regn_no
                FROM prescriptions p
                JOIN patients pat ON p.patient_id = pat.id
                WHERE p.id = ?
            """, (prescription_id,))
            rx_row = cursor.fetchone()
            if not rx_row:
                raise HTTPException(status_code=404, detail="Prescription not found")
            if rx_row["status"] == "billed" or cursor.execute(
                "SELECT 1 FROM bills WHERE prescription_id = ? LIMIT 1", (prescription_id,)
            ).fetchone():
                raise HTTPException(status_code=409, detail="Prescription has already been billed")
            if rx_row["status"] not in {"verified", "sent"}:
                raise HTTPException(status_code=400, detail="Prescription is not ready for billing")

            normalized = _normalize_prescription_payload(rx_row["medicines"])
            meds_list = normalized.get("medicines", [])
            validated, medicine_total = _validated_medicines(cursor, meds_list)
            requested_fee = details.get("consultation_fee", normalized.get("consultation_fee", 400)) if isinstance(details, dict) else normalized.get("consultation_fee", 400)
            consultation_fee = _money(requested_fee)
            if consultation_fee < Decimal("400.00"):
                raise HTTPException(status_code=400, detail="Consultation fee cannot be less than Rs. 400")
            bill_details = {
                **normalized,
                "consultation_fee": float(consultation_fee),
                "medicine_total": float(medicine_total),
                "patient": {
                    "name": rx_row["name"], "age": rx_row["age"], "gender": rx_row["gender"],
                    "address": rx_row["address"], "mobile": rx_row["mobile"],
                    "weight": rx_row["weight"], "regn_no": rx_row["regn_no"],
                }
            }
        elif medicines_payload:
            normalized = _normalize_prescription_payload(medicines_payload)
            meds_list = normalized.get("medicines", [])
            validated, medicine_total = _validated_medicines(cursor, meds_list)
            bill_details = {
                **normalized,
                **(_safe_json_loads(details, {}) if not isinstance(details, dict) else details)
            }
            bill_details["medicine_total"] = float(medicine_total)
            consultation_fee = Decimal("0.00")
        else:
            raise HTTPException(status_code=400, detail="A prescription or medicines list is required")

        total = (medicine_total + consultation_fee).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        for row, quantity, _ in validated:
            cursor.execute("UPDATE medicines SET stock_quantity = stock_quantity - ? WHERE id = ?", (quantity, row["id"]))

        cursor.execute(
            """INSERT INTO bills (prescription_id, patient_name, patient_id, total_amount, payment_method, date, verified_by, source_type, details)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (prescription_id, patient_name, patient_id, float(total), payment_method, today, verified_by, source_type, json.dumps(bill_details))
        )
        if prescription_id:
            cursor.execute("UPDATE prescriptions SET status = 'billed' WHERE id = ?", (prescription_id,))

        conn.commit()
        conn.close()

        if prescription_id:
            await manager.broadcast("PRESCRIPTION_UPDATED", {"id": prescription_id, "status": "billed"})
        return {"message": "Billing completed successfully"}
    except HTTPException:
        conn.rollback()
        conn.close()
        raise
    except Exception as e:
        conn.close()
        raise HTTPException(status_code=500, detail=f"Database error: {e}")

# 11. Medicine Inventory CRUD
@router.get("/inventory")
def get_inventory(search: str = "", filter: str = ""):
    conn = get_db_connection()
    cursor = conn.cursor()
    query = "SELECT * FROM medicines"
    filters = []
    if search:
        filters.append("name LIKE ?")
    if filter == "expiring":
        filters.append("expiry_date IS NOT NULL")
    if filter == "low":
        filters.append("stock_quantity < 50")
    if filters:
        query += " WHERE " + " AND ".join(filters)
    if filter == "expiring":
        query += " ORDER BY expiry_date ASC"
    else:
        query += " ORDER BY name ASC"

    params = []
    if search:
        params.append(f"%{search}%")
    cursor.execute(query, params)
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]

@router.post("/inventory")
def add_inventory_item(payload: dict):
    name = payload.get("name")
    stock_quantity = int(payload.get("stock_quantity", 0))
    unit_price = float(payload.get("unit_price", 0.0))
    molecule = payload.get("molecule")
    batch_number = payload.get("batch_number")
    manufacturer = payload.get("manufacturer")
    dosage = payload.get("dosage")
    expiry_date = payload.get("expiry_date")

    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            "INSERT INTO medicines (name, stock_quantity, unit_price, molecule, batch_number, manufacturer, dosage, expiry_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (name, stock_quantity, unit_price, molecule, batch_number, manufacturer, dosage, expiry_date)
        )
        conn.commit()
        new_id = cursor.lastrowid
        conn.close()
        return {"id": new_id, "name": name, "stock_quantity": stock_quantity, "unit_price": unit_price, "molecule": molecule, "batch_number": batch_number, "manufacturer": manufacturer, "dosage": dosage, "expiry_date": expiry_date}
    except Exception as e:
        conn.close()
        raise HTTPException(status_code=400, detail=f"Item already exists or database error: {e}")

@router.put("/inventory/{id}")
def update_inventory_item(id: int, payload: dict):
    name = payload.get("name")
    stock_quantity = int(payload.get("stock_quantity"))
    unit_price = float(payload.get("unit_price"))
    molecule = payload.get("molecule")
    batch_number = payload.get("batch_number")
    manufacturer = payload.get("manufacturer")
    dosage = payload.get("dosage")
    expiry_date = payload.get("expiry_date")

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        "UPDATE medicines SET name = ?, stock_quantity = ?, unit_price = ?, molecule = ?, batch_number = ?, manufacturer = ?, dosage = ?, expiry_date = ? WHERE id = ?",
        (name, stock_quantity, unit_price, molecule, batch_number, manufacturer, dosage, expiry_date, id)
    )
    conn.commit()
    conn.close()
    return {"id": id, "name": name, "stock_quantity": stock_quantity, "unit_price": unit_price, "molecule": molecule, "batch_number": batch_number, "manufacturer": manufacturer, "dosage": dosage, "expiry_date": expiry_date}

@router.delete("/inventory/{id}")
def delete_inventory_item(id: int):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM medicines WHERE id = ?", (id,))
    conn.commit()
    conn.close()
    return {"message": "Medicine deleted", "id": id}

# 12. Appointments
@router.get("/appointments")
def get_appointments(date: str = None):
    if not date:
        date = datetime.now().strftime("%Y-%m-%d")
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM appointments WHERE date = ? ORDER BY time_slot ASC", (date,))
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]

@router.post("/appointments")
def create_appointment(payload: dict):
    patient_id = payload.get("patient_id")
    patient_name = payload.get("patient_name")
    patient_contact = payload.get("patient_contact")
    date = payload.get("date")
    time_slot = payload.get("time_slot")

    conn = get_db_connection()
    cursor = conn.cursor()

    # Verify daily cap of 45
    cursor.execute("SELECT COUNT(*) as count FROM appointments WHERE date = ? AND status != 'cancelled'", (date,))
    count_row = cursor.fetchone()
    if count_row and count_row["count"] >= 45:
        conn.close()
        raise HTTPException(status_code=400, detail="Appointment cap of 45 slots reached for this day")

    try:
        cursor.execute(
            """INSERT INTO appointments (patient_id, patient_name, patient_contact, date, time_slot, status)
               VALUES (?, ?, ?, ?, ?, 'booked')""",
            (patient_id or None, patient_name, patient_contact, date, time_slot)
        )
        conn.commit()
        new_id = cursor.lastrowid
        conn.close()
        return {
            "id": new_id,
            "patient_id": patient_id,
            "patient_name": patient_name,
            "patient_contact": patient_contact,
            "date": date,
            "time_slot": time_slot,
            "status": "booked"
        }
    except Exception as e:
        conn.close()
        raise HTTPException(status_code=500, detail=f"Database error: {e}")

@router.put("/appointments/{id}")
def update_appointment(id: int, payload: dict):
    status = payload.get("status")
    time_slot = payload.get("time_slot")

    conn = get_db_connection()
    cursor = conn.cursor()

    if status:
        cursor.execute("UPDATE appointments SET status = ? WHERE id = ?", (status, id))
    elif time_slot:
        cursor.execute("UPDATE appointments SET time_slot = ? WHERE id = ?", (time_slot, id))
    else:
        conn.close()
        raise HTTPException(status_code=400, detail="No field specified to update")

    conn.commit()
    conn.close()
    return {"message": "Appointment updated", "id": id}

# 13. End of Day Financial Report
@router.get("/reports/eod")
def get_eod_report(date: str = None):
    if not date:
        date = datetime.now().strftime("%Y-%m-%d")

    conn = get_db_connection()
    cursor = conn.cursor()
    sql = """
        SELECT b.*, COALESCE(b.patient_name, pat.name) as patient_name, COALESCE(b.patient_id, pat.id) as patient_id
        FROM bills b
        LEFT JOIN prescriptions p ON b.prescription_id = p.id
        LEFT JOIN patients pat ON p.patient_id = pat.id
        WHERE b.date = ?
        ORDER BY b.created_at ASC
    """
    cursor.execute(sql, (date,))
    rows = cursor.fetchall()
    conn.close()

    cash_total = 0.0
    upi_total = 0.0
    transactions = []

    for r in rows:
        bill = dict(r)
        details = _safe_json_loads(bill.get("details"), {})
        bill["details"] = details
        bill["medicines"] = details.get("medicines", [])
        transactions.append(bill)
        amount = float(bill.get("total_amount") or 0)
        if bill["payment_method"] == "cash":
            cash_total += amount
        elif bill["payment_method"] == "upi":
            upi_total += amount

    return {
        "date": date,
        "transactions": transactions,
        "cashTotal": cash_total,
        "upiTotal": upi_total,
        "grandTotal": cash_total + upi_total
    }
