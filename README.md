# Gangwon-do Real-Time Parking Map

강원도 관광객과 지역 방문자를 위한 실시간 주차장 지도 및 AI 주차 추천 프로젝트입니다.

프론트엔드는 카카오맵 기반으로 강릉시 실시간 주차장과 강원대학교 프로토타입 주차장을 시각화하고, 백엔드는 공공데이터, 카카오 로컬 검색, Arduino 센서 데이터, Gemini 기반 추천 이유 생성을 연결합니다.

## 주요 기능

- 카카오맵 기반 주차장 위치 표시
- 강릉시 실시간 주차 정보 조회 및 5분 주기 새로고침
- 주차장 잔여면, 혼잡도, 요금/주소 등 사용자용 정보 표시
- 자연어 목적지 검색과 AI 주차 선호 분석
- 추천 순위 카드와 `1`, `2`, `3` 지도 마커 표시
- 모바일 홈/지도 탭과 지도·목록 높이 조절 및 독립 스크롤
- 좌표가 있는 모든 주차장을 카카오내비 앱에 전달하는 길찾기
- 길찾기 중 추천 주차장 잔여면 변경 Web Push 알림
- Arduino 센서 기반 주차면 상태 수집
- SSE(Server-Sent Events)를 통한 실시간 주차 상태 스트리밍
- Gemini API를 이용한 자연어 추천 이유 생성

## 프로젝트 구조

```text
.
├── index.html              # 루트 프론트엔드 페이지
├── server.js               # 프론트엔드 서버 및 공공데이터 프록시
├── fastapi_parking_bridge.py # ESP32 A1 센서 데이터를 백엔드 DB로 전달하는 브릿지
├── api/                    # Vercel API 엔트리
├── docs/                   # 카카오맵 기능 조사 및 프로젝트 문서
├── backend/                # Express + SQLite 백엔드
│   ├── server.js
│   ├── routes/
│   ├── services/
│   ├── db/
│   └── README.md
├── package.json
└── vercel.json
```

## 실행 환경

- Node.js 22.5 이상
- npm
- 공공데이터포털 서비스 키
- Kakao Developers REST API 키 및 JavaScript 키
- Google Gemini API 키

API 키가 없어도 서버 자체는 실행할 수 있지만, 외부 API 연동 기능은 제한됩니다.

## 프론트엔드 실행

```bash
npm install
npm start
```

기본 주소:

- http://localhost:8080

루트 서버는 `server.js`를 실행하며, 기본 포트는 `8080`입니다. 서버는 `0.0.0.0`에 바인딩되므로 같은 네트워크의 모바일 기기에서도 접속할 수 있습니다.

### 같은 Wi-Fi에서 모바일 접속

1. PC와 모바일 기기를 같은 Wi-Fi에 연결합니다.
2. PC의 Wi-Fi IPv4 주소를 확인합니다. Windows에서는 `ipconfig`의 Wi-Fi IPv4 주소를 사용합니다.
3. 모바일 브라우저에서 `http://PC_IP:8080`으로 접속합니다.

현재 개발 PC 예시:

```text
http://192.168.0.6:8080
```

모바일 브라우저는 Arduino 상태 백엔드도 같은 PC의 `3001` 포트로 연결합니다. Windows 방화벽에서 Node.js 인바운드 연결을 허용하고 프론트엔드와 Express 백엔드를 모두 실행해야 합니다.

카카오 지도와 카카오내비 JavaScript SDK를 LAN 주소에서 사용하려면 Kakao Developers 앱 설정의 Web 플랫폼/JavaScript SDK 허용 도메인에 접속 주소를 추가해야 합니다.

```text
http://192.168.0.6:8080
```

## 백엔드 실행

```bash
cd backend
npm install
copy .env.example .env
npm start
```

기본 주소:

- http://localhost:3001
- http://localhost:3001/health

## 목적지 추천과 카카오내비

홈 화면에서 장소명이나 자연어 요청을 입력하면 목적지와 주차 선호를 분석하고, 목적지 반경 1.5km 안의 추천 주차장 상위 3개를 표시합니다.

```text
홈에서 목적지 검색
  -> 목적지 좌표 검색
  -> 거리와 잔여면 기준 추천
  -> 지도 탭 자동 전환
  -> 1~3순위 마커와 추천 카드 표시
```

