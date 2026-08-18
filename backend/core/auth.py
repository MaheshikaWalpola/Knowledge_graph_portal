from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt

from core.config import settings
from services.auth_service import get_user_by_email

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")

SECRET_KEY = settings.JWT_SECRET
ALGORITHM = settings.JWT_ALGORITHM


def get_current_user(token: str = Depends(oauth2_scheme)):
    """Decode JWT and return the current user document."""
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

    # Load user from MongoDB
    user = get_user_by_email(email)
    if not user:
        raise credentials_exception

    return user
