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
    hashed = bcrypt.hashpw(password.encode("utf-8"), salt)
    return hashed.decode("utf-8")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))
    except Exception:
        return False


def _ensure_column(conn, table_name: str, column_name: str, definition: str):
    columns = [row[1] for row in conn.execute(f"PRAGMA table_info({table_name})")]
    if column_name not in columns:
        conn.execute(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {definition}")


def _ensure_user(cursor, username: str, password: str, role: str):
    row = cursor.execute("SELECT id FROM users WHERE role = ?", (role,)).fetchone()
    if row:
        return
    cursor.execute(
        "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)",
        (username, hash_password(password), role)
    )


def _migrate_users_table(conn):
    create_sql_row = conn.execute(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'"
    ).fetchone()
    create_sql = create_sql_row[0] if create_sql_row else ""
    if "rajeshwari" in create_sql.lower():
        return

    conn.execute("""
        CREATE TABLE IF NOT EXISTS users_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          role TEXT CHECK(role IN ('doctor', 'pharmacist', 'rajeshwari')) NOT NULL
        );
    """)
    conn.execute("""
        INSERT INTO users_new (id, username, password_hash, role)
        SELECT id, username, password_hash, role
        FROM users
    """)
    conn.execute("DROP TABLE users")
    conn.execute("ALTER TABLE users_new RENAME TO users")


def init_db():
    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute("PRAGMA foreign_keys = ON;")

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT CHECK(role IN ('doctor', 'pharmacist', 'rajeshwari')) NOT NULL
    );
    """)
    _migrate_users_table(conn)

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS patients (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      age INTEGER NOT NULL,
      gender TEXT NOT NULL,
      contact TEXT NOT NULL,
      medical_history TEXT,
      photo_path TEXT,
      dob TEXT,
      address TEXT,
      mobile TEXT,
      weight TEXT,
      regn_no TEXT,
      documents TEXT DEFAULT '[]',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    """)

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

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS medicines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      stock_quantity INTEGER NOT NULL DEFAULT 0,
      unit_price REAL NOT NULL DEFAULT 0.0,
      molecule TEXT,
      batch_number TEXT,
      manufacturer TEXT,
      dosage TEXT,
      expiry_date TEXT
    );
    """)

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS prescriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      visit_id INTEGER NOT NULL,
      patient_id TEXT NOT NULL,
      medicines TEXT NOT NULL,
      consultation_fee INTEGER NOT NULL DEFAULT 400,
      status TEXT CHECK(status IN ('draft', 'sent', 'verified', 'billed')) NOT NULL DEFAULT 'draft',
      attached_image_path TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (visit_id) REFERENCES visits(id),
      FOREIGN KEY (patient_id) REFERENCES patients(id)
    );
    """)

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS bills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      prescription_id INTEGER,
      patient_name TEXT,
      patient_id TEXT,
      total_amount REAL NOT NULL,
      payment_method TEXT CHECK(payment_method IN ('upi', 'cash')) NOT NULL,
      date TEXT NOT NULL,
      verified_by TEXT NOT NULL,
      source_type TEXT DEFAULT 'prescription',
      details TEXT DEFAULT '{}',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (prescription_id) REFERENCES prescriptions(id)
    );
    """)

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

    _ensure_column(conn, "medicines", "molecule", "TEXT")
    _ensure_column(conn, "medicines", "batch_number", "TEXT")
    _ensure_column(conn, "medicines", "manufacturer", "TEXT")
    _ensure_column(conn, "medicines", "dosage", "TEXT")
    _ensure_column(conn, "medicines", "expiry_date", "TEXT")
    _ensure_column(conn, "patients", "dob", "TEXT")
    _ensure_column(conn, "patients", "address", "TEXT")
    _ensure_column(conn, "patients", "mobile", "TEXT")
    _ensure_column(conn, "patients", "weight", "TEXT")
    _ensure_column(conn, "patients", "regn_no", "TEXT")
    _ensure_column(conn, "patients", "documents", "TEXT DEFAULT '[]'")
    _ensure_column(conn, "bills", "details", "TEXT DEFAULT '{}'")

    _ensure_user(cursor, "doctor", "doctor123", "doctor")
    _ensure_user(cursor, "pharmacist", "pharmacist123", "pharmacist")
    _ensure_user(cursor, "Rajeshwari", "Raji123", "rajeshwari")

    cursor.execute("SELECT COUNT(*) FROM medicines")
    if cursor.fetchone()[0] == 0:
        initial_medicines = [
            ("Paracetamol 650mg", 500, 2.5, "Paracetamol", "B001", "Abbott", "650mg", "2026-12-31"),
            ("Amoxicillin 500mg", 200, 6.0, "Amoxicillin", "B002", "Cipla", "500mg", "2026-09-18"),
            ("Cetirizine 10mg", 300, 1.5, "Cetirizine", "B003", "Sun Pharma", "10mg", "2026-08-10"),
            ("Ibuprofen 400mg", 250, 3.0, "Ibuprofen", "B004", "Mankind", "400mg", "2026-10-20"),
            ("Pantoprazole 40mg", 150, 4.5, "Pantoprazole", "B005", "Dr. Reddy", "40mg", "2026-12-01"),
            ("Metformin 500mg", 400, 2.0, "Metformin", "B006", "Zydus", "500mg", "2027-01-15"),
            ("Amlodipine 5mg", 350, 1.8, "Amlodipine", "B007", "Torrent", "5mg", "2026-11-09")
        ]
        for name, stock, price, molecule, batch, manufacturer, dosage, expiry in initial_medicines:
            cursor.execute(
                "INSERT OR IGNORE INTO medicines (name, stock_quantity, unit_price, molecule, batch_number, manufacturer, dosage, expiry_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (name, stock, price, molecule, batch, manufacturer, dosage, expiry)
            )

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
    prefix_match = re.match(r"^[A-Z]+", last_id)
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
        next_prefix = ""
        carry = True
        for char in reversed(prefix):
            char_code = ord(char)
            if carry:
                if char_code == 90:
                    char_code = 65
                    carry = True
                else:
                    char_code += 1
                    carry = False
            next_prefix = chr(char_code) + next_prefix
        if carry:
            next_prefix = "A" + next_prefix
        return f"{next_prefix}001"
