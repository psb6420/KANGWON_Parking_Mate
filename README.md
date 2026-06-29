# 강원 Parking Mate (Gangwon-do Real-Time Parking Map)

강원도 관광객과 지역 방문자를 위한 **실시간 주차장 지도 + AI 주차 추천 + 길찾기 중 잔여면 변경 알림** 서비스입니다.

카카오맵 위에 강릉시 실시간 공영주차장과 강원대학교 IoT 프로토타입 주차장을 함께 표시하고, 자연어로 목적지를 입력하면 AI가 의도를 분석해 목적지 반경 1.5km 안의 추천 주차장 상위 3곳을 골라 줍니다. 길찾기를 시작하면 백엔드가 추천 주차장의 잔여면을 계속 감시하다가 변동이 생기면 Web Push로 알려 줍니다.

- **라이브 데모(PWA)**: https://gangwon-do-realtime-parking-map.vercel.app
- **GitHub 저장소**: https://github.com/psb6420/KANGWON_Parking_Mate

> 모바일에서는 사이트를 홈 화면에 추가하면 앱처럼 전체화면으로 실행되고(PWA), 안드로이드는 이 저장소의 TWA 앱으로 설치할 수도 있습니다.

---

## 사용 기술

| 영역 | 기술 |
|---|---|
| **프론트엔드** | Vanilla JS(프레임워크 없음), HTML/CSS, 카카오맵 JavaScript SDK, 카카오내비 SDK |
| **PWA** | Web App Manifest, Service Worker(`sw.js`), Web Push |
| **프론트 서버** | Node.js 내장 `http`(무의존성) — 정적 파일 서빙 + 공공데이터/Gemini 프록시 |
| **백엔드** | Node.js + Express, `node:sqlite`(내장 SQLite), SSE(Server-Sent Events), `web-push`(VAPID), `cors`, `dotenv` |
| **AI** | Google Gemini API (`gemini-2.5-flash`) — 의도 분석 / 추천 이유 생성 |
| **IoT 센서** | ESP32(Arduino C++, 초음파 센서) → FastAPI(Python) 브릿지 → Express 백엔드 |
| **모바일** | Android TWA(`android-twa/`), Capacitor 스캐폴드(`android/`, esbuild 번들) |
| **배포** | Vercel(프론트 정적/서버리스), Fly.io · Railway(백엔드) |
| **외부 데이터** | 공공데이터포털 강릉시 ITS(`GNitsTrafficInfoService_1.0`), 한국관광공사 TourAPI, Kakao Local API |

> SQLite를 별도 설치/컴파일 없이 쓰기 위해 Node.js 내장 `node:sqlite` 모듈을 사용합니다. 따라서 **Node.js 22.5 이상**이 필요합니다.

---

## 시스템 아키텍처

```text
  [ 사용자 브라우저 / 안드로이드 TWA ]
   index.html (PWA + 카카오맵) · sw.js (Service Worker)
        │                       │
        │ 정적·공공데이터·AI       │ 추천 감시·푸시·실시간
        ▼                       ▼
  ┌──────────────┐        ┌────────────────────┐       ┌──────────────────┐
  │ 프론트 서버   │        │ 백엔드 (Express)    │◀─────▶│ Gemini API        │
  │ server.js    │        │ backend/server.js  │       │ gemini-2.5-flash  │
  │ :8080        │        │ :3001              │       └──────────────────┘
  │ 정적 + 프록시 │        │ SQLite·SSE·WebPush │
  └──────┬───────┘        └─────────┬──────────┘
         │                          │
         ▼                          ▼
  ┌──────────────┐        ┌────────────────────┐       ┌──────────────────┐
  │ 강릉시 ITS    │        │ 길찾기 중 잔여면     │       │ ESP32 초음파 센서  │
  │ 공공데이터 API │        │ 감시 → Web Push     │◀──────│ FastAPI 브릿지     │
  └──────────────┘        └────────────────────┘  :8000 │ :8000             │
                                                         └──────────────────┘
```

세 개의 실행 프로세스로 구성됩니다.

| 프로세스 | 파일 | 기본 포트 | 역할 |
|---|---|---|---|
| 프론트 서버 | `server.js` | `8080` | 정적 파일 서빙, 강릉시 공공데이터 프록시·캐시, Gemini 의도/추천이유 프록시 |
| 백엔드 | `backend/server.js` | `3001` | SQLite 저장, Arduino 상태 수신, SSE 스트리밍, Web Push 감시·알림 |
| ESP32 브릿지 | `fastapi_parking_bridge.py` | `8000` | ESP32 센서값을 받아 Express 백엔드로 전달 |

