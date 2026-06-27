import { App } from "@capacitor/app";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";

const ParkingNavigation = registerPlugin("ParkingNavigation");
let pushListenersReady = false;
let registrationPromise = null;

function emit(name, detail) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

async function preparePushListeners() {
  if (pushListenersReady) return;
  pushListenersReady = true;

  await PushNotifications.addListener("pushNotificationReceived", (notification) => {
    emit("parkingmate:native-push", notification);
  });
  await PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
    emit("parkingmate:native-push-action", action.notification?.data || {});
  });
}

async function registerPush() {
  if (registrationPromise) return registrationPromise;
  registrationPromise = (async () => {
    await preparePushListeners();
    let permission = await PushNotifications.checkPermissions();
    if (permission.receive === "prompt") {
      permission = await PushNotifications.requestPermissions();
    }
    if (permission.receive !== "granted") {
      throw new Error("푸시 알림 권한이 허용되지 않았습니다.");
    }

    const tokenPromise = new Promise((resolve, reject) => {
      const timeout = window.setTimeout(
        () => reject(new Error("FCM 등록 토큰을 받지 못했습니다.")),
        15000,
      );
      PushNotifications.addListener("registration", (token) => {
        window.clearTimeout(timeout);
        resolve(token.value);
      });
      PushNotifications.addListener("registrationError", (error) => {
        window.clearTimeout(timeout);
        reject(new Error(error?.error || "FCM 등록에 실패했습니다."));
      });
    });

    await PushNotifications.register();
    return tokenPromise;
  })().catch((error) => {
    registrationPromise = null;
    throw error;
  });
  return registrationPromise;
}

window.ParkingMateNative = Object.freeze({
  isNative: Capacitor.isNativePlatform(),
  platform: Capacitor.getPlatform(),
  registerPush,
  startNavigation: (destination) => ParkingNavigation.startNavigation(destination),
  scheduleReroute: (request) => ParkingNavigation.scheduleReroute(request),
  cancelReroute: () => ParkingNavigation.cancelReroute(),
});

App.addListener("appUrlOpen", ({ url }) => emit("parkingmate:app-url", { url }));
emit("parkingmate:native-ready", {
  platform: Capacitor.getPlatform(),
});
