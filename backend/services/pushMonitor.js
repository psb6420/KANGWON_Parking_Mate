const crypto = require("node:crypto");
const webPush = require("web-push");
const { getDb } = require("../db");
const { fetchGangneungParking } = require("./publicApi");

const DEFAULT_MONITOR_INTERVAL_MS = 30 * 1000;
const DEFAULT_WATCH_MINUTES = 120;
const MAX_WATCH_LOTS = 10;
const DEFAULT_LOW_SPOTS_THRESHOLD = 3;
const ARDUINO_LOT_IDS = new Set(["KNU_PARKING_6", "KNU_PARKING_BAENGNOKAN"]);

let monitorTimer = null;
let monitorRunning = false;

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function monitorIntervalMs() {
  return Math.max(
    30_000,
    positiveNumber(process.env.PUSH_MONITOR_INTERVAL_MS, DEFAULT_MONITOR_INTERVAL_MS),
  );
}

function lowSpotsThreshold() {
  return Math.max(
    1,
    Math.round(positiveNumber(process.env.PUSH_LOW_SPOTS_THRESHOLD, DEFAULT_LOW_SPOTS_THRESHOLD)),
  );
}

function pushConfig() {
  const publicKey = String(process.env.VAPID_PUBLIC_KEY || "").trim();
  const privateKey = String(process.env.VAPID_PRIVATE_KEY || "").trim();
  const subject = String(process.env.VAPID_SUBJECT || "mailto:parking-mate@example.com").trim();
  return {
    enabled: Boolean(publicKey && privateKey),
    publicKey,
    privateKey,
    subject,
    monitorIntervalMs: monitorIntervalMs(),
    watchDurationMinutes: DEFAULT_WATCH_MINUTES,
  };
}

function configureWebPush() {
  const config = pushConfig();
  if (config.enabled) {
    webPush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
  }
  return config;
}

function integerOrNull(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : null;
}

function normalizeLots(lots) {
  if (!Array.isArray(lots)) return [];
  const seen = new Set();
  const normalized = [];
  for (const lot of lots) {
    const managementNo = String(lot?.managementNo || "").trim();
    if (!managementNo || seen.has(managementNo)) continue;
    seen.add(managementNo);
    const lat = Number(lot?.lat);
    const lng = Number(lot?.lng);
    normalized.push({
      managementNo,
      name: String(lot?.name || managementNo).trim().slice(0, 120),
      available: integerOrNull(lot?.available),
      total: integerOrNull(lot?.total),
      lat: Number.isFinite(lat) ? lat : null,
      lng: Number.isFinite(lng) ? lng : null,
      ranking: Number.isFinite(Number(lot?.ranking)) ? Number(lot.ranking) : 0,
    });
    if (normalized.length >= MAX_WATCH_LOTS) break;
  }
  return normalized;
}

function validateSubscription(subscription) {
  const endpoint = String(subscription?.endpoint || "").trim();
  const p256dh = String(subscription?.keys?.p256dh || "").trim();
  const auth = String(subscription?.keys?.auth || "").trim();
  if (!endpoint || !p256dh || !auth) {
    throw new Error("유효한 Web Push 구독 정보가 필요합니다.");
  }
  return { endpoint, p256dh, auth };
}

