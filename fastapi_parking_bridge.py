from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import json
import sys
import urllib.error
import urllib.request


# Windows PowerShell encoding error prevention
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass


app = FastAPI()

EXPRESS_BACKEND_STATUS_URL = "http://localhost:3001/api/parking/status"
TARGET_A1_PARKING_ID = "KNU_PARKING_6_A1"


class ParkingStatus(BaseModel):
    spotId: str
    status: str


def status_to_occupied(status: str) -> bool:
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

    raise HTTPException(
        status_code=400,
        detail=(
            "Unknown status. Use occupied/empty, true/false, 1/0, "
            "차량 있음/차량 없음, or equivalent values."
        ),
    )


def forward_to_a1(data: ParkingStatus, is_occupied: bool) -> dict:
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
        error_body = error.read().decode("utf-8", errors="replace")
        return {
            "ok": False,
            "status_code": error.code,
            "backend_response": error_body,
        }
    except Exception as error:
        return {
            "ok": False,
            "status_code": None,
            "backend_response": str(error),
        }


@app.get("/health")
def health():
    return {"status": "ok", "target": EXPRESS_BACKEND_STATUS_URL}


@app.post("/api/parking/status")
def update_parking_status(data: ParkingStatus):
    is_occupied = status_to_occupied(data.status)
    state_str = "차량 있음" if is_occupied else "차량 없음"
    forwarded = forward_to_a1(data, is_occupied)

    print("\n[Data Received]")
    print(f" - Spot ID: {data.spotId}")
    print(f" - Status: {data.status}")
    print(f" - Parsed State: {state_str}")
    print(f" - Connected Target: {TARGET_A1_PARKING_ID}")
    print(f" - Forwarded: {'success' if forwarded['ok'] else 'failed'}")
    print("-" * 40)

    if not forwarded["ok"]:
        return {
            "message": "Data received, but A1 forwarding failed",
            "spotId": data.spotId,
            "target_parking_id": TARGET_A1_PARKING_ID,
            "is_occupied": is_occupied,
            "forwarded": forwarded,
        }

    return {
        "message": "Data received successfully and reflected on A1",
        "spotId": data.spotId,
        "target_parking_id": TARGET_A1_PARKING_ID,
        "is_occupied": is_occupied,
        "forwarded": forwarded,
    }
