#include <Wire.h>
#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include <MPU6050.h>

HardwareSerial gps(2);
MPU6050 mpu;

// ---------- Fall Detection ----------
bool impactDetected = false;
bool fallDetected = false;
unsigned long impactTime = 0;

float ax, ay, az;
float totalAccel;

// ---------- Counters ----------
unsigned long fallCount = 0;
unsigned long obstacleCount = 0;
bool lastObstacleState = false;

// ---------- GPS Storage ----------
String lastLatitude = "";
String lastLongitude = "";

// ---------- ESP-NOW Structure ----------
typedef struct {
  bool obstacle;
} IncomingMessage;

IncomingMessage incoming;

// ---------- ESP-NOW Receive ----------
void onReceive(const esp_now_recv_info_t *info, const uint8_t *data, int len) {
  if (len == sizeof(IncomingMessage)) {
    memcpy(&incoming, data, sizeof(incoming));

    if (incoming.obstacle && !lastObstacleState) {
      obstacleCount++;
      Serial.println("EVENT:OBSTACLE_ALERT");
    }
    lastObstacleState = incoming.obstacle;
  }
}

// ---------- Parse GPS ----------
void readGPS() {
  while (gps.available()) {
    String line = gps.readStringUntil('\n');

    if (line.startsWith("$GPRMC")) {

      int commas[12];
      int commaIndex = 0;

      for (int i = 0; i < (int)line.length() && commaIndex < 12; i++) {
        if (line[i] == ',') {
          commas[commaIndex++] = i;
        }
      }

      if (commaIndex >= 6 && line[commas[1] + 1] == 'A') {
        lastLatitude = line.substring(commas[2] + 1, commas[3]);
        lastLongitude = line.substring(commas[4] + 1, commas[5]);
      }
    }
  }
}

void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println("EVENT:BOOT");

  // ---------- MPU ----------
  Wire.begin(21, 22);
  mpu.initialize();
  if (!mpu.testConnection()) {
    Serial.println("EVENT:MPU_FAIL");
    while (1);
  }
  Serial.println("EVENT:MPU_OK");

  // ---------- GPS ----------
  gps.begin(9600, SERIAL_8N1, 16, 17);

  // ---------- ESP-NOW ----------
  WiFi.mode(WIFI_STA);
  esp_wifi_set_channel(1, WIFI_SECOND_CHAN_NONE);

  if (esp_now_init() != ESP_OK) {
    Serial.println("EVENT:ESPNOW_FAIL");
    while (1);
  }

  esp_now_register_recv_cb(onReceive);

  Serial.println("EVENT:ESPNOW_OK");
  Serial.println("EVENT:READY");
}

void loop() {

  // ---------- Background GPS Read ----------
  readGPS();

  // ---------- Accelerometer ----------
  int16_t rawAx, rawAy, rawAz;
  mpu.getAcceleration(&rawAx, &rawAy, &rawAz);

  ax = rawAx / 16384.0;
  ay = rawAy / 16384.0;
  az = rawAz / 16384.0;

  totalAccel = sqrt(ax * ax + ay * ay + az * az);

  // ---------- FALL DETECTION ----------
  bool fallEvent = false;

  if (!impactDetected && totalAccel > 2.5) {
    impactDetected = true;
    impactTime = millis();
  }

  if (impactDetected) {
    if (totalAccel < 0.5) {
      fallEvent = true;
      fallDetected = true;
      impactDetected = false;
    }

    if (millis() - impactTime > 800) {
      impactDetected = false;
    }
  }

  if (fallDetected) {
    fallCount++;
    Serial.println("EVENT:FALL_DETECTED");
    fallDetected = false;
  }

  // ---------- STRUCTURED DATA OUTPUT ----------
  // Format: DATA:key=value,key=value,...
  Serial.print("DATA:accel=");
  Serial.print(totalAccel, 3);
  Serial.print(",ax=");
  Serial.print(ax, 3);
  Serial.print(",ay=");
  Serial.print(ay, 3);
  Serial.print(",az=");
  Serial.print(az, 3);
  Serial.print(",fall=");
  Serial.print(fallEvent ? 1 : 0);
  Serial.print(",obstacle=");
  Serial.print(incoming.obstacle ? 1 : 0);
  Serial.print(",falls=");
  Serial.print(fallCount);
  Serial.print(",obstacles=");
  Serial.print(obstacleCount);
  Serial.print(",lat=");
  Serial.print(lastLatitude.length() > 0 ? lastLatitude : "0");
  Serial.print(",lng=");
  Serial.println(lastLongitude.length() > 0 ? lastLongitude : "0");

  delay(50);
}
