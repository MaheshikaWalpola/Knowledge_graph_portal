from typing import Dict
from fastapi import HTTPException

from services.auth_service import (
    get_user_by_email,
    verify_password,
    hash_password,
    update_user_name,
    update_user_password_hash,
    set_reset_token,
    get_user_by_reset_token,
    clear_reset_token,
)

from services.email_service import send_password_reset_email


def ctrl_update_profile(email: str, firstName: str, lastName: str) -> Dict:
    user = get_user_by_email(email)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    first = (firstName or "").strip()
    last = (lastName or "").strip()

    if not first:
        raise HTTPException(status_code=400, detail="First name is required")
    if not last:
        raise HTTPException(status_code=400, detail="Last name is required")

    update_user_name(email=email, first_name=first, last_name=last)

    return {
        "status": "ok",
        "message": "Profile updated",
        "user": {"email": email, "firstName": first, "lastName": last},
    }


def ctrl_change_password(email: str, currentPassword: str, newPassword: str) -> Dict:
    user = get_user_by_email(email)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if not verify_password(currentPassword, user["password_hash"]):
        raise HTTPException(status_code=400, detail="Current password is incorrect")

    if len(newPassword) < 8:
        raise HTTPException(status_code=400, detail="New password must be at least 8 characters")

    new_hash = hash_password(newPassword)
    update_user_password_hash(email=email, new_password_hash=new_hash)

    return {"status": "ok", "message": "Password updated"}


def ctrl_forgot_password(email: str) -> Dict:
    user = get_user_by_email(email)
    if not user:
        raise HTTPException(status_code=404, detail="User does not exist")

    token = set_reset_token(email=email, minutes=30)
    send_password_reset_email(to_email=email, token=token)

    return {"status": "ok", "message": "Reset link sent"}


def ctrl_reset_password(token: str, newPassword: str) -> Dict:
    if len(newPassword) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")

    user = get_user_by_reset_token(token)

    new_hash = hash_password(newPassword)
    update_user_password_hash(email=user["email"], new_password_hash=new_hash)
    clear_reset_token(user["_id"])

    return {"status": "ok", "message": "Password reset successful"}
