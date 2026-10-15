from typing import Dict
from fastapi import HTTPException

from services.auth_service import (
    create_user,
    get_user_by_email,
    verify_password,
    create_access_token,
    verify_user_by_token,
)
from services.email_service import send_verification_email

def ctrl_register_user(email: str, password: str, firstName: str, lastName: str) -> Dict:
    print("Registering user:", email);
    user = create_user(email, password, firstName, lastName)
    token = user.get("verification_token")
    print("Verification token:", token)
    if token:
        send_verification_email(user["email"], token)
        print("test1")
    print("test2")
    return {"status": "ok", "message": "User registered. Please check your email to verify."}

def ctrl_verify_email(token: str) -> Dict:
    user = verify_user_by_token(token)

    access_token = create_access_token(email=user["email"])

    user_payload = {
        "email": user["email"],
        "firstName": user.get("first_name", ""),
        "lastName": user.get("last_name", ""),
        "isVerified": user.get("is_verified", True),
    }

    return {
        "status": "ok",
        "message": "Email verified successfully.",
        "access_token": access_token,
        "token_type": "bearer",
        "user": user_payload,
    }

def ctrl_login(email: str, password: str) -> Dict:
    user = get_user_by_email(email)
    if not user:
        raise HTTPException(status_code=400, detail="Invalid email or password")

    if not verify_password(password, user["password_hash"]):
        raise HTTPException(status_code=400, detail="Invalid email or password")

    if not user.get("is_verified"):
        raise HTTPException(status_code=400, detail="Email not verified")

    token = create_access_token(email=user["email"])

    return {
        "access_token": token,
        "token_type": "bearer",
        "first_name": user.get("first_name", ""),
        "last_name": user.get("last_name", "")
    }
