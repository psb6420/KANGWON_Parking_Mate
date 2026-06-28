const fetch = require("node-fetch");

const BASE_GANGNEUNG = "https://apis.data.go.kr/4201000/GNitsTrafficInfoService_1.0";
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

async function fetchGangneungParking(serviceKey, endpoint, pageNo = 1) {
  const url = appendKey(
    `${BASE_GANGNEUNG}/${endpoint}?pageNo=${pageNo}&numOfRows=100`,
    serviceKey,
  );
  const data = await fetchJson(url);
  const code = data?.header?.resultCode;
  if (code && code !== "00") throw new Error(data?.header?.resultMsg || "API error");
  return data;
}

async function fetchGangwonTourism(serviceKey, keyword = "", pageNo = 1, numOfRows = 20) {
  const areaCode = "32";
  const path = keyword ? "searchKeyword1" : "areaBasedList1";
  const target = new URL(`${BASE_TOURISM}/${path}`);
  target.searchParams.set("numOfRows", String(numOfRows));
  target.searchParams.set("pageNo", String(pageNo));
  target.searchParams.set("MobileOS", "ETC");
  target.searchParams.set("MobileApp", "GangwonParkingMate");
  target.searchParams.set("_type", "json");
  target.searchParams.set("areaCode", areaCode);
  if (keyword) {
    target.searchParams.set("keyword", keyword);
  } else {
    target.searchParams.set("contentTypeId", "12");
  }
  const data = await fetchJson(appendKey(target.toString(), serviceKey));
  const code = data?.response?.header?.resultCode;
  if (code && code !== "0000") throw new Error(data?.response?.header?.resultMsg || "Tourism API error");
  return data;
}

async function fetchGangwonEvents(serviceKey, pageNo = 1) {
  const now = new Date();
  const eventStartDate = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}01`;
  const target = new URL(`${BASE_TOURISM}/searchFestival1`);
  target.searchParams.set("numOfRows", "50");
  target.searchParams.set("pageNo", String(pageNo));
  target.searchParams.set("MobileOS", "ETC");
  target.searchParams.set("MobileApp", "GangwonParkingMate");
  target.searchParams.set("_type", "json");
  target.searchParams.set("areaCode", "32");
  target.searchParams.set("eventStartDate", eventStartDate);
  const data = await fetchJson(appendKey(target.toString(), serviceKey));
  const code = data?.response?.header?.resultCode;
  if (code && code !== "0000") throw new Error(data?.response?.header?.resultMsg || "Events API error");
  return data;
}

async function searchKakaoPlace(kakaoRestKey, keyword, x = null, y = null) {
  let url = `${BASE_KAKAO}/v2/local/search/keyword.json?query=${encodeURIComponent(keyword)}&size=15`;
  if (x && y) url += `&x=${x}&y=${y}&radius=20000&sort=distance`;
  const data = await fetchJson(url, {
    headers: { Authorization: `KakaoAK ${kakaoRestKey}` },
  });
  if (data.errorType) throw new Error(data.message || "Kakao API error");
  return data;
}

async function searchKakaoParkingNearby(kakaoRestKey, x, y, radius = 1000) {
  const url = `${BASE_KAKAO}/v2/local/search/category.json?category_group_code=PK6&x=${x}&y=${y}&radius=${radius}&sort=distance&size=15`;
  const data = await fetchJson(url, {
    headers: { Authorization: `KakaoAK ${kakaoRestKey}` },
  });
  if (data.errorType) throw new Error(data.message || "Kakao API error");
  return data;
}

module.exports = {
  fetchGangneungParking,
  fetchGangwonTourism,
  fetchGangwonEvents,
  searchKakaoPlace,
  searchKakaoParkingNearby,
};
