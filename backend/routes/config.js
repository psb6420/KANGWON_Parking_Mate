const express = require("express");
const router = express.Router();

// GET /api/config
// 프론트엔드에 필요한 공개 설정 키 반환 (민감 키는 절대 노출 안 함)
router.get("/", (req, res) => {
  res.json({
    kakaoJavascriptKey: process.env.KAKAO_JAVASCRIPT_KEY || "",
    hasDataServiceKey: Boolean(process.env.DATA_GO_KR_SERVICE_KEY),
    hasGeminiKey: Boolean(process.env.GEMINI_API_KEY),
    hasKakaoRestKey: Boolean(process.env.KAKAO_REST_API_KEY),
  });
});

module.exports = router;
