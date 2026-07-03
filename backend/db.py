import sqlite3
import os
import re
import bcrypt

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "database.sqlite")

def get_db_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def hash_password(password: str) -> str:
    salt = bcrypt.gensalt(10)
    hashed = bcrypt.hashpw(password.encode('utf-8'), salt)
    return hashed.decode('utf-8')

def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        return bcrypt.checkpw(plain_password.encode('utf-8'), hashed_password.encode('utf-8'))
    except Exception:
        return False

def init_db():
    conn = get_db_connection()
    cursor = conn.cursor()

    # Enable foreign keys
    cursor.execute("PRAGMA foreign_keys = ON;")

    # 1. Users table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT CHECK(role IN ('doctor', 'pharmacist')) NOT NULL
    );
    """)

    # 2. Patients table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS patients (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      age INTEGER NOT NULL,
      gender TEXT NOT NULL,
      contact TEXT NOT NULL,
      medical_history TEXT,
      photo_path TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    """)

    # 3. Visits table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS visits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id TEXT NOT NULL,
      date TEXT NOT NULL,
      doctor_notes TEXT,
      visit_number INTEGER NOT NULL,
      FOREIGN KEY (patient_id) REFERENCES patients(id)
    );
    """)

    # 4. Medicines table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS medicines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      stock_quantity INTEGER NOT NULL DEFAULT 0,
      unit_price REAL NOT NULL DEFAULT 0.0
    );
    """)

    # 5. Prescriptions table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS prescriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      visit_id INTEGER NOT NULL,
      patient_id TEXT NOT NULL,
      medicines TEXT NOT NULL, -- JSON string
      consultation_fee INTEGER NOT NULL DEFAULT 400,
      status TEXT CHECK(status IN ('draft', 'sent', 'verified', 'billed')) NOT NULL DEFAULT 'draft',
      attached_image_path TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (visit_id) REFERENCES visits(id),
      FOREIGN KEY (patient_id) REFERENCES patients(id)
    );
    """)

    # 6. Bills table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS bills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      prescription_id INTEGER NOT NULL,
      total_amount REAL NOT NULL,
      payment_method TEXT CHECK(payment_method IN ('upi', 'cash')) NOT NULL,
      date TEXT NOT NULL,
      verified_by TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (prescription_id) REFERENCES prescriptions(id)
    );
    """)

    # 7. Appointments table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS appointments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id TEXT,
      patient_name TEXT,
      patient_contact TEXT,
      date TEXT NOT NULL,
      time_slot TEXT NOT NULL,
      status TEXT CHECK(status IN ('booked', 'completed', 'cancelled')) NOT NULL DEFAULT 'booked',
      FOREIGN KEY (patient_id) REFERENCES patients(id)
    );
    """)

    # Seed users
    cursor.execute("SELECT COUNT(*) FROM users")
    if cursor.fetchone()[0] == 0:
        doc_hash = hash_password("doctor123")
        pharm_hash = hash_password("pharmacist123")
        cursor.execute("INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)", ("doctor", doc_hash, "doctor"))
        cursor.execute("INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)", ("pharmacist", pharm_hash, "pharmacist"))

    # Seed medicines
    cursor.execute("SELECT COUNT(*) FROM medicines")
    if cursor.fetchone()[0] == 0:
        initial_medicines = [
            ("Paracetamol 650mg", 500, 2.5),
            ("Amoxicillin 500mg", 200, 6.0),
            ("Cetirizine 10mg", 300, 1.5),
            ("Ibuprofen 400mg", 250, 3.0),
            ("Pantoprazole 40mg", 150, 4.5),
            ("Metformin 500mg", 400, 2.0),
            ("Amlodipine 5mg", 350, 1.8)
        ]
        for name, stock, price in initial_medicines:
            cursor.execute("INSERT OR IGNORE INTO medicines (name, stock_quantity, unit_price) VALUES (?, ?, ?)", (name, stock, price))

    conn.commit()
    conn.close()
    print("Database SQLite initialised and seeded.")

def get_next_patient_id() -> str:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id FROM patients ORDER BY id DESC LIMIT 1")
    row = cursor.fetchone()
    conn.close()

    if not row:
        return "A001"

    last_id = row[0]
    prefix_match = re.match(r'^[A-Z]+', last_id)
    if not prefix_match:
        return "A001"

    prefix = prefix_match.group(0)
    num_part_str = last_id[len(prefix):]
    try:
        num_part = int(num_part_str)
    except ValueError:
        return "A001"

    if num_part < 999:
        num_part += 1
        new_num_str = f"{num_part:03d}"
        return f"{prefix}{new_num_str}"
    else:
        # Increment prefix character
        next_prefix = ""
        carry = True
        for char in reversed(prefix):
            char_code = ord(char)
            if carry:
                if char_code == 90:  # 'Z'
                    char_code = 65  # 'A'
                    carry = True
                else:
                    char_code += 1
                    carry = False
            next_prefix = chr(char_code) + next_prefix
        if carry:
            next_prefix = "A" + next_prefix
        return f"{next_prefix}001"
