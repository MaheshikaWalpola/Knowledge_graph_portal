from datetime import datetime, timedelta
import secrets
from typing import Optional

from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from passlib.context import CryptContext
import jwt

from core.config import settings
from services.mongo_service import users_collection

security = HTTPBearer()

# Use pbkdf2_sha256 instead of bcrypt to avoid backend issues
pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def create_access_token(email: str, expires_minutes: int = 60*24) -> str:
    now = datetime.utcnow()
    payload = {
        "sub": email,
        "exp": now + timedelta(minutes=expires_minutes),
        "iat": now,
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def generate_verification_token() -> str:
    return secrets.token_urlsafe(32)


# --- DB operations ---


def get_user_by_email(email: str) -> Optional[dict]:
    return users_collection.find_one({"email": email})


def create_user(email: str, password: str, firstName: str, lastName: str) -> dict:
    existing = get_user_by_email(email)
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")

    verification_token = generate_verification_token()
    doc = {
        "email": email,
        "first_name": firstName,
        "last_name": lastName,
        "password_hash": hash_password(password),
        "is_verified": False,
        "verification_token": verification_token,
        "created_at": datetime.utcnow(),
    }
    users_collection.insert_one(doc)
    return doc


def verify_user_by_token(token: str) -> dict:
    user = users_collection.find_one({"verification_token": token})
    if not user:
        raise HTTPException(status_code=400, detail="Invalid or expired verification token")

    users_collection.update_one(
        {"_id": user["_id"]},
        {"$set": {"is_verified": True}, "$unset": {"verification_token": ""}},
    )
    user["is_verified"] = True
    user.pop("verification_token", None)
    return user

def decode_access_token(token: str) -> dict:
    try:
        payload = jwt.decode(
            token,
            settings.JWT_SECRET,
            algorithms=[settings.JWT_ALGORITHM],
        )
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")

def get_current_user_email(
    creds: HTTPAuthorizationCredentials = Depends(security),
) -> str:
    token = creds.credentials
    payload = decode_access_token(token)
    email = payload.get("sub")
    if not email:
        raise HTTPException(status_code=401, detail="Invalid token payload")
    return email

def update_user_name(email: str, first_name: str, last_name: str) -> None:
    users_collection.update_one(
        {"email": email},
        {"$set": {"first_name": first_name, "last_name": last_name}},
    )

def update_user_password_hash(email: str, new_password_hash: str) -> None:
    users_collection.update_one(
        {"email": email},
        {"$set": {"password_hash": new_password_hash}},
    )

def generate_reset_token() -> str:
    return secrets.token_urlsafe(32)

def set_reset_token(email: str, minutes: int = 30) -> str:
    token = generate_reset_token()
    expires = datetime.utcnow() + timedelta(minutes=minutes)

    users_collection.update_one(
        {"email": email},
        {"$set": {"reset_token": token, "reset_token_expires": expires}},
    )
    return token

def get_user_by_reset_token(token: str) -> dict:
    user = users_collection.find_one({"reset_token": token})
    if not user:
        raise HTTPException(status_code=400, detail="Invalid reset token")

    exp = user.get("reset_token_expires")
    if not exp or datetime.utcnow() > exp:
        raise HTTPException(status_code=400, detail="Reset token expired")

    return user

def clear_reset_token(user_id) -> None:
    users_collection.update_one(
        {"_id": user_id},
        {"$unset": {"reset_token": "", "reset_token_expires": ""}},
    )