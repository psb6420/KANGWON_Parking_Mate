const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { URL } = require("node:url");

const PORT = Number(process.env.PORT || 8080);
const ROOT = __dirname;
const API_ROOT = "https://apis.data.go.kr/B553881/Parking";
const GANGNEUNG_API_ROOT = "https://apis.data.go.kr/4201000/GNitsTrafficInfoService_1.0";
const FETCH_TIMEOUT_MS = 120000;
const RETRY_COUNT = 2;
const API_PAGE_SIZE = Number(process.env.PARKING_API_PAGE_SIZE || 5000);
const API_CONCURRENCY = Number(process.env.PARKING_API_CONCURRENCY || 5);
const MAP_ROW_LIMIT = Number(process.env.PARKING_MAP_ROW_LIMIT || 100000);
const TARGET_REGION_TEXT = "\uac15\uc6d0";
const REALTIME_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const REALTIME_CHANGE_LOG_PATH = path.join(ROOT, "parking-realtime-change.log.jsonl");
const TARGET_PARKING_IDS = new Set([
  "21005-99999-00103-00-1",
  "25413-99999-00026-00-1",
  "25466-99999-00070-00-1",
  "25466-99999-00071-00-1",
  "25466-99999-00072-00-1",
  "25467-99999-00054-00-1",
  "25467-99999-00055-00-1",
  "25490-99999-00060-00-1",
  "25542-99999-00006-00-1",
  "25542-99999-00007-00-1",
  "25544-99999-00021-00-1",
]);

const API_CONFIG = {
  facility: { endpoint: "PrkSttusInfo", label: "facility" },
  realtime: { endpoint: "PrkRealtimeInfo", label: "realtime" },
  operation: { endpoint: "PrkOprInfo", label: "operation" },
  gangneungInfo: { endpoint: "getParkInfo", label: "gangneung-info" },
  gangneungRealtime: { endpoint: "getParkRltm", label: "gangneung-realtime" },
};

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
let parkingStore = null;
let realtimeRefreshJob = null;
let realtimeAutoRefreshTimer = null;

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
  const sido = String(row.prk_plce_adres_sido || "").trim();
  const sigungu = String(row.prk_plce_adres_sigungu || "").trim();
  const address = String(row.prk_plce_adres || row.prk_plce_road_nm_adres || "").trim();
  if (!address) return [sido, sigungu].filter(Boolean).join(" ").trim();
  if ((sido && address.includes(sido)) || (sigungu && address.includes(sigungu))) return address;
  return [sido, sigungu, address].filter(Boolean).join(" ").trim();
}

function rowId(row) {
  return String(row.prk_center_id || "").trim();
}

function normalizeAddressKey(address) {
  return String(address || "")
    .replace(/강원도/g, "강원특별자치도")
    .replace(/\s+/g, "")
    .replace(/[()]/g, "")
    .trim();
}

function gangneungAddress(row) {
  return String(row.prkAddr || row.prk_addr || row.address || "").trim();
}

function gangneungId(row) {
  return String(row.prkId || row.prk_id || "").trim();
}

function isFiniteNumberText(value) {
  if (value === undefined || value === null || String(value).trim() === "") return false;
  return Number.isFinite(Number(value));
}

function isTargetRegion(row) {
  return TARGET_PARKING_IDS.has(rowId(row)) || rowAddress(row).includes(TARGET_REGION_TEXT);
}

function isTargetParkingId(id) {
  return TARGET_PARKING_IDS.has(id);
}

function formatTime(value) {
  if (value === undefined || value === null || String(value).trim() === "") return "";
  const text = String(value).trim().padStart(6, "0");
  if (!/^\d{6}$/.test(text)) return "";
  return `${text.slice(0, 2)}:${text.slice(2, 4)}`;
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return "";
}

function formatWon(value) {
  const text = firstNonEmpty(value);
  if (!text) return "";
  const number = Number(text);
  if (!Number.isFinite(number)) return text;
  return `${number.toLocaleString()}\uc6d0`;
}

function operationSummary(row) {
  if (!row) return "";
  const days = [
    ["\uc6d4", row.Monday],
    ["\ud654", row.Tuesday],
    ["\uc218", row.Wednesday],
    ["\ubaa9", row.Thursday],
    ["\uae08", row.Friday],
    ["\ud1a0", row.Saturday],
    ["\uc77c", row.Sunday],
    ["\uacf5\ud734", row.Holiday],
  ];
  const summaries = days
    .map(([label, day]) => {
      const start = formatTime(day?.opertn_start_time);
      const end = formatTime(day?.opertn_end_time);
      if (!start || !end) return "";
      return `${label} ${start}-${end}`;
    })
    .filter(Boolean);
  return summaries.slice(0, 4).join(" / ");
}

