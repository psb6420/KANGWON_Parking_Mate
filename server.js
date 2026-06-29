const http = require("node:http");
const https = require("node:https");
const fs = require("node:fs");
const path = require("node:path");
const { URL } = require("node:url");

loadEnvFile(path.join(__dirname, ".env"));
loadEnvFile(path.join(__dirname, "backend", ".env"));

const PORT = 8080;
const ROOT = __dirname;
// 장시간 실행되는 단독 프론트 서버에서만 백엔드 프록시를 켠다.
// (Vercel 서버리스는 server.js를 require로 로드 → require.main !== module → SSE 중계 불가하므로 끔)
const BACKEND_PROXY_ENABLED = require.main === module && !process.env.VERCEL;
const BACKEND_PROXY_PREFIXES = ["/api/arduino/", "/api/push/", "/api/parking/status"];
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
  arduinoSlot: "A11",
};
const KNU_PARKING_BAENGNOKAN = {
  id: "KNU_PARKING_BAENGNOKAN",
  name: "강원대학교 백록관 주차장",
  address: "강원특별자치도 춘천시 강원대학길 1",
  lat: 37.868692486145015,
  lng: 127.74127352696846,
  totalSlots: 12,
  surroundingLabels: { top: "60주년 기념관", bottom: "도로", left: "백록관", right: "" },
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
  rows.push(createVirtualArduinoRow(KNU_PARKING_BAENGNOKAN, realtimeChangeById.get(KNU_PARKING_BAENGNOKAN.id) || null));
  return rows;
}

function createKnuParkingLot6Row(realtimeChange = null) {
  return createVirtualArduinoRow(KNU_PARKING_LOT_6, realtimeChange);
}

