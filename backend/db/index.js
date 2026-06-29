// Node.js v22.5+ 내장 sqlite 모듈 사용 (컴파일 불필요)
const { DatabaseSync } = require("node:sqlite");
const path = require("path");

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "../parking_mate.db");

let db;

function getDb() {
  if (!db) {
    db = new DatabaseSync(DB_PATH);
    initSchema(db);
  }
  return db;
}

function initSchema(db) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    -- 주차장 시설 정보 (공공API 캐시)
    CREATE TABLE IF NOT EXISTS parking_facilities (
      management_no   TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      address         TEXT,
      lat             REAL,
      lng             REAL,
      total_spots     INTEGER,
      source          TEXT,
      operation_info  TEXT,
      charge_info     TEXT,
      fetched_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 주차장 실시간 현황
    CREATE TABLE IF NOT EXISTS parking_realtime (
      management_no   TEXT PRIMARY KEY,
      available_spots INTEGER,
      total_spots     INTEGER,
      congestion      TEXT,
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Arduino 주차장
    CREATE TABLE IF NOT EXISTS arduino_parking_lots (
      lot_id          TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      address         TEXT,
      lat             REAL,
      lng             REAL,
      total_slots     INTEGER NOT NULL DEFAULT 0,
      registered_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Arduino 슬롯 상태
    CREATE TABLE IF NOT EXISTS arduino_slots (
      lot_id          TEXT NOT NULL,
      slot_no         INTEGER NOT NULL,
      is_occupied     INTEGER NOT NULL DEFAULT 0,
      sensor_value    REAL,
      updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (lot_id, slot_no)
    );

    -- 기상청 날씨 캐시
    CREATE TABLE IF NOT EXISTS weather_cache (
      grid_key        TEXT PRIMARY KEY,
      nx              INTEGER NOT NULL,
      ny              INTEGER NOT NULL,
      weather_data    TEXT NOT NULL,
      fetched_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 강원도 관광지 정보 캐시
    CREATE TABLE IF NOT EXISTS destinations (
      content_id      TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      address         TEXT,
      lat             REAL,
      lng             REAL,
      category        TEXT,
      image_url       TEXT,
      fetched_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ParkingScore 계산 이력
    CREATE TABLE IF NOT EXISTS parking_score_log (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      destination_lat REAL NOT NULL,
      destination_lng REAL NOT NULL,
      destination_name TEXT,
      management_no   TEXT NOT NULL,
      score           REAL NOT NULL,
      score_breakdown TEXT NOT NULL,
      rank            INTEGER,
      calculated_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 행사/축제 정보 캐시
    CREATE TABLE IF NOT EXISTS events (
      event_id        TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      address         TEXT,
      lat             REAL,
      lng             REAL,
      start_date      TEXT,
      end_date        TEXT,
      fetched_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Web Push subscriptions. The endpoint is a browser-issued secret URL.
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      endpoint         TEXT PRIMARY KEY,
      p256dh           TEXT NOT NULL,
      auth             TEXT NOT NULL,
      created_at       TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- A navigation watch expires automatically so abandoned trips do not poll forever.
    CREATE TABLE IF NOT EXISTS parking_watch_sessions (
      watch_id         TEXT PRIMARY KEY,
      endpoint         TEXT NOT NULL,
      destination_name TEXT,
      created_at       TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at       TEXT NOT NULL,
      FOREIGN KEY (endpoint) REFERENCES push_subscriptions(endpoint) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS parking_watch_lots (
      watch_id         TEXT NOT NULL,
      management_no    TEXT NOT NULL,
      name             TEXT NOT NULL,
      last_available   INTEGER,
      total_spots      INTEGER,
      PRIMARY KEY (watch_id, management_no),
      FOREIGN KEY (watch_id) REFERENCES parking_watch_sessions(watch_id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_parking_watch_expires
      ON parking_watch_sessions(expires_at);
  `);
  // 기존 DB에 컬럼 추가 (이미 있으면 무시)
  try { db.exec("ALTER TABLE parking_watch_lots ADD COLUMN lat REAL"); } catch {}
  try { db.exec("ALTER TABLE parking_watch_lots ADD COLUMN lng REAL"); } catch {}
  try { db.exec("ALTER TABLE parking_watch_lots ADD COLUMN ranking INTEGER DEFAULT 0"); } catch {}
  try { db.exec("ALTER TABLE parking_watch_lots ADD COLUMN is_navigated INTEGER DEFAULT 0"); } catch {}
  seedDefaultArduinoLots(db);
}

function seedDefaultArduinoLots(db) {
  const upsertLot = db.prepare(
    `INSERT INTO arduino_parking_lots (lot_id, name, address, lat, lng, total_slots)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(lot_id) DO UPDATE SET
       name = excluded.name,
       address = excluded.address,
       lat = excluded.lat,
       lng = excluded.lng,
       total_slots = excluded.total_slots`
  );
  const upsertSlot = db.prepare(
    `INSERT INTO arduino_slots (lot_id, slot_no, is_occupied, sensor_value, updated_at)
     VALUES (?, ?, ?, NULL, datetime('now'))
     ON CONFLICT(lot_id, slot_no) DO UPDATE SET
       is_occupied = excluded.is_occupied`
  );

  const lots = [
    { id: "KNU_PARKING_6", name: "강원대학교 주차장6", address: "강원특별자치도 춘천시 강원대학길 1", lat: 37.8691389, lng: 127.7405348, totalSlots: 12, occupiedSlots: [1,2,3,4,5,6,7,8,9,10,12] },
    { id: "KNU_PARKING_BAENGNOKAN", name: "강원대학교 백록관 주차장", address: "강원특별자치도 춘천시 강원대학길 1", lat: 37.868692486145015, lng: 127.74127352696846, totalSlots: 12, occupiedSlots: [3, 6, 8, 12] },
  ];

  for (const lot of lots) {
    upsertLot.run(lot.id, lot.name, lot.address, lot.lat, lot.lng, lot.totalSlots);
    const occupiedSet = new Set(lot.occupiedSlots || []);
    for (let slotNo = 1; slotNo <= lot.totalSlots; slotNo += 1) {
      upsertSlot.run(lot.id, slotNo, occupiedSet.has(slotNo) ? 1 : 0);
    }
  }
}

module.exports = { getDb };
