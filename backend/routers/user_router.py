from typing import Dict
from fastapi import APIRouter, Body, Depends

from controllers.user_controller import (
    ctrl_update_profile,
    ctrl_change_password,
    ctrl_forgot_password,
    ctrl_reset_password,
)

from services.auth_service import get_current_user_email

router = APIRouter(prefix="/user", tags=["user"])

@router.put("/profile")
def api_update_profile(
    firstName: str = Body(..., embed=True),
    lastName: str = Body(..., embed=True),
    email: str = Depends(get_current_user_email),
) -> Dict:
    return ctrl_update_profile(email=email, firstName=firstName, lastName=lastName)

@router.post("/change-password")
def api_change_password(
    currentPassword: str = Body(..., embed=True),
    newPassword: str = Body(..., embed=True),
    email: str = Depends(get_current_user_email),
) -> Dict:
    return ctrl_change_password(email=email, currentPassword=currentPassword, newPassword=newPassword)

@router.post("/forgotpassword")
def api_forgot_password(email: str = Body(..., embed=True)) -> Dict:
    return ctrl_forgot_password(email)

@router.post("/resetpassword")
def api_reset_password(
    token: str = Body(..., embed=True),
    newPassword: str = Body(..., embed=True),
) -> Dict:
    return ctrl_reset_password(token=token, newPassword=newPassword)