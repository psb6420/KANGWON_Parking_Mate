const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { URL } = require("node:url");

loadEnvFile(path.join(__dirname, ".env"));
loadEnvFile(path.join(__dirname, "backend", ".env"));

const PORT = 8080;
const ROOT = __dirname;
const GANGNEUNG_API_ROOT = "https://apis.data.go.kr/4201000/GNitsTrafficInfoService_1.0";
const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";
const FETCH_TIMEOUT_MS = 30000;
const RETRY_COUNT = 2;
const REALTIME_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const KNU_PARKING_LOT_6 = {
  id: "KNU_PARKING_6",
  name: "강원대학교 주차장6",
  address: "강원특별자치도 춘천시 강원대학길 1",
  lat: 37.8691389,
  lng: 127.7405348,
  totalSlots: 12,
};

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};

const CACHE_FILE = path.join(__dirname, "parking-cache.json");

let parkingCache = null;
let parkingJob = null;

function saveCacheToFile(cache) {
  try {
    const serialized = JSON.stringify({
      payload: cache.payload,
      snapshot: [...cache.snapshot.entries()],
    });
    fs.writeFileSync(CACHE_FILE, serialized, "utf8");
  } catch {
    // 파일 저장 실패해도 메모리 캐시는 유지
  }
}

function loadCacheFromFile() {
  try {
    if (!fs.existsSync(CACHE_FILE)) return null;
    const raw = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
    if (!raw?.payload) return null;
    return {
      payload: raw.payload,
      snapshot: new Map(raw.snapshot || []),
    };
  } catch {
    return null;
  }
}

parkingCache = loadCacheFromFile();

const REASONS_CACHE_FILE = path.join(__dirname, "reasons-cache.json");
let reasonsCache = new Map();

(function loadReasonsCacheFromFile() {
  try {
    if (!fs.existsSync(REASONS_CACHE_FILE)) return;
    const raw = JSON.parse(fs.readFileSync(REASONS_CACHE_FILE, "utf8"));
    reasonsCache = new Map(Object.entries(raw));
  } catch {}
})();

function saveReasonsCacheToFile() {
  try {
    fs.writeFileSync(REASONS_CACHE_FILE, JSON.stringify(Object.fromEntries(reasonsCache)), "utf8");
  } catch {}
}

