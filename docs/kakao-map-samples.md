# Kakao Map Web API Sample 기능 정리

정리 기준: Kakao 지도 Web API 공식 샘플 페이지  
원본: https://apis.map.kakao.com/web/sample/  
작성일: 2026-06-23

이 문서는 `kakao-map-app`에서 카카오맵 기능을 확장할 때 참고하기 위한 기능 카탈로그입니다. 공식 샘플을 그대로 나열하기보다, 실제 프로젝트에서 어떤 기능으로 쓰이는지 기준으로 묶었습니다.

## 1. 지도 기본 기능

지도 생성, 이동, 확대/축소, 지도 상태 확인, 컨트롤, 지도 타입 전환처럼 모든 지도 기능의 기반이 되는 샘플입니다.

| 기능 묶음 | 공식 샘플 | 샘플 URL | 프로젝트 적용 포인트 |
|---|---|---|---|
| 지도 생성 | 지도 생성하기 | https://apis.map.kakao.com/web/sample/basicMap/ | `index.html`의 지도 초기화 기본 구조 |
| 지도 이동 | 지도 이동시키기 | https://apis.map.kakao.com/web/sample/moveMap/ | 목적지/주차장 선택 시 지도 중심 이동 |
| 지도 레벨 | 지도 레벨 바꾸기 | https://apis.map.kakao.com/web/sample/changeLevel/ | 추천 주차장 확대, 전체 보기 축소 |
| 지도 상태 조회 | 지도 정보 얻어오기 | https://apis.map.kakao.com/web/sample/mapInfo/ | 현재 중심좌표, 레벨, 영역 디버깅 |
| 기본 컨트롤 | 지도에 컨트롤 올리기 | https://apis.map.kakao.com/web/sample/addMapControl/ | 줌 컨트롤, 지도/스카이뷰 컨트롤 |
| 사용자 컨트롤 | 지도에 사용자 컨트롤 올리기 | https://apis.map.kakao.com/web/sample/addMapCustomControl/ | 새로고침, 현재위치, 추천 버튼 |
| 이동 제한 | 지도 이동 막기 | https://apis.map.kakao.com/web/sample/disableMapDragMove/ | 고정 지도나 임베드 화면에서 사용 |
| 확대 제한 | 지도 확대 축소 막기 | https://apis.map.kakao.com/web/sample/enableDisableZoomInOut/ | 모바일 스크롤 충돌 방지 |
| 교통 레이어 | 지도에 교통정보 표시하기 | https://apis.map.kakao.com/web/sample/addTrafficOverlay/ | 주차 추천 시 도로 혼잡 참고 |
| 로드뷰 도로 레이어 | 지도에 로드뷰 도로 표시하기 | https://apis.map.kakao.com/web/sample/addRoadviewOverlay/ | 로드뷰 진입 가능 도로 표시 |
| 지형도 레이어 | 지도에 지형도 표시하기 | https://apis.map.kakao.com/web/sample/addTerrainOverlay/ | 산지/관광지 주변 지형 확인 |
| 지도 타입 전환 | 지도 타입 바꾸기1 | https://apis.map.kakao.com/web/sample/changeOverlay1/ | 버튼식 지도 타입 전환 |
| 지도 타입 전환 | 지도 타입 바꾸기2 | https://apis.map.kakao.com/web/sample/changeOverlay2/ | 체크박스/토글식 레이어 전환 |
| 지도 범위 맞춤 | 지도 범위 재설정 하기 | https://apis.map.kakao.com/web/sample/setBounds/ | 여러 주차장이 모두 보이게 자동 맞춤 |
| 지도 크기 변경 | 지도 영역 크기 동적 변경하기 | https://apis.map.kakao.com/web/sample/mapRelayout/ | 패널 열림/닫힘, 반응형 레이아웃 후 `relayout()` 처리 |

## 2. 지도 이벤트

사용자가 지도를 움직이거나 클릭했을 때 검색, 마커 생성, 주소 조회, 상태 갱신 등을 붙이는 데 필요한 샘플입니다.

