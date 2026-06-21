# 강원 Parking Mate — Backend

강원도 관광객을 위한 AI 주차 추천 서비스의 Express + SQLite 백엔드입니다.

## 기술 스택

- **Runtime**: Node.js 22.5+
- **Framework**: Express
- **DB**: SQLite (`node:sqlite` 내장 모듈)
- **실시간**: SSE (Server-Sent Events)
- **AI**: Google Gemini API (추천 이유 자연어 생성)

---

## 로컬 실행

```bash
cd backend

# 1. 의존성 설치
npm install

# 2. 환경변수 설정
cp .env.example .env
# .env 파일 열어서 API 키 입력

# 3. 서버 시작
npm start
# → http://localhost:3001
# → 데모 페이지: http://localhost:3001/demo.html
```

---

## 환경변수 (.env)

| 변수명 | 설명 | 필수 |
|---|---|---|
| `PORT` | 서버 포트 (기본 3001) | |
| `DATA_GO_KR_SERVICE_KEY` | 공공데이터포털 서비스 키 | |
| `KAKAO_REST_API_KEY` | 카카오 REST API 키 | |
| `KAKAO_JAVASCRIPT_KEY` | 카카오 JavaScript 키 | |
| `GEMINI_API_KEY` | Google Gemini API 키 | |
| `DB_PATH` | SQLite DB 파일 경로 (기본 `./parking_mate.db`) | |

---

## API 엔드포인트

### 프론트 설정값 가져오기

```
GET /api/config
```

```json
// 응답
{
  "kakaoJavascriptKey": "abc123",   // 카카오 지도 SDK 초기화에 사용
  "hasDataServiceKey": true,
  "hasGeminiKey": true,
  "hasKakaoRestKey": true
}
```

---

### 주차 추천 (핵심 기능)

```
POST /api/recommend
Content-Type: application/json
```

```json
// 요청 — 관광지 이름으로 검색
{ "destination": "안목해변" }

// 요청 — 좌표 직접 입력 (지도에서 클릭한 위치)
{ "lat": 37.7803, "lng": 128.9446, "radius": 1500 }
```

```json
// 응답
{
  "destination": {
    "name": "안목해변",
    "lat": 37.7803,
    "lng": 128.9446
  },
  "llmReason": "안목해변 주차장은 현재 여유롭고 도보 2분 거리로 가장 가깝습니다.",
  "totalCandidates": 5,
  "recommendations": [
    {
      "rank": 1,
      "managementNo": "TEST_ZONE",
      "name": "안목해변 공영주차장",
      "address": "강원특별자치도 강릉시 견소동",
      "lat": 37.7805,
      "lng": 128.9441,
      "availableSpots": 7,       // 잔여 주차면수 (null이면 정보 없음)
      "totalSpots": 50,
      "congestion": "smooth",    // smooth(초록) | normal(노랑) | congested(빨강)
      "distanceM": 120,          // 목적지까지 직선 거리 (미터)
      "walkMin": 2,              // 도보 시간 (분)
      "parkingScore": 83,        // 0~100점
      "scoreBreakdown": {
        "availScore": 70,        // 잔여면수 점수 (50% 반영)
        "distScore": 96          // 거리 점수 (50% 반영)
      },
      "source": "arduino",       // arduino | gangneung | kakao
      "updatedAt": "2026-06-12T13:00:00.000Z"
    },
    { "rank": 2, "..." : "..." },
    { "rank": 3, "..." : "..." }
  ]
}
```

> `congestion` 값으로 지도 핀 색상 결정:
> - `smooth` → 초록 (추천)
> - `normal` → 노랑 (보통)
> - `congested` → 빨강 (혼잡)

---

### Arduino 실시간 현황 (SSE)

지도에 Arduino 주차장을 실시간으로 표시할 때 사용합니다.

```javascript
// 프론트에서 이렇게 연결
const es = new EventSource("http://localhost:3001/api/parking/status/live");

es.onmessage = (e) => {
  const data = JSON.parse(e.data);

  if (data.type === "init") {
    // 페이지 첫 로드 시 현재 전체 상태
    console.log(data.lot_id, data.slots, data.available, data.total);
  }

  if (data.type === "update") {
    // 아두이노가 데이터 보낼 때마다 실시간 수신
    console.log(data.lot_id, data.slotLabel, data.is_occupied, data.available);
  }
};
```

```json
// init 이벤트 (연결 직후 현재 상태 전송)
{
  "type": "init",
  "lot_id": "TEST_ZONE",
  "name": "TEST_ZONE 주차장",
  "lat": 37.8018,
  "lng": 128.9014,
  "slots": [
    { "slot_no": 1, "slotLabel": "A1", "is_occupied": true,  "distance_cm": 8.5 },
    { "slot_no": 2, "slotLabel": "A2", "is_occupied": false, "distance_cm": 35.2 }
  ],
  "available": 1,
  "total": 2
}

// update 이벤트 (아두이노 데이터 수신마다 전송)
{
  "type": "update",
  "lot_id": "TEST_ZONE",
  "slot_no": 1,
  "slotLabel": "A1",
  "is_occupied": false,
  "distance_cm": 32.1,
  "available": 2,
  "total": 2,
  "updated_at": "2026-06-12T13:00:00.000Z"
}
```

---

### 관광지 검색

```
GET /api/destinations/search?q=안목해변
GET /api/destinations/popular
```

```json
// 응답
{
  "count": 3,
  "data": [
    {
      "name": "안목해변",
      "address": "강원특별자치도 강릉시 견소동",
      "lat": 37.7803,
      "lng": 128.9446,
      "category": "해수욕장"
    }
  ]
}
```

---

### 주차장 목록

