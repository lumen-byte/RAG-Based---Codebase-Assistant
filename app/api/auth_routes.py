from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session
from pydantic import BaseModel, EmailStr
from datetime import timedelta
import logging

from app.db.database import get_db
from app.db.models import User
from app.auth.security import verify_password, get_password_hash, create_access_token
from app.auth.dependencies import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/auth", tags=["Authentication"])

class UserCreate(BaseModel):
    email: EmailStr
    password: str

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class GoogleLogin(BaseModel):
    email: EmailStr
    google_id: str

@router.post("/register")
def register_user(user: UserCreate, db: Session = Depends(get_db)):
    statement = select(User).where(User.email == user.email)
    existing_user = db.execute(statement).scalar_one_or_none()
    
    if existing_user:
        raise HTTPException(status_code=400, detail="Email already registered")
        
    hashed_password = get_password_hash(user.password)
    new_user = User(email=user.email, hashed_password=hashed_password)
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    
    return {"message": "User registered successfully"}

@router.post("/login")
def login_user(user: UserLogin, db: Session = Depends(get_db)):
    statement = select(User).where(User.email == user.email)
    db_user = db.execute(statement).scalar_one_or_none()
    
    if not db_user or not db_user.hashed_password:
        raise HTTPException(status_code=401, detail="Invalid credentials")
        
    if not verify_password(user.password, db_user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid credentials")
        
    access_token = create_access_token(data={"sub": str(db_user.id)})
    return {"access_token": access_token, "token_type": "bearer"}

@router.post("/google")
def google_login(google_user: GoogleLogin, db: Session = Depends(get_db)):
    # Find user by email or google_id
    statement = select(User).where(User.email == google_user.email)
    db_user = db.execute(statement).scalar_one_or_none()
    
    if not db_user:
        # Create new OAuth user
        db_user = User(email=google_user.email, google_id=google_user.google_id)
        db.add(db_user)
        db.commit()
        db.refresh(db_user)
    elif not db_user.google_id:
        # Link existing email-only user to Google account
        db_user.google_id = google_user.google_id
        db.commit()
        db.refresh(db_user)
        
    access_token = create_access_token(data={"sub": str(db_user.id)})
    return {"access_token": access_token, "token_type": "bearer"}

@router.get("/me")
def get_me(current_user: User = Depends(get_current_user)):
    return {"email": current_user.email, "id": str(current_user.id)}
