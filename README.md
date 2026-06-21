# Gangwon-do Real-Time Parking Map

강원도 관광객과 지역 방문자를 위한 실시간 주차장 지도 및 AI 주차 추천 프로젝트입니다.

프론트엔드는 카카오맵 기반으로 강원도/춘천권 주차장 정보를 시각화하고, 백엔드는 공공데이터, 카카오 로컬 검색, Arduino 센서 데이터, Gemini 기반 추천 이유 생성을 연결합니다.

## 주요 기능

- 카카오맵 기반 주차장 위치 표시
- 강원도/춘천 실시간 주차 정보 조회 및 새로고침
- 주차장 잔여면, 혼잡도, 요금/주소 등 사용자용 정보 표시
- 목적지 기준 가까운 주차장 추천
- Arduino 센서 기반 주차면 상태 수집
- SSE(Server-Sent Events)를 통한 실시간 주차 상태 스트리밍
- Gemini API를 이용한 자연어 추천 이유 생성

## 프로젝트 구조

```text
.
├── index.html              # 루트 프론트엔드 페이지
├── public/                 # 정적 프론트엔드 파일
├── server.js               # 프론트엔드 서버 및 공공데이터 프록시
├── api/                    # Vercel API 엔트리
├── backend/                # Express + SQLite 백엔드
│   ├── server.js
│   ├── routes/
│   ├── services/
│   ├── db/
│   ├── public/demo.html
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

루트 서버는 `server.js`를 실행하며, 기본 포트는 `8080`입니다.

## 백엔드 실행

```bash
cd backend
npm install
copy .env.example .env
npm start
```

기본 주소:

- http://localhost:3001
- http://localhost:3001/demo.html
- http://localhost:3001/health

## 환경변수

백엔드는 `backend/.env` 파일을 사용합니다.

```env
PORT=3001
DATA_GO_KR_SERVICE_KEY=your_service_key_here
KAKAO_REST_API_KEY=your_kakao_rest_key_here
KAKAO_JAVASCRIPT_KEY=your_kakao_js_key_here
GEMINI_API_KEY=your_gemini_api_key_here
DB_PATH=
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

## 추천 로직

백엔드의 `ParkingScore`는 잔여 주차면과 목적지까지의 거리를 함께 반영합니다.

- 잔여면 점수: 50%
- 거리 점수: 50%
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
- `backend/server.js`는 Express API 서버입니다.
- 백엔드 상세 API 사용법은 `backend/README.md`를 참고합니다.
- 로컬 DB와 API 키 파일은 커밋하지 않습니다.