function createVirtualArduinoRow(lot, realtimeChange = null) {
  const total = String(lot.totalSlots);
  return {
    managementNo: lot.id,
    name: lot.name,
    address: lot.address,
    lat: lot.lat,
    lng: lot.lng,
    needsGeocode: false,
    coordinateSource: "virtual-arduino",
    total,
    realtimeTotal: total,
    realtimeAvailable: total,
    realtimeChange,
    isVirtualArduinoLot: true,
    arduinoLotId: lot.id,
    slotLayout: {
      columns: 4,
      rows: 3,
      totalSlots: lot.totalSlots,
      arduinoSlot: lot.arduinoSlot || "A1",
      surroundingLabels: lot.surroundingLabels || null,
    },
    sourceEntries: [
      {
        apiSource: "ARDUINO",
        sourceApi: `virtual slots + Arduino ${lot.arduinoSlot || "A1"}`,
        sourceId: lot.id,
        name: lot.name,
        address: lot.address,
        available: total,
        total,
        realtimeChange,
        raw: {
          slotLayout: "A1-A12 / 4x3",
          arduinoSlot: lot.arduinoSlot || "A1",
        },
      },
    ],
    sourceLabels: ["ARDUINO"],
    operationSummary: `가상 주차면 A1-A12 / ${lot.arduinoSlot || "A1"} Arduino 센서 연동`,
    chargeSummary: "프로토타입 가상 주차장입니다.",
    operationDetails: [`가상 주차면 12면 중 ${lot.arduinoSlot || "A1"}은 Arduino 센서 상태와 연결됩니다.`],
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
  const backendOrigin = cleanSecret(process.env.PARKING_BACKEND_ORIGIN);
  // 프록시가 켜져 있고 중계할 백엔드 주소가 있으면, 클라이언트는 same-origin(빈 문자열)으로
  // 백엔드를 호출하게 하고 프론트 서버가 :8000으로 중계한다. 그러면 휴대폰은 :8080 한 곳만 보면 된다.
  const proxyEnabled = BACKEND_PROXY_ENABLED && Boolean(backendOrigin);
  sendJson(res, 200, {
    kakaoJavascriptKey: cleanSecret(process.env.KAKAO_JAVASCRIPT_KEY),
    hasDataServiceKey: Boolean(cleanSecret(process.env.DATA_GO_KR_SERVICE_KEY)),
    hasGeminiKey: Boolean(cleanSecret(process.env.GEMINI_API_KEY)),
    parkingBackendOrigin: proxyEnabled ? "" : backendOrigin,
    backendProxy: proxyEnabled,
  });
}

// 백엔드(:8000)로의 요청을 그대로 중계한다. SSE(text/event-stream)도 스트리밍으로 통과시킨다.
function proxyToBackend(req, res, reqUrl) {
  const target = cleanSecret(process.env.PARKING_BACKEND_ORIGIN);
  if (!target) {
    sendJson(res, 502, { status: "failed", message: "Backend origin is not configured." });
    return;
  }
  let targetUrl;
  try {
    targetUrl = new URL(reqUrl.pathname + reqUrl.search, target);
  } catch {
    sendJson(res, 502, { status: "failed", message: "Invalid backend origin." });
    return;
  }
  const client = targetUrl.protocol === "https:" ? https : http;
  const headers = { ...req.headers };
  headers.host = targetUrl.host;
  delete headers["accept-encoding"]; // 압축 해제로 SSE 스트림이 끊기지 않도록 평문으로 받는다
  if (targetUrl.hostname.includes("ngrok")) headers["ngrok-skip-browser-warning"] = "1";

  const proxyReq = client.request(
    targetUrl,
    { method: req.method, headers },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      proxyRes.pipe(res);
    },
  );
  proxyReq.setTimeout(0); // SSE 장시간 연결이 타임아웃으로 끊기지 않게 한다
  proxyReq.on("error", (error) => {
    if (!res.headersSent) {
      sendJson(res, 502, { status: "failed", message: `Backend proxy error: ${error.message}` });
    } else {
      res.end();
    }
  });
  req.on("aborted", () => proxyReq.destroy());
  req.pipe(proxyReq);
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
  } else if (/가까|근처|인근|도보|최단|가장\s*가까|거동|불편|노인|어르신|할머니|할아버지|휠체어|장애|아기|유아|아이랑|아이들|어린이|짐이\s*많|짐\s*많|무거|급하|빨리/.test(compact)) {
    preference = "near";
  }

  const FALLBACK_REASON = "AI 분석을 사용할 수 없어 입력 문장을 기본 해석으로 처리했습니다.";
  const SKIP_WORDS = /^(가까운|근처|쾌적한|추천|찾아|주차|이랑|랑|와|과|그|이|저|제|우리|여기|저기|거기)$/;
  const STRIP_PARTICLES = /(에서|으로|로|에|이랑|랑|와|과|은|는)$/g;

  function extractCandidate(word) {
    const c = word.replace(STRIP_PARTICLES, "").trim();
    return c.length >= 2 && !SKIP_WORDS.test(c) ? c : null;
  }

  // "백록관 주차장" — 주차장 바로 앞 단어
  const beforeParking = compact.match(/(\S+)\s*주차장/);
  if (beforeParking) {
    const c = extractCandidate(beforeParking[1]);
    if (c) return { destination: c, preference, reason: FALLBACK_REASON, usedAi: false };
  }

  // "백록관 갈거야/가려고/가고싶어/가야해" — 동사 앞 단어
  const beforeVerb = compact.match(/(\S+)\s*(?:갈거야|갈게|갈건데|갈까|가려고|가고\s*싶|가야|갑니다|갔어|가자|갈게요|가는데|가볼까)/);
  if (beforeVerb) {
    const c = extractCandidate(beforeVerb[1]);
    if (c) return { destination: c, preference, reason: FALLBACK_REASON, usedAi: false };
  }

  // 오타 포함 역방향 추출: 마지막 단어가 갈/가-로 시작하는 동사형이면 그 앞 단어를 목적지로
  const words = compact.split(/\s+/);
  if (words.length >= 2) {
    const last = words[words.length - 1];
    if (/^(?:갈|가)[가-힣]*/.test(last)) {
      // 뒤에서 connector(이랑/랑/와/과) 붙은 단어는 건너뜀
      for (let i = words.length - 2; i >= 0; i--) {
        const c = extractCandidate(words[i]);
        if (c) return { destination: c, preference, reason: FALLBACK_REASON, usedAi: false };
      }
    }
  }

  let destination = compact
    .replace(/(에서|근처에서)\s*(가까운|가까이|근처|인근).*$/g, "")
    .replace(/(으로|로|이랑|랑)\s*(갈|가|가는데).*$/g, "")
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
  const rawDest = String(payload?.destination || "").trim();
  const validDest = rawDest && !["unknown", "없음", "null", "none"].includes(rawDest.toLowerCase());
  const destination = validDest ? rawDest : (fallback.destination || originalText);
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
    "아래 '사용자 입력' 문장에서 목적지(destination)와 주차 선호(preference)를 추출해라.",
    "destination은 사용자가 실제로 언급한 장소/지명만 넣는다. 장소가 없으면 \"unknown\"으로 둔다.",
    "preference는 다음 중 하나만 사용한다: near, comfort, balanced.",
    "- near: 가까움, 도보, 최단거리, 근처를 원함. 또는 거동 불편, 노인/어르신/할머니/할아버지 동반, 휠체어, 장애, 아기/유아/어린이 동반, 짐이 많음, 급함 등 가까운 주차가 필요한 상황",
    "- comfort: 멀어도 됨, 여유, 쾌적, 혼잡 회피, 자리 많음을 원함",
    "- balanced: 명확한 선호가 없거나 둘 다 균형",
    "reason은 위 분류를 왜 그렇게 했는지 사용자 입력 근거로 1문장으로 적는다.",
    "출력은 {\"destination\":string,\"preference\":\"near\"|\"comfort\"|\"balanced\",\"reason\":string} 형식의 JSON만 반환한다.",
    "아래 예시는 형식 참고용일 뿐이다. 예시의 값(장소명·문구)을 절대 그대로 복사하지 말고 반드시 실제 사용자 입력에서 추출해라.",
    "예시1) 입력: \"경포해변 근처 가까운 주차장\" -> {\"destination\":\"경포해변\",\"preference\":\"near\",\"reason\":\"가까운 주차를 원한다고 해석했습니다.\"}",
    "예시2) 입력: \"오죽헌 갈건데 자리 넉넉한 곳\" -> {\"destination\":\"오죽헌\",\"preference\":\"comfort\",\"reason\":\"여유로운 주차를 원한다고 해석했습니다.\"}",
    "예시3) 입력: \"주차장 추천해줘\" -> {\"destination\":\"unknown\",\"preference\":\"balanced\",\"reason\":\"명확한 목적지나 선호가 없어 균형으로 해석했습니다.\"}",
    `사용자 입력: "${text}"`,
  ].join("\n");


  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  let response;
  try {
    response = await fetch(`${GEMINI_API_URL}?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 256,
          responseMimeType: "application/json",
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    });
  } finally {
    clearTimeout(timer);
  }

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
    .map((lot) => `managementNo=${lot.managementNo} | ${lot.name} (거리 ${Math.round(lot.destinationDistanceM || 0)}m)`)
    .join("\n");

  const prompt = [
    "너는 강원 Parking Mate의 주차장 추천 이유 생성기다.",
    `목적지: ${destination}`,
    `아래 주차장 목록 ${lots.length}개 전부에 대해 각각 1~2문장의 추천 이유를 한국어로 작성해라.`,
    "목적지까지의 도보 거리와 주차장 위치·접근성을 근거로 설명해라. 잔여면수 등 실시간 데이터는 언급하지 마라.",
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
        thinkingConfig: { thinkingBudget: 0 },
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

async function proxyInterpretYesNo(req, res) {
  if (req.method !== "POST") { sendJson(res, 405, { message: "POST required." }); return; }
  try {
    const body = await readJsonBody(req);
    const text = String(body?.text || "").trim();
    if (!text) { sendJson(res, 200, { isYes: null }); return; }
    const apiKey = cleanSecret(process.env.GEMINI_API_KEY);
    if (!apiKey) { sendJson(res, 200, { isYes: null }); return; }
    const prompt = `사용자가 "예 또는 아니오"로 대답했다. 다음 발화가 긍정이면 true, 부정이면 false, 판단 불가면 null을 반환해라.\n발화: "${text}"\nJSON으로만 답해라: {"isYes": true|false|null}`;
    const response = await fetch(`${GEMINI_API_URL}?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 40, responseMimeType: "application/json", thinkingConfig: { thinkingBudget: 0 } },
      }),
    });
    const data = await response.json();
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    const parsed = JSON.parse(raw);
    sendJson(res, 200, { isYes: parsed.isYes ?? null });
  } catch { sendJson(res, 200, { isYes: null }); }
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
  const requestOrigin = String(req.headers.origin || "");

  if (requestOrigin === "https://localhost" || requestOrigin === "http://localhost") {
    res.setHeader("access-control-allow-origin", requestOrigin);
    res.setHeader("vary", "Origin");
    res.setHeader("access-control-allow-headers", "content-type");
    res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  }

  if (req.method === "OPTIONS") {
    send(res, 204, "");
    return;
  }

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

  if (reqUrl.pathname === "/api/ai/interpret-yes-no") {
    proxyInterpretYesNo(req, res);
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

  if (
    BACKEND_PROXY_ENABLED &&
    BACKEND_PROXY_PREFIXES.some((prefix) => reqUrl.pathname.startsWith(prefix))
  ) {
    proxyToBackend(req, res, reqUrl);
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