| 이벤트 | 공식 샘플 | 샘플 URL | 프로젝트 적용 포인트 |
|---|---|---|---|
| 클릭 | 클릭 이벤트 등록하기 | https://apis.map.kakao.com/web/sample/addMapClickEvent/ | 클릭 좌표 표시, 임시 목적지 선택 |
| 클릭 위치 마커 | 클릭한 위치에 마커 표시하기 | https://apis.map.kakao.com/web/sample/addMapClickEventWithMarker/ | 사용자가 직접 목적지 지정 |
| 이동 완료 | 이동 이벤트 등록하기 | https://apis.map.kakao.com/web/sample/addMapDragendEvent/ | 지도 이동 후 주변 주차장 재검색 |
| 줌 변경 | 확대, 축소 이벤트 등록하기 | https://apis.map.kakao.com/web/sample/addMapZoomChangedEvent/ | 레벨별 마커/클러스터 표시 전환 |
| 중심 변경 | 중심좌표 변경 이벤트 등록하기 | https://apis.map.kakao.com/web/sample/addMapCenterChangedEvent/ | 현재 중심 기준 주소/행정동 표시 |
| 영역 변경 | 영역 변경 이벤트 등록하기 | https://apis.map.kakao.com/web/sample/addMapBoundsChangedEvent/ | 현재 화면 안 주차장만 필터링 |
| 타일 로드 | 타일로드 이벤트 등록하기 | https://apis.map.kakao.com/web/sample/addTilesloadedEvent/ | 지도 로딩 완료 후 UI 상태 갱신 |

## 3. 타일셋

일반적인 주차장 앱에서는 우선순위가 낮지만, 자체 지도 타일이나 특수 시각화가 필요할 때 참고합니다.

| 기능 | 공식 샘플 | 샘플 URL | 프로젝트 적용 포인트 |
|---|---|---|---|
| 커스텀 타일셋 | 커스텀 타일셋1 | https://apis.map.kakao.com/web/sample/customTileset/ | 직접 만든 타일 이미지 표시 |
| 커스텀 타일셋 | 커스텀 타일셋2 | https://apis.map.kakao.com/web/sample/getTile/ | 좌표/줌 기반 타일 동적 로딩 |

## 4. 마커와 인포윈도우

주차장 위치 표시, 상세 정보, 클릭/호버 반응 등 이 프로젝트에서 가장 많이 쓰는 영역입니다.

| 기능 묶음 | 공식 샘플 | 샘플 URL | 프로젝트 적용 포인트 |
|---|---|---|---|
| 기본 마커 | 마커 생성하기 | https://apis.map.kakao.com/web/sample/basicMarker/ | 주차장 위치 표시 |
| 드래그 마커 | 드래그 가능한 마커 생성하기 | https://apis.map.kakao.com/web/sample/draggableMarker/ | 임시 위치 조정, 관리자 입력 UI |
| 이미지 마커 | 다른 이미지로 마커 생성하기 | https://apis.map.kakao.com/web/sample/basicMarkerImage/ | 혼잡도별 주차장 아이콘 |
| 인포윈도우 | 인포윈도우 생성하기 | https://apis.map.kakao.com/web/sample/basicInfoWindow/ | 간단한 텍스트 정보 표시 |
| 마커+인포윈도우 | 마커에 인포윈도우 표시하기 | https://apis.map.kakao.com/web/sample/markerWithInfoWindow/ | 마커 클릭 시 주차장명/잔여면 표시 |
| 마커 클릭 | 마커에 클릭 이벤트 등록하기 | https://apis.map.kakao.com/web/sample/addMarkerClickEvent/ | 상세 패널 열기, 추천 대상 선택 |
| 마커 마우스 | 마커에 마우스 이벤트 등록하기 | https://apis.map.kakao.com/web/sample/addMarkerMouseEvent/ | hover 강조, 미리보기 |
| 드래그 이벤트 | draggable 마커 이벤트 적용하기 | https://apis.map.kakao.com/web/sample/addDraggableMarkerDragEvent/ | 위치 수정 완료 시 좌표 저장 |
| 현재 위치 | geolocation으로 마커 표시하기 | https://apis.map.kakao.com/web/sample/geolocationMarker/ | 내 위치 기준 가까운 주차장 추천 |
| 여러 마커 | 여러개 마커 표시하기 | https://apis.map.kakao.com/web/sample/multipleMarkerImage/ | 주차장 목록 전체 표시 |
| 여러 마커 제어 | 여러개 마커 제어하기 | https://apis.map.kakao.com/web/sample/multipleMarkerControl/ | 필터/검색 결과에 따른 마커 표시 제어 |
| 여러 마커 이벤트 | 여러개 마커에 이벤트 등록하기1 | https://apis.map.kakao.com/web/sample/multipleMarkerEvent/ | 각 주차장 마커별 클릭/hover |
| 여러 마커 이벤트 | 여러개 마커에 이벤트 등록하기2 | https://apis.map.kakao.com/web/sample/multipleMarkerEvent2/ | 반복문 클로저 처리 참고 |
| 카테고리 아이콘 | 다양한 이미지 마커 표시하기 | https://apis.map.kakao.com/web/sample/categoryMarker/ | 공영/민영/전기차/장애인 등 아이콘 분리 |

