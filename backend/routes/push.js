const express = require("express");
const {
  pushConfig,
  registerWatch,
  stopWatch,
} = require("../services/pushMonitor");

const router = express.Router();

router.get("/config", (_req, res) => {
  const config = pushConfig();
  res.json({
    enabled: config.enabled,
    publicKey: config.publicKey,
    monitorIntervalMs: config.monitorIntervalMs,
    watchDurationMinutes: config.watchDurationMinutes,
  });
});

router.post("/watch", async (req, res, next) => {
  try {
    const result = await registerWatch(req.body || {});
    res.status(201).json(result);
  } catch (error) {
    if (/필요|없습니다|설정되지/.test(error.message)) {
      res.status(400).json({ error: error.message });
      return;
    }
    next(error);
  }
});

router.delete("/watch/:watchId", (req, res) => {
  const stopped = stopWatch(req.params.watchId);
  res.json({ stopped });
});

module.exports = router;