function chargeSummary(row) {
  if (!row) return "";
  const basic = row.basic_info || {};
  const fixed = row.fxamt_info || {};
  const freeTime = firstNonEmpty(row.opertn_bs_free_time);
  const basicTime = firstNonEmpty(basic.parking_chrge_bs_time);
  const basicCharge = formatWon(basic.parking_chrge_bs_chrge);
  const addTime = firstNonEmpty(basic.parking_chrge_adit_unit_time);
  const addCharge = formatWon(basic.parking_chrge_adit_unit_chrge);
  const oneDay = formatWon(fixed.parking_chrge_one_day_chrge);
  const month = formatWon(fixed.parking_chrge_mon_unit_chrge);
  const parts = [];

  if (freeTime) parts.push(`\ubb34\ub8cc ${freeTime}\ubd84`);
  if (basicTime && basicCharge) parts.push(`\uae30\ubcf8 ${basicTime}\ubd84 ${basicCharge}`);
  else if (basicTime) parts.push(`\uae30\ubcf8 ${basicTime}\ubd84`);
  if (addTime && addCharge) parts.push(`\ucd94\uac00 ${addTime}\ubd84 ${addCharge}`);
  else if (addTime) parts.push(`\ucd94\uac00 ${addTime}\ubd84`);
  if (oneDay) parts.push(`1\uc77c ${oneDay}`);
  if (month) parts.push(`\uc6d4 ${month}`);

  return parts.join(" / ");
}

function operationDetails(row) {
  if (!row) return [];
  const summary = operationSummary(row);
  const charge = chargeSummary(row);
  return [
    summary ? `\uc6b4\uc601\uc2dc\uac04: ${summary}` : "\uc6b4\uc601\uc2dc\uac04: API \uc81c\uacf5\uac12 \uc5c6\uc74c",
    charge ? `\uc694\uae08: ${charge}` : "\uc694\uae08: API \uc81c\uacf5\uac12 \uc5c6\uc74c",
  ];
}

function normalizeFacility(row, sourcePageNo) {
  const hasApiCoordinate = isFiniteKoreaCoordinate(row.prk_plce_entrc_la, row.prk_plce_entrc_lo);
  const address = rowAddress(row);
  return {
    managementNo: rowId(row),
    name: row.prk_plce_nm || `${address.split(/\s+/).slice(-2).join(" ")} \uc8fc\ucc28\uc7a5`,
    address: address || "\uc8fc\uc18c \uc5c6\uc74c",
    lat: hasApiCoordinate ? Number(row.prk_plce_entrc_la) : null,
    lng: hasApiCoordinate ? Number(row.prk_plce_entrc_lo) : null,
    needsGeocode: !hasApiCoordinate,
    coordinateSource: hasApiCoordinate ? "api" : "address",
    total: row.prk_cmprt_co || "",
    sourcePageNo,
    facilityRaw: row,
  };
}