## 5. 도형, 거리, 면적, 반경

서비스 지역 표시, 반경 검색, 도보 거리 보조 표시, 주차 가능 구역 시각화에 활용할 수 있습니다.

| 기능 | 공식 샘플 | 샘플 URL | 프로젝트 적용 포인트 |
|---|---|---|---|
| 도형 표시 | 원, 선, 사각형, 다각형 표시하기 | https://apis.map.kakao.com/web/sample/drawShape/ | 검색 반경, 서비스 구역, 경로 보조선 |
| 선 거리 | 선의 거리 계산하기 | https://apis.map.kakao.com/web/sample/calculatePolylineDistance/ | 목적지-주차장 직선거리/경로거리 UI |
| 다각형 면적 | 다각형의 면적 계산하기 | https://apis.map.kakao.com/web/sample/calculatePolygonArea/ | 구역 면적 계산, 행정/상권 영역 |
| 다각형 이벤트 | 다각형에 이벤트 등록하기1 | https://apis.map.kakao.com/web/sample/addPolygonMouseEvent1/ | 구역 hover/클릭 강조 |
| 다각형 이벤트 | 다각형에 이벤트 등록하기2 | https://apis.map.kakao.com/web/sample/addPolygonMouseEvent2/ | 구역별 정보창 표시 |
| 원 반경 | 원의 반경 계산하기 | https://apis.map.kakao.com/web/sample/calculateCircleRadius/ | 사용자 지정 반경 검색 |
| 구멍난 다각형 | 구멍난 다각형 만들기 | https://apis.map.kakao.com/web/sample/donut/ | 제외 구역이 있는 서비스 영역 |

## 6. 커스텀 오버레이

HTML/CSS로 직접 디자인한 말풍선, 카드, 배지 등을 지도 위에 표시하는 샘플입니다. 주차장 앱에서는 인포윈도우보다 커스텀 오버레이가 표현력이 좋습니다.

| 기능 | 공식 샘플 | 샘플 URL | 프로젝트 적용 포인트 |
|---|---|---|---|
| 커스텀 오버레이 | 커스텀 오버레이 생성하기1 | https://apis.map.kakao.com/web/sample/customOverlay1/ | 간단한 HTML 라벨 |
| 커스텀 오버레이 | 커스텀 오버레이 생성하기2 | https://apis.map.kakao.com/web/sample/customOverlay2/ | 주차장 카드형 말풍선 |
| 닫기 가능 | 닫기가 가능한 커스텀 오버레이 | https://apis.map.kakao.com/web/sample/removableCustomOverlay/ | X 버튼으로 상세 오버레이 닫기 |
| 이미지 마커+오버레이 | 이미지 마커와 커스텀 오버레이 | https://apis.map.kakao.com/web/sample/markerWithCustomOverlay/ | 혼잡도 아이콘 + 상세 카드 조합 |
| 드래그 오버레이 | 커스텀오버레이를 드래그 하기 | https://apis.map.kakao.com/web/sample/dragCustomOverlay/ | 관리자용 위치/정보 배치 UI |
| 화면 밖 추적 | 지도 영역 밖의 마커위치 추적하기 | https://apis.map.kakao.com/web/sample/markerTracker/ | 선택한 목적지/주차장이 화면 밖일 때 방향 표시 |

## 7. 로드뷰

목적지 주변 실제 도로 환경 확인, 주차장 진입로 확인 기능을 만들 때 활용합니다.

