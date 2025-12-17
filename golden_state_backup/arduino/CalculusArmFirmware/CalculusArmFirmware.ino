// CalculusArmFirmware.ino
// Firmware for CalculusArm Dynamics Lab
// Handles High-Speed Serial Communication for Web Control
// Controls 3 Servos (Base, Shoulder, Elbow) and reads HC-SR04

#include <Servo.h>

// * --- PIN CONFIGURATION ---
const int PIN_BASE     = 2;
const int PIN_SHOULDER = 3;
const int PIN_ELBOW    = 4;
const int PIN_TRIG     = 8;
const int PIN_ECHO     = 9;

// * --- SERVO OBJECTS ---
Servo baseServo;
Servo shoulderServo;
Servo elbowServo;

// * --- STATE VARIABLES ---
int targetBase = 90;
int targetShoulder = 90;
int targetElbow = 90;

// * --- TIMING ---
unsigned long lastTelemetryTime = 0;
const int TELEMETRY_INTERVAL = 100; // Send data every 100ms (10Hz)

void setup() {
  // 1. Initialize Serial at high speed for smooth plotting
  Serial.begin(115200); 
  
  // 2. Attach Servos
  // Use wider pulse widths so SG90 servos can sweep closer to the full 0–180 range.
  baseServo.attach(PIN_BASE, 500, 2400);
  shoulderServo.attach(PIN_SHOULDER, 500, 2400);
  elbowServo.attach(PIN_ELBOW, 500, 2400);

  // 3. Move to Home Position
  updateServos();

  // 4. Initialize Sonar
  pinMode(PIN_TRIG, OUTPUT);
  pinMode(PIN_ECHO, INPUT);

  Serial.println("READY:CalculusArm");
}

void loop() {
  // 1. Handle Incoming Commands
  if (Serial.available() > 0) {
    String command = Serial.readStringUntil('\n');
    parseCommand(command);
  }

  // 2. Send Telemetry
  if (millis() - lastTelemetryTime > TELEMETRY_INTERVAL) {
    sendTelemetry();
    lastTelemetryTime = millis();
  }
}

// * Command Format: "S:90,45,120" (Set Angles) 
void parseCommand(String cmd) {
  cmd.trim();
  if (cmd.startsWith("S:")) {
    // Remove "S:"
    cmd = cmd.substring(2);
    
    // Parse Ints
    int firstComma = cmd.indexOf(',');
    int secondComma = cmd.indexOf(',', firstComma + 1);
    
    if (firstComma > 0 && secondComma > 0) {
      int b = cmd.substring(0, firstComma).toInt();
      int s = cmd.substring(firstComma + 1, secondComma).toInt();
      int e = cmd.substring(secondComma + 1).toInt();
      
      // Constrain to safe limits (0-180)
      targetBase = constrain(b, 0, 180);
      targetShoulder = constrain(s, 0, 180);
      targetElbow = constrain(e, 0, 180);
      
      updateServos();
    }
  }
}

// * --- UPDATE SERVOS ---
void updateServos() {
  baseServo.write(targetBase);
  shoulderServo.write(targetShoulder);
  elbowServo.write(targetElbow);
}

// * --- SEND TELEMETRY ---
void sendTelemetry() {
  // Get Sonar Distance
  float dist = readSonar();
  
  // Format: DATA:Base,Shoulder,Elbow,Distance
  Serial.print("DATA:");
  Serial.print(targetBase);
  Serial.print(",");
  Serial.print(targetShoulder);
  Serial.print(",");
  Serial.print(targetElbow);
  Serial.print(",");
  Serial.println(dist);
}

// * --- READ SONAR ---
float readSonar() {
  digitalWrite(PIN_TRIG, LOW);
  delayMicroseconds(2);
  digitalWrite(PIN_TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(PIN_TRIG, LOW);
  
  long duration = pulseIn(PIN_ECHO, HIGH, 10000); // 10ms timeout (~1.7m max) 
  
  if (duration == 0) return -1.0;
  return (duration * 0.0343) / 2.0;
}