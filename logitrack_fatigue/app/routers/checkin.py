from fastapi import APIRouter
from app.schemas import CheckInSchema
from app import storage

router = APIRouter(prefix="/api/v1/driver", tags=["driver-checkin"])


@router.post("/checkin", status_code=200)
def submit_checkin(payload: CheckInSchema):
    record = storage.upsert_checkin(
        driver_id=payload.driver_id,
        horas_sueno=payload.horas_sueno,
        kss_level=payload.kss_level,
    )
    return {"ok": True, "checkin": record}
