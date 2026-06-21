const express = require("express");
const router = express.Router();
const { getDb } = require("../db");
const { fetchGangneungParking } = require("../services/publicApi");

function extractItems(payload) {
  const item = payload?.body?.items?.item;
  if (Array.isArray(item)) return item;
  if (item && typeof item === "object") return [item];
  return [];
}

router.get("/lots", (req, res) => {
  const db = getDb();
  const { lat, lng, radius = 2000 } = req.query;

  let rows;
  if (lat && lng) {
    const latDelta = radius / 111000;
    const lngDelta = radius / (111000 * Math.cos((parseFloat(lat) * Math.PI) / 180));
    rows = db
      .prepare(
        `SELECT * FROM parking_facilities
         WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?`,
      )
      .all(
        parseFloat(lat) - latDelta,
        parseFloat(lat) + latDelta,
        parseFloat(lng) - lngDelta,
        parseFloat(lng) + lngDelta,
      );
  } else {
    rows = db.prepare("SELECT * FROM parking_facilities LIMIT 200").all();
  }

  res.json({ count: rows.length, data: rows });
});

router.get("/realtime", (req, res) => {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT f.management_no, f.name, f.address, f.lat, f.lng, f.total_spots, f.source,
              r.available_spots, r.congestion, r.updated_at
       FROM parking_facilities f
       LEFT JOIN parking_realtime r ON f.management_no = r.management_no
       ORDER BY r.updated_at DESC`,
    )
    .all();

  res.json({ count: rows.length, data: rows });
});

router.post("/sync", async (_req, res) => {
  const serviceKey = process.env.DATA_GO_KR_SERVICE_KEY;
  if (!serviceKey) {
    return res.status(400).json({ error: "DATA_GO_KR_SERVICE_KEY not set" });
  }

  try {
    const [infoData, realtimeData] = await Promise.all([
      fetchGangneungParking(serviceKey, "getParkInfo", 1),
      fetchGangneungParking(serviceKey, "getParkRltm", 1),
    ]);

    const infoRows = extractItems(infoData);
    const realtimeRows = extractItems(realtimeData);
    const realtimeMap = new Map(realtimeRows.map((row) => [String(row.prkId || "").trim(), row]));
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
        source = excluded.source,
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

    const insertRows = db.transaction((rows) => {
      for (const row of rows) {
        const id = String(row.prkId || "").trim();
        if (!id) continue;
        const realtime = realtimeMap.get(id);
        const available = parseInt(realtime?.availLots, 10);
        const total = parseInt(realtime?.totalLots, 10);
        let congestion = "normal";
        if (Number.isFinite(available) && Number.isFinite(total) && total > 0) {
          const ratio = available / total;
          if (ratio >= 0.5) congestion = "smooth";
          else if (ratio >= 0.1) congestion = "normal";
          else if (ratio > 0) congestion = "congested";
          else congestion = "full";
        }

        upsertFacility({
          management_no: id,
          name: row.prkName || realtime?.prkName || id,
          address: row.prkAddr || "",
          lat: parseFloat(row.yCrdn) || null,
          lng: parseFloat(row.xCrdn) || null,
          total_spots: Number.isFinite(total) ? total : null,
          source: "gangneung",
        });

        if (realtime) {
          upsertRealtime({
            management_no: id,
            available_spots: Number.isFinite(available) ? available : null,
            total_spots: Number.isFinite(total) ? total : null,
            congestion,
          });
        }
      }
    });

    insertRows(infoRows);

    res.json({
      message: "Sync complete",
      source: "gangneung",
      facilityCount: infoRows.length,
      realtimeCount: infoRows.filter((row) => realtimeMap.has(String(row.prkId || "").trim())).length,
    });
  } catch (err) {
    console.error("Sync error:", err);
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
