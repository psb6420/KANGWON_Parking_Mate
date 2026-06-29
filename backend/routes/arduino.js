const express = require("express");
const router = express.Router();
const { getDb } = require("../db");
const { onArduinoLotUpdate } = require("../services/pushMonitor");

// POST /api/arduino/sensor
// Arduino에서 주차면 센서 데이터 수신
// Body: { lot_id: string, slot_no: number, is_occupied: boolean, sensor_value?: number }
router.post("/sensor", (req, res) => {
  const { lot_id, slot_no, is_occupied, sensor_value } = req.body;

  if (!lot_id || slot_no == null || is_occupied == null) {
    return res.status(400).json({ error: "lot_id, slot_no, is_occupied 필수" });
  }

  const db = getDb();

  // 주차장 존재 확인
  const lot = db.prepare("SELECT * FROM arduino_parking_lots WHERE lot_id = ?").get(lot_id);
  if (!lot) {
    return res.status(404).json({ error: `lot_id '${lot_id}' 없음. /api/arduino/lots로 먼저 등록하세요.` });
  }

  db.prepare(
    `INSERT INTO arduino_slots (lot_id, slot_no, is_occupied, sensor_value, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(lot_id, slot_no) DO UPDATE SET
       is_occupied = excluded.is_occupied,
       sensor_value = excluded.sensor_value,
       updated_at = excluded.updated_at`
  ).run(lot_id, slot_no, is_occupied ? 1 : 0, sensor_value ?? null);

  // 잔여면 수가 실제로 바뀌면 이 lot을 감시 중인 watch에 즉시(디바운스 후) 푸시 평가
  onArduinoLotUpdate(lot_id);

  res.json({ ok: true, lot_id, slot_no, is_occupied: Boolean(is_occupied) });
});

// POST /api/arduino/sensor/batch
// Arduino에서 전체 슬롯 일괄 업데이트
// Body: { lot_id: string, slots: [{ slot_no, is_occupied, sensor_value? }] }
router.post("/sensor/batch", (req, res) => {
  const { lot_id, slots } = req.body;

  if (!lot_id || !Array.isArray(slots) || slots.length === 0) {
    return res.status(400).json({ error: "lot_id, slots[] 필수" });
  }

  const db = getDb();
  const lot = db.prepare("SELECT * FROM arduino_parking_lots WHERE lot_id = ?").get(lot_id);
  if (!lot) {
    return res.status(404).json({ error: `lot_id '${lot_id}' 없음` });
  }

  const upsert = db.prepare(
    `INSERT INTO arduino_slots (lot_id, slot_no, is_occupied, sensor_value, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(lot_id, slot_no) DO UPDATE SET
       is_occupied = excluded.is_occupied,
       sensor_value = excluded.sensor_value,
       updated_at = excluded.updated_at`
  );

  const batchInsert = db.transaction((slotList) => {
    for (const s of slotList) {
      if (s.slot_no == null || s.is_occupied == null) continue;
      upsert.run(lot_id, s.slot_no, s.is_occupied ? 1 : 0, s.sensor_value ?? null);
    }
  });

  batchInsert(slots);

  // 배치 반영 후 잔여면 변화 시 한 번만 이벤트 평가
  onArduinoLotUpdate(lot_id);

  res.json({ ok: true, lot_id, updatedCount: slots.length });
});

// GET /api/arduino/slots/:lotId
// 특정 주차장의 슬롯별 상태 조회
router.get("/slots/:lotId", (req, res) => {
  const db = getDb();
  const { lotId } = req.params;

  const lot = db.prepare("SELECT * FROM arduino_parking_lots WHERE lot_id = ?").get(lotId);
  if (!lot) {
    return res.status(404).json({ error: `lot_id '${lotId}' 없음` });
  }

  const slots = db
    .prepare("SELECT slot_no, is_occupied, sensor_value, updated_at FROM arduino_slots WHERE lot_id = ? ORDER BY slot_no")
    .all(lotId);

  const availableCount = slots.filter((s) => !s.is_occupied).length;
  const occupiedCount = slots.filter((s) => s.is_occupied).length;

  res.json({
    lot_id: lotId,
    name: lot.name,
    address: lot.address,
    lat: lot.lat,
    lng: lot.lng,
    totalSlots: lot.total_slots,
    availableCount,
    occupiedCount,
    slots: slots.map((s) => ({
      slotNo: s.slot_no,
      isOccupied: Boolean(s.is_occupied),
      sensorValue: s.sensor_value,
      updatedAt: s.updated_at,
    })),
  });
});

// POST /api/arduino/lots
// Arduino 주차장 등록
// Body: { lot_id, name, address, lat, lng, total_slots }
router.post("/lots", (req, res) => {
  const { lot_id, name, address, lat, lng, total_slots } = req.body;

  if (!lot_id || !name || !total_slots) {
    return res.status(400).json({ error: "lot_id, name, total_slots 필수" });
  }

  const db = getDb();
  db.prepare(
    `INSERT INTO arduino_parking_lots (lot_id, name, address, lat, lng, total_slots)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(lot_id) DO UPDATE SET
       name = excluded.name,
       address = excluded.address,
       lat = excluded.lat,
       lng = excluded.lng,
       total_slots = excluded.total_slots`
  ).run(lot_id, name, address || null, lat || null, lng || null, total_slots);

  res.status(201).json({ ok: true, lot_id, name, total_slots });
});

// GET /api/arduino/lots
// 등록된 Arduino 주차장 목록
router.get("/lots", (req, res) => {
  const db = getDb();
  const lots = db
    .prepare(
      `SELECT al.*,
              COUNT(CASE WHEN s.is_occupied = 0 THEN 1 END) AS available_slots,
              MAX(s.updated_at) AS last_sensor_at
       FROM arduino_parking_lots al
       LEFT JOIN arduino_slots s ON al.lot_id = s.lot_id
       GROUP BY al.lot_id`
    )
    .all();

  res.json({ count: lots.length, data: lots });
});

module.exports = router;