일반 목록과 추천 목록의 `길찾기` 버튼은 주차장 이름과 WGS84 경도/위도를 전달합니다. 모바일에서는 `Kakao.Navi.start()`로 카카오내비 앱을 실행하고, 앱이 설치돼 있지 않으면 설치 페이지로 이동합니다. 카카오내비 실행을 지원하지 않는 PC에서는 같은 목적지의 카카오맵 웹 길찾기를 새 탭으로 엽니다. 웹앱 내부에서 직접 턴바이턴 길 안내를 제공하는 방식은 아닙니다.

모바일에서 `길찾기`를 누르면 현재 추천 목록 상위 3곳을 최대 2시간 동안 감시합니다. Express 백엔드는 브라우저와 독립적으로 1분마다 강릉시 `getParkRltm`과 Arduino 주차면을 확인하고 다음 변경이 생길 때 Web Push를 보냅니다.

- 잔여면이 `1 이상 -> 0`이면 만차 알림
- 잔여면이 `0 -> 1 이상`이면 빈자리 발생 알림
- 그 외 변경은 이전 잔여면과 현재 잔여면 알림
- 여러 추천 주차장이 동시에 바뀌면 한 알림으로 묶어서 발송
- 새 길찾기를 시작하면 이전 감시는 현재 추천 목록으로 교체

Web Push는 Service Worker가 수신하므로 카카오내비가 전면에 있거나 Parking Mate 페이지가 닫혀 있어도 서버가 실행 중이면 알림을 받을 수 있습니다. 단, 다음 모바일 조건이 필요합니다.

- 서비스 주소는 `HTTPS`여야 합니다. PC의 `http://192.168.x.x:8080` LAN 주소에서는 모바일 Web Push를 사용할 수 없습니다.
- Android는 Chrome에서 알림 권한을 허용해야 합니다.
- iPhone/iPad는 iOS/iPadOS 16.4 이상에서 사이트를 홈 화면에 추가한 뒤 웹앱으로 열어야 합니다.
- 사용자가 최초 1회 알림 권한을 허용해야 합니다.
- 배포 환경에서는 프론트의 `PARKING_BACKEND_ORIGIN`을 장시간 실행되는 Express/Railway HTTPS 주소로 설정해야 합니다. Vercel Serverless 함수만으로는 1분 백그라운드 타이머를 유지할 수 없습니다.

## ESP32 A1 센서 브릿지 실행

강원대학교 주차장6의 A1 칸은 ESP32/FastAPI 브릿지와 연결됩니다. ESP32는 FastAPI 브릿지로 `spotId/status` 값을 보내고, 브릿지는 값을 `KNU_PARKING_6_A1`로 변환해 Express 백엔드의 `/api/parking/status`로 전달합니다. Express 백엔드는 SQLite DB에 저장하고, 웹 화면은 DB 값을 1초마다 읽어 A1 색상을 갱신합니다.

```bash
python -m uvicorn fastapi_parking_bridge:app --reload --host 0.0.0.0 --port 8000
```

기본 주소:

- FastAPI 브릿지: `http://localhost:8000`
- ESP32 전송 주소: `http://PC_IP:8000/api/parking/status`

ESP32 전송 예시:

```json
{
  "spotId": "A1",
  "status": "OCCUPIED"
}
```

상태 매핑:

- `OCCUPIED` -> `KNU_PARKING_6_A1` 저장값 `true` -> 화면 A1 빨간색, `꽉 차 있음`
- `EMPTY` -> `KNU_PARKING_6_A1` 저장값 `false` -> 화면 A1 초록색, `비어 있음`

전체 흐름:

```text
ESP32
  -> FastAPI bridge (:8000)
  -> Express backend (:3001)
  -> SQLite arduino_slots
  -> Web app (:8080), 1초 폴링으로 A1 반영
```

## 환경변수

루트 서버는 루트 `.env`와 `backend/.env`를 순서대로 읽고, Express 백엔드는 `backend/.env`를 사용합니다.

```env
PORT=3001
DATA_GO_KR_SERVICE_KEY=your_service_key_here
KAKAO_REST_API_KEY=your_kakao_rest_key_here
KAKAO_JAVASCRIPT_KEY=your_kakao_js_key_here
GEMINI_API_KEY=your_gemini_api_key_here
DB_PATH=
PARKING_BACKEND_ORIGIN=https://your-backend.example.com
VAPID_PUBLIC_KEY=your_public_vapid_key
VAPID_PRIVATE_KEY=your_private_vapid_key
VAPID_SUBJECT=mailto:your-email@example.com
PUSH_MONITOR_INTERVAL_MS=60000
```

