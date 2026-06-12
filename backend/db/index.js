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
  `);
}

module.exports = { getDb };
