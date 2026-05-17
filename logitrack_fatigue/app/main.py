from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers.checkin import router as checkin_router

app = FastAPI(title="LogiTrack Fatigue Service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(checkin_router)
