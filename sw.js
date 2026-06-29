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
      const data = payload.data || { url: "/?view=map" };
      const isReroute = data.action === "reroute";
      const allClients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      const visibleClient = allClients.find((c) => c.visibilityState === "visible");

      // 앱이 켜져 있으면 페이지에도 전달 → 인앱 상태바 갱신 / 만차 시 리루팅 오버레이
      if (visibleClient) {
        for (const client of allClients) {
          client.postMessage({ type: "parking-foreground-alert", payload });
        }
      }

      // 만차 리루팅 + 앱이 켜져 있는 경우엔 인터랙티브 음성 오버레이가 처리하므로
      // OS 알림은 생략해 중복 소리를 방지
      if (isReroute && visibleClient) return;

      // 그 외에는 OS 알림을 항상 표시 — 앱이 켜져 있어도 소리/배너로 울림
      return self.registration.showNotification(payload.title || "강원 Parking Mate", {
        body: payload.body || "추천 주차장의 잔여면을 확인하세요.",
        tag: payload.tag || "parking-watch",
        renotify: true,
        requireInteraction: true,
        icon: payload.icon || "/icon-192.png",
        badge: payload.badge || "/badge-72.png",
        vibrate: [200, 100, 200],
        data,
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
