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

// Lab State
int currentLab = 0; // 0=None, 1=Drag, 2=Brake, 3=Osc
unsigned long labStartTime = 0;
unsigned long lastLogTime = 0;

// Function Prototypes
void moveForward(int speed);
void moveBackward(int speed);
void turnLeft(int speed);
void turnRight(int speed);
void stopMotors();
int getFilteredDistance();
int getRawDistance();
void runLabLogic();

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
  }

  // 2. Lab Execution
  if (currentLab > 0) {
    runLabLogic();
    return; // Skip normal telemetry/auto logic during Lab
  }

  // 2. Read Sensors
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
  
  // 4. Auto Mode Logic (Roam -> Line Capture -> Safety Stop)
  if (autoMode) {
    // Priority 1: Safety Stop (Close Obstacle)
    if (distance < 15 && distance > 0) {
      stopMotors();
    } 
    // Priority 2: Line Capture (If ANY sensor sees line)
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
    // Priority 3: Free Roam (Wander)
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

void runLabLogic() {
  unsigned long t = millis() - labStartTime;
  float t_sec = t / 1000.0;
  
  // LAB 1: Drag Race (Pos vs Time)
  if (currentLab == 1) {
    // Profile: Accel (0-2s), Coast (2-3s), Stop (>3s)
    if (t < 2000) moveForward(150 + (t/20)); // Ramp speed
    else if (t < 3000) moveForward(255);
    else stopMotors();
    
    // Log Data (10Hz)
    if (millis() - lastLogTime > 100) {
      int d = getRawDistance(); // Use Raw for speed, filtered might be too slow
      Serial.print(t_sec); Serial.print(","); Serial.println(d);
      lastLogTime = millis();
    }
    
    if (t > 4000) { stopMotors(); currentLab = 0; } // End
  }

  // LAB 2: Braking (Vel vs Time)
  else if (currentLab == 2) {
    static int lastDist = 0;
    
    // Profile: High Speed (0-1.5s), Brake (1.5s+)
    if (t < 1500) moveForward(255);
    else stopMotors();
    
    if (millis() - lastLogTime > 100) {
      int d = getRawDistance();
      // Calc Velocity (cm/s) = (d_new - d_old) / 0.1s
      // Note: Since sensor faces BACK, d increases as we move forward.
      // v = delta_d / delta_t
      if (lastDist == 0) lastDist = d; // Init
      
      float v = (d - lastDist) / 0.1; 
      lastDist = d;
      
      // Filter crazy spikes
      if (abs(v) < 500) {
        Serial.print(t_sec); Serial.print(","); Serial.println(v);
      }
      lastLogTime = millis();
    }
    
    if (t > 3000) { stopMotors(); currentLab = 0; }
  }

  // LAB 3: Oscillator (Heading/Power vs Time)
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

  // LAB 4: Radar Trap (Stationary Observer)
  else if (currentLab == 4) {
    // Robot is stationary. Just logging distance.
    stopMotors(); 
    
    if (millis() - lastLogTime > 100) {
       int h = getFilteredDistance(); 
       Serial.print(t_sec); Serial.print(","); Serial.println(h);
       lastLogTime = millis();
    }
    
    if (t > 20000) { stopMotors(); currentLab = 0; } // 20s run
  }
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