---

## 주요 기능

- 카카오맵 기반 강릉시 실시간 공영주차장 + 강원대 프로토타입 주차장 표시
- 강릉시 `getParkInfo`/`getParkRltm` 기반 실시간 잔여면 조회 및 5분 주기 갱신
- 잔여면 비율로 `여유 / 보통 / 혼잡` 마커 색상 및 배지 표시
- 자연어 목적지 입력 → Gemini가 목적지와 주차 선호(`near`/`comfort`/`balanced`) 추출
- 목적지 반경 1.5km 추천 주차장 상위 3곳 선정 + `1·2·3` 지도 마커 및 추천 카드
- Gemini가 추천 주차장별 추천 이유를 자연어로 생성(키 없으면 규칙 기반 fallback)
- 모바일 홈/지도 탭 전환, 지도·목록 높이 조절 및 독립 스크롤, 음성 입력
- 좌표가 있는 주차장은 카카오내비 앱으로 길찾기(PC는 카카오맵 웹 길찾기로 폴백)
- 길찾기 중 추천 주차장 잔여면 변경 시 Web Push 알림(만차/빈자리/일반 변동)
- 길안내 중인 주차장이 만차가 되면 다른 추천 주차장으로 **경로 변경 재안내**
- ESP32 초음파 센서로 강원대 가상 주차면 상태 수집 → SSE/폴링으로 실시간 반영
- PWA 설치 및 안드로이드 TWA 앱 패키징

---

## 프로젝트 구조

```text
.
├── index.html                  # 프론트엔드 단일 페이지(SPA, 카카오맵 + UI 전체)
├── sw.js                       # Service Worker (Web Push 수신, 리루팅 처리)
├── manifest.webmanifest        # PWA 매니페스트
├── server.js                   # 프론트 서버(:8080) + 공공데이터/Gemini 프록시
├── fastapi_parking_bridge.py   # ESP32 → Express 백엔드 FastAPI 브릿지(:8000)
├── api/index.js                # Vercel 서버리스 엔트리(server.js 재사용)
├── vercel.json                 # Vercel rewrites
├── fly.toml                    # 프론트 서버 Fly.io 배포 설정
│
├── backend/                    # Express + SQLite 백엔드(:3001)
│   ├── server.js               # Express 앱 진입점
│   ├── routes/                 # config / parking / status / arduino / destinations / push
│   ├── services/               # gemini.js, publicApi.js, pushMonitor.js
│   ├── db/index.js             # node:sqlite 스키마 초기화 + 시드 데이터
│   ├── fly.toml / railway.json # 백엔드 배포 설정
│   └── README.md               # 백엔드 상세 문서
│
├── Arduino/esp32_v1_sensor2/   # ESP32 초음파 센서 펌웨어(.ino)
│
├── android-twa/                # ★ 안드로이드 배포본: 라이브 PWA를 감싼 TWA 앱
├── android/                    # Capacitor 안드로이드 스캐폴드
├── mobile/mobile-entry.js      # Capacitor 네이티브 브리지(푸시/내비)
├── scripts/build-mobile.mjs    # 모바일용 웹 번들 빌드(esbuild → www/)
├── capacitor.config.json
│
├── .well-known/assetlinks.json # TWA Digital Asset Links(주소창 제거용)
├── docs/                       # 카카오맵 샘플 조사 문서
└── package.json
```

---

## 실행 환경 / 사전 준비

