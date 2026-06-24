import logging
from uuid import UUID

from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_user
from app.db.database import get_db
from app.db.models import RepositorySummary, User

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/v1/repository",
    tags=["Repository Intelligence"]
)


@router.get("/summary/{repo_id}", status_code=200)
def get_repository_summary(
    repo_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Retrieves the high-level LLM-generated repository architecture summary 
    by its database UUID.
    """
    summary = db.query(RepositorySummary).filter(RepositorySummary.id == repo_id).first()
    if not summary:
        raise HTTPException(status_code=404, detail="Repository summary not found.")
        
    return {
        "repo_id": str(summary.id),
        "repo_url": summary.repo_url,
        "summary": summary.summary_json
    }
