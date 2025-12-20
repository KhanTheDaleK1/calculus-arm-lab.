// SonarRobust.ino
// Advanced driver for HC-SR04 on Pins 5 (Trig) and 6 (Echo).
// Features: Signal Filtering, Timeout Handling, Calibration constants.

// --- CONFIGURATION ---
const int PIN_TRIG = 8;
const int PIN_ECHO = 9;

// Physics Constants
// Speed of sound at 20C ~= 343 m/s = 0.0343 cm/us
const float SPEED_OF_SOUND_CM_US = 0.0343;
const int MAX_DISTANCE_CM = 500; // Increased limit
const unsigned long TIMEOUT_US = 30000; // Increased timeout

// Filtering
const int NUM_SAMPLES = 5; // Rolling average window

void setup() {
  Serial.begin(9600);
  while (!Serial); // Wait for serial
  
  pinMode(PIN_TRIG, OUTPUT);
  pinMode(PIN_ECHO, INPUT);
  
  Serial.println("--- SYSTEM START: HC-SR04 DIAGNOSTIC ---");
  Serial.print("PIN_TRIG: "); Serial.println(PIN_TRIG);
  Serial.print("PIN_ECHO: "); Serial.println(PIN_ECHO);
  Serial.println("Logic: 5-Sample Moving Average | Timeout: enabled");
  Serial.println("----------------------------------------");
  delay(1000);
}

float getRawDistance() {
  // 1. Clear Trigger
  digitalWrite(PIN_TRIG, LOW);
  delayMicroseconds(2);

  // 2. Generate precise 10us Pulse
  digitalWrite(PIN_TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(PIN_TRIG, LOW);

  // 3. Measure Echo (with timeout)
  long duration = pulseIn(PIN_ECHO, HIGH, TIMEOUT_US);

  // 4. Error Handling
  if (duration == 0) {
    return -1.0; // Timeout / No Echo
  }

  // 5. Calculate Distance
  // Distance = (Time * Speed) / 2 (round trip)
  return (duration * SPEED_OF_SOUND_CM_US) / 2.0;
}

void loop() {
  float total = 0;
  int validSamples = 0;
  
  // Collect Samples
  for (int i = 0; i < NUM_SAMPLES; i++) {
    float reading = getRawDistance();
    if (reading > 0) {
      total += reading;
      validSamples++;
    }
    delay(10); // Short delay between bursts (Optimize Frequency)
  }

  Serial.print("Status: ");
  if (validSamples > 0) {
    float average = total / validSamples;
    Serial.print("OK   | Samples: ");
    Serial.print(validSamples);
    Serial.print("/");
    Serial.print(NUM_SAMPLES);
    Serial.print(" | Dist: ");
    Serial.print(average, 2); // 2 decimal places
    Serial.println(" cm");
  } else {
    Serial.println("FAIL | No Echo / Out of Range");
  }

  delay(200); // 5Hz Refresh Rate (Human readable)
}