function reasonsCacheKey(destination, lots) {
  const ids = lots.map((l) => String(l.managementNo || "")).sort().join(",");
  return `${destination.trim()}::${ids}`;
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

function sendJson(res, status, payload) {
  send(res, status, JSON.stringify(payload, null, 2), {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
}

function serveFile(reqUrl, res) {
  const pathname = reqUrl.pathname === "/" ? "/index.html" : decodeURIComponent(reqUrl.pathname);
  const requested = path.normalize(path.join(ROOT, pathname));
  if (!requested.startsWith(ROOT)) {
    send(res, 403, "Forbidden");
    return;
  }

  fs.readFile(requested, (error, data) => {
    if (error) {
      send(res, 404, "Not found");
      return;
    }
    const ext = path.extname(requested).toLowerCase();
    const headers = { "content-type": MIME[ext] || "application/octet-stream" };
    if (pathname === "/sw.js") {
      headers["cache-control"] = "no-cache";
      headers["service-worker-allowed"] = "/";
    }
    send(res, 200, data, headers);
  });
}

function cleanSecret(value) {
  return String(value || "").replace(/^\uFEFF/, "").trim();
}

function appendServiceKey(url, serviceKey) {
  const separator = url.includes("?") ? "&" : "?";
  const cleanKey = cleanSecret(serviceKey);
  const value = /%[0-9a-f]{2}/i.test(cleanKey) ? cleanKey : encodeURIComponent(cleanKey);
  return `${url}${separator}serviceKey=${value}`;
}

async function fetchGangneungPage(serviceKey, endpoint, pageNo, numOfRows) {
  const target = new URL(`${GANGNEUNG_API_ROOT}/${endpoint}`);
  target.searchParams.set("pageNo", String(pageNo));
  target.searchParams.set("numOfRows", String(numOfRows));
  const targetUrl = appendServiceKey(target.toString(), serviceKey);

  let lastError;
  for (let attempt = 0; attempt <= RETRY_COUNT; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(targetUrl, {
        headers: { accept: "application/json,*/*" },
        signal: controller.signal,
      });
      const text = await response.text();
      let payload;
      try {
        payload = JSON.parse(text);
      } catch {
        throw new Error(`JSON parse failed: ${text.slice(0, 120)}`);
      }
      const resultCode = payload?.header?.resultCode;
      if (!response.ok || resultCode !== "00") {
        throw new Error(payload?.header?.resultMsg || `HTTP ${response.status}`);
      }
      return payload;
    } catch (error) {
      lastError = error;
      if (attempt < RETRY_COUNT) await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError;
}

function extractGangneungRows(payload) {
  const item = payload?.body?.items?.item;
  if (Array.isArray(item)) return item;
  if (item && typeof item === "object") return [item];
  return [];
}

async function fetchGangneungAll(serviceKey, endpoint) {
  const firstPayload = await fetchGangneungPage(serviceKey, endpoint, 1, 100);
  const firstRows = extractGangneungRows(firstPayload);
  const totalCount = Number(firstPayload?.body?.totalCount || firstRows.length || 0);
  const requestedPages = Math.max(1, Math.ceil(totalCount / 100));
  const rows = [...firstRows];
  for (let pageNo = 2; pageNo <= requestedPages; pageNo += 1) {
    const payload = await fetchGangneungPage(serviceKey, endpoint, pageNo, 100);
    rows.push(...extractGangneungRows(payload));
  }
  return {
    endpoint,
    rows,
    fetchedRows: rows.length,
    requestedPages,
    totalCount,
    fetchedAt: new Date().toISOString(),
  };
}

function gangneungId(row) {
  return String(row?.prkId || row?.prk_id || "").trim();
}

function gangneungAddress(row) {
  return String(row?.prkAddr || row?.prk_addr || row?.address || "").trim();
}

function isFiniteKoreaCoordinate(lat, lng) {
  if (lat === undefined || lat === null || lng === undefined || lng === null) return false;
  if (String(lat).trim() === "" || String(lng).trim() === "") return false;
  const nLat = Number(lat);
  const nLng = Number(lng);
  return Number.isFinite(nLat) && Number.isFinite(nLng) && nLat >= 32 && nLat <= 39.5 && nLng >= 124 && nLng <= 132;
}

function formatShortTime(value) {
  if (value === undefined || value === null || String(value).trim() === "") return "";
  const text = String(value).trim().padStart(4, "0");
  if (!/^\d{4}$/.test(text)) return "";
  return `${text.slice(0, 2)}:${text.slice(2, 4)}`;
}

function formatGangneungOperation(info) {
  if (!info) return "";
  return [
    ["평일", info.weekOpenTime, info.weekEndTime],
    ["토요일", info.satOpenTime, info.satEndTime],
    ["휴일", info.holiOpenTime, info.holiEndTime],
  ]
    .map(([label, start, end]) => {
      const s = formatShortTime(start);
      const e = formatShortTime(end);
      return s && e ? `${label} ${s}-${e}` : "";
    })
    .filter(Boolean)
    .join(" / ");
}

function createState() {
  return {
    status: "running",
    phase: "gangneung-info",
    sourceApis: ["getParkInfo", "getParkRltm"],
    targetRegion: "강릉시 실시간 주차장",
    regionFilterMode: "gangneung-open-api-only",
    request: {
      provider: "4201000/GNitsTrafficInfoService_1.0",
    },
    gangneungInfoCount: 0,
    gangneungRealtimeCount: 0,
    realtimeMatchedCount: 0,
    mergedAddressCount: 0,
    overlappingAddressCount: 0,
    sourceApiFetches: {
      gangneungInfo: null,
      gangneungRealtime: null,
    },
    data: [],
    gangneungRealtimeComparison: null,
    gangneungRealtimeBaselineComparison: null,
    refreshIntervalMs: REALTIME_REFRESH_INTERVAL_MS,
    lastRealtimeRefreshedAt: null,
    nextRealtimeRefreshAt: null,
    startedAt: new Date().toISOString(),
    completedAt: null,
    error: null,
  };
}

function snapshotRows(rows) {
  const snapshot = new Map();
  for (const row of rows) {
    snapshot.set(row.managementNo, {
      available: row.realtimeAvailable,
      total: row.realtimeTotal,
    });
  }
  return snapshot;
}

function numberOrNull(value) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function compareSnapshots(previous, next, previousAt, currentAt) {
  const changedIds = [];
  let totalDelta = 0;
  let checkedCount = 0;
  for (const [id, current] of next.entries()) {
    const before = previous.get(id);
    if (!before) continue;
    const previousAvailable = numberOrNull(before.available);
    const currentAvailable = numberOrNull(current.available);
    if (previousAvailable === null || currentAvailable === null) continue;
    checkedCount += 1;
    const delta = currentAvailable - previousAvailable;
    totalDelta += delta;
    if (delta !== 0) {
      changedIds.push({
        id,
        previousAvailable,
        currentAvailable,
        delta,
        previousTotal: before.total,
        currentTotal: current.total,
        previousAt,
        currentAt,
      });
    }
  }
  return {
    previousAt,
    currentAt,
    checkedCount,
    unchangedCount: checkedCount - changedIds.length,
    changedCount: changedIds.length,
    totalDelta,
    changedIds,
  };
}

function buildMarkerRows(infoRows, realtimeRows, realtimeChangeById = new Map()) {
  const infoById = new Map();
  const realtimeById = new Map();
  for (const row of infoRows) {
    const id = gangneungId(row);
    if (id) infoById.set(id, row);
  }
  for (const row of realtimeRows) {
    const id = gangneungId(row);
    if (id) realtimeById.set(id, row);
  }

  const rows = [];
  for (const [id, info] of infoById.entries()) {
    const realtime = realtimeById.get(id);
    if (!realtime) continue;
    const address = gangneungAddress(info);
    const operationSummary = formatGangneungOperation(info);
    rows.push({
      managementNo: id,
      name: info.prkName || realtime.prkName || id,
      address: address || "주소 없음",
      lat: isFiniteKoreaCoordinate(info.yCrdn, info.xCrdn) ? Number(info.yCrdn) : null,
      lng: isFiniteKoreaCoordinate(info.yCrdn, info.xCrdn) ? Number(info.xCrdn) : null,
      needsGeocode: !isFiniteKoreaCoordinate(info.yCrdn, info.xCrdn),
      coordinateSource: isFiniteKoreaCoordinate(info.yCrdn, info.xCrdn) ? "getParkInfo" : "address",
      total: String(realtime.totalLots ?? ""),
      realtimeTotal: String(realtime.totalLots ?? ""),
      realtimeAvailable: String(realtime.availLots ?? ""),
      realtimeChange: realtimeChangeById.get(id) || null,
      sourceEntries: [
        {
          apiSource: "15140011",
          sourceApi: "getParkInfo + getParkRltm",
          sourceId: id,
          name: info.prkName || realtime.prkName || id,
          address,
          available: realtime.availLots ?? "",
          total: realtime.totalLots ?? "",
          realtimeChange: realtimeChangeById.get(id) || null,
          raw: {
            getParkInfo: info,
            getParkRltm: realtime,
          },
        },
      ],
      sourceLabels: ["15140011"],
      gangneungInfoRaw: info,
      gangneungRealtimeRaw: realtime,
      operationSummary,
      chargeSummary: "요금 정보 미제공",
      operationDetails: operationSummary ? [operationSummary] : [],
      hasOperationInfo: Boolean(operationSummary),
    });
  }
  rows.push(createKnuParkingLot6Row(realtimeChangeById.get(KNU_PARKING_LOT_6.id) || null));
  return rows;
}

function createKnuParkingLot6Row(realtimeChange = null) {
  const total = String(KNU_PARKING_LOT_6.totalSlots);
  return {
    managementNo: KNU_PARKING_LOT_6.id,
    name: KNU_PARKING_LOT_6.name,
    address: KNU_PARKING_LOT_6.address,
    lat: KNU_PARKING_LOT_6.lat,
    lng: KNU_PARKING_LOT_6.lng,
    needsGeocode: false,
    coordinateSource: "virtual-arduino",
    total,
    realtimeTotal: total,
    realtimeAvailable: total,
    realtimeChange,
    isVirtualArduinoLot: true,
    arduinoLotId: KNU_PARKING_LOT_6.id,
    slotLayout: {
      columns: 4,
      rows: 3,
      totalSlots: KNU_PARKING_LOT_6.totalSlots,
      arduinoSlot: "A1",
    },
    sourceEntries: [
      {
        apiSource: "ARDUINO",
        sourceApi: "virtual slots + Arduino A1",
        sourceId: KNU_PARKING_LOT_6.id,
        name: KNU_PARKING_LOT_6.name,
        address: KNU_PARKING_LOT_6.address,
        available: total,
        total,
        realtimeChange,
        raw: {
          slotLayout: "A1-A12 / 4x3",
          arduinoSlot: "A1",
        },
      },
    ],
    sourceLabels: ["ARDUINO"],
    operationSummary: "가상 주차면 A1-A12 / A1 Arduino 센서 연동",
    chargeSummary: "프로토타입 가상 주차장입니다.",
    operationDetails: ["가상 주차면 12면 중 A1은 Arduino 센서 상태와 연결됩니다."],
    hasOperationInfo: true,
  };
}

async function loadParkingData(serviceKey, previousCache = null) {
  const state = createState();
  const previousSnapshot = previousCache?.snapshot || new Map();
  const previousAt = previousCache?.payload?.lastRealtimeRefreshedAt || null;

  state.phase = "gangneung-info";
  const infoFetch = await fetchGangneungAll(serviceKey, "getParkInfo");
  state.sourceApiFetches.gangneungInfo = infoFetch;
  state.gangneungInfoCount = infoFetch.rows.length;

  state.phase = "gangneung-realtime";
  const realtimeFetch = await fetchGangneungAll(serviceKey, "getParkRltm");
  state.sourceApiFetches.gangneungRealtime = realtimeFetch;
  state.gangneungRealtimeCount = realtimeFetch.rows.length;

  const checkedAt = new Date().toISOString();
  const data = buildMarkerRows(infoFetch.rows, realtimeFetch.rows);
  const nextSnapshot = snapshotRows(data);
  const comparison = previousSnapshot.size
    ? compareSnapshots(previousSnapshot, nextSnapshot, previousAt, checkedAt)
    : null;
  const changeById = new Map((comparison?.changedIds || []).map((change) => [change.id, change]));
  state.data = buildMarkerRows(infoFetch.rows, realtimeFetch.rows, changeById);
  state.realtimeMatchedCount = state.data.length;
  state.mergedAddressCount = state.data.length;
  state.overlappingAddressCount = 0;
  state.gangneungRealtimeComparison = comparison;
  state.gangneungRealtimeBaselineComparison = comparison;
  state.status = "complete";
  state.phase = "complete";
  state.lastRealtimeRefreshedAt = checkedAt;
  state.nextRealtimeRefreshAt = new Date(Date.now() + REALTIME_REFRESH_INTERVAL_MS).toISOString();
  state.completedAt = new Date().toISOString();

  return {
    payload: publicState(state),
    snapshot: snapshotRows(state.data),
  };
}

function publicState(state) {
  return {
    status: state.status,
    phase: state.phase,
    sourceApis: state.sourceApis,
    targetRegion: state.targetRegion,
    regionFilterMode: state.regionFilterMode,
    request: state.request,
    gangneungInfoCount: state.gangneungInfoCount,
    gangneungRealtimeCount: state.gangneungRealtimeCount,
    realtimeMatchedCount: state.realtimeMatchedCount,
    mergedAddressCount: state.mergedAddressCount,
    overlappingAddressCount: state.overlappingAddressCount,
    sourceApiFetches: state.sourceApiFetches,
    data: state.data,
    gangneungRealtimeComparison: state.gangneungRealtimeComparison,
    gangneungRealtimeBaselineComparison: state.gangneungRealtimeBaselineComparison,
    refreshIntervalMs: state.refreshIntervalMs,
    lastRealtimeRefreshedAt: state.lastRealtimeRefreshedAt,
    nextRealtimeRefreshAt: state.nextRealtimeRefreshAt,
    startedAt: state.startedAt,
    completedAt: state.completedAt,
    error: state.error,
  };
}

async function proxyParking(reqUrl, res) {
  const serviceKey = reqUrl.searchParams.get("serviceKey") || process.env.DATA_GO_KR_SERVICE_KEY || "";
  const refresh = reqUrl.searchParams.get("refresh") === "1";
  if (!serviceKey) {
    sendJson(res, 400, { message: "serviceKey is required." });
    return;
  }
  if (parkingCache && !refresh) {
    sendJson(res, 200, parkingCache.payload);
    return;
  }
  if (!parkingJob) {
    parkingJob = loadParkingData(serviceKey, parkingCache)
      .then((result) => {
        parkingCache = result;
        saveCacheToFile(result);
        return result.payload;
      })
      .finally(() => {
        parkingJob = null;
      });
  }
  try {
    const payload = await parkingJob;
    sendJson(res, 200, payload);
  } catch (error) {
    sendJson(res, 502, { status: "failed", message: error.message, data: [] });
  }
}

function proxyClientConfig(res) {
  sendJson(res, 200, {
    kakaoJavascriptKey: cleanSecret(process.env.KAKAO_JAVASCRIPT_KEY),
    hasDataServiceKey: Boolean(cleanSecret(process.env.DATA_GO_KR_SERVICE_KEY)),
    hasGeminiKey: Boolean(cleanSecret(process.env.GEMINI_API_KEY)),
    parkingBackendOrigin: cleanSecret(process.env.PARKING_BACKEND_ORIGIN),
  });
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 65536) {
        reject(new Error("Request body is too large."));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Invalid JSON body."));
      }
    });
    req.on("error", reject);
  });
}

