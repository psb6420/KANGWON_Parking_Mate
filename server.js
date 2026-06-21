const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { URL } = require("node:url");

loadEnvFile(path.join(__dirname, ".env"));
loadEnvFile(path.join(__dirname, "backend", ".env"));

const PORT = Number(process.env.PORT || 8080);
const ROOT = __dirname;
const GANGNEUNG_API_ROOT = "https://apis.data.go.kr/4201000/GNitsTrafficInfoService_1.0";
const FETCH_TIMEOUT_MS = 30000;
const RETRY_COUNT = 2;
const REALTIME_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

let parkingCache = null;
let parkingJob = null;

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
    send(res, 200, data, { "content-type": MIME[ext] || "application/octet-stream" });
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
      total: String(realtime.totalLots || ""),
      realtimeTotal: String(realtime.totalLots || ""),
      realtimeAvailable: String(realtime.availLots || ""),
      realtimeChange: realtimeChangeById.get(id) || null,
      sourceEntries: [
        {
          apiSource: "15140011",
          sourceApi: "getParkInfo + getParkRltm",
          sourceId: id,
          name: info.prkName || realtime.prkName || id,
          address,
          available: realtime.availLots || "",
          total: realtime.totalLots || "",
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
      chargeSummary: "요금 정보는 getParkInfo 제공값 기준으로 확인하세요.",
      operationDetails: operationSummary ? [`getParkInfo 운영시간: ${operationSummary}`] : [],
      hasOperationInfo: Boolean(operationSummary),
    });
  }
  return rows;
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
  });
}

function requestHandler(req, res) {
  const reqUrl = new URL(req.url, `http://localhost:${PORT}`);

  if (reqUrl.pathname === "/api/config") {
    proxyClientConfig(res);
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
  server.listen(PORT, "127.0.0.1", () => {
    console.log(`Kakao parking app: http://localhost:${PORT}/`);
    console.log("Using Gangneung getParkInfo/getParkRltm only.");
  });
}

module.exports = requestHandler;
