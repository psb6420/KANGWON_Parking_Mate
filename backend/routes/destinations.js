const express = require("express");
const router = express.Router();
const { getDb } = require("../db");
const { fetchGangwonTourism, fetchGangwonEvents, searchKakaoPlace } = require("../services/publicApi");

// GET /api/destinations/search?q=안목해변
// 강원도 관광지 검색 (DB 캐시 → Kakao API → 한국관광공사 순)
router.get("/search", async (req, res) => {
  const { q } = req.query;
  if (!q || q.trim().length < 1) {
    return res.status(400).json({ error: "q 파라미터 필요" });
  }

  const db = getDb();
  const keyword = q.trim();

  // DB 캐시 먼저 검색
  const cached = db
    .prepare(
      `SELECT * FROM destinations
       WHERE name LIKE ? OR address LIKE ?
       ORDER BY name LIMIT 10`
    )
    .all(`%${keyword}%`, `%${keyword}%`);

  if (cached.length > 0) {
    return res.json({ source: "cache", count: cached.length, data: cached });
  }

  // Kakao Local API 검색
  const kakaoKey = process.env.KAKAO_REST_API_KEY;
  if (kakaoKey) {
    try {
      const kakaoResult = await searchKakaoPlace(kakaoKey, `강원 ${keyword}`);
      const places = (kakaoResult?.documents || []).map((doc) => ({
        content_id: `kakao_${doc.id}`,
        name: doc.place_name,
        address: doc.address_name,
        lat: parseFloat(doc.y),
        lng: parseFloat(doc.x),
        category: doc.category_name,
        image_url: null,
      }));
      return res.json({ source: "kakao", count: places.length, data: places });
    } catch (err) {
      console.warn("Kakao search failed:", err.message);
    }
  }

  // 한국관광공사 API fallback
  const serviceKey = process.env.DATA_GO_KR_SERVICE_KEY;
  if (serviceKey) {
    try {
      const tourData = await fetchGangwonTourism(serviceKey, keyword);
      const items = tourData?.response?.body?.items?.item || [];
      const places = (Array.isArray(items) ? items : [items]).map((item) => ({
        content_id: String(item.contentid || ""),
        name: item.title || "",
        address: `${item.addr1 || ""} ${item.addr2 || ""}`.trim(),
        lat: parseFloat(item.mapy) || null,
        lng: parseFloat(item.mapx) || null,
        category: item.cat1 || null,
        image_url: item.firstimage || null,
      }));

      // DB 캐시 저장
      const upsert = db.prepare(`
        INSERT INTO destinations (content_id, name, address, lat, lng, category, image_url)
        VALUES (@content_id, @name, @address, @lat, @lng, @category, @image_url)
        ON CONFLICT(content_id) DO UPDATE SET
          name = excluded.name, address = excluded.address,
          lat = excluded.lat, lng = excluded.lng
      `);
      const insertAll = db.transaction((rows) => rows.forEach((r) => upsert.run(r)));
      insertAll(places.filter((p) => p.content_id));

      return res.json({ source: "tourism_api", count: places.length, data: places });
    } catch (err) {
      console.error("Tourism API error:", err.message);
    }
  }

  res.status(404).json({ error: "검색 결과 없음 (API 키 미설정 또는 검색 결과 없음)" });
});

// GET /api/destinations/popular
// 추천 인기 관광지 목록 (기획서: 현재 붐비지 않는 숨은 명소 퀵 버튼)
router.get("/popular", (req, res) => {
  const POPULAR = [
    { name: "안목해변", address: "강원특별자치도 강릉시 견소동", lat: 37.7803, lng: 128.9446, category: "해수욕장" },
    { name: "레고랜드", address: "강원특별자치도 춘천시 중도로 128", lat: 37.8780, lng: 127.7258, category: "테마파크" },
    { name: "속초해수욕장", address: "강원특별자치도 속초시 조양동", lat: 38.2087, lng: 128.5855, category: "해수욕장" },
    { name: "설악산 국립공원", address: "강원특별자치도 속초시 설악산로 1091", lat: 38.1196, lng: 128.4658, category: "자연공원" },
    { name: "강릉 경포대", address: "강원특별자치도 강릉시 경포로 365", lat: 37.8026, lng: 128.9007, category: "명승지" },
    { name: "양양 낙산사", address: "강원특별자치도 양양군 강현면 낙산사로 100", lat: 38.1222, lng: 128.6356, category: "문화재" },
    { name: "평창 대관령", address: "강원특별자치도 평창군 대관령면", lat: 37.6885, lng: 128.7483, category: "자연경관" },
    { name: "춘천 남이섬", address: "강원특별자치도 춘천시 남산면 남이섬길 1", lat: 37.7910, lng: 127.5260, category: "섬/관광지" },
  ];

  const db = getDb();
  // DB에서 추가 인기 명소가 있으면 합산
  const dbPopular = db.prepare("SELECT * FROM destinations ORDER BY fetched_at DESC LIMIT 20").all();

  res.json({
    count: POPULAR.length + dbPopular.length,
    data: [...POPULAR, ...dbPopular],
  });
});

// GET /api/destinations/events
// 강원도 현재 행사/축제 조회 (1일 캐시)
router.get("/events", async (req, res) => {
  const db = getDb();
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");

  // DB에 오늘 날짜 이후 행사 있으면 반환
  const cached = db
    .prepare(
      "SELECT * FROM events WHERE end_date >= ? OR end_date IS NULL ORDER BY start_date LIMIT 50"
    )
    .all(today);

  if (cached.length > 0) {
    const lastFetched = cached[0]?.fetched_at;
    const isStale = !lastFetched || Date.now() - new Date(lastFetched).getTime() > 24 * 60 * 60 * 1000;
    if (!isStale) {
      return res.json({ source: "cache", count: cached.length, data: cached });
    }
  }

  const serviceKey = process.env.DATA_GO_KR_SERVICE_KEY;
  if (!serviceKey) {
    return res.json({ source: "cache", count: cached.length, data: cached });
  }

  try {
    const eventData = await fetchGangwonEvents(serviceKey);
    const items = eventData?.response?.body?.items?.item || [];
    const events = (Array.isArray(items) ? items : [items]).map((item) => ({
      event_id: String(item.contentid || `${item.title}_${item.eventstartdate}`),
      name: item.title || "",
      address: `${item.addr1 || ""} ${item.addr2 || ""}`.trim(),
      lat: parseFloat(item.mapy) || null,
      lng: parseFloat(item.mapx) || null,
      start_date: item.eventstartdate || null,
      end_date: item.eventenddate || null,
    }));

    const upsert = db.prepare(`
      INSERT INTO events (event_id, name, address, lat, lng, start_date, end_date, fetched_at)
      VALUES (@event_id, @name, @address, @lat, @lng, @start_date, @end_date, datetime('now'))
      ON CONFLICT(event_id) DO UPDATE SET
        name = excluded.name, start_date = excluded.start_date, end_date = excluded.end_date,
        fetched_at = excluded.fetched_at
    `);
    const insertAll = db.transaction((rows) => rows.forEach((r) => upsert.run(r)));
    insertAll(events.filter((e) => e.event_id));

    res.json({ source: "api", count: events.length, data: events });
  } catch (err) {
    console.error("Events fetch error:", err.message);
    res.json({ source: "cache", count: cached.length, data: cached });
  }
});

module.exports = router;
