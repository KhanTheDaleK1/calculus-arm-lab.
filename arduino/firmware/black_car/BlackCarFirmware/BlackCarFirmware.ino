/*
  Black Car - Basic Motor Test & Obstacle Avoidance + Line Tracking
  Target: Elegoo Smart Robot Car V3.0 (Arduino Uno R3 / Uno R4 WiFi)
*/

// * Motor Pins
#define ENA 5
#define ENB 6
#define IN1 7 // Reverted to Original (Forward)
#define IN2 8 // Reverted to Original
#define IN3 11 // Swapped (Fixing Right Motor)
#define IN4 9  // Swapped (Fixing Right Motor)

// * Ultrasonic Pins
#define TRIG A5
#define ECHO A4

// * Line Sensor Pins (Elegoo V3.0 Standard)
#define LINE_L 10
#define LINE_M 4
#define LINE_R 2

// * State Variables
char command = 'S';
int speed = 200;
int turnSpeed = 230; 
bool autoMode = false;

// * Wi-Fi (Uno R4 WiFi only)
#if defined(ARDUINO_UNO_R4_WIFI)
#include <WiFiS3.h>
const char WIFI_SSID[] = "3E+K";
const char WIFI_PASS[] = "Tuba2thpaste";
bool wifiConnected = false;
unsigned long lastWifiAttempt = 0;
const unsigned long WIFI_RETRY_MS = 5000;
void serviceWiFi();
#endif

// * Lab State
int currentLab = 0; // 0=None, 1=Drag, 2=Brake, 3=Osc
unsigned long labStartTime = 0;
unsigned long lastLogTime = 0;

// * Function Prototypes
void moveForward(int speed);
void moveBackward(int speed);
void turnLeft(int speed);
void turnRight(int speed);
void stopMotors();
float getFilteredDistance();
float getRawDistance();
void runLabLogic();
void waitForSerial();

void waitForSerial() {
#if defined(ARDUINO_UNO_R4_WIFI) || defined(ARDUINO_UNO_R4_MINIMA)
  // Allow native USB boards to enumerate so READY isn't missed.
  unsigned long start = millis();
  while (!Serial && (millis() - start < 2000)) {
    delay(10);
  }
#endif
}

void setup() {
  Serial.begin(9600);
  waitForSerial();
  
  // Motor Config
  pinMode(ENA, OUTPUT);
  pinMode(ENB, OUTPUT);
  pinMode(IN1, OUTPUT);
  pinMode(IN2, OUTPUT);
  pinMode(IN3, OUTPUT);
  pinMode(IN4, OUTPUT);

  // Sensor Config
  pinMode(TRIG, OUTPUT);
  pinMode(ECHO, INPUT);
  
  pinMode(LINE_L, INPUT);
  pinMode(LINE_M, INPUT);
  pinMode(LINE_R, INPUT);

  stopMotors();
  Serial.println("READY"); 

#if defined(ARDUINO_UNO_R4_WIFI)
  serviceWiFi(); // Kick off Wi-Fi connection attempt
#endif
}

