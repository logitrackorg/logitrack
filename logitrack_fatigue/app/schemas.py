from pydantic import BaseModel, Field


class CheckInSchema(BaseModel):
    driver_id: str
    horas_sueno: int = Field(..., ge=0, le=24)
    kss_level: int = Field(..., ge=1, le=9)
