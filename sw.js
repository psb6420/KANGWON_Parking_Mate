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
    (async () => {
      const allClients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      const visibleClient = allClients.find((c) => c.visibilityState === "visible");

      // 앱이 화면에 떠 있으면 OS 팝업 대신 페이지에서 인앱 배너 + 음성으로 처리.
      // userVisibleOnly 규칙상 "보이는 창이 있을 때"는 알림을 생략해도 허용됨.
      if (visibleClient) {
        for (const client of allClients) {
          client.postMessage({ type: "parking-foreground-alert", payload });
        }
        return;
      }

      // 백그라운드 → OS 알림 표시
      return self.registration.showNotification(payload.title || "강원 Parking Mate", {
        body: payload.body || "추천 주차장의 잔여면을 확인하세요.",
        tag: payload.tag || "parking-watch",
        renotify: true,
        requireInteraction: true,
        icon: payload.icon || "/icon-192.png",
        badge: payload.badge || "/badge-72.png",
        vibrate: [200, 100, 200],
        data: payload.data || { url: "/?view=map" },
      });
    })(),
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
        // 기존 창이 있으면 절대 navigate 금지 — navigate()는 페이지 리로드를 일으킴
        if (notifData.action === "reroute") {
          target.postMessage({ type: "parking-reroute", ...notifData });
        } else {
          target.postMessage({ type: "switch-view", view: "map" });
        }
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
