require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");

const configRouter = require("./routes/config");
const parkingRouter = require("./routes/parking");
const statusRouter = require("./routes/status");
const recommendRouter = require("./routes/recommend");
const arduinoRouter = require("./routes/arduino");
const destinationsRouter = require("./routes/destinations");
const pushRouter = require("./routes/push");
const { startPushMonitor } = require("./services/pushMonitor");

const app = express();
const PORT = Number(process.env.PORT || 3001);

const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",").map((s) => s.trim()).filter(Boolean);
app.use(cors({
  origin: allowedOrigins.length
    ? (origin, cb) => {
        // Capacitor WebView는 origin 없음 또는 https://localhost
        if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
        cb(Object.assign(new Error("CORS not allowed"), { status: 403 }));
      }
    : true,
}));
app.use(express.json());

// 요청 로깅 (개발용)
app.use((req, _res, next) => {
  console.log(`${new Date().toISOString().slice(11, 19)} ${req.method} ${req.path}`);
  next();
});

app.use(express.static(path.join(__dirname, "public")));

app.use("/api/config", configRouter);
app.use("/api/parking", statusRouter);    // POST /api/parking/status  ← Arduino
app.use("/api/parking", parkingRouter);
app.use("/api/recommend", recommendRouter);
app.use("/api/arduino", arduinoRouter);
app.use("/api/destinations", destinationsRouter);
app.use("/api/push", pushRouter);

// 헬스체크
app.get("/health", (_req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

// 404
app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// 에러 핸들러
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || "Internal server error" });
});

app.listen(PORT, () => {
  console.log(`강원 Parking Mate Backend: http://localhost:${PORT}`);
  console.log(`  API Keys: DATA_GO_KR=${Boolean(process.env.DATA_GO_KR_SERVICE_KEY)}, KAKAO=${Boolean(process.env.KAKAO_REST_API_KEY)}, GEMINI=${Boolean(process.env.GEMINI_API_KEY)}`);
  startPushMonitor();
});

module.exports = app;
