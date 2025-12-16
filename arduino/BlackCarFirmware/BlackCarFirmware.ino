/*
  Black Car - Basic Motor Test & Obstacle Avoidance + Line Tracking
  Target: Elegoo Smart Robot Car V3.0 (Arduino Uno R3)
*/

// Motor Pins
#define ENA 5
#define ENB 6
#define IN1 7 // Reverted to Original (Forward)
#define IN2 8 // Reverted to Original
#define IN3 11 // Swapped (Fixing Right Motor)
#define IN4 9  // Swapped (Fixing Right Motor)

// Ultrasonic Pins
#define TRIG A5
#define ECHO A4

// Line Sensor Pins (Elegoo V3.0 Standard)
#define LINE_L 10
#define LINE_M 4
#define LINE_R 2

// State Variables
char command = 'S';
int speed = 150;
int turnSpeed = 220; 
bool autoMode = false;

// Function Prototypes
void moveForward(int speed);
void moveBackward(int speed);
void turnLeft(int speed);
void turnRight(int speed);
void stopMotors();
int getFilteredDistance();
int getRawDistance();

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
  
  pinMode(LINE_L, INPUT);
  pinMode(LINE_M, INPUT);
  pinMode(LINE_R, INPUT);

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

    if (command == 'F') { moveForward(speed); autoMode = false; }
    else if (command == 'B') { moveBackward(speed); autoMode = false; }
    else if (command == 'L') { turnLeft(turnSpeed); autoMode = false; }
    else if (command == 'R') { turnRight(turnSpeed); autoMode = false; }
    else if (command == 'S') { stopMotors(); autoMode = false; }
    else if (command == 'A') { autoMode = true; Serial.println("AUTO: LINE+AVOID"); }
    else if (command == 'M') { autoMode = false; stopMotors(); Serial.println("AUTO: OFF"); }
  }

  // 2. Read Sensors
  int distance = getFilteredDistance();
  int lVal = digitalRead(LINE_L);
  int mVal = digitalRead(LINE_M);
  int rVal = digitalRead(LINE_R);
  
  // Send Telemetry (~10Hz)
  static unsigned long lastTelem = 0;
  if (millis() - lastTelem > 100) {
    Serial.print("D:"); Serial.print(distance);
    Serial.print("|L:"); Serial.print(lVal); Serial.print(mVal); Serial.println(rVal);
    lastTelem = millis();
  }

  // 3. Auto Mode Logic (Line Tracking + Safety Stop)
  if (autoMode) {
    if (distance < 15 && distance > 0) {
      // Safety Stop
      stopMotors();
      // Serial.println("AUTO: OBSTACLE"); // Optional debug
    } 
    else {
      // Line Following Logic (Assuming HIGH = Black Line)
      if (mVal == HIGH) {
        moveForward(150); // Center on line -> Go
      } else if (lVal == HIGH) {
        turnLeft(turnSpeed); // Left on line -> Turn Left
      } else if (rVal == HIGH) {
        turnRight(turnSpeed); // Right on line -> Turn Right
      } else {
        // No line detected -> Stop
        stopMotors();
      }
    }
  }
  
  delay(10);
}

// --- FILTERING LOGIC ---

int getFilteredDistance() {
  int readings[3];
  
  // Take 3 readings with sufficient delay
  for (int i = 0; i < 3; i++) {
    readings[i] = getRawDistance();
    delay(30); 
  }

  // Simple Bubble Sort
  if (readings[0] > readings[1]) { int t = readings[0]; readings[0] = readings[1]; readings[1] = t; }
  if (readings[1] > readings[2]) { int t = readings[1]; readings[1] = readings[2]; readings[2] = t; }
  if (readings[0] > readings[1]) { int t = readings[0]; readings[0] = readings[1]; readings[1] = t; }

  return readings[1]; 
}

int getRawDistance() {
  digitalWrite(TRIG, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG, LOW);
  
  long duration = pulseIn(ECHO, HIGH, 30000);
  
  if (duration == 0) return 400; 
  
  int cm = duration * 0.034 / 2;
  
  if (cm < 5) return 400; 
  if (cm > 400) return 400;
  
  return cm;
}

// --- MOTOR FUNCTIONS ---

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