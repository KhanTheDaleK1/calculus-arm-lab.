// MeArmServoDiag.ino
// One-shot diagnostic: moves each servo to mid, min, max, then parks at mid.
// Pins: 11 (base), 10 (left shoulder), 9 (right shoulder), 6 (claw)
// LED on pin 13 blinks every second to confirm the sketch is running.
// Power: use a proper 5–6V servo supply; share GND with the Uno.

#include <Servo.h>

Servo sBase;
Servo sLeft;
Servo sRight;
Servo sClaw;

const int MIN_ANGLE = 30;
const int MID_ANGLE = 90;
const int MAX_ANGLE = 150;
const int CLAMP_MIN = 50;   // claw closed-ish
const int CLAMP_MAX = 130;  // claw open-ish

const int LED_PIN = 13;
bool ledState = false;

void attachServos() {
  sBase.attach(11);
  sLeft.attach(10);
  sRight.attach(9);
  sClaw.attach(6);
}

void moveServo(Servo &s, int angle, int holdMs) {
  s.write(angle);
  delay(holdMs);
}

void setup() {
  pinMode(LED_PIN, OUTPUT);
  attachServos();

  // Mid position park
  moveServo(sBase, MID_ANGLE, 500);
  moveServo(sLeft, MID_ANGLE, 500);
  moveServo(sRight, MID_ANGLE, 500);
  moveServo(sClaw, (CLAMP_MIN + CLAMP_MAX) / 2, 500);

  // Sweep each axis through min/mid/max
  moveServo(sBase, MIN_ANGLE, 600);
  moveServo(sBase, MAX_ANGLE, 600);
  moveServo(sBase, MID_ANGLE, 600);

  moveServo(sLeft, MIN_ANGLE, 600);
  moveServo(sLeft, MAX_ANGLE, 600);
  moveServo(sLeft, MID_ANGLE, 600);

  moveServo(sRight, MIN_ANGLE, 600);
  moveServo(sRight, MAX_ANGLE, 600);
  moveServo(sRight, MID_ANGLE, 600);

  moveServo(sClaw, CLAMP_MIN, 600);
  moveServo(sClaw, CLAMP_MAX, 600);
  moveServo(sClaw, (CLAMP_MIN + CLAMP_MAX) / 2, 600);
}

void loop() {
  // Blink LED to show the sketch is alive; hold servos at last positions
  ledState = !ledState;
  digitalWrite(LED_PIN, ledState ? HIGH : LOW);
  delay(1000);
}