void loop() {
#if defined(ARDUINO_UNO_R4_WIFI)
  serviceWiFi();
#endif

  // * 1. Process Incoming Commands
  if (Serial.available() > 0) {
    command = Serial.read();
    
    // Debug: Confirm we heard the command
    // Serial.print("CMD:"); Serial.println(command); // Commented out to keep CSV clean

    if (command == 'F') { moveForward(speed); autoMode = false; currentLab = 0; }
    else if (command == 'B') { moveBackward(speed); autoMode = false; currentLab = 0; }
    else if (command == 'L') { turnLeft(turnSpeed); autoMode = false; currentLab = 0; }
    else if (command == 'R') { turnRight(turnSpeed); autoMode = false; currentLab = 0; }
    else if (command == 'S') { stopMotors(); autoMode = false; currentLab = 0; }
    else if (command == 'A') { autoMode = true; currentLab = 0; } // Auto Mode
    else if (command == 'M') { autoMode = false; currentLab = 0; stopMotors(); }
    
    // Lab Commands
    else if (command == '1') { currentLab = 1; labStartTime = millis(); autoMode = false; }
    else if (command == '2') { currentLab = 2; labStartTime = millis(); autoMode = false; }
    else if (command == '3') { currentLab = 3; labStartTime = millis(); autoMode = false; }
    else if (command == '4') { currentLab = 4; labStartTime = millis(); autoMode = false; stopMotors(); }
    else if (command == '5') { currentLab = 5; labStartTime = millis(); autoMode = false; stopMotors(); }
  }

  // * 2. Lab Execution
  if (currentLab > 0) {
    runLabLogic();
    return; // Skip normal telemetry/auto logic during Lab
  }

  // * 3. Read Sensors
  int distance = getFilteredDistance();
  int lVal = digitalRead(LINE_L);
  int mVal = digitalRead(LINE_M);
  int rVal = digitalRead(LINE_R);
  
  // Send Telemetry (~10Hz) - ONLY IN FREE DRIVE MODE
  static unsigned long lastTelem = 0;
  if (millis() - lastTelem > 100) {
    if (currentLab == 0) {
      Serial.print("D:"); Serial.print(distance);
      Serial.print("|L:"); Serial.print(lVal); Serial.print(mVal); Serial.println(rVal);
    }
    lastTelem = millis();
  }
  
  // * 4. Auto Mode Logic (Roam -> Line Capture -> Safety Stop)
  if (autoMode) {
    // ! Priority 1: Safety Stop (Close Obstacle)
    if (distance < 15 && distance > 0) {
      stopMotors();
    } 
    // ! Priority 2: Line Capture (If ANY sensor sees line)
    else if (lVal == HIGH || mVal == HIGH || rVal == HIGH) {
       // Line Following Logic
       if (mVal == HIGH) {
        moveForward(150); 
       } else if (lVal == HIGH) {
        turnLeft(turnSpeed);
       } else if (rVal == HIGH) {
        turnRight(turnSpeed);
       }
    }
    // ! Priority 3: Free Roam (Wander)
    else {
      // Basic Obstacle Avoidance (Wander)
      if (distance < 30 && distance > 0) { 
        stopMotors();
        delay(200);
        moveBackward(150);
        delay(400); 
        turnLeft(turnSpeed); 
        delay(500); 
      } else {
        moveForward(180); 
      }
    }
  }
  
  delay(10);
}

