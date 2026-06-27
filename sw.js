self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data ? event.data.text() : "주차장 잔여면이 변경되었습니다." };
  }

  event.waitUntil(
    self.registration.showNotification(payload.title || "강원 Parking Mate", {
      body: payload.body || "추천 주차장의 잔여면을 확인하세요.",
      tag: payload.tag || "parking-watch",
      renotify: true,
      data: payload.data || { url: "/?view=map" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const notifData = event.notification.data || {};
  const targetUrl = new URL(notifData.url || "/?view=map", self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const target = clients.find((c) => "focus" in c);

      if (target) {
        if (notifData.action === "reroute") {
          // reroute: postMessage만 보내고 navigate 금지 (navigate하면 페이지 리로드로 메시지 유실)
          target.postMessage({ type: "parking-reroute", ...notifData });
          return target.focus();
        }
        if ("navigate" in target) target.navigate(targetUrl);
        return target.focus();
      }

      // 앱 창이 없으면 새 창 열기 (URL에 데이터 포함)
      if (self.clients.openWindow) {
        const openUrl =
          notifData.action === "reroute"
            ? new URL(
                `${targetUrl}&pendingReroute=${encodeURIComponent(JSON.stringify(notifData))}`,
                self.location.origin,
              ).href
            : targetUrl;
        return self.clients.openWindow(openUrl);
      }
    }),
  );
});
