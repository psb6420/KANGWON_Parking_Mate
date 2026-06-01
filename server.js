const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { URL } = require("node:url");

const PORT = Number(process.env.PORT || 8080);
const ROOT = __dirname;
const PARKING_API_BASE = "https://apis.data.go.kr/B553881/Parking/PrkSttusInfo";
const FETCH_TIMEOUT_MS = 45000;
const RETRY_COUNT = 2;
const API_PAGE_SIZE = Number(process.env.PARKING_API_PAGE_SIZE || 5000);
const API_CONCURRENCY = Number(process.env.PARKING_API_CONCURRENCY || 5);
const MAP_ROW_LIMIT = Number(process.env.PARKING_MAP_ROW_LIMIT || 100000);
const GANGWON_TEXT = "\uac15\uc6d0";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

let allParkingCache = null;
let allParkingJob = null;

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

function appendServiceKey(url, serviceKey) {
  const separator = url.includes("?") ? "&" : "?";
  const value = /%[0-9a-f]{2}/i.test(serviceKey) ? serviceKey : encodeURIComponent(serviceKey);
  return `${url}${separator}serviceKey=${value}`;
}

function isFiniteKoreaCoordinate(lat, lng) {
  if (lat === undefined || lat === null || lng === undefined || lng === null) return false;
  if (String(lat).trim() === "" || String(lng).trim() === "") return false;
  const nLat = Number(lat);
  const nLng = Number(lng);
  return Number.isFinite(nLat) && Number.isFinite(nLng) && nLat >= 32 && nLat <= 39.5 && nLng >= 124 && nLng <= 132;
}

function rowAddress(row) {
  return [
    row.prk_plce_adres,
    row.prk_plce_adres_sido,
    row.prk_plce_adres_sigungu,
    row.prk_plce_road_nm_adres,
  ]
    .filter(Boolean)
    .join(" ")
    .trim();
}

function isGangwonRow(row) {
  return rowAddress(row).includes(GANGWON_TEXT);
}

function normalizeParkingRow(row, sourcePageNo) {
  return {
    managementNo: String(row.prk_center_id || "").trim(),
    name: row.prk_plce_nm || "\uc8fc\ucc28\uc7a5",
    address: rowAddress(row) || "\uc8fc\uc18c \uc5c6\uc74c",
    lat: Number(row.prk_plce_entrc_la),
    lng: Number(row.prk_plce_entrc_lo),
    total: row.prk_cmprt_co || "",
    sourcePageNo,
  };
}

