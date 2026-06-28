#include <WiFi.h>
#include <HTTPClient.h>

// ==========================================
// 핀 설정
// ==========================================
// 초음파 센서 1
const int TRIG_PIN_1 = 5;
const int ECHO_PIN_1 = 18;

// 초음파 센서 2
const int TRIG_PIN_2 = 25; // 19번 핀 접촉 불량 의심으로 25번으로 변경
const int ECHO_PIN_2 = 26; // 21번 핀 접촉 불량 의심으로 26번으로 변경

// LED
const int LED_GREEN_PIN = 22; // 비어있음 (초록색)
const int LED_RED_PIN = 23;   // 주차됨 (빨간색)

// ==========================================
// 로직 설정 값
// ==========================================
const int DISTANCE_THRESHOLD = 70; // 측정 기준 거리 (cm)
const unsigned long DEBOUNCE_DELAY = 3000; // 테스트를 위해 3초(3000)로 변경 (원래 15000)
const unsigned long HEARTBEAT_INTERVAL = 20000; // 생존 신고 전송 주기: 20초 (밀리초)

// ==========================================
// 통신 설정 (본인 환경에 맞게 수정하세요)
// ==========================================
const char* ssid = "lim";         // 와이파이 이름
const char* password = "chulan2134"; // 와이파이 비밀번호
const char* serverUrl = "http://192.168.0.6:8000/api/parking/status"; // 통신할 서버 URL
const String parkingSpotId = "SPOT_01";      // 주차 구역 ID

// ==========================================
// 전역 상태 변수
// ==========================================
bool isCurrentlyOccupied = false;        // 현재 확정된 최종 주차 상태 (true: 주차됨, false: 비어있음)
bool potentialNewState = false;          // 센서로 감지된 임시 상태 (15초 유지를 확인하기 위함)
unsigned long stateChangeStartTime = 0;  // 임시 상태가 시작된 시간 기록
unsigned long lastCommunicationTime = 0; // 마지막으로 서버에 데이터를 전송한 시간

void setup() {
  Serial.begin(115200);

  // 1. 핀 모드 설정
  pinMode(TRIG_PIN_1, OUTPUT);
  pinMode(ECHO_PIN_1, INPUT);
  pinMode(TRIG_PIN_2, OUTPUT);
  pinMode(ECHO_PIN_2, INPUT);
  
  pinMode(LED_GREEN_PIN, OUTPUT);
  pinMode(LED_RED_PIN, OUTPUT);

  // 2. 초기 상태 설정: 비어있음 (초록색 켜기)
  updateLEDs(false);

  // 3. WiFi 연결
  connectWiFi();
}

void loop() {
  // -------------------------------------------------------------
  // 1. 센서 간섭을 피하기 위해 센서를 번갈아가며 거리 측정
  // -------------------------------------------------------------
  float distance1 = measureDistance(TRIG_PIN_1, ECHO_PIN_1);
  delay(50); // 센서 간 초음파 간섭 방지를 위한 50ms 대기
  float distance2 = measureDistance(TRIG_PIN_2, ECHO_PIN_2);
  delay(50);

  // --- 추가된 디버깅용 코드 (1초마다 거리 출력) ---
  static unsigned long lastDebugTime = 0;
  if (millis() - lastDebugTime > 1000) {
    Serial.print("센서1 거리: "); Serial.print(distance1); Serial.print(" cm | ");
    Serial.print("센서2 거리: "); Serial.print(distance2); Serial.println(" cm");
    lastDebugTime = millis();
  }
  // ------------------------------------------------

  // -------------------------------------------------------------
  // 2. 현재 순간의 주차 여부 1차 판단 (에러 값 -1.0은 무시하는 똑똑한 로직)
  // -------------------------------------------------------------
  // 두 센서 중 하나라도 유효한 거리(0 초과)가 나왔을 때만 상태를 평가합니다.
  if (distance1 > 0 || distance2 > 0) {
    bool sensor1Detects = (distance1 > 0 && distance1 <= DISTANCE_THRESHOLD);
    bool sensor2Detects = (distance2 > 0 && distance2 <= DISTANCE_THRESHOLD);
    
    bool currentInstantState = (sensor1Detects || sensor2Detects);

    // -------------------------------------------------------------
    // 3. 디바운싱 로직 (노이즈 방지: 3초 이상 유지되는지 확인)
    // -------------------------------------------------------------
    if (currentInstantState != potentialNewState) {
      // 유효한 감지 상태가 바뀌었다면, 타이머를 리셋합니다.
      potentialNewState = currentInstantState;
      stateChangeStartTime = millis();
    }
  }

  // 바뀐 상태가 15초(DEBOUNCE_DELAY) 이상 유지되었는지 확인합니다.
  if ((millis() - stateChangeStartTime) >= DEBOUNCE_DELAY) {
    // 15초 이상 유지되었고, 이 상태가 기존의 확정 상태와 다르다면 상태를 최종 확정합니다.
    if (potentialNewState != isCurrentlyOccupied) {
      isCurrentlyOccupied = potentialNewState;
      
      Serial.print(">>> 주차 상태 변경됨: ");
      Serial.println(isCurrentlyOccupied ? "주차됨 (차가 들어옴) <<<" : "비어있음 (차가 빠짐) <<<");
      
      // 상태가 변했으므로 LED 업데이트 및 서버 전송 (이벤트 발생)
      updateLEDs(isCurrentlyOccupied);
      sendDataToServer(isCurrentlyOccupied);
      
      // 서버에 전송했으므로 마지막 통신 시간을 갱신합니다.
      lastCommunicationTime = millis(); 
    }
  }

  // -------------------------------------------------------------
  // 4. 생존 신고 (Heartbeat) 로직: 상태가 안 변해도 20초마다 전송
  // -------------------------------------------------------------
  if ((millis() - lastCommunicationTime) >= HEARTBEAT_INTERVAL) {
    Serial.println("--- 생존 신고 데이터 전송 ---");
    sendDataToServer(isCurrentlyOccupied);
    lastCommunicationTime = millis();
  }
}

