const express = require("express");
const router = express.Router();
const { getDb } = require("../db");

// SSE 클라이언트 목록
const sseClients = new Set();

// 4×3 그리드 기준: slot_no 1→A1, 5→B1, 9→C1 등으로 변환
const GRID_COLS = 4;
const ROW_LETTERS = "ABCDEFGHIJ";
function slotNoToLabel(slotNo, cols = GRID_COLS) {
  return `${ROW_LETTERS[Math.floor((slotNo - 1) / cols)]}${((slotNo - 1) % cols) + 1}`;
}

function broadcast(data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    try { res.write(msg); } catch {}
  }
}

// 아두이노 spotId → 실제 주차장 lot_id 매핑
const ARDUINO_SPOT_MAP = {
  "SPOT_01": "KNU_PARKING_BAENGNOKAN_A1",
};

// "TEST_ZONE_A1" → { lot_id: "TEST_ZONE", slotLabel: "A1", slot_no: 1 }
function parseParsingId(parking_id) {
  const match = String(parking_id).match(/^(.+)_([A-Z])(\d+)$/);
  if (match) {
    return { lot_id: match[1], slotLabel: match[2] + match[3], slot_no: parseInt(match[3]) };
  }
  return { lot_id: parking_id, slotLabel: "A1", slot_no: 1 };
}

// POST /api/parking/status  ← Arduino에서 직접 호출
// Arduino 형식(spotId, status) 또는 백엔드 형식(parking_id, is_occupied) 모두 허용
router.post("/status", (req, res) => {
  const body = req.body;
  const parking_id = body.parking_id || body.spotId;
  const is_occupied = body.is_occupied != null
    ? body.is_occupied
    : (body.status === "OCCUPIED" ? true : body.status === "EMPTY" ? false : null);
  const distance_cm = body.distance_cm ?? null;

  if (!parking_id || is_occupied == null) {
    return res.status(400).json({ error: "parking_id, is_occupied 필수" });
  }

  const mappedId = ARDUINO_SPOT_MAP[parking_id] || parking_id;
  const { lot_id, slotLabel, slot_no } = parseParsingId(mappedId);
  const db = getDb();

  // 주차장 없으면 자동 생성 (기본 좌표: 강릉 경포 해변 근처)
  const existing = db.prepare("SELECT lot_id FROM arduino_parking_lots WHERE lot_id = ?").get(lot_id);
  if (!existing) {
    db.prepare(
      `INSERT INTO arduino_parking_lots (lot_id, name, address, lat, lng, total_slots)
       VALUES (?, ?, ?, ?, ?, 0)`
    ).run(lot_id, `${lot_id} 주차장`, "강원특별자치도 강릉시 경포로", 37.8018, 128.9014);
  }

  // 슬롯 상태 저장
  db.prepare(
    `INSERT INTO arduino_slots (lot_id, slot_no, is_occupied, sensor_value, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(lot_id, slot_no) DO UPDATE SET
       is_occupied = excluded.is_occupied,
       sensor_value = excluded.sensor_value,
       updated_at = excluded.updated_at`
  ).run(lot_id, slot_no, is_occupied ? 1 : 0, distance_cm ?? null);

  // total_slots 동기화 (슬롯이 추가될 때마다 최신화)
  const { max } = db.prepare("SELECT MAX(slot_no) as max FROM arduino_slots WHERE lot_id = ?").get(lot_id);
  if (max) db.prepare("UPDATE arduino_parking_lots SET total_slots = ? WHERE lot_id = ?").run(max, lot_id);

  // 전체 슬롯 현황 조회
  const slots = db.prepare(
    "SELECT slot_no, is_occupied, sensor_value, updated_at FROM arduino_slots WHERE lot_id = ? ORDER BY slot_no"
  ).all(lot_id);
  const available = slots.filter((s) => !s.is_occupied).length;

  const updatedAt = new Date().toISOString();

  // 실시간 SSE 브로드캐스트
  broadcast({
    type: "update",
    lot_id,
    slot_no,
    slotLabel: slotNoToLabel(slot_no),
    is_occupied: Boolean(is_occupied),
    distance_cm: distance_cm ?? null,
    available,
    total: slots.length,
    updated_at: updatedAt,
  });

  console.log(`[Arduino] ${parking_id} → ${is_occupied ? "🚗 차있음" : "🟢 비어있음"} (${distance_cm}cm) | 잔여 ${available}/${slots.length}`);

  res.json({ ok: true, lot_id, slot_no, slotLabel, is_occupied: Boolean(is_occupied) });
});

// GET /api/parking/status/live  ← 웹 브라우저에서 SSE 연결
router.get("/status/live", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.flushHeaders();

  // 연결 즉시 현재 상태 전송
  const db = getDb();
  const lots = db.prepare("SELECT * FROM arduino_parking_lots").all();
  for (const lot of lots) {
    const slots = db.prepare(
      "SELECT slot_no, is_occupied, sensor_value, updated_at FROM arduino_slots WHERE lot_id = ? ORDER BY slot_no"
    ).all(lot.lot_id);
    res.write(`data: ${JSON.stringify({
      type: "init",
      lot_id: lot.lot_id,
      name: lot.name,
      address: lot.address,
      lat: lot.lat,
      lng: lot.lng,
      slots: slots.map((s) => ({
        slot_no: s.slot_no,
        slotLabel: slotNoToLabel(s.slot_no),
        is_occupied: Boolean(s.is_occupied),
        distance_cm: s.sensor_value,
        updated_at: s.updated_at,
      })),
      available: slots.filter((s) => !s.is_occupied).length,
      total: slots.length,
    })}\n\n`);
  }

  // 데이터 없을 때 빈 상태 전송 (페이지 첫 로드용)
  if (lots.length === 0) {
    res.write(`data: ${JSON.stringify({ type: "empty" })}\n\n`);
  }

  sseClients.add(res);
  req.on("close", () => sseClients.delete(res));
});

module.exports = router;