주의: 실제 API 키는 GitHub에 커밋하지 않습니다. `backend/.env`는 `.gitignore`에 포함되어 있습니다.

## 주요 API

### 프론트엔드 서버

| Method | Path | 설명 |
|---|---|---|
| `GET` | `/api/config` | 프론트엔드에서 필요한 설정 조회 |
| `GET` | `/api/parking/gangwon-realtime` | 강릉시 `getParkInfo` + `getParkRltm` 기반 주차 정보 조회 |
| `GET` | `/api/parking/chuncheon-realtime` | 호환용 별칭. 내부 데이터 소스는 강릉시 API |
| `GET` | `/api/parking/all` | 호환용 별칭. 내부 데이터 소스는 강릉시 API |
| `GET` | `/api/parking/realtime-refresh` | 강릉시 실시간 주차 정보 갱신 |
| `POST` | `/api/ai/parking-intent` | 자연어에서 목적지와 주차 선호 추출 |
| `POST` | `/api/ai/parking-reasons` | 추천 주차장별 AI 추천 이유 생성 |

### 백엔드 서버

| Method | Path | 설명 |
|---|---|---|
| `GET` | `/health` | 서버 상태 확인 |
| `GET` | `/api/config` | API 키 설정 여부 확인 |
| `POST` | `/api/recommend` | 목적지 기준 주차장 추천 |
| `GET` | `/api/parking/lots` | 주차장 목록 조회 |
| `GET` | `/api/parking/realtime` | 주차장 실시간 현황 조회 |
| `POST` | `/api/parking/sync` | 강릉시 주차장 정보와 실시간 현황 동기화 |
| `POST` | `/api/parking/status` | Arduino 주차면 상태 수신 |
| `GET` | `/api/parking/status/live` | 실시간 주차면 상태 SSE |
| `POST` | `/api/arduino/lots` | Arduino 주차장 등록 |
| `GET` | `/api/arduino/lots` | Arduino 주차장 목록 |
| `GET` | `/api/destinations/search` | 목적지 검색 |
| `GET` | `/api/destinations/popular` | 인기 목적지 조회 |
| `GET` | `/api/destinations/events` | 지역 행사 조회 |
| `GET` | `/api/push/config` | Web Push 공개키와 감시 설정 조회 |
| `POST` | `/api/push/watch` | 현재 추천 주차장 감시 시작 또는 교체 |
| `DELETE` | `/api/push/watch/:watchId` | 추천 주차장 감시 중지 |

## 추천 로직

백엔드의 `ParkingScore`는 잔여 주차면과 목적지까지의 거리를 함께 반영합니다.

- 잔여면 점수: 10자리 이상이면 100점, 1자리 줄어들 때마다 10점씩 감점합니다.
- 거리 점수: 200m 이내이면 100점, 이후 100m 멀어질 때마다 10점씩 감점합니다.
- 최종 점수: `(잔여면 점수 + 거리 점수) / 2` 평균값을 사용합니다.
- 점수에 따라 `smooth`, `normal`, `congested` 혼잡도를 산출합니다.
- Gemini API 키가 있으면 1위 추천 주차장에 대한 자연어 추천 이유를 생성합니다.
- Gemini API 키가 없거나 호출이 실패하면 기본 추천 문구를 사용합니다.

## 배포

- 프론트엔드: Vercel 정적 배포 구조
- 백엔드: Railway 배포 설정 포함
- 백엔드 배포 시 `backend/railway.json`과 Railway 환경변수를 사용합니다.

필수 배포 환경변수:

- `DATA_GO_KR_SERVICE_KEY`
- `KAKAO_REST_API_KEY`
- `KAKAO_JAVASCRIPT_KEY`
- `GEMINI_API_KEY`
- `DB_PATH`

## 개발 메모

- 루트 `server.js`는 프론트엔드와 공공데이터 프록시 역할을 합니다.
- 루트 프론트엔드의 단일 진입점은 `index.html`입니다.
- `backend/server.js`는 Express API 서버입니다.
- 백엔드 상세 API 사용법은 `backend/README.md`를 참고합니다.
- 로컬 DB와 API 키 파일은 커밋하지 않습니다.