async function fetchParkingPage(serviceKey, endpoint, pageNo, numOfRows) {
  const target = new URL(`${API_ROOT}/${endpoint}`);
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

function phaseState() {
  return {
    status: "pending",
    totalCount: 0,
    requestedPages: 0,
    fetchedPages: 0,
    failedPages: [],
  };
}

function createState() {
  return {
    status: "running",
    phase: "realtime",
    sourceApis: [
      API_CONFIG.realtime.endpoint,
      API_CONFIG.facility.endpoint,
      API_CONFIG.operation.endpoint,
      API_CONFIG.gangneungInfo.endpoint,
      API_CONFIG.gangneungRealtime.endpoint,
    ],
    targetRegion: "\uac15\uc6d0 \uc2e4\uc2dc\uac04 \uc81c\uacf5 11\uac1c ID",
    regionFilterMode: "fixed-prk-center-id-overlap",
    request: {
      pageSize: API_PAGE_SIZE,
      concurrency: API_CONCURRENCY,
      format: 2,
    },
    phases: {
      facility: phaseState(),
      realtime: phaseState(),
      operation: phaseState(),
    },
    facilityCount: 0,
    facilityMappableCount: 0,
    realtimeMatchedCount: 0,
    operationMatchedCount: 0,
    gangneungInfoCount: 0,
    gangneungRealtimeCount: 0,
    mergedAddressCount: 0,
    overlappingAddressCount: 0,
    sourceApiFetches: {
      gangneungInfo: null,
      gangneungRealtime: null,
    },
    mapRowLimit: MAP_ROW_LIMIT,
    data: [],
    realtimeApiFetch: {
      endpoint: API_CONFIG.realtime.endpoint,
      fetchedRows: 0,
      matchedRows: 0,
      fetchedPages: 0,
      requestedPages: 0,
      totalCount: 0,
      fetchedAt: null,
    },
    realtimeChangeById: new Map(),
    realtimeComparison: null,
    realtimeBaselineComparison: null,
    gangneungRealtimeChangeById: new Map(),
    gangneungRealtimeComparison: null,
    gangneungRealtimeBaselineComparison: null,
    realtimeChangeLogFile: path.basename(REALTIME_CHANGE_LOG_PATH),
    refreshIntervalMs: REALTIME_REFRESH_INTERVAL_MS,
    lastRealtimeRefreshedAt: null,
    nextRealtimeRefreshAt: null,
    startedAt: new Date().toISOString(),
    completedAt: null,
    error: null,
  };
}

function clearRealtimeAutoRefresh() {
  if (!realtimeAutoRefreshTimer) return;
  clearTimeout(realtimeAutoRefreshTimer);
  realtimeAutoRefreshTimer = null;
}

function scheduleRealtimeAutoRefresh() {
  clearRealtimeAutoRefresh();
  if (!parkingStore || !parkingStore.serviceKey) return;
  const nextAt = parkingStore.state?.nextRealtimeRefreshAt;
  const targetTime = nextAt ? new Date(nextAt).getTime() : Date.now() + REALTIME_REFRESH_INTERVAL_MS;
  const delay = Math.max(1000, Number.isFinite(targetTime) ? targetTime - Date.now() : REALTIME_REFRESH_INTERVAL_MS);

  realtimeAutoRefreshTimer = setTimeout(() => {
    realtimeAutoRefreshTimer = null;
    if (!parkingStore || parkingJob || realtimeRefreshJob || parkingStore.state.status === "running") {
      scheduleRealtimeAutoRefresh();
      return;
    }
    startRealtimeRefreshJob(parkingStore.serviceKey);
  }, delay);
}

function appendRealtimeChangeLog(entry) {
  fs.appendFile(
    REALTIME_CHANGE_LOG_PATH,
    `${JSON.stringify(entry)}\n`,
    (error) => {
      if (error) console.error("Failed to write realtime change log:", error.message);
    },
  );
}

function snapshotRealtimeRows(realtimeById) {
  const snapshot = new Map();
  for (const [id, row] of realtimeById.entries()) {
    snapshot.set(id, {
      available: row?.pkfc_Available_ParkingLots_total ?? "",
      total: row?.pkfc_ParkingLots_total ?? "",
    });
  }
  return snapshot;
}

function snapshotGangneungRealtimeRows(gangneungRealtimeById) {
  const snapshot = new Map();
  for (const [id, row] of gangneungRealtimeById.entries()) {
    snapshot.set(id, {
      available: row?.availLots ?? "",
      total: row?.totalLots ?? "",
    });
  }
  return snapshot;
}

function numberOrNull(value) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function compareRealtimeSnapshots(previous, next, previousAt, currentAt) {
  const byId = new Map();
  const changedIds = [];
  let totalDelta = 0;

  for (const [id, current] of next.entries()) {
    const before = previous.get(id);
    if (!before) continue;
    const previousAvailable = numberOrNull(before.available);
    const currentAvailable = numberOrNull(current.available);
    if (previousAvailable === null || currentAvailable === null) continue;
    const delta = currentAvailable - previousAvailable;
    const change = {
      id,
      previousAvailable,
      currentAvailable,
      delta,
      previousTotal: before.total,
      currentTotal: current.total,
      previousAt,
      currentAt,
    };
    byId.set(id, change);
    totalDelta += delta;
    if (delta !== 0) changedIds.push(change);
  }

  return {
    byId,
    summary: {
      previousAt,
      currentAt,
      checkedCount: byId.size,
      unchangedCount: byId.size - changedIds.length,
      changedCount: changedIds.length,
      totalDelta,
      changedIds,
    },
  };
}

async function scanEndpoint({ serviceKey, state, phase, endpoint, onRows, shouldStop }) {
  const phaseInfo = state.phases[phase];
  phaseInfo.status = "running";
  state.phase = phase;

  const firstPayload = await fetchParkingPage(serviceKey, endpoint, 1, API_PAGE_SIZE);
  const firstRows = Array.isArray(firstPayload[endpoint]) ? firstPayload[endpoint] : [];
  phaseInfo.totalCount = Number(firstPayload.totalCount || 0);
  phaseInfo.requestedPages = Math.max(1, Math.ceil(phaseInfo.totalCount / API_PAGE_SIZE));
  phaseInfo.fetchedPages = 1;
  onRows(firstRows, 1);
  if (shouldStop?.()) {
    phaseInfo.status = "complete";
    return;
  }

  let nextPage = 2;
  async function worker() {
    while (nextPage <= phaseInfo.requestedPages && !shouldStop?.()) {
      const pageNo = nextPage;
      nextPage += 1;
      try {
        const payload = await fetchParkingPage(serviceKey, endpoint, pageNo, API_PAGE_SIZE);
        const rows = Array.isArray(payload[endpoint]) ? payload[endpoint] : [];
        onRows(rows, pageNo);
      } catch {
        phaseInfo.failedPages.push(pageNo);
      } finally {
        phaseInfo.fetchedPages += 1;
      }
    }
  }

  const workerCount = Math.min(API_CONCURRENCY, Math.max(1, phaseInfo.requestedPages - 1));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  const retryPages = [...phaseInfo.failedPages];
  phaseInfo.failedPages = [];
  for (const pageNo of retryPages) {
    try {
      const payload = await fetchParkingPage(serviceKey, endpoint, pageNo, API_PAGE_SIZE);
      const rows = Array.isArray(payload[endpoint]) ? payload[endpoint] : [];
      onRows(rows, pageNo);
    } catch {
      phaseInfo.failedPages.push(pageNo);
    }
  }

  phaseInfo.status = phaseInfo.failedPages.length ? "complete_with_errors" : "complete";
}

function createGroup(address, fallbackKey) {
  return {
    key: normalizeAddressKey(address) || fallbackKey,
    managementNo: "",
    name: "",
    address: address || "\uc8fc\uc18c \uc5c6\uc74c",
    lat: null,
    lng: null,
    needsGeocode: true,
    coordinateSource: "address",
    total: "",
    realtimeTotal: "",
    realtimeAvailable: "",
    realtimeChange: null,
    sourceEntries: [],
    sourceLabels: [],
    facilityRaw: null,
    realtimeRaw: null,
    operationRaw: null,
    gangneungInfoRaw: null,
    gangneungRealtimeRaw: null,
    operationSummary: "",
    chargeSummary: "",
    operationDetails: [],
    hasOperationInfo: false,
  };
}

function upsertGroup(groups, address, fallbackKey) {
  const key = normalizeAddressKey(address) || fallbackKey;
  if (!groups.has(key)) groups.set(key, createGroup(address, fallbackKey));
  return groups.get(key);
}

function addSourceEntry(group, entry) {
  group.sourceEntries.push(entry);
  if (!group.sourceLabels.includes(entry.apiSource)) group.sourceLabels.push(entry.apiSource);
  if (!group.managementNo) group.managementNo = entry.sourceId;
  if (!group.name) group.name = entry.name;
  if (!group.address || group.address === "\uc8fc\uc18c \uc5c6\uc74c") group.address = entry.address;
  if (!group.realtimeAvailable && entry.available !== undefined) group.realtimeAvailable = String(entry.available ?? "");
  if (!group.realtimeTotal && entry.total !== undefined) group.realtimeTotal = String(entry.total ?? "");
  if (!group.total && entry.total !== undefined) group.total = String(entry.total ?? "");
  if (!group.realtimeChange && entry.realtimeChange) group.realtimeChange = entry.realtimeChange;
}

function preferCoordinate(group, lat, lng, source) {
  if (!isFiniteKoreaCoordinate(lat, lng)) return;
  group.lat = Number(lat);
  group.lng = Number(lng);
  group.needsGeocode = false;
  group.coordinateSource = source;
}

function formatGangneungOperation(info) {
  if (!info) return "";
  const rows = [
    ["\ud3c9\uc77c", info.weekOpenTime, info.weekEndTime],
    ["\ud1a0\uc694", info.satOpenTime, info.satEndTime],
    ["\ud734\uc77c", info.holiOpenTime, info.holiEndTime],
  ]
    .map(([label, start, end]) => {
      const s = formatShortTime(start);
      const e = formatShortTime(end);
      if (!s || !e) return "";
      return `${label} ${s}-${e}`;
    })
    .filter(Boolean);
  return rows.join(" / ");
}

function formatShortTime(value) {
  if (value === undefined || value === null || String(value).trim() === "") return "";
  const text = String(value).trim().padStart(4, "0");
  if (!/^\d{4}$/.test(text)) return "";
  if (text === "0000") return "00:00";
  return `${text.slice(0, 2)}:${text.slice(2, 4)}`;
}

function buildMarkerRows(
  facilityById,
  realtimeById,
  operationById,
  realtimeChangeById = new Map(),
  gangneungInfoById = new Map(),
  gangneungRealtimeById = new Map(),
  gangneungRealtimeChangeById = new Map(),
) {
  const groups = new Map();

  for (const facility of facilityById.values()) {
    if (!realtimeById.has(facility.managementNo)) continue;
    const realtime = realtimeById.get(facility.managementNo);
    const operation = operationById.get(facility.managementNo);
    const realtimeChange = realtimeChangeById.get(facility.managementNo) || null;
    const group = upsertGroup(groups, facility.address, `old:${facility.managementNo}`);
    if (isFiniteKoreaCoordinate(facility.lat, facility.lng)) {
      preferCoordinate(group, facility.lat, facility.lng, facility.coordinateSource || "api");
    }
    group.facilityRaw ||= facility.facilityRaw;
    group.realtimeRaw ||= realtime || null;
    group.operationRaw ||= operation || null;
    group.operationSummary ||= operationSummary(operation);
    group.chargeSummary ||= chargeSummary(operation);
    group.operationDetails = group.operationDetails.length ? group.operationDetails : operationDetails(operation);
    group.hasOperationInfo = group.hasOperationInfo || Boolean(operation);
    addSourceEntry(group, {
      apiSource: "15099883",
      sourceApi: "PrkSttusInfo + PrkRealtimeInfo + PrkOprInfo",
      sourceId: facility.managementNo,
      name: facility.name,
      address: facility.address,
      available: realtime?.pkfc_Available_ParkingLots_total || "",
      total: realtime?.pkfc_ParkingLots_total || facility.total || "",
      realtimeChange,
      raw: {
        PrkSttusInfo: facility.facilityRaw,
        PrkRealtimeInfo: realtime || null,
        PrkOprInfo: operation || null,
      },
    });
  }

  for (const info of gangneungInfoById.values()) {
    const id = gangneungId(info);
    const realtime = gangneungRealtimeById.get(id);
    if (!id || !realtime) continue;
    const address = gangneungAddress(info);
    const group = upsertGroup(groups, address, `gangneung:${id}`);
    const realtimeChange = gangneungRealtimeChangeById.get(id) || null;
    preferCoordinate(group, info.yCrdn, info.xCrdn, "getParkInfo");
    group.gangneungInfoRaw ||= info;
    group.gangneungRealtimeRaw ||= realtime;
    if (!group.operationSummary) group.operationSummary = formatGangneungOperation(info);
    if (!group.operationDetails.length && group.operationSummary) {
      group.operationDetails = [`getParkInfo \uc6b4\uc601\uc2dc\uac04: ${group.operationSummary}`];
    }
    group.hasOperationInfo = group.hasOperationInfo || Boolean(group.operationSummary);
    addSourceEntry(group, {
      apiSource: "15140011",
      sourceApi: "getParkInfo + getParkRltm",
      sourceId: id,
      name: info.prkName || realtime.prkName || id,
      address,
      available: realtime.availLots || "",
      total: realtime.totalLots || "",
      realtimeChange,
      raw: {
        getParkInfo: info,
        getParkRltm: realtime,
      },
    });
  }

  return [...groups.values()]
    .filter((group) => group.sourceEntries.length)
    .slice(0, MAP_ROW_LIMIT)
    .map((group) => {
      const preferred = group.sourceEntries.find((entry) => entry.apiSource === "15140011") || group.sourceEntries[0];
      return {
        ...group,
        managementNo: preferred.sourceId || group.managementNo,
        name: preferred.name || group.name,
        address: preferred.address || group.address,
        realtimeAvailable: String(preferred.available ?? group.realtimeAvailable ?? ""),
        realtimeTotal: String(preferred.total ?? group.realtimeTotal ?? ""),
        total: String(preferred.total ?? group.total ?? ""),
      };
    });
}

function startParkingJob(serviceKey) {
  clearRealtimeAutoRefresh();
  const state = createState();
  const facilityById = new Map();
  const realtimeById = new Map();
  const realtimePageById = new Map();
  const matchedRealtimePages = new Set();
  const operationById = new Map();
  const gangneungInfoById = new Map();
  const gangneungRealtimeById = new Map();
  parkingStore = {
    serviceKey,
    state,
    facilityById,
    realtimeById,
    realtimePageById,
    matchedRealtimePages,
    operationById,
    gangneungInfoById,
    gangneungRealtimeById,
  };

  const refreshMarkerRows = () => {
    state.data = buildMarkerRows(
      facilityById,
      realtimeById,
      operationById,
      state.realtimeChangeById,
      gangneungInfoById,
      gangneungRealtimeById,
      state.gangneungRealtimeChangeById,
    );
    state.realtimeMatchedCount = [...facilityById.keys()].filter((id) => realtimeById.has(id)).length;
    state.mergedAddressCount = state.data.length;
    state.overlappingAddressCount = state.data.filter((row) => row.sourceEntries?.length > 1).length;
  };

  const promise = (async () => {
    await Promise.all([
      scanEndpoint({
        serviceKey,
        state,
        phase: "realtime",
        endpoint: API_CONFIG.realtime.endpoint,
        onRows: (rows, pageNo) => {
          let changed = false;
          let matchedRows = 0;
          state.realtimeApiFetch.fetchedRows += rows.length;
          state.realtimeApiFetch.fetchedPages += 1;
          state.realtimeApiFetch.requestedPages = state.phases.realtime.requestedPages;
          state.realtimeApiFetch.totalCount = state.phases.realtime.totalCount;
          state.realtimeApiFetch.fetchedAt = new Date().toISOString();
          for (const row of rows) {
            const id = rowId(row);
            if (!id || !isTargetParkingId(id) || realtimeById.has(id)) continue;
            matchedRows += 1;
            realtimeById.set(id, row);
            realtimePageById.set(id, pageNo);
            if (facilityById.has(id)) {
              matchedRealtimePages.add(pageNo);
              changed = true;
            }
          }
          state.realtimeApiFetch.matchedRows += matchedRows;
          if (changed) refreshMarkerRows();
        },
        shouldStop: () => realtimeById.size >= TARGET_PARKING_IDS.size,
      }),
      scanEndpoint({
        serviceKey,
        state,
        phase: "facility",
        endpoint: API_CONFIG.facility.endpoint,
        onRows: (rows, pageNo) => {
          let changed = false;
          for (const row of rows) {
            const id = rowId(row);
            if (!id || !isTargetParkingId(id) || !isTargetRegion(row)) continue;
            state.facilityCount += 1;
            if (isFiniteKoreaCoordinate(row.prk_plce_entrc_la, row.prk_plce_entrc_lo)) {
              state.facilityMappableCount += 1;
            }
            if (facilityById.has(id)) continue;
            facilityById.set(id, normalizeFacility(row, pageNo));
            if (realtimeById.has(id)) {
              const realtimePageNo = realtimePageById.get(id);
              if (realtimePageNo) matchedRealtimePages.add(realtimePageNo);
            }
            changed = true;
          }
          if (changed) refreshMarkerRows();
        },
        shouldStop: () => facilityById.size >= TARGET_PARKING_IDS.size,
      }),
    ]);

    const targetOperationCount = () =>
      [...facilityById.keys()].filter((id) => realtimeById.has(id)).length;

    await scanEndpoint({
      serviceKey,
      state,
      phase: "operation",
      endpoint: API_CONFIG.operation.endpoint,
      onRows: (rows) => {
        for (const row of rows) {
          const id = rowId(row);
          if (!facilityById.has(id) || !realtimeById.has(id) || operationById.has(id)) continue;
          operationById.set(id, row);
        }
        state.operationMatchedCount = operationById.size;
        refreshMarkerRows();
      },
      shouldStop: () => {
        const targetCount = targetOperationCount();
        return targetCount > 0 && operationById.size >= targetCount;
      },
    });

    state.phase = API_CONFIG.gangneungInfo.label;
    const gangneungInfoFetch = await fetchGangneungAll(serviceKey, API_CONFIG.gangneungInfo.endpoint);
    state.sourceApiFetches.gangneungInfo = gangneungInfoFetch;
    for (const row of gangneungInfoFetch.rows) {
      const id = gangneungId(row);
      if (id) gangneungInfoById.set(id, row);
    }
    state.gangneungInfoCount = gangneungInfoById.size;

    state.phase = API_CONFIG.gangneungRealtime.label;
    const gangneungRealtimeFetch = await fetchGangneungAll(serviceKey, API_CONFIG.gangneungRealtime.endpoint);
    state.sourceApiFetches.gangneungRealtime = gangneungRealtimeFetch;
    for (const row of gangneungRealtimeFetch.rows) {
      const id = gangneungId(row);
      if (id) gangneungRealtimeById.set(id, row);
    }
    state.gangneungRealtimeCount = gangneungRealtimeById.size;
    refreshMarkerRows();

    state.status = Object.values(state.phases).some((phase) => phase.failedPages.length)
      ? "complete_with_errors"
      : "complete";
    state.phase = "complete";
    state.lastRealtimeRefreshedAt = new Date().toISOString();
    state.nextRealtimeRefreshAt = new Date(Date.now() + REALTIME_REFRESH_INTERVAL_MS).toISOString();
    parkingStore.realtimeSnapshotById = snapshotRealtimeRows(realtimeById);
    parkingStore.realtimeSnapshotAt = state.lastRealtimeRefreshedAt;
    parkingStore.initialRealtimeSnapshotById = snapshotRealtimeRows(realtimeById);
    parkingStore.initialRealtimeSnapshotAt = state.lastRealtimeRefreshedAt;
    parkingStore.gangneungRealtimeSnapshotById = snapshotGangneungRealtimeRows(gangneungRealtimeById);
    parkingStore.gangneungRealtimeSnapshotAt = state.lastRealtimeRefreshedAt;
    parkingStore.initialGangneungRealtimeSnapshotById = snapshotGangneungRealtimeRows(gangneungRealtimeById);
    parkingStore.initialGangneungRealtimeSnapshotAt = state.lastRealtimeRefreshedAt;
    refreshMarkerRows();
    state.completedAt = new Date().toISOString();
    parkingCache = publicState(state);
    scheduleRealtimeAutoRefresh();
  })().catch((error) => {
    state.status = "failed";
    state.error = error.message;
    state.completedAt = new Date().toISOString();
  });

  parkingJob = { state, promise };
  promise.finally(() => {
    parkingJob = null;
  });

  return parkingJob;
}

function publicState(state) {
  return {
    status: state.status,
    phase: state.phase,
    sourceApis: state.sourceApis,
    targetRegion: state.targetRegion,
    regionFilterMode: state.regionFilterMode,
    request: state.request,
    phases: state.phases,
    facilityCount: state.facilityCount,
    facilityMappableCount: state.facilityMappableCount,
    realtimeMatchedCount: state.realtimeMatchedCount,
    gangneungInfoCount: state.gangneungInfoCount,
    gangneungRealtimeCount: state.gangneungRealtimeCount,
    mergedAddressCount: state.mergedAddressCount,
    overlappingAddressCount: state.overlappingAddressCount,
    sourceApiFetches: state.sourceApiFetches,
    realtimeApiFetch: state.realtimeApiFetch,
    realtimeMatchedPages: parkingStore?.matchedRealtimePages
      ? [...parkingStore.matchedRealtimePages].sort((a, b) => a - b)
      : [],
    operationMatchedCount: state.operationMatchedCount,
    mapRowLimit: state.mapRowLimit,
    data: state.data,
    realtimeComparison: state.realtimeComparison,
    realtimeBaselineComparison: state.realtimeBaselineComparison,
    gangneungRealtimeComparison: state.gangneungRealtimeComparison,
    gangneungRealtimeBaselineComparison: state.gangneungRealtimeBaselineComparison,
    realtimeChangeLogFile: state.realtimeChangeLogFile,
    refreshIntervalMs: state.refreshIntervalMs,
    lastRealtimeRefreshedAt: state.lastRealtimeRefreshedAt,
    nextRealtimeRefreshAt: state.nextRealtimeRefreshAt,
    startedAt: state.startedAt,
    completedAt: state.completedAt,
    error: state.error,
  };
}

function startRealtimeRefreshJob(serviceKey) {
  if (!parkingStore) {
    throw new Error("Parking data is not loaded yet.");
  }
  if (realtimeRefreshJob) return realtimeRefreshJob;

  const {
    state,
    facilityById,
    realtimeById,
    realtimePageById,
    matchedRealtimePages,
    operationById,
    gangneungInfoById,
    gangneungRealtimeById,
  } = parkingStore;
  const refreshMarkerRows = () => {
    state.data = buildMarkerRows(
      facilityById,
      realtimeById,
      operationById,
      state.realtimeChangeById,
      gangneungInfoById,
      gangneungRealtimeById,
      state.gangneungRealtimeChangeById,
    );
    state.realtimeMatchedCount = [...facilityById.keys()].filter((id) => realtimeById.has(id)).length;
    state.mergedAddressCount = state.data.length;
    state.overlappingAddressCount = state.data.filter((row) => row.sourceEntries?.length > 1).length;
  };
  const previousSnapshotById = parkingStore.realtimeSnapshotById || snapshotRealtimeRows(realtimeById);
  const previousSnapshotAt = parkingStore.realtimeSnapshotAt || state.lastRealtimeRefreshedAt || null;
  const previousGangneungSnapshotById =
    parkingStore.gangneungRealtimeSnapshotById || snapshotGangneungRealtimeRows(gangneungRealtimeById);
  const previousGangneungSnapshotAt =
    parkingStore.gangneungRealtimeSnapshotAt || state.lastRealtimeRefreshedAt || null;
  const phaseInfo = phaseState();
  state.phases.realtime = phaseInfo;
  state.status = "refreshing";
  state.phase = "realtime";
  state.error = null;

  const promise = (async () => {
    const pages = [...matchedRealtimePages].sort((a, b) => a - b);
    if (pages.length) {
      await refreshRealtimePages({
        serviceKey,
        state,
        pages,
        onRows: (rows, pageNo) => {
          let matchedRows = 0;
          for (const row of rows) {
            const id = rowId(row);
            if (!facilityById.has(id)) continue;
            matchedRows += 1;
            realtimeById.set(id, row);
            realtimePageById.set(id, pageNo);
          }
          state.realtimeApiFetch.matchedRows += matchedRows;
          refreshMarkerRows();
        },
      });
    } else {
      await scanEndpoint({
        serviceKey,
        state,
        phase: "realtime",
        endpoint: API_CONFIG.realtime.endpoint,
        onRows: (rows, pageNo) => {
        let matchedRows = 0;
        for (const row of rows) {
          const id = rowId(row);
          if (!facilityById.has(id)) continue;
          matchedRows += 1;
          realtimeById.set(id, row);
          realtimePageById.set(id, pageNo);
          matchedRealtimePages.add(pageNo);
        }
        state.realtimeApiFetch.matchedRows += matchedRows;
        refreshMarkerRows();
      },
      });
    }

    const gangneungRealtimeFetch = await fetchGangneungAll(serviceKey, API_CONFIG.gangneungRealtime.endpoint);
    state.sourceApiFetches.gangneungRealtime = gangneungRealtimeFetch;
    gangneungRealtimeById.clear();
    for (const row of gangneungRealtimeFetch.rows) {
      const id = gangneungId(row);
      if (id) gangneungRealtimeById.set(id, row);
    }
    state.gangneungRealtimeCount = gangneungRealtimeById.size;
    refreshMarkerRows();

    state.status = state.phases.realtime.failedPages.length ? "complete_with_errors" : "complete";
    state.phase = "complete";
    state.lastRealtimeRefreshedAt = new Date().toISOString();
    const nextSnapshotById = snapshotRealtimeRows(realtimeById);
    const nextGangneungSnapshotById = snapshotGangneungRealtimeRows(gangneungRealtimeById);
    const comparison = compareRealtimeSnapshots(
      previousSnapshotById,
      nextSnapshotById,
      previousSnapshotAt,
      state.lastRealtimeRefreshedAt,
    );
    const baselineComparison = compareRealtimeSnapshots(
      parkingStore.initialRealtimeSnapshotById || previousSnapshotById,
      nextSnapshotById,
      parkingStore.initialRealtimeSnapshotAt || previousSnapshotAt,
      state.lastRealtimeRefreshedAt,
    );
    const gangneungComparison = compareRealtimeSnapshots(
      previousGangneungSnapshotById,
      nextGangneungSnapshotById,
      previousGangneungSnapshotAt,
      state.lastRealtimeRefreshedAt,
    );
    const gangneungBaselineComparison = compareRealtimeSnapshots(
      parkingStore.initialGangneungRealtimeSnapshotById || previousGangneungSnapshotById,
      nextGangneungSnapshotById,
      parkingStore.initialGangneungRealtimeSnapshotAt || previousGangneungSnapshotAt,
      state.lastRealtimeRefreshedAt,
    );
    state.realtimeChangeById = comparison.byId;
    state.realtimeComparison = comparison.summary;
    state.realtimeBaselineComparison = baselineComparison.summary;
    state.gangneungRealtimeChangeById = gangneungComparison.byId;
    state.gangneungRealtimeComparison = gangneungComparison.summary;
    state.gangneungRealtimeBaselineComparison = gangneungBaselineComparison.summary;
    parkingStore.realtimeSnapshotById = nextSnapshotById;
    parkingStore.realtimeSnapshotAt = state.lastRealtimeRefreshedAt;
    parkingStore.gangneungRealtimeSnapshotById = nextGangneungSnapshotById;
    parkingStore.gangneungRealtimeSnapshotAt = state.lastRealtimeRefreshedAt;
    refreshMarkerRows();
    state.nextRealtimeRefreshAt = new Date(Date.now() + REALTIME_REFRESH_INTERVAL_MS).toISOString();
    state.completedAt = new Date().toISOString();
    parkingCache = publicState(state);
    appendRealtimeChangeLog({
      loggedAt: new Date().toISOString(),
      endpoint: API_CONFIG.realtime.endpoint,
      fetch: state.realtimeApiFetch,
      previousComparison: comparison.summary,
      firstApiComparison: baselineComparison.summary,
      gangneungPreviousComparison: gangneungComparison.summary,
      gangneungFirstApiComparison: gangneungBaselineComparison.summary,
    });
  })().catch((error) => {
    state.status = "failed";
    state.error = error.message;
    state.completedAt = new Date().toISOString();
  });

  realtimeRefreshJob = { state, promise };
  promise.finally(() => {
    realtimeRefreshJob = null;
    if (parkingStore && parkingStore.state.status !== "failed") scheduleRealtimeAutoRefresh();
  });

  return realtimeRefreshJob;
}

async function refreshRealtimePages({ serviceKey, state, pages, onRows }) {
  const phaseInfo = state.phases.realtime;
  phaseInfo.status = "running";
  phaseInfo.totalCount = pages.length;
  phaseInfo.requestedPages = pages.length;
  phaseInfo.fetchedPages = 0;
  phaseInfo.failedPages = [];
  state.phase = "realtime";
  state.realtimeApiFetch = {
    endpoint: API_CONFIG.realtime.endpoint,
    fetchedRows: 0,
    matchedRows: 0,
    fetchedPages: 0,
    requestedPages: pages.length,
    totalCount: 0,
    fetchedAt: null,
  };

  for (const pageNo of pages) {
    try {
      const payload = await fetchParkingPage(
        serviceKey,
        API_CONFIG.realtime.endpoint,
        pageNo,
        API_PAGE_SIZE,
      );
      const rows = Array.isArray(payload[API_CONFIG.realtime.endpoint])
        ? payload[API_CONFIG.realtime.endpoint]
        : [];
      state.realtimeApiFetch.fetchedRows += rows.length;
      state.realtimeApiFetch.fetchedPages += 1;
      state.realtimeApiFetch.totalCount = Number(payload.totalCount || 0);
      state.realtimeApiFetch.fetchedAt = new Date().toISOString();
      onRows(rows, pageNo);
    } catch {
      phaseInfo.failedPages.push(pageNo);
    } finally {
      phaseInfo.fetchedPages += 1;
    }
  }

  phaseInfo.status = phaseInfo.failedPages.length ? "complete_with_errors" : "complete";
}

async function proxyParkingGangwonRealtime(reqUrl, res) {
  const serviceKey = reqUrl.searchParams.get("serviceKey") || process.env.DATA_GO_KR_SERVICE_KEY || "";
  const refresh = reqUrl.searchParams.get("refresh") === "1";
  if (!serviceKey) {
    sendJson(res, 400, { message: "serviceKey is required." });
    return;
  }

  if (refresh) parkingCache = null;

  if (realtimeRefreshJob && !refresh) {
    const isDone =
      realtimeRefreshJob.state.status === "complete" ||
      realtimeRefreshJob.state.status === "complete_with_errors";
    const status = realtimeRefreshJob.state.status === "failed" ? 502 : isDone ? 200 : 202;
    sendJson(res, status, publicState(realtimeRefreshJob.state));
    return;
  }

  if (parkingCache && !refresh) {
    sendJson(res, 200, parkingCache);
    return;
  }

  if (!parkingJob) {
    startParkingJob(serviceKey);
  }

  const isDone = parkingJob.state.status === "complete" || parkingJob.state.status === "complete_with_errors";
  const status = parkingJob.state.status === "failed" ? 502 : isDone ? 200 : 202;
  sendJson(res, status, publicState(parkingJob.state));
}

async function proxyParkingRealtimeRefresh(reqUrl, res) {
  const serviceKey =
    reqUrl.searchParams.get("serviceKey") ||
    parkingStore?.serviceKey ||
    process.env.DATA_GO_KR_SERVICE_KEY ||
    "";
  if (!serviceKey) {
    sendJson(res, 400, { message: "serviceKey is required." });
    return;
  }
  if (!parkingStore) {
    sendJson(res, 409, { message: "Parking data must be loaded before realtime refresh." });
    return;
  }
  if (parkingJob || parkingStore.state.status === "running") {
    sendJson(res, 409, { message: "Parking data is still loading. Realtime refresh starts after initial load." });
    return;
  }

  const job = startRealtimeRefreshJob(serviceKey);
  const isDone = job.state.status === "complete" || job.state.status === "complete_with_errors";
  const status = job.state.status === "failed" ? 502 : isDone ? 200 : 202;
  sendJson(res, status, publicState(job.state));
}

function proxyClientConfig(res) {
  sendJson(res, 200, {
    kakaoJavascriptKey: process.env.KAKAO_JAVASCRIPT_KEY || "",
    hasDataServiceKey: Boolean(process.env.DATA_GO_KR_SERVICE_KEY),
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
    reqUrl.pathname === "/api/parking/all"
  ) {
    proxyParkingGangwonRealtime(reqUrl, res);
    return;
  }

  if (reqUrl.pathname === "/api/parking/realtime-refresh") {
    proxyParkingRealtimeRefresh(reqUrl, res);
    return;
  }

  serveFile(reqUrl, res);
}

if (require.main === module) {
  const server = http.createServer(requestHandler);
  server.listen(PORT, "127.0.0.1", () => {
    console.log(`Kakao parking app: http://localhost:${PORT}/`);
  });
}

module.exports = requestHandler;