function normalizePreference(value) {
  if (value === "near" || value === "comfort" || value === "balanced") return value;
  return "balanced";
}

function fallbackParkingIntent(text) {
  const original = String(text || "").trim();
  const compact = original.replace(/\s+/g, " ");
  let preference = "balanced";
  if (/쾌적|여유|한산|널널|자리|혼잡하지|안\s*붐비|멀어도/.test(compact)) {
    preference = "comfort";
  } else if (/가까|근처|인근|도보|최단|가장\s*가까/.test(compact)) {
    preference = "near";
  }

  let destination = compact
    .replace(/(에서|근처에서)\s*(가까운|가까이|근처|인근).*$/g, "")
    .replace(/(으로|로)\s*(갈|가).*$/g, "")
    .replace(/주차장|찾아줘|찾아|추천해줘|추천|가까운|가까이|근처|인근|쾌적한|쾌적|여유로운|여유|한산한|한산|멀어도|되니깐|되니까|괜찮으니까/g, "")
    .replace(/\s+/g, " ")
    .trim();
  destination = destination.replace(/(에서|으로|로|에)$/g, "").trim();

  return {
    destination: destination || original,
    preference,
    reason: "AI 분석을 사용할 수 없어 입력 문장을 기본 해석으로 처리했습니다.",
    usedAi: false,
  };
}

