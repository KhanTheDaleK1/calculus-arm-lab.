// MeArmServoTest.ino
// Gentle servo sweep test for MeArm/ArmUno pins (11,10,9,6)
// This replaces the MeCon firmware while loaded; re-flash MeArmMeCon-A04 to return to normal.
// Sweeps within a conservative range to avoid hitting mechanical end-stops.

#include <Servo.h>

Servo xServo;   // base
Servo yServo;   // left shoulder
Servo zServo;   // right shoulder


// Conservative angle limits; adjust if your arm can safely travel farther
const int MIN_ANGLE = 40;
const int MAX_ANGLE = 140;
const int STEP = 5;
const int DWELL_MS = 300;
const int GRIP_MIN = 60;  // tweak for your claw closed position
const int GRIP_MAX = 120; // tweak for your claw open position

void attachServos() {
  xServo.attach(2);
  yServo.attach(3);
  zServo.attach(4);
}

void setup() {
  attachServos();
  // Park at mid positions
  int mid = (MIN_ANGLE + MAX_ANGLE) / 2;
  xServo.write(mid);
  yServo.write(mid);
  zServo.write(mid);
  delay(1000);
}

void sweepServo(Servo &s, int from, int to, int step, int dwell) {
  if (from < to) {
    for (int a = from; a <= to; a += step) {
      s.write(a);
      delay(dwell);
    }
  } else {
    for (int a = from; a >= to; a -= step) {
      s.write(a);
      delay(dwell);
    }
  }
}

void loop() {
  // Base sweep
  sweepServo(xServo, MIN_ANGLE, MAX_ANGLE, STEP, DWELL_MS);
  sweepServo(xServo, MAX_ANGLE, MIN_ANGLE, STEP, DWELL_MS);

  // Shoulder left/right alternating to keep torque balanced
  sweepServo(yServo, MIN_ANGLE, MAX_ANGLE, STEP, DWELL_MS);
  sweepServo(zServo, MIN_ANGLE, MAX_ANGLE, STEP, DWELL_MS);
  sweepServo(yServo, MAX_ANGLE, MIN_ANGLE, STEP, DWELL_MS);
  sweepServo(zServo, MAX_ANGLE, MIN_ANGLE, STEP, DWELL_MS);

  // Pause between cycles
  delay(500);
}