async function registerWatch({ subscription, lots, destinationName, durationMinutes }) {
  const config = configureWebPush();
  if (!config.enabled) throw new Error("서버의 Web Push 키가 설정되지 않았습니다.");

  const normalizedSubscription = validateSubscription(subscription);
  const normalizedLots = normalizeLots(lots);
  if (!normalizedLots.length) throw new Error("감시할 추천 주차장이 없습니다.");

  const requestedMinutes = positiveNumber(durationMinutes, DEFAULT_WATCH_MINUTES);
  const watchMinutes = Math.min(240, Math.max(10, Math.round(requestedMinutes)));
  const watchId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + watchMinutes * 60 * 1000).toISOString();
  const db = getDb();

  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(
      `INSERT INTO push_subscriptions (endpoint, p256dh, auth, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(endpoint) DO UPDATE SET
         p256dh = excluded.p256dh,
         auth = excluded.auth,
         updated_at = excluded.updated_at`,
    ).run(
      normalizedSubscription.endpoint,
      normalizedSubscription.p256dh,
      normalizedSubscription.auth,
    );

    const previousWatches = db
      .prepare("SELECT watch_id FROM parking_watch_sessions WHERE endpoint = ?")
      .all(normalizedSubscription.endpoint);
    const deleteLots = db.prepare("DELETE FROM parking_watch_lots WHERE watch_id = ?");
    const deleteWatch = db.prepare("DELETE FROM parking_watch_sessions WHERE watch_id = ?");
    for (const previous of previousWatches) {
      deleteLots.run(previous.watch_id);
      deleteWatch.run(previous.watch_id);
    }

    db.prepare(
      `INSERT INTO parking_watch_sessions
       (watch_id, endpoint, destination_name, expires_at)
       VALUES (?, ?, ?, ?)`,
    ).run(
      watchId,
      normalizedSubscription.endpoint,
      String(destinationName || "").trim().slice(0, 120),
      expiresAt,
    );

    const insertLot = db.prepare(
      `INSERT INTO parking_watch_lots
       (watch_id, management_no, name, last_available, total_spots, lat, lng, ranking)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const lot of normalizedLots) {
      insertLot.run(watchId, lot.managementNo, lot.name, lot.available, lot.total, lot.lat, lot.lng, lot.ranking);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  let confirmationSent = false;
  try {
    await webPush.sendNotification(
      subscription,
      JSON.stringify({
        title: "추천 주차장 알림 시작",
        body: `${normalizedLots.length}곳의 잔여면을 ${watchMinutes}분 동안 확인합니다.`,
        tag: `parking-watch-${watchId}`,
        data: { url: "/?view=map", watchId },
      }),
      { TTL: 120 },
    );
    confirmationSent = true;
  } catch (error) {
    console.warn(`[Push] confirmation failed: ${error.message}`);
  }

  return {
    watchId,
    expiresAt,
    lotCount: normalizedLots.length,
    confirmationSent,
  };
}

function stopWatch(watchId) {
  const id = String(watchId || "").trim();
  if (!id) return false;
  const db = getDb();
  const watch = db
    .prepare("SELECT endpoint FROM parking_watch_sessions WHERE watch_id = ?")
    .get(id);
  const result = db.prepare("DELETE FROM parking_watch_sessions WHERE watch_id = ?").run(id);
  if (watch?.endpoint) {
    db.prepare(
      `DELETE FROM push_subscriptions
       WHERE endpoint = ?
         AND NOT EXISTS (
           SELECT 1 FROM parking_watch_sessions WHERE endpoint = ?
         )`,
    ).run(watch.endpoint, watch.endpoint);
  }
  return result.changes > 0;
}

function cleanupExpiredWatches(db) {
  const deleted = db
    .prepare("DELETE FROM parking_watch_sessions WHERE expires_at <= ?")
    .run(new Date().toISOString()).changes;
  db.exec(
    `DELETE FROM push_subscriptions
     WHERE NOT EXISTS (
       SELECT 1 FROM parking_watch_sessions
       WHERE parking_watch_sessions.endpoint = push_subscriptions.endpoint
     )`,
  );
  return deleted;
}

function extractItems(payload) {
  const item = payload?.body?.items?.item;
  if (Array.isArray(item)) return item;
  return item && typeof item === "object" ? [item] : [];
}

function arduinoStateForLot(db, lotId) {
  const slots = db
    .prepare("SELECT is_occupied FROM arduino_slots WHERE lot_id = ?")
    .all(lotId);
  if (!slots.length) return null;
  return {
    available: slots.filter((slot) => !slot.is_occupied).length,
    total: slots.length,
  };
}

async function fetchCurrentStates(managementNos, db) {
  const states = new Map();
  const needsGangneung = managementNos.some((id) => !ARDUINO_LOT_IDS.has(id));

  if (needsGangneung) {
    const serviceKey = String(process.env.DATA_GO_KR_SERVICE_KEY || "").trim();
    if (!serviceKey) throw new Error("DATA_GO_KR_SERVICE_KEY가 설정되지 않았습니다.");
    const payload = await fetchGangneungParking(serviceKey, "getParkRltm", 1);
    for (const row of extractItems(payload)) {
      const id = String(row.prkId || "").trim();
      if (!id) continue;
      states.set(id, {
        available: integerOrNull(row.availLots),
        total: integerOrNull(row.totalLots),
      });
    }
  }

  for (const lotId of managementNos) {
    if (!ARDUINO_LOT_IDS.has(lotId)) continue;
    const state = arduinoStateForLot(db, lotId);
    if (state) states.set(lotId, state);
  }
  return states;
}

// 잔여면에 변동이 있으면(±1 미세 변동 포함) 알림, 변동이 전혀 없으면 보내지 않음.
// 반환 타입은 메시지 표현용 분류일 뿐 전송 여부와는 무관(null = 변동 없음).
// - full    : 만차 진입 (previous>0 → 0)
// - opened  : 빈자리 발생 (0 → current>0)
// - low     : 잔여면이 임계값 이하 (곧 만차)
// - changed : 그 외 일반 변동(미세 변동 포함)
function classifyChange(previous, current, low) {
  if (previous === null || current === previous) return null; // 변동 없음 → 전송 안 함
  if (current === 0 && previous > 0) return "full";
  if (previous === 0 && current > 0) return "opened";
  if (current <= low) return "low";
  return "changed";
}

function describeChange(change) {
  switch (change.type) {
    case "full":
      return `${change.name} 만차 (${change.previous}→0)`;
    case "opened":
      return `${change.name} 빈자리 ${change.current}면 발생`;
    case "low":
      return `${change.name} 잔여 ${change.current}면 (곧 만차)`;
    default:
      return `${change.name} ${change.previous}→${change.current}면`;
  }
}

// 포그라운드(앱이 켜진 상태)에서 인앱 상태바를 그릴 수 있도록 감시 중인 모든 주차장의 현재 현황을 동봉
function buildLotsSnapshot(watch, states) {
  return watch.lots.map((lot) => {
    const state = states.get(lot.management_no);
    return {
      managementNo: lot.management_no,
      name: lot.name,
      available: state?.available ?? integerOrNull(lot.last_available),
      total: state?.total ?? integerOrNull(lot.total_spots),
    };
  });
}

function reroutePayload(watch, fullLotName, nextLot, snapshot, changes) {
  return {
    title: `${fullLotName} 만차`,
    body: `${nextLot.name}으로 경로를 변경할까요? 알림을 눌러 응답하세요.`,
    tag: `parking-watch-${watch.watch_id}`,
    data: {
      url: "/?view=map",
      watchId: watch.watch_id,
      action: "reroute",
      fullLotName,
      nextLot: { managementNo: nextLot.management_no, name: nextLot.name, lat: nextLot.lat, lng: nextLot.lng },
      lots: snapshot,
      changes,
    },
  };
}

function notificationPayload(watch, changes, snapshot) {
  const data = { url: "/?view=map", watchId: watch.watch_id, lots: snapshot, changes };
  if (changes.length === 1) {
    const change = changes[0];
    let title;
    if (change.type === "full") title = `${change.name} 만차`;
    else if (change.type === "opened") title = `${change.name} 빈자리 발생`;
    else title = `${change.name} 잔여 ${change.current}면`;
    return {
      title,
      body: describeChange(change),
      tag: `parking-watch-${watch.watch_id}`,
      data,
    };
  }
  return {
    title: `추천 주차장 ${changes.length}곳 변경`,
    body: changes.slice(0, 3).map(describeChange).join(" · "),
    tag: `parking-watch-${watch.watch_id}`,
    data,
  };
}

async function runPushMonitor() {
  if (monitorRunning) return { skipped: true };
  monitorRunning = true;
  const db = getDb();
  try {
    cleanupExpiredWatches(db);
    const watchedLots = db
      .prepare(
        `SELECT DISTINCT l.management_no
         FROM parking_watch_lots l
         JOIN parking_watch_sessions w ON w.watch_id = l.watch_id
         WHERE w.expires_at > ?`,
      )
      .all(new Date().toISOString());
    if (!watchedLots.length) return { watched: 0, notified: 0 };

    const managementNos = watchedLots.map((row) => row.management_no);
    const states = await fetchCurrentStates(managementNos, db);
    const watches = db
      .prepare(
        `SELECT w.watch_id, w.endpoint, w.destination_name, w.expires_at,
                s.p256dh, s.auth,
                l.management_no, l.name, l.last_available, l.total_spots,
                l.lat, l.lng, l.ranking
         FROM parking_watch_sessions w
         JOIN push_subscriptions s ON s.endpoint = w.endpoint
         JOIN parking_watch_lots l ON l.watch_id = w.watch_id
         WHERE w.expires_at > ?
         ORDER BY w.watch_id, COALESCE(l.ranking, 99)`,
      )
      .all(new Date().toISOString());

    const grouped = new Map();
    for (const row of watches) {
      if (!grouped.has(row.watch_id)) grouped.set(row.watch_id, { ...row, lots: [] });
      grouped.get(row.watch_id).lots.push(row);
    }

    const low = lowSpotsThreshold();
    const updateState = db.prepare(
      `UPDATE parking_watch_lots
       SET last_available = ?, total_spots = ?
       WHERE watch_id = ? AND management_no = ?`,
    );

    let notified = 0;
    for (const watch of grouped.values()) {
      const changes = [];
      const baselineUpdates = []; // 현재 상태가 있는 모든 lot의 최신값(기준값 갱신용)
      for (const lot of watch.lots) {
        const currentState = states.get(lot.management_no);
        if (!currentState || currentState.available === null) continue;
        baselineUpdates.push({
          managementNo: lot.management_no,
          available: currentState.available,
          total: currentState.total,
        });
        const previous = integerOrNull(lot.last_available);
        const type = classifyChange(previous, currentState.available, low);
        if (type) {
          changes.push({
            managementNo: lot.management_no,
            name: lot.name,
            previous,
            current: currentState.available,
            total: currentState.total,
            type,
          });
        }
      }

      const applyBaselines = () => {
        for (const u of baselineUpdates) {
          updateState.run(u.available, u.total, watch.watch_id, u.managementNo);
        }
      };

      // 현재 만차(잔여 0)인 감시 주차장과 대체 가능한(잔여>0) 주차장 파악.
      // 추천 주차장이 만차이면 잔여면 변동이 없어도 매 주기 경로 변경을 다시 제안한다
      // (사용자가 응답하거나 빈자리가 날 때까지 30초마다 상시 재안내).
      const fullLots = watch.lots
        .filter((l) => states.get(l.management_no)?.available === 0)
        .sort((a, b) => (a.ranking ?? 99) - (b.ranking ?? 99));
      const nextLot = watch.lots
        .filter((l) => l.lat && l.lng && states.get(l.management_no)?.available > 0)
        .sort((a, b) => (a.ranking ?? 99) - (b.ranking ?? 99))[0];
      const shouldReroute = fullLots.length > 0 && Boolean(nextLot);

      // 보낼 이유가 없으면(잔여면 변동 없음 + 만차 재안내 대상 아님) 기준값만 갱신
      if (!changes.length && !shouldReroute) {
        applyBaselines();
        continue;
      }

      const snapshot = buildLotsSnapshot(watch, states);
      // 만차인 추천 주차장이 있으면 다음 이용 가능한 주차장으로 경로 변경을 반복 제안
      const payload = shouldReroute
        ? reroutePayload(watch, fullLots[0].name, nextLot, snapshot, changes)
        : notificationPayload(watch, changes, snapshot);

      const subscription = {
        endpoint: watch.endpoint,
        keys: { p256dh: watch.p256dh, auth: watch.auth },
      };
      try {
        await webPush.sendNotification(
          subscription,
          JSON.stringify(payload),
          { TTL: 120 },
        );
        applyBaselines(); // 전송 성공 시에만 기준값 갱신 → 실패 시 다음 주기에 재시도
        notified += 1;
      } catch (error) {
        if (error.statusCode === 404 || error.statusCode === 410) {
          db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").run(watch.endpoint);
        }
        console.warn(`[Push] delivery failed: ${error.message}`);
      }
    }
    return { watched: grouped.size, notified };
  } finally {
    monitorRunning = false;
  }
}

function startPushMonitor() {
  const config = configureWebPush();
  if (monitorTimer || !config.enabled) {
    if (!config.enabled) console.warn("[Push] VAPID keys are not configured; monitor is disabled.");
    return config;
  }
  monitorTimer = setInterval(() => {
    runPushMonitor().catch((error) => console.error(`[Push] monitor failed: ${error.message}`));
  }, config.monitorIntervalMs);
  monitorTimer.unref();
  setTimeout(() => {
    runPushMonitor().catch((error) => console.error(`[Push] initial monitor failed: ${error.message}`));
  }, 5000).unref();
  console.log(`[Push] monitor interval: ${config.monitorIntervalMs}ms`);
  return config;
}

module.exports = {
  pushConfig,
  registerWatch,
  stopWatch,
  runPushMonitor,
  startPushMonitor,
};
