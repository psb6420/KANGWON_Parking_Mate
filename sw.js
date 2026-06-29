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

      // 감시 중인 모든 주차장의 현재 현황으로 "라이브 보드" 본문 구성
      const lots = Array.isArray(data.lots) ? data.lots : [];
      const liveSummary = lots
        .map((lot) => {
          if (lot.available === null || lot.available === undefined) return null;
          return lot.available === 0 ? `${lot.name} 만차` : `${lot.name} ${lot.available}면`;
        })
        .filter(Boolean)
        .join(" · ");

      // 중요한 상태 변화(만차 진입 / 빈자리 발생 / 리루팅)만 소리·진동으로 재알림,
      // 그 외 숫자 미세 변동은 같은 알림(같은 tag)을 조용히 갱신 → 딩동 반복 방지
      const changes = Array.isArray(data.changes) ? data.changes : [];
      const significant =
        isReroute || changes.some((c) => c.type === "full" || c.type === "opened");

      return self.registration.showNotification(payload.title || "강원 Parking Mate", {
        body: liveSummary || payload.body || "추천 주차장의 잔여면을 확인하세요.",
        tag: payload.tag || "parking-watch", // 같은 watch는 같은 알림으로 갱신(누적 X)
        renotify: significant,
        silent: !significant,
        requireInteraction: true, // 알림이 사라지지 않고 상시 유지
        icon: payload.icon || "/icon-192.png",
        badge: payload.badge || "/badge-72.png",
        vibrate: significant ? [200, 100, 200] : undefined,
        timestamp: Date.now(),
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
