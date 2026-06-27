"""Bridge ESP32 parking status messages into the Express/SQLite backend.

ESP32 posts spotId/status to this FastAPI app. The bridge always maps the
incoming sensor value to the demo A1 slot, KNU_PARKING_6_A1, and forwards it to
the Express backend so the web app can read the saved DB state.
"""

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import json
import os
import sys
import urllib.error
import urllib.request


try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass


app = FastAPI()

_BACKEND_ORIGIN = os.getenv(
    "BACKEND_URL", "https://gangwon-parking-backend.fly.dev"
).rstrip("/")
EXPRESS_BACKEND_STATUS_URL = f"{_BACKEND_ORIGIN}/api/parking/status"
TARGET_A1_PARKING_ID = "KNU_PARKING_6_A1"


class ParkingStatus(BaseModel):
    spotId: str
    status: str


def status_to_occupied(status: str) -> bool:
    """Convert ESP32 status text into the boolean format used by the backend."""
    normalized = str(status or "").strip().lower()
    occupied_values = {
        "occupied",
        "occupy",
        "full",
        "car",
        "detected",
        "true",
        "1",
        "yes",
        "on",
        "차량 있음",
        "차량있음",
        "주차중",
        "주차 중",
    }
    empty_values = {
        "empty",
        "free",
        "available",
        "vacant",
        "clear",
        "false",
        "0",
        "no",
        "off",
        "차량 없음",
        "차량없음",
        "비어있음",
        "비어 있음",
    }

    if normalized in occupied_values:
        return True
    if normalized in empty_values:
        return False
    raise HTTPException(status_code=400, detail="Unknown parking status")


def forward_to_backend(is_occupied: bool) -> dict:
    """Persist the A1 state through the existing Express backend endpoint."""
    payload = {
        "parking_id": TARGET_A1_PARKING_ID,
        "is_occupied": is_occupied,
        "distance_cm": None,
    }
    body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        EXPRESS_BACKEND_STATUS_URL,
        data=body,
        headers={"Content-Type": "application/json; charset=utf-8"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=5) as response:
            response_body = response.read().decode("utf-8")
            return {
                "ok": True,
                "status_code": response.status,
                "backend_response": json.loads(response_body),
            }
    except urllib.error.HTTPError as error:
        return {
            "ok": False,
            "status_code": error.code,
            "backend_response": error.read().decode("utf-8", errors="replace"),
        }
    except Exception as error:
        return {
            "ok": False,
            "status_code": None,
            "backend_response": str(error),
        }


@app.get("/")
def read_root():
    return {
        "message": "ESP32 parking bridge is running",
        "target": TARGET_A1_PARKING_ID,
    }


@app.get("/health")
def health():
    return {
        "status": "ok",
        "target": EXPRESS_BACKEND_STATUS_URL,
    }


@app.post("/api/parking/status")
def update_parking_status(data: ParkingStatus):
    is_occupied = status_to_occupied(data.status)
    forwarded = forward_to_backend(is_occupied)

    print("\n[Data Received]")
    print(f" - Spot ID: {data.spotId}")
    print(f" - Status: {data.status}")
    print(f" - Parsed State: {'OCCUPIED' if is_occupied else 'EMPTY'}")
    print(f" - Connected Target: {TARGET_A1_PARKING_ID}")
    print(f" - DB Forwarded: {'success' if forwarded['ok'] else 'failed'}")
    print("-" * 40)

    return {
        "message": (
            "Data received, saved to DB, and reflected on A1"
            if forwarded["ok"]
            else "Data received, but DB forwarding failed"
        ),
        "spotId": data.spotId,
        "target_parking_id": TARGET_A1_PARKING_ID,
        "is_occupied": is_occupied,
        "forwarded": forwarded,
    }
