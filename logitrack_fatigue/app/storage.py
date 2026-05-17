from datetime import date, datetime
from typing import Optional

# In-memory store: { (driver_id, date) -> record }
_store: dict[tuple[str, date], dict] = {}


def upsert_checkin(driver_id: str, horas_sueno: int, kss_level: int) -> dict:
    today = date.today()
    record = {
        "driver_id": driver_id,
        "date": today.isoformat(),
        "horas_sueno": horas_sueno,
        "kss_level": kss_level,
        "recorded_at": datetime.utcnow().isoformat(),
    }
    _store[(driver_id, today)] = record
    return record


def get_checkin(driver_id: str, for_date: Optional[date] = None) -> Optional[dict]:
    key = (driver_id, for_date or date.today())
    return _store.get(key)
