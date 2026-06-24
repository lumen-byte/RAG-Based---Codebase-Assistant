import os
from fastapi import Depends, HTTPException, status, Request
from clerk_backend_api import Clerk
from clerk_backend_api.security.types import AuthenticateRequestOptions
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.db.models import User
from app.config import CLERK_SECRET_KEY

if not CLERK_SECRET_KEY:
    # If not set in env, print warning (will fail at runtime)
    print("WARNING: CLERK_SECRET_KEY is not set in environment.")

# Initialize Clerk SDK
clerk = Clerk(bearer_auth=CLERK_SECRET_KEY or "missing_key")

class ClerkRequestShim:
    """Shim to adapt FastAPI Request to Clerk's Requestish interface"""
    def __init__(self, request: Request):
        self.headers = dict(request.headers)

async def get_current_user(
    request: Request,
    db: Session = Depends(get_db),
) -> User:
    """
    FastAPI dependency to secure endpoints using Clerk.
    Verifies the Bearer token via Clerk API, extracts the user ID,
    and returns the corresponding database User object (creating it if needed).
    """
    try:
        print("Clerk Auth - Headers:", dict(request.headers))
        request_state = await clerk.authenticate_request_async(
            request, 
            AuthenticateRequestOptions()
        )
        print("Clerk Auth - request_state.is_signed_in:", request_state.is_signed_in, "reason:", request_state.reason)
        
        if not request_state.is_signed_in:
            reason = str(request_state.reason) if request_state.reason else "Invalid authentication token."
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=reason,
                headers={"WWW-Authenticate": "Bearer"},
            )
            
        payload = request_state.payload
        if isinstance(payload, dict):
            clerk_id = payload.get("sub")
        elif hasattr(payload, "sub"):
            clerk_id = payload.sub
        elif hasattr(payload, "get"):
            clerk_id = payload.get("sub")
        else:
            clerk_id = None
        if not clerk_id:
            raise ValueError("Token missing subject (sub)")
            
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Authentication error: {str(e)}",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Query the user from the database
    statement = select(User).where(User.clerk_id == clerk_id)
    user = db.execute(statement).scalar_one_or_none()

    if user is None:
        try:
            # Fetch user details from Clerk to get the email
            clerk_user = await clerk.users.get_async(user_id=clerk_id)
            email = clerk_user.email_addresses[0].email_address if clerk_user.email_addresses else f"{clerk_id}@placeholder.com"
        except Exception:
            email = f"{clerk_id}@placeholder.com"
            
        user = User(clerk_id=clerk_id, email=email)
        db.add(user)
        db.commit()
        db.refresh(user)

    return user
