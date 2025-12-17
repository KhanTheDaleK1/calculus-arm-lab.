# CalculusArm Dynamics Lab

**An Educational Robotics Platform for Exploring Calculus & Trigonometry**

This project turns a 3-Axis Robotic Arm (MeArm) and a Smart Robot Car into a tangible laboratory for understanding **Vectors**, **Derivatives**, **Polar Coordinates**, and **Physics**.

## 🌟 Features

*   **Real-Time Control:** Web-based dashboard to control the arm using Inverse Kinematics (Cartesian XYZ inputs).
*   **Dynamics Visualization:** Live XY plotting of the arm's path.
*   **Calculus Engines:** Displays instantaneous velocity ($dx/dt$) and polar conversions ($r, \theta$) in real-time.
*   **Physics Labs:**
    *   **Microphone Labs:** Sound wave analysis, spectrum visualization, and Doppler shift experiments.
    *   **Car Labs:** Drag race (kinematics), Braking distance (integrals), Harmonic motion, and Radar trap.
*   **TI-84 Integration:** Import motion data CSVs from your graphing calculator to replay trajectories.
*   **Hardware Loop:** High-speed Serial communication with Arduino via Web Serial API.
*   **Browser-Based Flashing:** Flash Arduino firmware directly from the browser (Chrome/Edge).

## 🌐 Live Hosting (GitHub Pages)
The repo includes a GitHub Pages workflow (`.github/workflows/deploy-pages.yml`) that publishes the static site from `web/` on every push to `main`.

**Custom domain:** `web/CNAME` sets the domain to `kim.beechem.site`.

## 🚀 Getting Started

### 1. Hardware Setup
**Calculus Arm:**
*   **Arduino Uno** + **Prototype Shield**
*   **MeArm** (Base: Pin 2, Shoulder: Pin 3, Elbow: Pin 4)
*   **HC-SR04** (Trig: Pin 8, Echo: Pin 9)

**Black Car:**
*   **Elegoo Smart Robot Car V3.0** (Arduino Uno R3)
*   **Motor Driver:** L298N (Pins 5,6,7,8,9,11)
*   **Ultrasonic:** HC-SR04 (Trig: A5, Echo: A4)
*   **Line Sensors:** Pins 10, 4, 2

### 2. Flash Firmware
You can flash the firmware directly from the web interface or manually:
*   **Manual:** Open `arduino/CalculusArmFirmware/CalculusArmFirmware.ino` (Arm) or `arduino/BlackCarFirmware/BlackCarFirmware.ino` (Car) and upload via Arduino IDE.
*   **Web:** Use the "Flash Firmware" button in the respective web app (requires Chrome/Edge).

### 3. Launch Interface
1.  Open `web/index.html` locally in Chrome/Edge (or visit the GitHub Pages URL).
2.  Select the desired lab (Arm, Black Car, Microphone).
3.  Click **🔌 Connect** and select your Arduino Port.

## 🧮 TI-84 Connectivity
To analyze data on your calculator:
1.  Record a trace in the web app.
2.  Click **Export CSV**.
3.  Use TI-Connect CE software to send the CSV (List L1/L2) to your calculator.
4.  Plot `L1` vs `L2` on your TI-84 using `Stat Plot`.

## 🛠 Tech Stack
*   **Frontend:** HTML5, CSS3 (Neon/Dark Mode)
*   **Logic:** Vanilla JavaScript (ES6+)
*   **Math/Graphing:** Plotly.js (CDN), MathJax (CDN)
*   **Icons:** FontAwesome (CDN)
*   **Comms:** Web Serial API, Web Audio API
*   **Firmware Pipeline:** Arduino CLI via GitHub Actions; emits `web/firmware/latest.hex` and `web/firmware/version.json`.

## 📂 Project Structure
*   `web/`: Static web application files.
    *   `arm/`: Calculus Arm controller.
    *   `black-car/`: Robot Car controller and physics labs.
    *   `microphone-labs/`: Audio analysis tools.
*   `arduino/`: Source code for Arduino firmware.
*   `golden_state_backup/`: Snapshot of the project in its "Golden State".
*   `.github/`: CI/CD workflows.

## 📜 License
MIT License. Created for STEM Education.