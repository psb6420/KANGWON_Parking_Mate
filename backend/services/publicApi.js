const fetch = require("node-fetch");

const BASE_TSAFETY = "https://apis.data.go.kr/B553881/Parking";
const BASE_GANGNEUNG = "https://apis.data.go.kr/4201000/GNitsTrafficInfoService_1.0";
const BASE_WEATHER = "https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0";
const BASE_TOURISM = "https://apis.data.go.kr/B551011/KorService1";
const BASE_KAKAO = "https://dapi.kakao.com";

const TIMEOUT_MS = 15000;

function appendKey(url, serviceKey) {
  const encoded = /%[0-9a-f]{2}/i.test(serviceKey) ? serviceKey : encodeURIComponent(serviceKey);
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}serviceKey=${encoded}`;
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`JSON parse failed: ${text.slice(0, 200)}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

// 한국교통안전공단 주차장 시설 정보
async function fetchParkingFacility(serviceKey, pageNo = 1, numOfRows = 1000) {
  const url = appendKey(
    `${BASE_TSAFETY}/PrkSttusInfo?pageNo=${pageNo}&numOfRows=${numOfRows}&format=2`,
    serviceKey
  );
  const data = await fetchJson(url);
  if (data.resultCode !== "0") throw new Error(data.resultMsg || "API error");
  return data;
}

// 한국교통안전공단 주차장 실시간 정보
async function fetchParkingRealtime(serviceKey, pageNo = 1, numOfRows = 1000) {
  const url = appendKey(
    `${BASE_TSAFETY}/PrkRealtimeInfo?pageNo=${pageNo}&numOfRows=${numOfRows}&format=2`,
    serviceKey
  );
  const data = await fetchJson(url);
  if (data.resultCode !== "0") throw new Error(data.resultMsg || "API error");
  return data;
}

// 한국교통안전공단 주차장 운영 정보
async function fetchParkingOperation(serviceKey, pageNo = 1, numOfRows = 1000) {
  const url = appendKey(
    `${BASE_TSAFETY}/PrkOprInfo?pageNo=${pageNo}&numOfRows=${numOfRows}&format=2`,
    serviceKey
  );
  const data = await fetchJson(url);
  if (data.resultCode !== "0") throw new Error(data.resultMsg || "API error");
  return data;
}

// 강릉시 주차장 정보
async function fetchGangneungParking(serviceKey, endpoint, pageNo = 1) {
  const url = appendKey(
    `${BASE_GANGNEUNG}/${endpoint}?pageNo=${pageNo}&numOfRows=100`,
    serviceKey
  );
  const data = await fetchJson(url);
  const code = data?.header?.resultCode;
  if (code && code !== "00") throw new Error(data?.header?.resultMsg || "API error");
  return data;
}

// 기상청 단기예보 (격자 좌표 필요)
async function fetchWeatherForecast(serviceKey, nx, ny) {
  const now = new Date();
  const baseDate = formatKstDate(now);
  const baseTime = getBaseTime(now);
  const url = appendKey(
    `${BASE_WEATHER}/getVilageFcst?pageNo=1&numOfRows=60&dataType=JSON&base_date=${baseDate}&base_time=${baseTime}&nx=${nx}&ny=${ny}`,
    serviceKey
  );
  const data = await fetchJson(url);
  const code = data?.response?.header?.resultCode;
  if (code && code !== "00") throw new Error(data?.response?.header?.resultMsg || "Weather API error");
  return data;
}

// 한국관광공사 강원도 관광지 정보
async function fetchGangwonTourism(serviceKey, keyword = "", pageNo = 1, numOfRows = 20) {
  const areaCode = "32"; // 강원특별자치도
  let url;
  if (keyword) {
    url = `${BASE_TOURISM}/searchKeyword1?numOfRows=${numOfRows}&pageNo=${pageNo}&MobileOS=ETC&MobileApp=GangwonParkingMate&_type=json&keyword=${encodeURIComponent(keyword)}&areaCode=${areaCode}`;
  } else {
    url = `${BASE_TOURISM}/areaBasedList1?numOfRows=${numOfRows}&pageNo=${pageNo}&MobileOS=ETC&MobileApp=GangwonParkingMate&_type=json&areaCode=${areaCode}&contentTypeId=12`;
  }
  const data = await fetchJson(appendKey(url, serviceKey));
  const code = data?.response?.header?.resultCode;
  if (code && code !== "0000") throw new Error(data?.response?.header?.resultMsg || "Tourism API error");
  return data;
}

