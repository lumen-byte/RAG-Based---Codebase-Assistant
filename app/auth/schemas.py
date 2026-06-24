import uuid
from datetime import datetime
from pydantic import BaseModel, ConfigDict, EmailStr


class UserBase(BaseModel):
    email: EmailStr


class UserCreate(UserBase):
    password: str


class UserResponse(UserBase):
    id: uuid.UUID
    created_at: datetime

    # Modern Pydantic V2 configuration to support ORM object conversion (from_attributes)
    model_config = ConfigDict(from_attributes=True)


class Token(BaseModel):
    """Legacy token schema — kept for backward compatibility."""
    access_token: str
    token_type: str


class AuthResponse(BaseModel):
    """Industry-standard auth response with both access and refresh tokens."""
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int  # seconds until access token expires


class RefreshTokenRequest(BaseModel):
    """Request schema for the token refresh endpoint."""
    refresh_token: str


class TokenData(BaseModel):
    email: str | None = None


class MessageResponse(BaseModel):
    """Generic status message response."""
    message: str


class GoogleAuthRequest(BaseModel):
    credential: str
