const fetch = require("node-fetch");

const GEMINI_API_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

const SYSTEM_PROMPT = `너는 강원도 관광객을 위한 친절한 주차 안내 AI '강원 Parking Mate'야.
아래의 주차장 데이터를 바탕으로, 왜 이 주차장을 추천하는지 2문장 이내의 진솔한 이유를 작성해줘.
친근하고 간결하게, 관광객이 이해하기 쉬운 언어로 작성해.`;

/**
 * Google Gemini API로 추천 이유 생성
 * @param {object} params
 * @param {string} params.destinationName - 목적지 이름
 * @param {string} params.parkingName - 주차장 이름
 * @param {number} params.availableSpots - 잔여 주차면수
 * @param {number} params.walkMin - 도보 시간 (분)
 * @param {number} params.score - ParkingScore (0~100)
 * @param {string} params.congestionLabel - smooth | normal | congested
 * @returns {Promise<string>} 추천 이유 텍스트
 */
async function generateRecommendationReason(params) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return buildFallbackReason(params);
  }

  const userPrompt = buildPrompt(params);

  try {
    const res = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: SYSTEM_PROMPT },
              { text: userPrompt },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 200,
        },
      }),
    });

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error("Empty Gemini response");
    return text.trim();
  } catch (err) {
    console.error("Gemini API error:", err.message);
    return buildFallbackReason(params);
  }
}

function buildPrompt({ destinationName, parkingName, availableSpots, walkMin, score }) {
  return [
    `- 목적지: ${destinationName}`,
    `- 주차장명: ${parkingName}`,
    `- 잔여면수: ${availableSpots != null ? `${availableSpots}면` : "정보 없음"}`,
    `- 도보거리: ${walkMin}분`,
    `- ParkingScore: ${score}점 (100점 만점)`,
  ].join("\n");
}

// Gemini API 키 없을 때 규칙 기반 fallback
function buildFallbackReason({ parkingName, availableSpots, walkMin, congestionLabel }) {
  const congestionText = { smooth: "여유롭고", normal: "보통이며", congested: "다소 혼잡하지만" };
  const statusText = congestionText[congestionLabel] || "이용 가능하며";
  const spotsText = availableSpots != null ? `현재 ${availableSpots}면 여유가 있어 ` : "";
  return `${parkingName}은 ${statusText} ${spotsText}목적지까지 도보 ${walkMin}분 거리입니다.`;
}

module.exports = { generateRecommendationReason };
