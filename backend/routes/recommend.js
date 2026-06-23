const express = require("express");
const router = express.Router();
const { getDb } = require("../db");
const { rankParkingLots } = require("../services/parkingScore");
const { generateRecommendationReason } = require("../services/gemini");
const { searchKakaoPlace, searchKakaoParkingNearby } = require("../services/publicApi");

// POST /api/recommend
// 목적지 입력 → ParkingScore 계산 → 상위 3개 추천 (LLM 이유 포함)
// Body: { destination: "안목해변", lat?: number, lng?: number, radius?: number }
router.post("/", async (req, res) => {
  const { destination, lat, lng, radius = 1500 } = req.body;

  if (!destination && (!lat || !lng)) {
    return res.status(400).json({ error: "destination 또는 lat/lng 필요" });
  }

  try {
    let destLat = parseFloat(lat);
    let destLng = parseFloat(lng);
    let destinationName = destination || "목적지";

    // 1. 목적지 좌표 탐색 (좌표 없으면 Kakao Local API로 검색)
    if (!Number.isFinite(destLat) || !Number.isFinite(destLng)) {
      const kakaoKey = process.env.KAKAO_REST_API_KEY;
      if (!kakaoKey) {
        return res.status(400).json({ error: "KAKAO_REST_API_KEY not set — lat/lng 직접 입력 필요" });
      }
      const kakaoResult = await searchKakaoPlace(kakaoKey, `강원 ${destination}`);
      const place = kakaoResult?.documents?.[0];
      if (!place) {
        return res.status(404).json({ error: `"${destination}" 검색 결과 없음` });
      }
      destLat = parseFloat(place.y);
      destLng = parseFloat(place.x);
      destinationName = place.place_name || destination;
    }

    // 2. DB에서 근처 주차장 후보 조회
    const db = getDb();
    const latDelta = radius / 111000;
    const lngDelta = radius / (111000 * Math.cos((destLat * Math.PI) / 180));
    const dbLots = db
      .prepare(
        `SELECT f.management_no, f.name, f.address, f.lat, f.lng,
                f.total_spots, f.source, f.charge_info,
                r.available_spots, r.updated_at
         FROM parking_facilities f
         LEFT JOIN parking_realtime r ON f.management_no = r.management_no
         WHERE f.lat BETWEEN ? AND ? AND f.lng BETWEEN ? AND ?`
      )
      .all(destLat - latDelta, destLat + latDelta, destLng - lngDelta, destLng + lngDelta);

    // 3. Arduino 주차장도 포함
    const arduinoLots = db
      .prepare(
        `SELECT al.lot_id AS management_no, al.name, al.address, al.lat, al.lng,
                al.total_slots AS total_spots, 'arduino' AS source,
                COUNT(CASE WHEN s.is_occupied = 0 THEN 1 END) AS available_spots,
                MAX(s.updated_at) AS updated_at
         FROM arduino_parking_lots al
         LEFT JOIN arduino_slots s ON al.lot_id = s.lot_id
         WHERE al.lat BETWEEN ? AND ? AND al.lng BETWEEN ? AND ?
         GROUP BY al.lot_id`
      )
      .all(destLat - latDelta, destLat + latDelta, destLng - lngDelta, destLng + lngDelta);

    let allLots = [...dbLots, ...arduinoLots];

    // 4. DB 데이터 부족하면 Kakao Local API로 보완
    if (allLots.length < 3 && process.env.KAKAO_REST_API_KEY) {
      try {
        const kakaoParking = await searchKakaoParkingNearby(
          process.env.KAKAO_REST_API_KEY,
          destLng,
          destLat,
          radius
        );
        const kakaoLots = (kakaoParking?.documents || []).map((doc) => ({
          management_no: `kakao_${doc.id}`,
          name: doc.place_name,
          address: doc.address_name,
          lat: parseFloat(doc.y),
          lng: parseFloat(doc.x),
          total_spots: null,
          available_spots: null,
          source: "kakao",
        }));
        const existingAddresses = new Set(allLots.map((l) => l.address));
        allLots = [...allLots, ...kakaoLots.filter((l) => !existingAddresses.has(l.address))];
      } catch (err) {
        console.warn("Kakao parking search fallback failed:", err.message);
      }
    }

    if (allLots.length === 0) {
      return res.status(404).json({
        error: "주변 주차장 정보 없음",
        suggestion: "반경을 늘리거나 DB sync가 필요합니다",
      });
    }

    // 5. ParkingScore 계산 및 순위 정렬
    const ranked = rankParkingLots(allLots, destLat, destLng);
    const topLots = ranked.slice(0, 3);

    // 6. 1위 주차장에 LLM 추천 이유 생성
    let llmReason = null;
    if (topLots.length > 0) {
      const top = topLots[0];
      llmReason = await generateRecommendationReason({
        destinationName,
        parkingName: top.name,
        availableSpots: top.available_spots,
        walkMin: top.walkMin,
        score: top.score,
        congestionLabel: top.congestionLabel,
      });
    }

    // 7. 점수 이력 저장
    const insertLog = db.prepare(`
      INSERT INTO parking_score_log (destination_lat, destination_lng, destination_name, management_no, score, score_breakdown, rank)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    db.transaction((lots) => {
      for (const lot of lots) {
        insertLog.run(
          destLat, destLng, destinationName,
          lot.management_no, lot.score,
          JSON.stringify({ availScore: lot.availScore, distScore: lot.distScore }), lot.rank
        );
      }
    })(topLots);

    res.json({
      destination: { name: destinationName, lat: destLat, lng: destLng },
      llmReason,
      totalCandidates: allLots.length,
      recommendations: topLots.map((lot) => ({
        rank: lot.rank,
        managementNo: lot.management_no,
        name: lot.name,
        address: lot.address,
        lat: lot.lat,
        lng: lot.lng,
        availableSpots: lot.available_spots,
        totalSpots: lot.total_spots,
        congestion: lot.congestionLabel,
        distanceM: lot.distanceM,
        walkMin: lot.walkMin,
        parkingScore: lot.score,
        scoreBreakdown: { availScore: lot.availScore, distScore: lot.distScore },
        source: lot.source,
        updatedAt: lot.updated_at,
      })),
    });
  } catch (err) {
    console.error("Recommend error:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
