import os
import shutil
import asyncio
from datetime import datetime
from backend.db import DB_PATH

BACKUPS_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "backups")

def ensure_backups_dir():
    if not os.path.exists(BACKUPS_DIR):
        os.makedirs(BACKUPS_DIR, exist_ok=True)

def run_backup():
    ensure_backups_dir()
    if not os.path.exists(DB_PATH):
        print("Database file does not exist yet. Skipping backup.")
        return

    now = datetime.now()
    date_str = now.strftime("%Y-%m-%d_%H-%M")
    backup_file_name = f"database_backup_{date_str}.sqlite"
    backup_path = os.path.join(BACKUPS_DIR, backup_file_name)

    try:
        shutil.copy2(DB_PATH, backup_path)
        print(f"Database backup saved successfully to {backup_path}")
        cleanup_old_backups()
    except Exception as e:
        print(f"Database backup failed: {e}")

def cleanup_old_backups():
    try:
        if not os.path.exists(BACKUPS_DIR):
            return
        files = [
            f for f in os.listdir(BACKUPS_DIR)
            if f.startswith("database_backup_") and f.endswith(".sqlite")
        ]
        
        # Gather file stats
        files_with_stats = []
        for f in files:
            file_path = os.path.join(BACKUPS_DIR, f)
            files_with_stats.append((f, file_path, os.path.getmtime(file_path)))
        
        # Sort files by modification time (newest first)
        files_with_stats.sort(key=lambda x: x[2], reverse=True)

        # Keep only the last 30 backups
        if len(files_with_stats) > 30:
            to_delete = files_with_stats[30:]
            for name, file_path, _ in to_delete:
                try:
                    os.remove(file_path)
                    print(f"Deleted old backup file: {name}")
                except Exception as e:
                    print(f"Failed to delete old backup file {name}: {e}")
    except Exception as e:
        print(f"Error during backup cleanup: {e}")

async def backup_scheduler_loop():
    ensure_backups_dir()
    # Wait 10 seconds after start to run initial backup
    await asyncio.sleep(10)
    run_backup()
    
    # Check/run every 24 hours
    while True:
        await asyncio.sleep(24 * 60 * 60)
        run_backup()