#if defined(ARDUINO_UNO_R4_WIFI)
void serviceWiFi() {
  if (WiFi.status() == WL_NO_MODULE) {
    if (!wifiConnected) {
      Serial.println("WIFI:NoModule");
      wifiConnected = true; // Prevent spamming the log
    }
    return;
  }

  if (WiFi.status() == WL_CONNECTED) {
    if (!wifiConnected) {
      wifiConnected = true;
      Serial.print("WIFI:Connected IP=");
      Serial.println(WiFi.localIP());
    }
    return;
  }

  wifiConnected = false;
  if (millis() - lastWifiAttempt < WIFI_RETRY_MS) return;

  lastWifiAttempt = millis();
  Serial.print("WIFI:Connecting ");
  Serial.println(WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
}
#endif

// * --- LAB LOGIC ---
void runLabLogic() {
  unsigned long t = millis() - labStartTime;
  float t_sec = t / 1000.0;
  
  // * LAB 1: Drag Race (Pos vs Time)
  if (currentLab == 1) {
    // Profile: Accel (0-2s), Coast (2-3s), Stop (>3s)
    if (t < 2000) moveForward(150 + (t/20)); // Ramp speed
    else if (t < 3000) moveForward(255);
    else stopMotors();
    
    // Log Data (10Hz)
    if (millis() - lastLogTime > 100) {
      float d = getRawDistance(); // Now returns float
      Serial.print(t_sec); Serial.print(","); Serial.println(d);
      lastLogTime = millis();
    }
    
    if (t > 4000) { stopMotors(); currentLab = 0; } // End
  }

  // * LAB 2: Braking
  else if (currentLab == 2) {
    static float lastDist = 0; // Changed to float
    if (t < 1500) moveForward(255);
    else stopMotors();
    
    if (millis() - lastLogTime > 100) {
      float d = getRawDistance(); // Now returns float
      if (lastDist == 0) lastDist = d;
      float v = (d - lastDist) / 0.1; 
      lastDist = d;
      if (abs(v) < 500) {
        Serial.print(t_sec); Serial.print(","); Serial.println(v);
      }
      lastLogTime = millis();
    }
    if (t > 3000) { stopMotors(); currentLab = 0; }
  }

  // * LAB 3: Oscillator (Heading/Power vs Time)
  else if (currentLab == 3) {
    // Snake Pattern
    float val = sin(t_sec * 3.0) * 100; // Amplitude 100, Freq ~0.5Hz
    
    int pLeft = 150 + val;
    int pRight = 150 - val;
    
    // Motor Control directly
    analogWrite(ENA, constrain(pLeft, 0, 255));
    analogWrite(ENB, constrain(pRight, 0, 255));
    digitalWrite(IN1, HIGH); digitalWrite(IN2, LOW);
    digitalWrite(IN3, HIGH); digitalWrite(IN4, LOW);
    
    if (millis() - lastLogTime > 100) {
      // Log "Offset" (Simulated by the sine value being driven)
      Serial.print(t_sec); Serial.print(","); Serial.println(val);
      lastLogTime = millis();
    }
    
    if (t > 5000) { stopMotors(); currentLab = 0; }
  }

  // * LAB 4: Radar Trap (Stationary)
  else if (currentLab == 4) {
    stopMotors(); 
    if (millis() - lastLogTime > 100) { // 10Hz
       float h = getFilteredDistance(); 
       Serial.print(t_sec); Serial.print(","); Serial.println(h, 2); // 2 decimal places
       lastLogTime = millis();
    }
    // No auto-stop. User must press Stop on UI.
  }

  // * LAB 5: Harmonic Motion (Stationary)
  else if (currentLab == 5) {
    stopMotors();
    if (millis() - lastLogTime > 100) { // 10Hz
       float y = getFilteredDistance(); 
       Serial.print(t_sec); Serial.print(","); Serial.println(y, 2); // 2 decimal places
       lastLogTime = millis();
    }
    // No auto-stop. User must press Stop on UI.
  }
}

// * --- FILTERING LOGIC ---

float getFilteredDistance() {
  float readings[3];
  for (int i = 0; i < 3; i++) { readings[i] = getRawDistance(); delay(30); }
  // Simple Bubble Sort
  if (readings[0] > readings[1]) { float t = readings[0]; readings[0] = readings[1]; readings[1] = t; }
  if (readings[1] > readings[2]) { float t = readings[1]; readings[1] = readings[2]; readings[2] = t; }
  if (readings[0] > readings[1]) { float t = readings[0]; readings[0] = readings[1]; readings[1] = t; }
  return readings[1]; 
}

float getRawDistance() {

  digitalWrite(TRIG, LOW); delayMicroseconds(2);

  digitalWrite(TRIG, HIGH); delayMicroseconds(10);

  digitalWrite(TRIG, LOW);

  long duration = pulseIn(ECHO, HIGH, 30000);

  if (duration == 0) return 400.0; 

  float cm = duration * 0.0343 / 2.0;

  if (cm < 2.0) return 400.0; 

  if (cm > 400.0) return 400.0;

  return cm;

}

// * --- MOTOR FUNCTIONS ---

void moveForward(int speed) {
  analogWrite(ENA, speed);
  analogWrite(ENB, speed);
  digitalWrite(IN1, HIGH);
  digitalWrite(IN2, LOW);
  digitalWrite(IN3, HIGH);
  digitalWrite(IN4, LOW);
}

void moveBackward(int speed) {
  analogWrite(ENA, speed);
  analogWrite(ENB, speed);
  digitalWrite(IN1, LOW);
  digitalWrite(IN2, HIGH);
  digitalWrite(IN3, LOW);
  digitalWrite(IN4, HIGH);
}

void turnLeft(int speed) {
  analogWrite(ENA, speed);
  analogWrite(ENB, speed);
  digitalWrite(IN1, LOW);
  digitalWrite(IN2, HIGH);
  digitalWrite(IN3, HIGH);
  digitalWrite(IN4, LOW);
}

void turnRight(int speed) {
  analogWrite(ENA, speed);
  analogWrite(ENB, speed);
  digitalWrite(IN1, HIGH);
  digitalWrite(IN2, LOW);
  digitalWrite(IN3, LOW);
  digitalWrite(IN4, HIGH);
}

void stopMotors() {
  digitalWrite(ENA, LOW);
  digitalWrite(ENB, LOW);
  digitalWrite(IN1, LOW);
  digitalWrite(IN2, LOW);
  digitalWrite(IN3, LOW);
  digitalWrite(IN4, LOW);
}
