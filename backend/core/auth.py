from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt

from core.config import settings
from services.auth_service import get_user_by_email

# This must match the path of your login endpoint
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")

# These should exist in your settings.py (or equivalent)
SECRET_KEY = settings.JWT_SECRET
ALGORITHM = settings.JWT_ALGORITHM


def get_current_user(token: str = Depends(oauth2_scheme)):
    """
    Decode the JWT from Authorization: Bearer <token>
    and return the current user document (from MongoDB).
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    try:
        # Decode the JWT
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])

        email: str = payload.get("sub") or payload.get("email")
        if email is None:
            raise credentials_exception

    except JWTError:
        raise credentials_exception

    # Load the user from MongoDB
    user = get_user_by_email(email)
    if not user:
        raise credentials_exception

    return user
