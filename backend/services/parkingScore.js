// ParkingScore = 잔여면수 50% + 거리 50%

// Haversine 공식: 두 좌표 간 직선 거리 (m)
function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// 잔여면수 점수 (0~100)
// 10자리 이상 = 100점, 1자리 줄어들 때마다 -10점
function availabilityScore(available) {
  if (available == null) return 30; // 데이터 없을 때 중간값
  const spots = Math.max(0, Math.min(available, 10));
  return spots * 10;
}

// 거리 점수 (0~100)
// 300m 이내 = 100점, 100m 멀어질 때마다 -20점
function distanceScore(distanceMeters) {
  if (distanceMeters <= 300) return 100;
  const steps = Math.ceil((distanceMeters - 300) / 100);
  return Math.max(0, 100 - steps * 20);
}

// 혼잡도 레이블 (지도 핀 색상용)
function congestionLabel(parkingScore) {
  if (parkingScore >= 65) return "smooth";    // 초록
  if (parkingScore >= 35) return "normal";    // 노랑
  return "congested";                         // 빨강
}

// 도보 시간 계산 (분)
function walkingMinutes(distanceMeters) {
  return Math.ceil(distanceMeters / 67); // 성인 도보 약 4km/h = 67m/분
}

/**
 * 단일 주차장의 ParkingScore 계산
 * @returns {{ score, availScore, distScore, distanceM, walkMin, congestionLabel }}
 */
function calculateParkingScore(lot, destLat, destLng) {
  const distanceM = (lot.lat && lot.lng)
    ? haversineDistance(destLat, destLng, lot.lat, lot.lng)
    : 800;

  const available = lot.available_spots ?? lot.realtimeAvailable ?? null;

  const availScore = availabilityScore(available != null ? Number(available) : null);
  const distScore = distanceScore(distanceM);
  const score = Math.round(availScore * 0.5 + distScore * 0.5);

  return {
    score,
    availScore,
    distScore,
    distanceM: Math.round(distanceM),
    walkMin: walkingMinutes(distanceM),
    congestionLabel: congestionLabel(score),
  };
}

/**
 * 주차장 목록에 ParkingScore를 계산하고 순위 정렬
 * @returns {Array} score 내림차순 정렬된 주차장 목록
 */
function rankParkingLots(lots, destLat, destLng) {
  return lots
    .filter((lot) => lot.lat && lot.lng)
    .map((lot) => ({ ...lot, ...calculateParkingScore(lot, destLat, destLng) }))
    .sort((a, b) => b.score - a.score)
    .map((lot, i) => ({ ...lot, rank: i + 1 }));
}

module.exports = {
  calculateParkingScore,
  rankParkingLots,
  haversineDistance,
  walkingMinutes,
  congestionLabel,
};