function parseGeminiJson(text) {
  const raw = String(text || "")
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("AI response did not contain JSON.");
    return JSON.parse(match[0]);
  }
}

function normalizeParkingIntent(payload, originalText, usedAi) {
  const fallback = fallbackParkingIntent(originalText);
  const destination = String(payload?.destination || fallback.destination || originalText).trim();
  const reason = String(payload?.reason || fallback.reason || "").trim();
  return {
    destination: destination || originalText,
    preference: normalizePreference(payload?.preference || fallback.preference),
    reason,
    usedAi,
  };
}

async function analyzeParkingIntent(text) {
  const apiKey = cleanSecret(process.env.GEMINI_API_KEY);
  if (!apiKey) return fallbackParkingIntent(text);

  const prompt = [
    "너는 강원 Parking Mate의 주차 추천 의도 분석기다.",
    "사용자 문장에서 목적지와 주차 선호를 추출해라.",
    "preference는 다음 중 하나만 사용한다: near, comfort, balanced.",
    "- near: 가까움, 도보, 최단거리, 근처를 강하게 원함",
    "- comfort: 멀어도 됨, 여유, 쾌적, 혼잡 회피, 자리 많음을 원함",
    "- balanced: 명확한 선호가 없거나 둘 다 균형",
    "반드시 JSON만 반환해라. 예: {\"destination\":\"레고랜드\",\"preference\":\"comfort\",\"reason\":\"멀어도 쾌적한 주차장을 원한다고 해석했습니다.\"}",
    `사용자 입력: ${text}`,
  ].join("\n");


  const response = await fetch(`${GEMINI_API_URL}?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 180,
        responseMimeType: "application/json",
      },
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error?.message || `Gemini HTTP ${response.status}`;
    throw new Error(message);
  }

  const outputText = payload?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  const parsed = parseGeminiJson(outputText);
  return normalizeParkingIntent(parsed, text, true);
}

async function analyzeParkingReasons(destination, lots) {
  const apiKey = cleanSecret(process.env.GEMINI_API_KEY);
  if (!apiKey) return { reasons: [] };

  const lotsText = lots
    .map((lot) => {
      const avail = Number(lot.realtimeAvailable);
      const total = Number(lot.realtimeTotal);
      const used = Number.isFinite(avail) && Number.isFinite(total) ? total - avail : null;
      const occupancy = used !== null ? `빈자리 ${avail}면, 사용중 ${used}면, 전체 ${total}면` : `전체 ${lot.realtimeTotal}면`;
      return `managementNo=${lot.managementNo} | ${lot.name} (${occupancy}, 거리 ${Math.round(lot.destinationDistanceM || 0)}m)`;
    })
    .join("\n");

  const prompt = [
    "너는 강원 Parking Mate의 주차장 추천 이유 생성기다.",
    `목적지: ${destination}`,
    `아래 주차장 목록 ${lots.length}개 전부에 대해 각각 1~2문장의 추천 이유를 한국어로 작성해라.`,
    "가용 주차면 수와 목적지까지의 거리를 근거로 설명해라.",
    `반드시 JSON만 반환해라. reasons 배열에 반드시 ${lots.length}개 항목이 있어야 한다.`,
    "형식: {\"reasons\":[{\"managementNo\":\"...\",\"reason\":\"...\"},...]}",
    "각 항목의 managementNo는 입력 데이터의 managementNo= 값을 그대로 복사해라. 절대 바꾸지 마라.",
    "주차장 목록:",
    lotsText,
  ].join("\n");

  const response = await fetch(`${GEMINI_API_URL}?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 1500,
        responseMimeType: "application/json",
      },
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message || `Gemini HTTP ${response.status}`);
  }

  const outputText = payload?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  const parsed = parseGeminiJson(outputText);
  return { reasons: Array.isArray(parsed?.reasons) ? parsed.reasons : [] };
}

