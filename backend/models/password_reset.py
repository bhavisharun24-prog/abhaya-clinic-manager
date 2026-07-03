import secrets
from datetime import datetime, timedelta
from backend.db import get_db_connection, hash_password, verify_password


def create_reset_token(user_id: int, expires_minutes: int = 60) -> str:
    """Generate a secure token, store its hash with expiry, and return the raw token.
    Default TTL is 60 minutes.
    """
    token = secrets.token_urlsafe(20)
    expiry = datetime.utcnow() + timedelta(minutes=expires_minutes)
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?, ?, ?)",
        (user_id, hash_password(token), expiry.isoformat())
    )
    conn.commit()
    conn.close()
    return token


def verify_reset_token(token: str) -> int | None:
    """Check a raw token against stored hashes and expiry.
    Returns the associated user_id if valid, otherwise None.
    """
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT user_id, token_hash, expires_at FROM password_resets WHERE expires_at > ?",
        (datetime.utcnow().isoformat(),)
    )
    rows = cursor.fetchall()
    for row in rows:
        if verify_password(token, row["token_hash"]):
            conn.close()
            return row["user_id"]
    conn.close()
    return None
