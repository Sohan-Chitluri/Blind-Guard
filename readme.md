# 🛡️ BlindGuard

**A distributed assistive wearable system for visually impaired users, featuring real-time fall detection, obstacle avoidance, GPS tracking, and a live web dashboard.**

Built with ESP32 + ESP8266 communicating over ESP-NOW — a low-latency, peer-to-peer embedded solution that works without WiFi routers.

---

## ✨ Features

- **Fall Detection** — Acceleration spike + free-fall pattern analysis using MPU6050
- **Obstacle Detection** — Ultrasonic distance measurement with haptic/buzzer feedback
- **GPS Tracking** — Real-time location logging via GPRMC sentence parsing
- **Peer-to-Peer Communication** — ESP-NOW protocol for instant, router-free data transfer
- **Web Dashboard** — Real-time monitoring UI with charts, event log, and GPS display
- **Event-Driven Logic** — Impact → free-fall confirmation reduces false positives
- **Demo Mode** — Test the dashboard without any hardware connected

## 🏗️ Architecture

```
┌─────────────────┐   ESP-NOW    ┌─────────────────┐   USB Serial   ┌─────────────────┐
│    ESP8266       │ ──────────→ │     ESP32        │ ─────────────→ │   Web Dashboard  │
│  Obstacle Unit   │  wireless   │   Safety Unit    │  structured    │   (Browser)      │
│                  │             │                  │  data stream   │                  │
│ • Ultrasonic     │   obstacle  │ • MPU6050 IMU    │                │ • Accel Chart    │
│ • Buzzer/Haptic  │   alerts    │ • GPS Module     │                │ • Event Log      │
│                  │             │ • ESP-NOW Rx     │                │ • GPS Display    │
└─────────────────┘             └─────────────────┘                └─────────────────┘
```

## 📁 Project Structure

```
BlindGuard/
├── BlindGaurd_esp32_updated.ino   # ESP32 firmware (fall detection + GPS + serial output)
├── esp8266_obstacle.ino           # ESP8266 firmware (ultrasonic + buzzer + ESP-NOW)
├── dashboard/
│   ├── index.html                 # Dashboard page
│   ├── style.css                  # Dark glassmorphism UI
│   └── main.js                    # Serial comms, charts, event log, demo mode
└── README.md
```

## 🔧 Hardware Requirements

| Component | Node | Purpose |
|-----------|------|---------|
| ESP32 Dev Board | Safety Unit | Main controller |
| MPU6050 | Safety Unit | Accelerometer for fall detection |
| GPS Module (NEO-6M) | Safety Unit | Location tracking |
| ESP8266 (NodeMCU) | Obstacle Unit | Secondary controller |
| HC-SR04 Ultrasonic | Obstacle Unit | Distance measurement |
| Buzzer / Vibration Motor | Obstacle Unit | Haptic feedback |

### Wiring

**ESP32 (Safety Unit):**
| Pin | Connection |
|-----|-----------|
| GPIO 21 (SDA) | MPU6050 SDA |
| GPIO 22 (SCL) | MPU6050 SCL |
| GPIO 16 (RX2) | GPS TX |
| GPIO 17 (TX2) | GPS RX |

**ESP8266 (Obstacle Unit):**
| Pin | Connection |
|-----|-----------|
| GPIO 12 | HC-SR04 TRIG |
| GPIO 14 | HC-SR04 ECHO |
| GPIO 13 | Buzzer / Vibration Motor |

## 🚀 Getting Started

### 1. Flash the Firmware

1. Open `BlindGaurd_esp32_updated.ino` in Arduino IDE
2. Install libraries: `MPU6050`, `Wire`, `WiFi`, `esp_now`
3. Select **ESP32 Dev Module** and flash
4. Open `esp8266_obstacle.ino`, update `receiverMAC[]` with your ESP32's MAC address
5. Select **NodeMCU 1.0** and flash

### 2. Run the Dashboard

**Option A — Open directly:**
```
Open dashboard/index.html in Chrome or Edge
```

**Option B — Local server (accessible over WiFi):**
```bash
cd BlindGuard
python -m http.server 3000 --directory dashboard --bind 0.0.0.0
```
Then open `http://localhost:3000` or `http://<your-ip>:3000` from any device on your network.

### 3. Connect

- Click **Connect** in the dashboard → select the ESP32's COM port
- Or click **Demo** to test with simulated data

## 📊 Serial Data Format

The ESP32 outputs structured lines for the dashboard to parse:

```
DATA:accel=1.020,ax=0.02,ay=0.01,az=0.98,fall=0,obstacle=0,falls=0,obstacles=0,lat=17.3850,lng=78.4867
EVENT:FALL_DETECTED
EVENT:OBSTACLE_ALERT
EVENT:BOOT
EVENT:MPU_OK
EVENT:ESPNOW_OK
EVENT:READY
```

## 🛠️ Technologies Used

- **ESP32** — Main MCU (MPU6050 + GPS + ESP-NOW receiver)
- **ESP8266** — Secondary MCU (Ultrasonic sensor + ESP-NOW sender)
- **ESP-NOW** — Peer-to-peer wireless protocol (no router needed)
- **Arduino Framework** — Firmware development
- **Web Serial API** — Browser-to-microcontroller communication
- **Vanilla HTML/CSS/JS** — Zero-dependency dashboard

## Screenshot
<img width="1920" height="1080" alt="Screenshot 2026-02-25 235649" src="https://github.com/user-attachments/assets/6d43915f-d44a-407d-943f-b4afef3378f2" />


## 📄 License

This project is open source and available under the [MIT License](LICENSE).

