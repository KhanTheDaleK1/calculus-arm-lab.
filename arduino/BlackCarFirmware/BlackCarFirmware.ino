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
#define IN1 7
#define IN2 8
#define IN3 9
#define IN4 11

// Ultrasonic Pins (V3.0 Shield Default often uses A5/A4 for Echo/Trig)
#define TRIG A5
#define ECHO A4

// State Variables
char command = 'S';
int speed = 150;
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
    else if (command == 'L') { turnLeft(speed); autoMode = false; }
    else if (command == 'R') { turnRight(speed); autoMode = false; }
    else if (command == 'S') { stopMotors(); autoMode = false; }
    else if (command == 'A') { autoMode = true; }
    else if (command == 'M') { autoMode = false; stopMotors(); }
  }

  // 2. Continuous Tasks
  int distance = getDistance();
  
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

int getDistance() {
  digitalWrite(TRIG, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG, LOW);
  
  long duration = pulseIn(ECHO, HIGH);
  return duration * 0.034 / 2;
}
