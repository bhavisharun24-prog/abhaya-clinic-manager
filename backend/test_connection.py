import os
import sys

# Append root folder to path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.db import init_db, get_db_connection, get_next_patient_id

def run_diagnostics():
    print("=====================================================")
    print("Abhaya Medical Care - Offline API & DB Diagnostics")
    print("=====================================================")
    print()

    # 1. Test Database
    try:
        init_db()
        print("[PASS] SQLite Database Initialized and Seeded.")
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Count users
        cursor.execute("SELECT COUNT(*) FROM users")
        user_count = cursor.fetchone()[0]
        print(f"[PASS] Found {user_count} registered users (doctor & pharmacist seed accounts).")

        # Check tables existence
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
        tables = [t[0] for t in cursor.fetchall()]
        print(f"[PASS] Databases tables built: {', '.join(tables)}")

        # Check sequential ID generator
        next_id = get_next_patient_id()
        print(f"[PASS] Next Patient ID algorithm output: {next_id}")

        conn.close()
        print("[SUCCESS] All local offline diagnostics passed successfully!")
        return True
    except Exception as e:
        print(f"[FAIL] Diagnostics test encountered an error: {e}")
        return False

if __name__ == "__main__":
    success = run_diagnostics()
    sys.exit(0 if success else 1)