// 한국관광공사 강원도 행사/축제
async function fetchGangwonEvents(serviceKey, pageNo = 1) {
  const now = new Date();
  const eventStartDate = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}01`;
  const areaCode = "32";
  const url = appendKey(
    `${BASE_TOURISM}/searchFestival1?numOfRows=50&pageNo=${pageNo}&MobileOS=ETC&MobileApp=GangwonParkingMate&_type=json&areaCode=${areaCode}&eventStartDate=${eventStartDate}`,
    serviceKey
  );
  const data = await fetchJson(url);
  const code = data?.response?.header?.resultCode;
  if (code && code !== "0000") throw new Error(data?.response?.header?.resultMsg || "Events API error");
  return data;
}

// Kakao Local API - 키워드로 장소 검색
async function searchKakaoPlace(kakaoRestKey, keyword, x = null, y = null) {
  let url = `${BASE_KAKAO}/v2/local/search/keyword.json?query=${encodeURIComponent(keyword)}&size=15`;
  if (x && y) url += `&x=${x}&y=${y}&radius=20000&sort=distance`;
  const data = await fetchJson(url, {
    headers: { Authorization: `KakaoAK ${kakaoRestKey}` },
  });
  if (data.errorType) throw new Error(data.message || "Kakao API error");
  return data;
}

// Kakao Local API - 좌표 근처 주차장 검색
async function searchKakaoParkingNearby(kakaoRestKey, x, y, radius = 1000) {
  const url = `${BASE_KAKAO}/v2/local/search/category.json?category_group_code=PK6&x=${x}&y=${y}&radius=${radius}&sort=distance&size=15`;
  const data = await fetchJson(url, {
    headers: { Authorization: `KakaoAK ${kakaoRestKey}` },
  });
  if (data.errorType) throw new Error(data.message || "Kakao API error");
  return data;
}

// WGS84 → 기상청 격자 좌표 변환
function latLngToGrid(lat, lng) {
  const RE = 6371.00877;
  const GRID = 5.0;
  const SLAT1 = 30.0;
  const SLAT2 = 60.0;
  const OLON = 126.0;
  const OLAT = 38.0;
  const XO = 43;
  const YO = 136;
  const DEGRAD = Math.PI / 180.0;

  const re = RE / GRID;
  const slat1 = SLAT1 * DEGRAD;
  const slat2 = SLAT2 * DEGRAD;
  const olon = OLON * DEGRAD;
  const olat = OLAT * DEGRAD;

  let sn = Math.tan(Math.PI * 0.25 + slat2 * 0.5) / Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sn = Math.log(Math.cos(slat1) / Math.cos(slat2)) / Math.log(sn);
  let sf = Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sf = (Math.pow(sf, sn) * Math.cos(slat1)) / sn;
  let ro = Math.tan(Math.PI * 0.25 + olat * 0.5);
  ro = (re * sf) / Math.pow(ro, sn);

  const ra = Math.tan(Math.PI * 0.25 + lat * DEGRAD * 0.5);
  const r = (re * sf) / Math.pow(ra, sn);
  let theta = lng * DEGRAD - olon;
  if (theta > Math.PI) theta -= 2.0 * Math.PI;
  if (theta < -Math.PI) theta += 2.0 * Math.PI;
  theta *= sn;

  return {
    nx: Math.floor(r * Math.sin(theta) + XO + 0.5),
    ny: Math.floor(ro - r * Math.cos(theta) + YO + 0.5),
  };
}

function formatKstDate(date) {
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10).replace(/-/g, "");
}

function getBaseTime(date) {
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const hour = kst.getUTCHours();
  const minute = kst.getUTCMinutes();
  const baseTimes = [2, 5, 8, 11, 14, 17, 20, 23];
  let base = baseTimes[0];
  for (const t of baseTimes) {
    if (hour > t || (hour === t && minute >= 10)) base = t;
  }
  return `${String(base).padStart(2, "0")}00`;
}

module.exports = {
  fetchParkingFacility,
  fetchParkingRealtime,
  fetchParkingOperation,
  fetchGangneungParking,
  fetchWeatherForecast,
  fetchGangwonTourism,
  fetchGangwonEvents,
  searchKakaoPlace,
  searchKakaoParkingNearby,
  latLngToGrid,
};