- **Node.js 22.5 이상** (백엔드의 `node:sqlite` 내장 모듈 사용)
- npm
- (선택) Python 3.10+ — ESP32 FastAPI 브릿지 실행 시
- 외부 API 키
  - 공공데이터포털 서비스 키 (`DATA_GO_KR_SERVICE_KEY`)
  - Kakao Developers JavaScript 키 / REST API 키
  - Google Gemini API 키 ([aistudio.google.com](https://aistudio.google.com)에서 무료 발급)

> API 키가 없어도 서버는 실행되지만, 해당 외부 연동 기능(지도/실시간/AI)은 제한됩니다. Gemini 키가 없으면 의도 분석은 규칙 기반으로, 추천 이유는 기본 문구로 자동 대체됩니다.

---

## 실행 방법

### 1) 프론트엔드 서버

```bash
npm install        # 의존성은 없지만 관례상 실행
cp .env.example .env   # Windows: copy .env.example .env
npm start          # node server.js
```

- 접속: http://localhost:8080
- 서버는 `0.0.0.0:8080`에 바인딩되어 같은 네트워크의 모바일 기기에서도 접속할 수 있습니다.

#### 같은 Wi-Fi에서 모바일 접속

1. PC와 모바일을 같은 Wi-Fi에 연결합니다.
2. PC의 Wi-Fi IPv4 주소를 확인합니다(Windows: `ipconfig`).
3. 모바일 브라우저에서 `http://PC_IP:8080`으로 접속합니다. (예: `http://192.168.0.6:8080`)

카카오 지도/내비 SDK를 LAN 주소에서 쓰려면 Kakao Developers 앱의 Web 플랫폼 허용 도메인에 접속 주소를 등록해야 합니다. 또한 **모바일 Web Push는 HTTPS에서만 동작**하므로 LAN의 `http://` 주소에서는 푸시 알림을 받을 수 없습니다(라이브 HTTPS 배포에서 동작).

### 2) 백엔드 서버

```bash
cd backend
npm install
cp .env.example .env   # Windows: copy .env.example .env
npm start              # node server.js  (개발 중 자동 재시작: npm run dev)
```

- 접속: http://localhost:3001
- 헬스체크: http://localhost:3001/health

`VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`가 설정되어 있어야 길찾기 중 Web Push 감시가 활성화됩니다. 키는 한 번만 생성해 보관하세요.

```bash
npx web-push generate-vapid-keys
```

### 3) ESP32 FastAPI 브릿지 (IoT 데모, 선택)

ESP32가 보내는 `spotId/status` 값을 받아 Express 백엔드의 `/api/parking/status`로 전달합니다.

```bash
python -m uvicorn fastapi_parking_bridge:app --reload --host 0.0.0.0 --port 8000
```

- 브릿지 주소: `http://localhost:8000`
- ESP32 전송 주소: `http://PC_IP:8000/api/parking/status`
- 전달 대상 백엔드는 환경변수 `BACKEND_URL`로 지정(기본값: 배포된 Fly 백엔드). 로컬 테스트 시 `BACKEND_URL=http://PC_IP:3001`로 설정하세요.

### 4) 안드로이드 앱

| 폴더 | 방식 | 설명 |
|---|---|---|
| `android-twa/` | **TWA** | 라이브 PWA를 Chrome 엔진으로 감싼 정식 배포본. 빌드/서명 절차는 [`android-twa/README.md`](android-twa/README.md) 참고 |
| `android/` + `mobile/` | Capacitor | 네이티브 푸시/내비 브리지 실험용 스캐폴드. `npm run mobile:build`로 `www/` 번들 생성 후 `cap sync` |

```bash
# TWA 디버그 빌드
cd android-twa
./gradlew assembleDebug
```

---

## 환경변수

프론트 서버는 루트 `.env`와 `backend/.env`를 순서대로 읽고, Express 백엔드는 `backend/.env`를 사용합니다. **실제 키는 커밋하지 않습니다**(`.env` 계열은 `.gitignore`에 포함).

### 루트 `.env` (프론트 서버)

```env
PORT=8080
DATA_GO_KR_SERVICE_KEY=공공데이터포털_서비스키
KAKAO_JAVASCRIPT_KEY=카카오_JS_키
KAKAO_REST_API_KEY=카카오_REST_키
GEMINI_API_KEY=구글_제미나이_키
PARKING_BACKEND_ORIGIN=https://your-backend.example.com   # 배포된 백엔드 HTTPS 주소
```

### `backend/.env` (백엔드)

```env
PORT=3001
DATA_GO_KR_SERVICE_KEY=...
KAKAO_REST_API_KEY=...
KAKAO_JAVASCRIPT_KEY=...
GEMINI_API_KEY=...
DB_PATH=                 # 비우면 ./parking_mate.db, Railway/Fly 볼륨은 /data/parking_mate.db
VAPID_PUBLIC_KEY=...     # Web Push 사용 시 필수
VAPID_PRIVATE_KEY=...    # Web Push 사용 시 필수
VAPID_SUBJECT=mailto:you@example.com
PUSH_MONITOR_INTERVAL_MS=60000   # 최소 30000
ALLOWED_ORIGINS=                 # 쉼표 구분, 비우면 전체 허용(로컬 개발용)
```

---

## 주요 API

### 프론트 서버 (`server.js`, :8080)

| Method | Path | 설명 |
|---|---|---|
| `GET` | `/api/config` | 프론트에 필요한 공개 설정(카카오 JS 키 등) 조회 |
| `GET` | `/api/parking/gangwon-realtime` | 강릉시 `getParkInfo` + `getParkRltm` 병합 실시간 주차 정보 |
| `GET` | `/api/parking/realtime-refresh` | 강릉시 실시간 정보 강제 갱신 |
| `GET` | `/api/parking/chuncheon-realtime`, `/api/parking/all` | 호환용 별칭(내부 데이터 소스는 강릉시 API) |
| `POST` | `/api/ai/parking-intent` | 자연어에서 목적지·주차 선호 추출(Gemini) |
| `POST` | `/api/ai/parking-reasons` | 추천 주차장별 추천 이유 생성(Gemini) |
| `POST` | `/api/ai/interpret-yes-no` | 음성 응답의 예/아니오 해석(리루팅 확인용) |

### 백엔드 서버 (`backend/server.js`, :3001)

| Method | Path | 설명 |
|---|---|---|
| `GET` | `/health` | 서버 상태 확인 |
| `GET` | `/api/config` | API 키 설정 여부 + 카카오 JS 키 |
| `GET` | `/api/parking/lots` | 주차장 시설 목록(좌표 범위 검색 지원) |
| `GET` | `/api/parking/realtime` | 주차장 실시간 현황 조회 |
| `POST` | `/api/parking/sync` | 강릉시 시설/실시간 정보를 DB로 동기화 |
| `POST` | `/api/parking/status` | Arduino 주차면 상태 수신(`spotId/status` 또는 `parking_id/is_occupied`) |
| `GET` | `/api/parking/status/live` | 주차면 상태 실시간 SSE 스트림 |
| `POST` | `/api/arduino/sensor` · `/api/arduino/sensor/batch` | 슬롯 단건/일괄 센서 갱신 |
| `GET` | `/api/arduino/slots/:lotId` | 특정 주차장 슬롯별 상태 |
| `GET` / `POST` | `/api/arduino/lots` | Arduino 주차장 목록 조회 / 등록 |
| `GET` | `/api/destinations/search` | 관광지 검색(DB 캐시 → Kakao → 관광공사) |
| `GET` | `/api/destinations/popular` | 인기 관광지 목록 |
| `GET` | `/api/destinations/events` | 강원도 행사/축제 조회(1일 캐시) |
| `GET` | `/api/push/config` | Web Push 공개키·감시 설정 |
| `POST` | `/api/push/watch` | 추천 주차장 감시 시작/교체 |
| `DELETE` | `/api/push/watch/:watchId` | 감시 중지 |

---

## 추천 로직

추천 순위는 **프론트엔드(`index.html`의 `rankedParkingRows`)** 에서 계산합니다. 목적지까지의 거리 점수와 잔여면 비율(쾌적) 점수를 주차 선호에 따라 가중합한 뒤 정렬하고, 목적지 1.5km 이내 상위 3곳을 추천합니다.

- `거리 점수` = `max(0, 1 - min(거리, 5000m) / 5000)` — 가까울수록 1에 가까움
- `쾌적 점수` = `잔여면 / 전체면` (잔여면 비율)
- 선호별 가중치
  - `near`(가까움): **거리 점수만** 사용 → 가장 가까운 순
  - `comfort`(쾌적): `쾌적 0.80 + 거리 0.20`
  - `balanced`(균형): `쾌적 0.60 + 거리 0.40`

마커 색상/혼잡 배지는 잔여면 비율 기준입니다.

| 잔여면 비율 | 배지 | 마커 색 |
|---|---|---|
| 0.5 이상 | 여유 | 초록 |
| 0.2 이상 | 보통 | 노랑 |
| 0.2 미만 | 혼잡 | 빨강 |

목적지·선호 추출과 추천 이유 문장은 Gemini(`gemini-2.5-flash`)가 담당하며, 키가 없거나 호출이 실패하면 규칙 기반 해석/기본 문구로 자동 대체됩니다.

---

## 길찾기 중 추천 주차장 Web Push

모바일에서 `길찾기`를 누르면 현재 추천 상위 3곳과 브라우저 푸시 구독을 `POST /api/push/watch`로 보냅니다. 백엔드는 감시 세션을 SQLite에 저장하고, 브라우저와 독립적으로 주기마다(기본 1분, 아두이노 변화는 이벤트 즉시) 강릉시 `getParkRltm`과 Arduino DB를 확인해 변동 시 Web Push를 보냅니다.

- 잔여면 `1 이상 → 0`: 만차 알림
- 잔여면 `0 → 1 이상`: 빈자리 발생 알림
- 그 외 변동: 이전 잔여면 → 현재 잔여면
- 여러 주차장이 동시에 바뀌면 한 알림으로 묶어 발송
- 길안내 중인 주차장이 만차면, 잔여면이 있는 다른 추천 주차장으로 **경로 변경 재안내**(앱이 켜져 있으면 인앱 음성 오버레이로 응답)
- 새 길찾기를 시작하면 이전 감시 세션을 교체, 감시는 기본 120분 뒤 만료

푸시는 Service Worker가 수신하므로 카카오내비가 전면에 있거나 페이지가 닫혀 있어도 서버가 실행 중이면 알림을 받습니다. 단:

- 서비스는 **HTTPS**여야 합니다(LAN `http://` 주소 불가).
- Android는 Chrome 알림 권한 허용, iPhone/iPad는 iOS 16.4+에서 홈 화면에 추가 후 웹앱으로 실행해야 합니다.
- 백엔드는 1분 백그라운드 타이머를 유지할 수 있는 **장시간 실행 프로세스**(Fly.io/Railway 등)여야 합니다. Vercel 서버리스 함수만으로는 유지되지 않으므로, 프론트의 `PARKING_BACKEND_ORIGIN`을 해당 백엔드 HTTPS 주소로 설정합니다.

---

## ESP32 / Arduino 연동

강원대학교 가상 주차장(`KNU_PARKING_6`, `KNU_PARKING_BAENGNOKAN` 백록관)의 한 칸이 실제 ESP32 초음파 센서와 연결됩니다. ESP32는 차량 유무를 디바운싱·하트비트 처리해 `{"spotId","status"}`로 전송합니다.

```text
ESP32(초음파 센서)
  → FastAPI 브릿지 (:8000)            # spotId/status → parking_id/is_occupied 변환
  → Express 백엔드 (:3001) /api/parking/status
  → SQLite arduino_slots 저장 + SSE 브로드캐스트
  → 웹앱(:8080)에서 SSE/폴링으로 해당 칸 색상 갱신
```

상태 매핑:

| ESP32 status | 저장값 | 화면 표시 |
|---|---|---|
| `OCCUPIED` | `is_occupied = true` | 빨간색, `꽉 차 있음` |
| `EMPTY` | `is_occupied = false` | 초록색, `비어 있음` |

펌웨어에서는 Wi-Fi 정보와 서버 주소(`serverUrl`)만 환경에 맞게 수정하면 됩니다. ESP32가 브릿지를 거치지 않고 Express 백엔드(`/api/parking/status`)로 직접 전송하는 것도 가능합니다.

---

## 배포

| 대상 | 플랫폼 | 설정 파일 |
|---|---|---|
| 프론트엔드 | Vercel(정적 + 서버리스) | `vercel.json`, `api/index.js` |
| 프론트 서버 | Fly.io(`gangwon-parking-app`) | `fly.toml` |
| 백엔드 | Fly.io(`gangwon-parking-backend`) / Railway | `backend/fly.toml`, `backend/railway.json` |

- 라이브 PWA: https://gangwon-do-realtime-parking-map.vercel.app
- 백엔드는 SQLite DB 영속화를 위해 볼륨(`/data`)을 마운트하고 `DB_PATH=/data/parking_mate.db`를 설정합니다(Fly `[[mounts]]` / Railway Volume).
- 안드로이드 TWA가 주소창 없이 전체화면으로 뜨려면 라이브 도메인에 `/.well-known/assetlinks.json`이 배포돼 있어야 합니다. 자세한 절차는 [`android-twa/README.md`](android-twa/README.md) 참고.

필수 배포 환경변수: `DATA_GO_KR_SERVICE_KEY`, `KAKAO_REST_API_KEY`, `KAKAO_JAVASCRIPT_KEY`, `GEMINI_API_KEY`, (백엔드) `DB_PATH`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`.

---

## 개발 메모

- 프론트엔드 단일 진입점은 `index.html`이며, UI·지도·추천 로직이 모두 들어 있는 단일 페이지 앱입니다.
- 루트 `server.js`는 정적 서빙과 공공데이터/Gemini 프록시(+ 5분 캐시)를 담당합니다.
- `backend/server.js`는 SQLite·SSE·Web Push 등 상태 저장이 필요한 기능을 담당합니다. 상세 API와 알고리즘은 [`backend/README.md`](backend/README.md)를 참고하세요.
- 추천 순위 계산은 백엔드가 아니라 프론트엔드에서 수행합니다(`/api/recommend` 엔드포인트는 사용하지 않습니다).
- 로컬 DB 파일, 캐시 파일, `.env` 등 비밀 값은 커밋하지 않습니다.
</content>
</invoke>