async function proxyParkingReasons(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { message: "POST method is required." });
    return;
  }
  try {
    const body = await readJsonBody(req);
    const destination = String(body?.destination || "").trim();
    const lots = Array.isArray(body?.lots) ? body.lots : [];
    if (!destination || lots.length === 0) {
      sendJson(res, 400, { message: "destination and lots are required." });
      return;
    }
    const cacheKey = reasonsCacheKey(destination, lots);
    if (reasonsCache.has(cacheKey)) {
      sendJson(res, 200, { reasons: reasonsCache.get(cacheKey), cached: true });
      return;
    }
    const result = await analyzeParkingReasons(destination, lots);
    if (result.reasons.length > 0) {
      reasonsCache.set(cacheKey, result.reasons);
      saveReasonsCacheToFile();
    }
    sendJson(res, 200, result);
  } catch (error) {
    console.error("[parking-reasons]", error.message);
    sendJson(res, 200, { reasons: [] });
  }
}

async function proxyParkingIntent(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { message: "POST method is required." });
    return;
  }
  let text = "";
  try {
    const body = await readJsonBody(req);
    text = String(body?.text || "").trim();
    if (!text) {
      sendJson(res, 400, { message: "text is required." });
      return;
    }
    const result = await analyzeParkingIntent(text);
    sendJson(res, 200, result);
  } catch (error) {
    const fallback = fallbackParkingIntent(text);
    sendJson(res, 200, {
      ...fallback,
      reason: `AI 분석이 실패했습니다. ${error.message}`,
      usedAi: false,
    });
  }
}

function requestHandler(req, res) {
  const reqUrl = new URL(req.url, `http://localhost:${PORT}`);

  if (reqUrl.pathname === "/api/config") {
    proxyClientConfig(res);
    return;
  }

  if (reqUrl.pathname === "/api/ai/parking-intent") {
    proxyParkingIntent(req, res);
    return;
  }

  if (reqUrl.pathname === "/api/ai/parking-reasons") {
    proxyParkingReasons(req, res);
    return;
  }

  
  if (
    reqUrl.pathname === "/api/parking/gangwon-realtime" ||
    reqUrl.pathname === "/api/parking/chuncheon-realtime" ||
    reqUrl.pathname === "/api/parking/all" ||
    reqUrl.pathname === "/api/parking/realtime-refresh"
  ) {
    proxyParking(reqUrl, res);
    return;
  }

  serveFile(reqUrl, res);
}

if (require.main === module) {
  const server = http.createServer(requestHandler);
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Kakao parking app: http://0.0.0.0:${PORT}/`);
    console.log("Using Gangneung getParkInfo/getParkRltm only.");
  });
}

module.exports = requestHandler;