| 기능 | 공식 샘플 | 샘플 URL | 프로젝트 적용 포인트 |
|---|---|---|---|
| 로드뷰 생성 | 로드뷰 생성하기 | https://apis.map.kakao.com/web/sample/basicRoadview/ | 주차장 주변 로드뷰 표시 |
| 로드뷰 도로 | 로드뷰 도로를 이용하여 로드뷰 생성하기 | https://apis.map.kakao.com/web/sample/basicRoadview2/ | 지도에서 로드뷰 가능 위치 선택 |
| 지도 연동 | 동동이를 이용하여 로드뷰와 지도 연동하기 | https://apis.map.kakao.com/web/sample/moveRoadview/ | 로드뷰 방향과 지도 위치 동기화 |
| 로드뷰 마커 | 로드뷰에 마커와 인포윈도우 올리기 | https://apis.map.kakao.com/web/sample/roadviewOverlay1/ | 로드뷰 안에서 주차장 위치 표시 |
| 고도/반경 | 마커의 고도와 반경 조절하기 | https://apis.map.kakao.com/web/sample/roadviewOverlay2/ | 로드뷰 내 마커 위치 보정 |
| 로드뷰 오버레이 | 로드뷰에 커스텀오버레이 올리기 | https://apis.map.kakao.com/web/sample/roadviewCustomOverlay/ | 로드뷰 내부 카드/라벨 표시 |
| 이미지 오버레이 | 로드뷰에 이미지 올리기 | https://apis.map.kakao.com/web/sample/roadviewImageOverlay/ | 이전/현재 현장 비교 이미지 |
| 지도 위 버튼 | 지도 위 버튼으로 로드뷰 표시하기 | https://apis.map.kakao.com/web/sample/roadviewWithMapButton/ | 지도에서 로드뷰 모드 진입 버튼 |
| 지도/로드뷰 토글 | 로드뷰와 지도 토글하기 | https://apis.map.kakao.com/web/sample/roadviewToggle/ | 주차장 상세에서 지도/로드뷰 전환 |

## 8. 정적지도

인터랙션이 필요 없는 공유 이미지, 리포트, 안내 화면에 적합합니다.

| 기능 | 공식 샘플 | 샘플 URL | 프로젝트 적용 포인트 |
|---|---|---|---|
| 이미지 지도 | 이미지 지도 생성하기 | https://apis.map.kakao.com/web/sample/staticMap/ | 공유용 고정 지도 |
| 이미지 지도+마커 | 이미지 지도에 마커 표시하기 | https://apis.map.kakao.com/web/sample/staticMapWithMarker/ | 안내 문서/알림용 위치 이미지 |
| 이미지 지도+텍스트 | 마커와 텍스트 표시하기 | https://apis.map.kakao.com/web/sample/staticMapWithMarkerText/ | 주차장명 포함 이미지 |

## 9. 장소 검색과 좌표 변환

`services` 라이브러리가 필요한 영역입니다. 목적지 검색, 주소 검색, 좌표-주소 변환 기능과 직접 연결됩니다.

스크립트 예시:

```html
<script src="//dapi.kakao.com/v2/maps/sdk.js?appkey=KAKAO_JAVASCRIPT_KEY&libraries=services"></script>
```

| 기능 | 공식 샘플 | 샘플 URL | 프로젝트 적용 포인트 |
|---|---|---|---|
| 키워드 검색 | 키워드로 장소검색하기 | https://apis.map.kakao.com/web/sample/keywordBasic/ | 목적지 검색 결과를 지도 마커로 표시 |
| 키워드 검색+목록 | 키워드로 장소검색하고 목록으로 표출하기 | https://apis.map.kakao.com/web/sample/keywordList/ | 검색 결과 리스트 + 지도 연동 |
| 카테고리 검색 | 카테고리로 장소 검색하기 | https://apis.map.kakao.com/web/sample/categoryBasic/ | 은행, 음식점, 관광지 등 주변 POI 표시 |
| 현재 영역 검색 | 카테고리별 장소 검색하기 | https://apis.map.kakao.com/web/sample/categoryFromBounds/ | 지도 이동 시 현재 화면 기준 재검색 |
| 주소->좌표 | 주소로 장소 표시하기 | https://apis.map.kakao.com/web/sample/addr2coord/ | 입력 주소를 목적지 좌표로 변환 |
| 좌표->주소 | 좌표로 주소를 얻어내기 | https://apis.map.kakao.com/web/sample/coord2addr/ | 클릭 좌표/현재 중심 주소 표시 |
| 좌표계 변환 | WTM 좌표를 WGS84 좌표로 변환하기 | https://apis.map.kakao.com/web/sample/transCoord/ | 공공데이터 좌표계가 WTM일 때 변환 |

