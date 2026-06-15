import asyncio
from app.db.database import SessionLocal, Base, engine
from app.db import models
from app.auth.security import hash_password

def test_db():
    try:
        # Re-run create_all just to be absolutely sure
        Base.metadata.create_all(bind=engine)
        db = SessionLocal()
        new_user = models.User(email="test3@example.com", hashed_password=hash_password("password"))
        db.add(new_user)
        db.commit()
        db.refresh(new_user)
        print("SUCCESS:", new_user.id)
    except Exception as e:
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    test_db()
