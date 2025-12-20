// MeArmPark.ino
// Parks the 3-axis MeArm at a neutral position.

#include <Servo.h>

Servo xServo;    // Base servo
Servo yServo;    // Shoulder servo
Servo zServo;    // Elbow servo

const int PARK_ANGLE = 90; // Neutral position

void setup() {
  // Attach servos to the pins
  xServo.attach(2); // Base
  yServo.attach(3); // Shoulder
  zServo.attach(4); // Elbow

  // Park servos at a neutral angle
  xServo.write(PARK_ANGLE);
  yServo.write(PARK_ANGLE);
  zServo.write(PARK_ANGLE);
}

void loop() {
  // Do nothing, holding position
}