## 10. 마커 클러스터링

주차장/장소 데이터가 많아질 때 성능과 가독성을 위해 필요합니다. `clusterer` 라이브러리가 필요합니다.

스크립트 예시:

```html
<script src="//dapi.kakao.com/v2/maps/sdk.js?appkey=KAKAO_JAVASCRIPT_KEY&libraries=clusterer"></script>
```

| 기능 | 공식 샘플 | 샘플 URL | 프로젝트 적용 포인트 |
|---|---|---|---|
| 기본 클러스터 | 마커 클러스터러 사용하기 | https://apis.map.kakao.com/web/sample/basicClusterer/ | 많은 주차장 마커 묶기 |
| 클러스터 클릭 | 마커 클러스터러에 클릭이벤트 추가하기 | https://apis.map.kakao.com/web/sample/addClustererClickEvent/ | 클러스터 클릭 시 확대 |
| 클러스터 텍스트 | 클러스터 마커에 텍스트 표시하기 | https://apis.map.kakao.com/web/sample/chickenClusterer/ | 혼잡도/개수별 커스텀 텍스트 |

## 11. Drawing Library

사용자가 지도 위에 직접 선, 원, 다각형 등을 그리게 할 때 쓰는 기능입니다. 관리자 도구나 서비스 구역 설정 기능에 적합합니다.

스크립트 예시:

```html
<script src="//dapi.kakao.com/v2/maps/sdk.js?appkey=KAKAO_JAVASCRIPT_KEY&libraries=drawing"></script>
```

| 기능 | 공식 샘플 | 샘플 URL | 프로젝트 적용 포인트 |
|---|---|---|---|
| Drawing 기본 | Drawing Library 사용하기 | https://apis.map.kakao.com/web/sample/basicDrawingLibrary/ | 사용자/관리자 도형 그리기 |
| 데이터 추출 | Drawing Library에서 데이터 얻기 | https://apis.map.kakao.com/web/sample/drawingGetData/ | 그린 구역을 JSON으로 저장 |
| Toolbox | Toolbox 사용하기 | https://apis.map.kakao.com/web/sample/drawingToolbox/ | 도형 그리기 도구 UI |
| Undo/Redo | Drawing undo, redo | https://apis.map.kakao.com/web/sample/drawingUndo/ | 편집 취소/다시 실행 |

## 프로젝트 우선순위

현재 `kakao-map-app`이 실시간 주차장 지도라면 아래 순서가 가장 실용적입니다.

1. 주차장 마커 안정화: `multipleMarkerImage`, `multipleMarkerEvent`, `basicMarkerImage`
2. 상세 정보 개선: `customOverlay2`, `removableCustomOverlay`, `markerWithCustomOverlay`
3. 검색 UX 개선: `keywordList`, `addr2coord`, `coord2addr`
4. 지도 반응형 안정화: `setBounds`, `mapRelayout`, `addMapBoundsChangedEvent`
5. 데이터가 많아질 때: `basicClusterer`, `addClustererClickEvent`
6. 현장 확인 기능: `roadviewWithMapButton`, `roadviewToggle`
7. 고급 관리자 기능: `drawingGetData`, `drawingToolbox`, `drawingUndo`

## 구현할 때 주의할 점

- `services`, `clusterer`, `drawing`은 SDK 로드 시 `libraries` 파라미터에 포함해야 합니다.
- 여러 라이브러리를 함께 쓸 경우 `libraries=services,clusterer,drawing`처럼 쉼표로 묶습니다.
- 지도 컨테이너 크기가 바뀌면 `map.relayout()`을 호출해야 화면이 깨지지 않습니다.
- 여러 마커 이벤트를 반복문으로 붙일 때는 각 마커 데이터가 이벤트 핸들러에 올바르게 캡처되는지 확인해야 합니다.
- 공공데이터 좌표계가 WGS84가 아니면 `transCoord` 샘플을 먼저 확인해야 합니다.
- 로드뷰는 모든 좌표에서 제공되지 않으므로, 가까운 파노라마 ID를 찾는 실패 처리가 필요합니다.

