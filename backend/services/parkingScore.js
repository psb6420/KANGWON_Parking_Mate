// ParkingScore = (available spot score + walking distance score) / 2

// Haversine distance between two WGS84 coordinates in meters.
function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Available spot score:
// 10+ spots = 100, 9 spots = 90, ... 1 spot = 10, 0 spots = 0.
function availabilityScore(available) {
  if (available == null) return 0;
  const parsed = Number(available);
  if (!Number.isFinite(parsed)) return 0;
  const spots = Math.max(0, Math.min(Math.floor(parsed), 10));
  return spots * 10;
}

// Walking distance score:
// <=200m = 100, then subtract 10 points for each additional 100m.
// Examples: 300m = 90, 400m = 80, 1200m+ = 0.
function distanceScore(distanceMeters) {
  const distance = Number(distanceMeters);
  if (!Number.isFinite(distance)) return 0;
  if (distance <= 200) return 100;
  const penaltySteps = Math.ceil((distance - 200) / 100);
  return Math.max(0, 100 - penaltySteps * 10);
}

function congestionLabel(parkingScore) {
  if (parkingScore >= 65) return "smooth";
  if (parkingScore >= 35) return "normal";
  return "congested";
}

function walkingMinutes(distanceMeters) {
  return Math.ceil(distanceMeters / 67);
}

function calculateParkingScore(lot, destLat, destLng) {
  const distanceM =
    lot.lat && lot.lng
      ? haversineDistance(destLat, destLng, Number(lot.lat), Number(lot.lng))
      : Number.POSITIVE_INFINITY;

  const available = lot.available_spots ?? lot.realtimeAvailable ?? null;
  const availScore = availabilityScore(available);
  const distScore = distanceScore(distanceM);
  const score = Math.round((availScore + distScore) / 2);

  return {
    score,
    availScore,
    distScore,
    distanceM: Math.round(distanceM),
    walkMin: Number.isFinite(distanceM) ? walkingMinutes(distanceM) : null,
    congestionLabel: congestionLabel(score),
  };
}

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
  availabilityScore,
  distanceScore,
  haversineDistance,
  walkingMinutes,
  congestionLabel,
};
