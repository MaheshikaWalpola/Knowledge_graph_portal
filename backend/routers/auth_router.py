# routers/auth_router.py
from typing import Optional, Dict
from fastapi import APIRouter, Body, Query

from controllers.auth_controller import (
    ctrl_register_user,
    ctrl_verify_email,
    ctrl_login,
)

router = APIRouter(prefix="/auth", tags=["auth"])

@router.post("/register")
def api_register_user(
    email: str = Body(..., embed=True),
    password: str = Body(..., embed=True),
    firstName: str = Body(..., embed=True),
    lastName: str = Body(..., embed=True),
) -> Dict:
    return ctrl_register_user(email, password, firstName, lastName)

@router.get("/verify-email")
def api_verify_email(token: str = Query(...)) -> Dict:
    return ctrl_verify_email(token)

@router.post("/login")
def api_login(
    email: str = Body(..., embed=True),
    password: str = Body(..., embed=True),
) -> Dict:
    return ctrl_login(email, password)
