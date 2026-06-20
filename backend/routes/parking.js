const express = require("express");
const router = express.Router();
const { getDb } = require("../db");
const { fetchParkingFacility, fetchParkingRealtime } = require("../services/publicApi");

// GET /api/parking/lots
// DB에 캐싱된 주차장 시설 목록 반환
router.get("/lots", (req, res) => {
  const db = getDb();
  const { lat, lng, radius = 2000 } = req.query;

  let rows;
  if (lat && lng) {
    // 좌표 기반 근거리 필터 (Haversine approximation — 1도 ≈ 111km)
    const latDelta = radius / 111000;
    const lngDelta = radius / (111000 * Math.cos((parseFloat(lat) * Math.PI) / 180));
    rows = db
      .prepare(
        `SELECT * FROM parking_facilities
         WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?`
      )
      .all(
        parseFloat(lat) - latDelta,
        parseFloat(lat) + latDelta,
        parseFloat(lng) - lngDelta,
        parseFloat(lng) + lngDelta
      );
  } else {
    rows = db.prepare("SELECT * FROM parking_facilities LIMIT 200").all();
  }

  res.json({ count: rows.length, data: rows });
});

// GET /api/parking/realtime
// DB에 캐싱된 실시간 주차 현황 반환
router.get("/realtime", (req, res) => {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT f.management_no, f.name, f.address, f.lat, f.lng, f.total_spots, f.source,
              r.available_spots, r.congestion, r.updated_at
       FROM parking_facilities f
       LEFT JOIN parking_realtime r ON f.management_no = r.management_no
       ORDER BY r.updated_at DESC`
    )
    .all();

  res.json({ count: rows.length, data: rows });
});

// POST /api/parking/sync
// 공공API에서 최신 데이터를 가져와 DB에 저장 (관리자/서버 초기화용)
router.post("/sync", async (req, res) => {
  const serviceKey = process.env.DATA_GO_KR_SERVICE_KEY;
  if (!serviceKey) {
    return res.status(400).json({ error: "DATA_GO_KR_SERVICE_KEY not set" });
  }

  try {
    const [facilityData, realtimeData] = await Promise.all([
      fetchParkingFacility(serviceKey, 1, 1000),
      fetchParkingRealtime(serviceKey, 1, 1000),
    ]);

    const db = getDb();
    const upsertFacility = db.prepare(`
      INSERT INTO parking_facilities (management_no, name, address, lat, lng, total_spots, source, fetched_at)
      VALUES (@management_no, @name, @address, @lat, @lng, @total_spots, @source, datetime('now'))
      ON CONFLICT(management_no) DO UPDATE SET
        name = excluded.name,
        address = excluded.address,
        lat = excluded.lat,
        lng = excluded.lng,
        total_spots = excluded.total_spots,
        fetched_at = excluded.fetched_at
    `);
    const upsertRealtime = db.prepare(`
      INSERT INTO parking_realtime (management_no, available_spots, total_spots, congestion, updated_at)
      VALUES (@management_no, @available_spots, @total_spots, @congestion, datetime('now'))
      ON CONFLICT(management_no) DO UPDATE SET
        available_spots = excluded.available_spots,
        total_spots = excluded.total_spots,
        congestion = excluded.congestion,
        updated_at = excluded.updated_at
    `);

    const facilityRows = facilityData.PrkSttusInfo || [];
    const realtimeRows = realtimeData.PrkRealtimeInfo || [];
    const gangwonFacilities = facilityRows.filter((r) =>
      String(r.prk_plce_adres_sido || "").includes("강원")
    );

    const insertFacilities = db.transaction((rows) => {
      for (const row of rows) {
        const id = String(row.prk_center_id || "").trim();
        if (!id) continue;
        upsertFacility({
          management_no: id,
          name: row.prk_plce_nm || id,
          address: `${row.prk_plce_adres_sido || ""} ${row.prk_plce_adres_sigungu || ""} ${row.prk_plce_adres || ""}`.trim(),
          lat: parseFloat(row.prk_plce_entrc_la) || null,
          lng: parseFloat(row.prk_plce_entrc_lo) || null,
          total_spots: parseInt(row.prk_cmprt_co, 10) || null,
          source: "tsafety",
        });
      }
    });

    const realtimeMap = new Map(
      realtimeRows.map((r) => [String(r.prk_center_id || "").trim(), r])
    );

    const insertRealtime = db.transaction((facilityIds) => {
      for (const id of facilityIds) {
        const r = realtimeMap.get(id);
        if (!r) continue;
        const available = parseInt(r.pkfc_Available_ParkingLots_total, 10);
        const total = parseInt(r.pkfc_ParkingLots_total, 10);
        let congestion = "normal";
        if (Number.isFinite(available) && Number.isFinite(total) && total > 0) {
          const ratio = available / total;
          if (ratio >= 0.5) congestion = "smooth";
          else if (ratio >= 0.1) congestion = "normal";
          else if (ratio > 0) congestion = "congested";
          else congestion = "full";
        }
        upsertRealtime({
          management_no: id,
          available_spots: Number.isFinite(available) ? available : null,
          total_spots: Number.isFinite(total) ? total : null,
          congestion,
        });
      }
    });

    insertFacilities(gangwonFacilities);
    const insertedIds = gangwonFacilities
      .map((r) => String(r.prk_center_id || "").trim())
      .filter(Boolean);
    insertRealtime(insertedIds);

    res.json({
      message: "Sync complete",
      facilityCount: gangwonFacilities.length,
      realtimeCount: insertedIds.filter((id) => realtimeMap.has(id)).length,
    });
  } catch (err) {
    console.error("Sync error:", err);
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
