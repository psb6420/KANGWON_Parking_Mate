# 강원 Parking Mate — Android 앱 (TWA)

라이브 PWA(`https://gangwon-do-realtime-parking-map.vercel.app`)를 **Trusted Web Activity(TWA)** 로 감싼 정식 안드로이드 애플리케이션입니다. 기기 Chrome 엔진으로 사이트를 전체화면(주소창 없이)으로 띄우므로, 웹 푸시 알림 · Service Worker · 위치(Geolocation) · 카카오맵/카카오내비가 **웹앱과 동일하게** 동작합니다.

- 패키지: `com.gangwon.parkingmate`
- 로드 주소: `https://gangwon-do-realtime-parking-map.vercel.app/?source=pwa`
- minSdk 24 (Android 7.0) / targetSdk 36 / compileSdk 36

> 이 폴더는 기존 `../android` (미완성 Capacitor 스캐폴드)와 **별개의 새 프로젝트**입니다.

## 사전 준비

- JDK 17 이상 (설치된 JDK 21 사용 가능)
- Android SDK (`local.properties`의 `sdk.dir` 경로)
- 기기에 **Chrome** 설치 (TWA 렌더링 엔진). 없으면 Custom Tab으로 자동 폴백합니다.

## 디버그 빌드

```powershell
cd android-twa
.\gradlew.bat assembleDebug
```

생성물:

```
app/build/outputs/apk/debug/app-debug.apk
```

## 설치 / 실행

기기를 USB 디버깅으로 연결하거나 에뮬레이터를 켠 뒤:

```powershell
# 한 번에 빌드+설치+실행
.\gradlew.bat installDebug
adb shell am start -n com.gangwon.parkingmate/com.google.androidbrowserhelper.trusted.LauncherActivity

# 또는 APK 직접 설치
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

## 주소창 없는 전체화면(Chromeless)을 위한 Digital Asset Links

TWA가 주소창 없이 뜨려면, 로드하는 도메인이 **이 앱을 신뢰한다는 증명**(`/.well-known/assetlinks.json`)을 서빙해야 합니다. 검증에 실패하면 앱은 여전히 동작하지만 상단에 얇은 Custom Tab 주소 바가 보입니다.

이 레포에는 **디버그 서명 키**의 지문이 들어간 파일이 이미 준비돼 있습니다:

```
../.well-known/assetlinks.json   (repo 루트 → 라이브 사이트로 배포됨)
```

라이브 사이트에 반영하려면 레포 루트에서:

```powershell
npx vercel --prod --yes
```

배포 후 확인:

```
https://gangwon-do-realtime-parking-map.vercel.app/.well-known/assetlinks.json
```

> 검증 적용은 앱을 **재설치**할 때 평가됩니다. 파일 배포 후 앱을 지웠다가 다시 설치하세요.

### 디버그 서명 SHA-256 (현재 등록된 지문)

```
64:8C:5A:7B:5E:E6:56:F9:F6:12:82:C0:B4:0C:3E:8A:0C:16:BA:ED:2E:3A:A0:B6:8C:13:2E:0D:A4:7B:13:19
```

다른 PC에서 빌드하면 디버그 키가 달라 지문도 달라집니다. 본인 지문 확인:

```powershell
keytool -list -v -keystore "$env:USERPROFILE\.android\debug.keystore" -alias androiddebugkey -storepass android -keypass android
```

## 릴리스(스토어용) 빌드

릴리스 키스토어로 서명하려면 Gradle 프로퍼티로 전달합니다:

```powershell
.\gradlew.bat assembleRelease `
  -PPARKING_KEYSTORE="C:\path\to\release.jks" `
  -PPARKING_KEYSTORE_PASSWORD=*** `
  -PPARKING_KEY_ALIAS=*** `
  -PPARKING_KEY_PASSWORD=***
```

> 릴리스/업로드 키(및 Play 앱 서명 키)의 SHA-256은 디버그 키와 **다릅니다**. 스토어 배포 시 해당 지문을 `assetlinks.json`의 `sha256_cert_fingerprints` 배열에 **추가**해야 주소창이 사라집니다. (배열이므로 디버그·릴리스 지문을 함께 넣어도 됩니다.)

## 동작 메모

- **웹 푸시(길안내 중 만차/빈자리 알림)**: Chrome이 수신해 `DelegationService`를 통해 안드로이드 알림으로 표시됩니다. Android 13+에서는 최초 1회 알림 권한 허용이 필요합니다.
- **위치/카카오맵/카카오내비**: Chrome 권한·스킴으로 그대로 동작합니다. 카카오 개발자 콘솔의 사이트 도메인 등록은 라이브 PWA 도메인 기준으로 이미 되어 있어야 합니다.
- 첫 실행 시 뜨는 iOS 안내 다이얼로그는 닫기 버튼으로 닫으면 됩니다(안드로이드 차단 아님).
