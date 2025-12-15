# CalculusArm Dynamics Lab

**An Educational Robotics Platform for Exploring Calculus & Trigonometry**

This project turns a 3-Axis Robotic Arm (MeArm) into a tangible laboratory for understanding **Vectors**, **Derivatives**, and **Polar Coordinates**.

## 🌟 Features

*   **Real-Time Control:** Web-based dashboard to control the arm using Inverse Kinematics (Cartesian XYZ inputs).
*   **Dynamics Visualization:** Live XY plotting of the arm's path.
*   **Calculus Engines:** Displays instantaneous velocity ($dx/dt$) and polar conversions ($r, \theta$) in real-time.
*   **TI-84 Integration:** Import motion data CSVs from your graphing calculator to replay trajectories.
*   **Hardware Loop:** High-speed Serial communication with Arduino.

## 🌐 Live Hosting (GitHub Pages)
The repo includes a GitHub Pages workflow (`.github/workflows/deploy-pages.yml`) that publishes the static site from `web/` on every push to `main`.

**Custom domain:** `web/CNAME` sets the domain to `kim.beechem.site`. In Cloudflare, point a CNAME for `kim` to `khanthedalek1.github.io`, then enable GitHub Pages in repo settings and set the custom domain to `kim.beechem.site`.

## 🚀 Getting Started

### 1. Hardware Setup
*   **Arduino Uno** + **Prototype Shield**
*   **MeArm** (Base: Pin 2, Shoulder: Pin 3, Elbow: Pin 4)
*   **HC-SR04** (Trig: Pin 8, Echo: Pin 9)

### 2. Flash Firmware
1.  Open `arduino/CalculusArmFirmware/CalculusArmFirmware.ino`.
2.  Upload to your Arduino.

### 3. Launch Interface
1.  Open `web/index.html` locally in Chrome/Edge (or visit the GitHub Pages URL after it’s enabled).
2.  Click **🔌 Connect Arm**.
3.  Select your Arduino Port.

### 4. Educational Modules
*   **Module 1:** *The Derivative.* Move the X-slider quickly. Observe the "Instantaneous Velocity" spike.
*   **Module 2:** *Polar vs Cartesian.* Watch how `r` (radius) changes as you move Y, but `theta` stays constant if you move along a ray.

## 🧮 TI-84 Connectivity
To analyze data on your calculator:
1.  Record a trace in the web app.
2.  Click **Export CSV**.
3.  Use TI-Connect CE software to send the CSV (List L1/L2) to your calculator.
4.  Plot `L1` vs `L2` on your TI-84 using `Stat Plot`.

## 🛠 Tech Stack
*   **Frontend:** HTML5, CSS3 (Neon/Dark Mode)
*   **Logic:** Vanilla JavaScript (ES6+)
*   **Math/Graphing:** Plotly.js, MathJax
*   **Comms:** Web Serial API

## 📜 License
MIT License. Created for STEM Education.
