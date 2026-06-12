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

### 주차 추천
| Method | URL | 설명 |
|---|---|---|
| `POST` | `/api/recommend` | 목적지 입력 → ParkingScore 계산 → 상위 5개 추천 |

```json
// 요청
{ "destination": "안목해변" }

// 또는 좌표 직접 입력
{ "lat": 37.7803, "lng": 128.9446, "radius": 1500 }
```

### Arduino 센서 (실시간)
| Method | URL | 설명 |
|---|---|---|
| `POST` | `/api/parking/status` | Arduino → 서버로 센서 데이터 전송 |
| `GET` | `/api/parking/status/live` | 브라우저 SSE 실시간 연결 |

```json
// Arduino가 보내는 형식
{ "parking_id": "TEST_ZONE_A1", "is_occupied": true, "distance_cm": 8.5 }
```

### 주차장 정보
| Method | URL | 설명 |
|---|---|---|
| `GET` | `/api/parking/lots` | 주차장 목록 (`?lat=&lng=&radius=` 필터 가능) |
| `GET` | `/api/parking/realtime` | 실시간 현황 |
| `POST` | `/api/parking/sync` | 공공API → DB 동기화 |

### 관광지
| Method | URL | 설명 |
|---|---|---|
| `GET` | `/api/destinations/search?q=안목해변` | 관광지 검색 |
| `GET` | `/api/destinations/popular` | 인기 관광지 목록 |
| `GET` | `/api/destinations/events` | 강원도 행사/축제 |

### 기타
| Method | URL | 설명 |
|---|---|---|
| `GET` | `/api/config` | 프론트 공개 설정 (Kakao JS 키 등) |
| `GET` | `/health` | 서버 상태 확인 |

---

## ParkingScore 알고리즘

```
ParkingScore (0~100점) = 잔여면수 점수 × 50% + 거리 점수 × 50%
```

**잔여면수 점수**: 10자리 이상 = 100점, 1자리 줄어들 때마다 -10점
**거리 점수**: 300m 이내 = 100점, 100m 멀어질 때마다 -20점 (800m~= 0점)

| ParkingScore | 지도 핀 색상 |
|---|---|
| 65점 이상 | 초록 (추천) |
| 35~64점 | 노랑 (보통) |
| 34점 이하 | 빨강 (혼잡) |

---

## Arduino 연동

ESP32 초음파 센서 코드에서 서버 주소만 설정하면 됩니다.

```cpp
// 로컬 테스트
const char* serverName = "http://192.168.x.x:3001/api/parking/status";

// Railway 배포 후
const char* serverName = "https://your-app.railway.app/api/parking/status";

// parking_id 형식: "주차장ID_슬롯ID"
// 예: "TEST_ZONE_A1", "TEST_ZONE_A2"
const char* parkingID = "TEST_ZONE_A1";
```

`parking_id`의 `TEST_ZONE_A1`, `TEST_ZONE_A2`는 자동으로 같은 주차장(TEST_ZONE)의 슬롯 1, 2번으로 묶입니다.

실시간 데모 페이지: `http://서버주소/demo.html`

---

## Railway 배포

> 아래 내용 참고하여 배포하세요.

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
(저장하면 자동으로 재배포됩니다)

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

### 6. 도메인 확인

**Settings** → **Networking** → **Generate Domain** 클릭
→ `https://xxx.railway.app` 형태의 URL 발급

### 7. Arduino 코드 수정

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
│   ├── recommend.js       ← POST /api/recommend (ParkingScore)
│   ├── parking.js         ← 주차장 CRUD
│   ├── arduino.js         ← Arduino 주차장 관리
│   ├── destinations.js    ← 관광지/행사 검색
│   └── config.js          ← 클라이언트 설정
├── services/
│   ├── parkingScore.js    ← ParkingScore 알고리즘
│   ├── publicApi.js       ← 공공API 호출
│   └── gemini.js          ← LLM 추천 이유 생성
└── public/
    └── demo.html          ← Arduino 실시간 데모 페이지
```
