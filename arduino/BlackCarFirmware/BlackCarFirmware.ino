/*
  Black Car - Basic Motor Test & Obstacle Avoidance
  Target: Elegoo Smart Robot Car V3.0 (Arduino Uno R3)
  
  Pinout (L298N Shield Standard):
  - ENA (PWM Left): 5
  - ENB (PWM Right): 6
  - IN1 (Left A): 7
  - IN2 (Left B): 8
  - IN3 (Right A): 9
  - IN4 (Right B): 11
  
  - Ultrasonic Trig: A5 (Analog 5 used as Digital)
  - Ultrasonic Echo: A4 (Analog 4 used as Digital)
*/

// Motor Pins
#define ENA 5
#define ENB 6
#define IN1 7 // Reverted to Original (Forward)
#define IN2 8 // Reverted to Original
#define IN3 11 // Swapped (Fixing Right Motor)
#define IN4 9  // Swapped (Fixing Right Motor)

// Ultrasonic Pins (V3.0 Shield Default often uses A5/A4 for Echo/Trig)
#define TRIG A5
#define ECHO A4

// State Variables
char command = 'S';
int speed = 150;
int turnSpeed = 220; // Increased for better torque on turns
bool autoMode = false;

void setup() {
  Serial.begin(9600);
  
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

  stopMotors();
  Serial.println("READY"); 
}

void loop() {
  // 1. Process Incoming Commands
  if (Serial.available() > 0) {
    command = Serial.read();
    
    // Debug: Confirm we heard the command
    Serial.print("CMD:");
    Serial.println(command);

    // Simple Protocol: F=Fwd, B=Back, L=Left, R=Right, S=Stop, A=Auto, M=Manual
    if (command == 'F') { moveForward(speed); autoMode = false; }
    else if (command == 'B') { moveBackward(speed); autoMode = false; }
    else if (command == 'L') { turnLeft(turnSpeed); autoMode = false; }
    else if (command == 'R') { turnRight(turnSpeed); autoMode = false; }
    else if (command == 'S') { stopMotors(); autoMode = false; }
    else if (command == 'A') { autoMode = true; }
    else if (command == 'M') { autoMode = false; stopMotors(); }
  }

  // 2. Continuous Tasks
  int distance = getFilteredDistance();
  
  // Send Telemetry (Throttle to ~10Hz to avoid flooding)
  static unsigned long lastTelem = 0;
  if (millis() - lastTelem > 100) {
    Serial.print("D:");
    Serial.println(distance);
    lastTelem = millis();
  }

  // 3. Auto Mode Logic
  if (autoMode) {
    if (distance < 25 && distance > 0) {
      stopMotors();
      delay(200);
      moveBackward(150);
      delay(300);
      turnLeft(180);
      delay(400);
    } else {
      moveForward(120);
    }
  }
  
  delay(10);
}

// --- FILTERING LOGIC ---

int getFilteredDistance() {
  int readings[3];
  
  // Take 3 readings
  for (int i = 0; i < 3; i++) {
    readings[i] = getRawDistance();
    delay(5); // Slight pause between pings to prevent echo overlap
  }

  // Simple Bubble Sort to find Median
  if (readings[0] > readings[1]) { int t = readings[0]; readings[0] = readings[1]; readings[1] = t; }
  if (readings[1] > readings[2]) { int t = readings[1]; readings[1] = readings[2]; readings[2] = t; }
  if (readings[0] > readings[1]) { int t = readings[0]; readings[0] = readings[1]; readings[1] = t; }

  return readings[1]; // Return Median
}

int getRawDistance() {
  digitalWrite(TRIG, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG, LOW);
  
  // Timeout: 30,000us (~5 meters max) to prevent blocking
  long duration = pulseIn(ECHO, HIGH, 30000);
  
  if (duration == 0) return 400; // Timeout (Too far)
  
  int cm = duration * 0.034 / 2;
  if (cm > 400) return 400;
  return cm;
}
// Remove old getDistance
// int getDistance() { ... }

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
