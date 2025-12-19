// SonarTest.ino
// Basic test for HC-SR04 Ultrasonic Sensor on Pins 6 (Trig) and 7 (Echo).

const int trigPin = 6;
const int echoPin = 7;

void setup() {
  Serial.begin(9600);
  pinMode(trigPin, OUTPUT);
  pinMode(echoPin, INPUT);
  Serial.println("--- HC-SR04 Sonar Test ---");
}

void loop() {
  // Clear the trigger
  digitalWrite(trigPin, LOW);
  delayMicroseconds(2);

  // Send a 10 microsecond pulse
  digitalWrite(trigPin, HIGH);
  delayMicroseconds(10);
  digitalWrite(trigPin, LOW);

  // Read the echo pin (returns duration in microseconds)
  long duration = pulseIn(echoPin, HIGH);

  // Calculate distance in cm (Speed of sound ~343m/s)
  // Distance = (Time * Speed) / 2
  long distanceCm = duration * 0.034 / 2;

  Serial.print("Distance: ");
  Serial.print(distanceCm);
  Serial.println(" cm");

  delay(500); // Check twice a second
}