async function fetchParkingFacilities(serviceKey, pageNo, numOfRows) {
  const target = new URL(PARKING_API_BASE);
  target.searchParams.set("pageNo", String(pageNo));
  target.searchParams.set("numOfRows", String(numOfRows));
  target.searchParams.set("format", "2");
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
      if (!response.ok || payload.resultCode !== "0") {
        throw new Error(payload.resultMsg || `HTTP ${response.status}`);
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

function createCollectionState() {
  const startedAt = new Date().toISOString();
  return {
    status: "running",
    sourceApi: "15099883 PrkSttusInfo",
    request: {
      pageSize: API_PAGE_SIZE,
      concurrency: API_CONCURRENCY,
      format: 2,
      requestedPages: 0,
    },
    totalCount: 0,
    fetchedPages: 0,
    returnedCount: 0,
    totalMappableCount: 0,
    gangwonMappableCount: 0,
    mapRowLimit: MAP_ROW_LIMIT,
    gangwonCount: 0,
    gangwonPages: [],
    failedPages: [],
    failedPageErrors: [],
    data: [],
    gangwonData: [],
    startedAt,
    completedAt: null,
    error: null,
  };
}

function collectPage(rows, pageNo, state) {
  let pageHasGangwon = false;

  for (const row of rows) {
    const isGangwon = isGangwonRow(row);
    if (isGangwon) {
      pageHasGangwon = true;
      state.gangwonCount += 1;
    }

    if (isFiniteKoreaCoordinate(row.prk_plce_entrc_la, row.prk_plce_entrc_lo)) {
      state.totalMappableCount += 1;
      if (isGangwon) state.gangwonMappableCount += 1;
      if (state.data.length < MAP_ROW_LIMIT) {
        state.data.push(normalizeParkingRow(row, pageNo));
      }
      if (isGangwon && state.gangwonData.length < MAP_ROW_LIMIT) {
        state.gangwonData.push(normalizeParkingRow(row, pageNo));
      }
    }
  }

  if (pageHasGangwon && !state.gangwonPages.includes(pageNo)) {
    state.gangwonPages.push(pageNo);
    state.gangwonPages.sort((a, b) => a - b);
  }
}

function publicJobState(state, includeData) {
  return {
    status: state.status,
    sourceApi: state.sourceApi,
    request: state.request,
    totalCount: state.totalCount,
    fetchedPages: state.fetchedPages,
    returnedCount: state.returnedCount,
    totalMappableCount: state.totalMappableCount,
    gangwonMappableCount: state.gangwonMappableCount,
    mapRowLimit: state.mapRowLimit,
    gangwonCount: state.gangwonCount,
    gangwonPages: state.gangwonPages,
    failedPages: state.failedPages,
    failedPageErrors: state.failedPageErrors,
    data: includeData ? state.data : [],
    gangwonData: includeData ? state.gangwonData : [],
    startedAt: state.startedAt,
    completedAt: state.completedAt,
    error: state.error,
  };
}

function startAllParkingJob(serviceKey) {
  const state = createCollectionState();

  const promise = (async () => {
    const firstPayload = await fetchParkingFacilities(serviceKey, 1, API_PAGE_SIZE);
    const firstRows = Array.isArray(firstPayload.PrkSttusInfo) ? firstPayload.PrkSttusInfo : [];

    state.totalCount = Number(firstPayload.totalCount || 0);
    state.request.requestedPages = Math.max(1, Math.ceil(state.totalCount / API_PAGE_SIZE));
    state.fetchedPages = 1;
    state.returnedCount += firstRows.length;
    collectPage(firstRows, 1, state);

    let nextPage = 2;
    async function worker() {
      while (nextPage <= state.request.requestedPages) {
        const pageNo = nextPage;
        nextPage += 1;
        try {
          const payload = await fetchParkingFacilities(serviceKey, pageNo, API_PAGE_SIZE);
          const rows = Array.isArray(payload.PrkSttusInfo) ? payload.PrkSttusInfo : [];
          state.returnedCount += rows.length;
          collectPage(rows, pageNo, state);
        } catch (error) {
          state.failedPages.push(pageNo);
          state.failedPageErrors.push({ pageNo, message: error.message });
        } finally {
          state.fetchedPages += 1;
        }
      }
    }

    const workerCount = Math.min(API_CONCURRENCY, Math.max(1, state.request.requestedPages - 1));
    await Promise.all(Array.from({ length: workerCount }, () => worker()));

    const retryPages = [...state.failedPages];
    state.failedPages = [];
    state.failedPageErrors = [];
    for (const pageNo of retryPages) {
      try {
        const payload = await fetchParkingFacilities(serviceKey, pageNo, API_PAGE_SIZE);
        const rows = Array.isArray(payload.PrkSttusInfo) ? payload.PrkSttusInfo : [];
        state.returnedCount += rows.length;
        collectPage(rows, pageNo, state);
      } catch (error) {
        state.failedPages.push(pageNo);
        state.failedPageErrors.push({ pageNo, message: error.message });
      }
    }

    state.status = state.failedPages.length ? "complete_with_errors" : "complete";
    state.completedAt = new Date().toISOString();
    allParkingCache = publicJobState(state, true);
  })().catch((error) => {
    state.status = "failed";
    state.error = error.message;
    state.completedAt = new Date().toISOString();
  });

  allParkingJob = { state, promise };
  promise.finally(() => {
    allParkingJob = null;
  });

  return allParkingJob;
}

async function proxyParkingAll(reqUrl, res) {
  const serviceKey = reqUrl.searchParams.get("serviceKey") || process.env.DATA_GO_KR_SERVICE_KEY || "";
  const refresh = reqUrl.searchParams.get("refresh") === "1";
  if (!serviceKey) {
    sendJson(res, 400, { message: "serviceKey is required." });
    return;
  }

  if (refresh) allParkingCache = null;

  if (allParkingCache && !refresh) {
    sendJson(res, 200, allParkingCache);
    return;
  }

  if (!allParkingJob) {
    startAllParkingJob(serviceKey);
  }

  const isDone = allParkingJob.state.status === "complete" || allParkingJob.state.status === "complete_with_errors";
  const state = publicJobState(allParkingJob.state, true);
  const status = state.status === "failed" ? 502 : isDone ? 200 : 202;
  sendJson(res, status, state);
}

const server = http.createServer((req, res) => {
  const reqUrl = new URL(req.url, `http://localhost:${PORT}`);

  if (reqUrl.pathname === "/api/parking/all") {
    proxyParkingAll(reqUrl, res);
    return;
  }

  serveFile(reqUrl, res);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Kakao parking app: http://localhost:${PORT}/`);
});
