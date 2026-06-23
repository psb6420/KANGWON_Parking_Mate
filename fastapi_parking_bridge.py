from fastapi import FastAPI
from pydantic import BaseModel
import sys
import uvicorn

# 윈도우 터미널 한글 깨짐 방지
sys.stdout.reconfigure(encoding='utf-8')

app = FastAPI()

# ESP32로부터 받을 데이터 구조 (JSON) 정의
class ParkingStatus(BaseModel):
    spotId: str
    status: str

# 1. 브라우저 접속 테스트용 (서버가 잘 켜졌는지 확인)
@app.get("/")
def read_root():
    return {"message": "파이썬 서버가 정상적으로 켜져 있습니다! (연결 성공)"}

# 2. ESP32 데이터 수신용 엔드포인트
@app.post("/api/parking/status")
def update_parking_status(data: ParkingStatus):
    # 서버 터미널 화면에 보기 좋게 출력
    print(f"\n[데이터 수신 완료]")
    print(f" - 주차 구역 ID: {data.spotId}")
    
    if data.status == "OCCUPIED":
        print(f" - 주차 상태: 차량 있음 🚗 (OCCUPIED)")
    else:
        print(f" - 주차 상태: 차량 없음 텅~ (EMPTY)")
        
    print("-" * 40)
    
    return {"message": "데이터를 성공적으로 받았습니다"}

if __name__ == "__main__":
    # 파이썬 파일을 직접 실행했을 때 서버가 켜지도록 설정합니다.
    # host="0.0.0.0" 은 외부 기기(ESP32 등)의 접속을 허용한다는 뜻입니다.
    print("=========================================")
    print("  ESP32 주차 센서 수신 서버를 시작합니다...  ")
    print("=========================================")
    uvicorn.run("esp32_v1_sensor2:app", host="0.0.0.0", port=8000, reload=True)
