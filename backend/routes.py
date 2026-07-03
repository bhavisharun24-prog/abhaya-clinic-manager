from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Depends
from typing import Optional, List
import json
import os
import shutil
import uuid
from datetime import datetime
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
    password = payload.get("password") # In a simplified local env, we can skip password check or verify doctor123/pharmacist123

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users WHERE username = ? AND role = ?", (username, role))
    user = cursor.fetchone()
    conn.close()

    if not user:
        raise HTTPException(status_code=401, detail="Invalid username or role")

    # Verify password if provided (doctor123 or pharmacist123)
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

# 2. Patient Search with Autocomplete
@router.get("/patients/search")
def search_patients(q: str = ""):
    if not q:
        return []
    conn = get_db_connection()
    cursor = conn.cursor()
    sql = """
        SELECT id, name, age, gender, contact, photo_path 
        FROM patients 
        WHERE id LIKE ? OR name LIKE ? 
        LIMIT 10
    """
    cursor.execute(sql, (f"%{q}%", f"%{q}%"))
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

    # Fetch latest prescription
    pr_sql = """
        SELECT p.* FROM prescriptions p
        INNER JOIN visits v ON p.visit_id = v.id
        WHERE v.patient_id = ?
        ORDER BY p.created_at DESC LIMIT 1
    """
    cursor.execute(pr_sql, (id,))
    latest_rx = cursor.fetchone()

    latest_rx_dict = None
    if latest_rx:
        latest_rx_dict = dict(latest_rx)
        try:
            latest_rx_dict["medicines"] = json.loads(latest_rx_dict["medicines"])
        except Exception:
            latest_rx_dict["medicines"] = []

    conn.close()
    return {
        "patient": dict(patient),
        "visits": visits,
        "latestPrescription": latest_rx_dict
    }