```
GET /api/parking/realtime
GET /api/parking/lots?lat=37.78&lng=128.94&radius=1500
```

---

## 프론트 연동 시 주의사항

**기존 서버(`server.js`)와 엔드포인트가 다릅니다.**

| 기존 프론트가 쓰던 것 | 새 백엔드 |
|---|---|
| `/api/parking/gangwon-realtime` | `/api/parking/realtime` |
| `/api/config` | `/api/config` ✅ 동일 |

합칠 때 프론트에서 API 호출 주소만 바꿔주면 됩니다.

```javascript
// 개발 (로컬)
const API_BASE = "http://localhost:3001";

// 배포 후
const API_BASE = "https://xxx.railway.app";

// 사용 예시
const result = await fetch(`${API_BASE}/api/recommend`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ destination: "안목해변" })
}).then(r => r.json());
```

CORS는 이미 모든 도메인 허용으로 설정되어 있어 별도 설정 불필요합니다.

---

## ParkingScore 알고리즘

```
ParkingScore (0~100점) = 잔여면수 점수 × 50% + 거리 점수 × 50%
```

**잔여면수 점수**: 10자리 이상 = 100점, 1자리 줄어들 때마다 -10점
**거리 점수**: 300m 이내 = 100점, 100m 멀어질 때마다 -20점 (800m 이상 = 0점)

| ParkingScore | 지도 핀 색상 | congestion 값 |
|---|---|---|
| 65점 이상 | 초록 (추천) | `smooth` |
| 35~64점 | 노랑 (보통) | `normal` |
| 34점 이하 | 빨강 (혼잡) | `congested` |

---

## Gemini API (LLM 추천 이유)

`.env`에 키 한 줄만 추가하면 바로 동작합니다.

```
GEMINI_API_KEY=여기에_키_입력
```

**키 발급:** [aistudio.google.com](https://aistudio.google.com) → Get API key → Create API key (무료)

키가 없으면 규칙 기반 문장으로 자동 fallback 됩니다.

```
키 있음 → Gemini API 호출 → 자연어 추천 이유
키 없음 → fallback → "○○주차장은 여유롭고 현재 7면 여유가 있어 도보 4분 거리입니다."
```

현재 코드는 `gemini-1.5-flash` 모델 사용 중. 더 최신 무료 모델로 바꾸려면 `services/gemini.js` 1번째 줄에서 모델명만 교체하면 됩니다.

> AI Studio에서 현재 무료 제공 모델 목록을 확인 후 사용하세요. (2025년 8월 기준: gemini-1.5-flash 무료)

---

## Arduino 연동

ESP32 초음파 센서 코드에서 서버 주소만 설정하면 됩니다.

```cpp
// 로컬 테스트 (노트북과 아두이노가 같은 와이파이일 때)
const char* serverName = "http://192.168.x.x:3001/api/parking/status";

// Railway 배포 후
const char* serverName = "https://your-app.railway.app/api/parking/status";

// parking_id 형식: "주차장ID_슬롯번호"
// → TEST_ZONE_A1, TEST_ZONE_A2 는 자동으로 같은 주차장(TEST_ZONE)으로 묶임
const char* parkingID = "TEST_ZONE_A1";
```

**네트워크 구성 (로컬 테스트 시)**
```
스마트폰 핫스팟
  ├── 노트북 연결  → npm start 실행, ipconfig로 IP 확인
  └── 아두이노 연결 → 노트북 IP로 데이터 전송
```

실시간 데모 페이지: `http://서버주소/demo.html`

---

## Railway 배포

### 1. GitHub push

```bash
git add backend/
git commit -m "Add backend"
git push
```

### 2. Railway 프로젝트 생성

1. [railway.app](https://railway.app) 접속 → GitHub 로그인
2. **New Project** → **Deploy from GitHub repo**
3. `kakao-map-app` 레포 선택 후 배포 시작

### 3. Root Directory 설정

**Settings** 탭 → **Root Directory** → `backend` 입력 → **Save**

### 4. 환경변수 등록

**Variables** 탭에서 아래 항목 추가:

```
DATA_GO_KR_SERVICE_KEY  = 실제키
KAKAO_REST_API_KEY      = 실제키
KAKAO_JAVASCRIPT_KEY    = 실제키
GEMINI_API_KEY          = 실제키
DB_PATH                 = /data/parking_mate.db
```

### 5. 볼륨 추가 (DB 영구 저장)

**+ New** → **Volume** → Mount Path: `/data` → Add

### 6. 도메인 확인 후 Arduino 코드 수정

**Settings** → **Networking** → **Generate Domain**
→ `https://xxx.railway.app` URL 발급

```cpp
const char* serverName = "https://xxx.railway.app/api/parking/status";
```

---

## 프로젝트 구조

```
backend/
├── server.js              ← Express 앱 진입점
├── railway.json           ← Railway 배포 설정
├── package.json
├── .env.example           ← 환경변수 템플릿
├── db/
│   └── index.js           ← SQLite 스키마 초기화
├── routes/
│   ├── status.js          ← POST /api/parking/status (Arduino)
│   ├── recommend.js       ← POST /api/recommend (ParkingScore + LLM)
│   ├── parking.js         ← 주차장 목록/실시간 현황
│   ├── arduino.js         ← Arduino 주차장 관리
│   ├── destinations.js    ← 관광지/행사 검색
│   └── config.js          ← 프론트 설정값
├── services/
│   ├── parkingScore.js    ← ParkingScore 알고리즘
│   ├── publicApi.js       ← 공공API 호출
│   └── gemini.js          ← LLM 추천 이유 생성
└── public/
    └── demo.html          ← Arduino 실시간 데모 페이지
```