// -------------------------------------------------------------
// 보조 함수: 초음파 센서 거리 측정
// -------------------------------------------------------------
float measureDistance(int trigPin, int echoPin) {
  digitalWrite(trigPin, LOW);
  delayMicroseconds(2);
  digitalWrite(trigPin, HIGH);
  delayMicroseconds(10);
  digitalWrite(trigPin, LOW);

  // pulseIn 타임아웃을 30000us (약 5미터 거리)로 설정하여 
  // 인식 안될 때 코드 실행이 멈춰버리는 현상(Blocking)을 방지합니다.
  long duration = pulseIn(echoPin, HIGH, 30000); 
  
  // duration이 0이면 타임아웃(반사된 초음파가 없음 = 앞에 물체가 텅 빔)을 의미합니다.
  // 이 경우 에러(-1.0)로 처리하면 차가 빠졌을 때 평생 인식을 못하므로, 무한대에 가까운 999.0cm로 반환합니다.
  if (duration == 0) return 999.0; 
  
  // 음속(340m/s)을 이용하여 거리 계산 (왕복이므로 2로 나눔)
  return duration * 0.034 / 2.0;
}

// -------------------------------------------------------------
// 보조 함수: LED 제어
// -------------------------------------------------------------
void updateLEDs(bool isOccupied) {
  if (isOccupied) {
    digitalWrite(LED_GREEN_PIN, LOW); // 초록색 끄기
    digitalWrite(LED_RED_PIN, HIGH);  // 빨간색 켜기
  } else {
    digitalWrite(LED_GREEN_PIN, HIGH); // 초록색 켜기
    digitalWrite(LED_RED_PIN, LOW);    // 빨간색 끄기
  }
}

// -------------------------------------------------------------
// 보조 함수: 서버로 상태 데이터 전송 (JSON 형태)
// -------------------------------------------------------------
void sendDataToServer(bool isOccupied) {
  if (WiFi.status() == WL_CONNECTED) {
    HTTPClient http;
    http.begin(serverUrl);
    http.addHeader("Content-Type", "application/json");

    // JSON 페이로드 생성 예시: {"spotId": "SPOT_01", "status": "OCCUPIED"}
    String payload = "{\"spotId\":\"" + parkingSpotId + "\", \"status\":\"" + (isOccupied ? "OCCUPIED" : "EMPTY") + "\"}";
    
    int httpResponseCode = http.POST(payload);

    if (httpResponseCode > 0) {
      Serial.printf("서버 전송 성공 (HTTP %d)\n", httpResponseCode);
    } else {
      Serial.printf("서버 전송 실패 (오류 코드: %d)\n", httpResponseCode);
    }
    http.end();
  } else {
    Serial.println("WiFi가 연결되어 있지 않아 전송할 수 없습니다.");
    connectWiFi(); // 끊겼으면 재연결 시도
  }
}

// -------------------------------------------------------------
// 보조 함수: WiFi 연결
// -------------------------------------------------------------
void connectWiFi() {
  Serial.print("WiFi 연결 중...");
  WiFi.begin(ssid, password);
  
  int attempts = 0;
  // 최대 10초(500ms * 20번) 대기
  while (WiFi.status() != WL_CONNECTED && attempts < 20) { 
    delay(500);
    Serial.print(".");
    attempts++;
  }
  
  if(WiFi.status() == WL_CONNECTED) {
    Serial.println("\nWiFi 연결 성공!");
    Serial.print("할당된 IP 주소: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("\nWiFi 연결 실패. 공유기 설정이나 비밀번호를 확인하세요.");
  }
}