# 4. Create New Patient
@router.post("/patients")
def create_patient(
    name: str = Form(...),
    age: int = Form(...),
    gender: str = Form(...),
    contact: str = Form(...),
    medical_history: Optional[str] = Form(None),
    photo: Optional[UploadFile] = File(None)
):
    photo_path = save_uploaded_file(photo) if photo else None
    patient_id = get_next_patient_id()

    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            """INSERT INTO patients (id, name, age, gender, contact, medical_history, photo_path)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (patient_id, name, age, gender, contact, medical_history, photo_path)
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
        "photo_path": photo_path
    }

# 5. Upload Patient Document
@router.post("/patients/{id}/upload")
def upload_patient_document(id: str, document: UploadFile = File(...)):
    doc_path = save_uploaded_file(document)
    if not doc_path:
        raise HTTPException(status_code=400, detail="Failed to upload file")
    return {"filePath": doc_path}

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
    medicines: str = Form(...), # stringified JSON
    consultation_fee: int = Form(...),
    prescription_image: Optional[UploadFile] = File(None)
):
    image_path = save_uploaded_file(prescription_image) if prescription_image else None
    today = datetime.now().strftime("%Y-%m-%d")

    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        # Get patient visit count
        cursor.execute("SELECT COUNT(*) as count FROM visits WHERE patient_id = ?", (patient_id,))
        row = cursor.fetchone()
        visit_number = (row["count"] if row else 0) + 1

        # Create visit
        cursor.execute(
            "INSERT INTO visits (patient_id, date, doctor_notes, visit_number) VALUES (?, ?, ?, ?)",
            (patient_id, today, doctor_notes, visit_number)
        )
        visit_id = cursor.lastrowid

        # Create prescription (status set as 'sent')
        cursor.execute(
            """INSERT INTO prescriptions (visit_id, patient_id, medicines, consultation_fee, status, attached_image_path)
               VALUES (?, ?, ?, ?, 'sent', ?)""",
            (visit_id, patient_id, medicines, consultation_fee, image_path)
        )
        prescription_id = cursor.lastrowid
        conn.commit()

        # Fetch prescription details with patient names for broadcast
        cursor.execute(
            """SELECT p.*, pat.name as patient_name, pat.age as patient_age, pat.gender as patient_gender
               FROM prescriptions p
               JOIN patients pat ON p.patient_id = pat.id
               WHERE p.id = ?""",
            (prescription_id,)
        )
        rx_row = cursor.fetchone()
        conn.close()

        rx_data = dict(rx_row)
        rx_data["medicines"] = json.loads(rx_data["medicines"])

        # Broadcast real-time to pharmacist
        await manager.broadcast("NEW_PRESCRIPTION", rx_data)
        return rx_data

    except Exception as e:
        conn.close()
        raise HTTPException(status_code=500, detail=f"Database error: {e}")

# 8. Get Pending / Sent Prescriptions for Pharmacist verification queue
@router.get("/prescriptions/pending")
def get_pending_prescriptions():
    conn = get_db_connection()
    cursor = conn.cursor()
    sql = """
        SELECT p.*, pat.name as patient_name, pat.age as patient_age, pat.gender as patient_gender
        FROM prescriptions p
        JOIN patients pat ON p.patient_id = pat.id
        WHERE p.status IN ('sent', 'verified')
        ORDER BY p.created_at ASC
    """
    cursor.execute(sql)
    rows = cursor.fetchall()
    conn.close()

    result = []
    for r in rows:
        rx = dict(r)
        rx["medicines"] = json.loads(rx["medicines"])
        result.append(rx)
    return result

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
    total_amount = payload.get("total_amount")
    payment_method = payload.get("payment_method")
    verified_by = payload.get("verified_by")
    today = datetime.now().strftime("%Y-%m-%d")

    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        # Create bill
        cursor.execute(
            """INSERT INTO bills (prescription_id, total_amount, payment_method, date, verified_by)
               VALUES (?, ?, ?, ?, ?)""",
            (prescription_id, total_amount, payment_method, today, verified_by)
        )

        # Update prescription status
        cursor.execute("UPDATE prescriptions SET status = 'billed' WHERE id = ?", (prescription_id,))

        # Deduct stocks
        cursor.execute("SELECT medicines FROM prescriptions WHERE id = ?", (prescription_id,))
        rx_row = cursor.fetchone()
        if rx_row:
            meds = json.loads(rx_row["medicines"])
            for med in meds:
                # Quantity defaults to duration if quantity not filled
                qty = int(med.get("quantity") or med.get("duration") or 1)
                cursor.execute(
                    "UPDATE medicines SET stock_quantity = MAX(0, stock_quantity - ?) WHERE name = ?",
                    (qty, med["name"])
                )

        conn.commit()
        conn.close()

        await manager.broadcast("PRESCRIPTION_UPDATED", {"id": prescription_id, "status": "billed"})
        return {"message": "Billing completed successfully"}
    except Exception as e:
        conn.close()
        raise HTTPException(status_code=500, detail=f"Database error: {e}")

# 11. Medicine Inventory CRUD
@router.get("/inventory")
def get_inventory():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM medicines ORDER BY name ASC")
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]

@router.post("/inventory")
def add_inventory_item(payload: dict):
    name = payload.get("name")
    stock_quantity = int(payload.get("stock_quantity", 0))
    unit_price = float(payload.get("unit_price", 0.0))

    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            "INSERT INTO medicines (name, stock_quantity, unit_price) VALUES (?, ?, ?)",
            (name, stock_quantity, unit_price)
        )
        conn.commit()
        new_id = cursor.lastrowid
        conn.close()
        return {"id": new_id, "name": name, "stock_quantity": stock_quantity, "unit_price": unit_price}
    except Exception as e:
        conn.close()
        raise HTTPException(status_code=400, detail=f"Item already exists or database error: {e}")

@router.put("/inventory/{id}")
def update_inventory_item(id: int, payload: dict):
    name = payload.get("name")
    stock_quantity = int(payload.get("stock_quantity"))
    unit_price = float(payload.get("unit_price"))

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        "UPDATE medicines SET name = ?, stock_quantity = ?, unit_price = ? WHERE id = ?",
        (name, stock_quantity, unit_price, id)
    )
    conn.commit()
    conn.close()
    return {"id": id, "name": name, "stock_quantity": stock_quantity, "unit_price": unit_price}

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
        SELECT b.*, pat.name as patient_name, pat.id as patient_id
        FROM bills b
        JOIN prescriptions p ON b.prescription_id = p.id
        JOIN patients pat ON p.patient_id = pat.id
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
        transactions.append(bill)
        if bill["payment_method"] == "cash":
            cash_total += bill["total_amount"]
        elif bill["payment_method"] == "upi":
            upi_total += bill["total_amount"]

    return {
        "date": date,
        "transactions": transactions,
        "cashTotal": cash_total,
        "upiTotal": upi_total,
        "grandTotal": cash_total + upi_total
    }
