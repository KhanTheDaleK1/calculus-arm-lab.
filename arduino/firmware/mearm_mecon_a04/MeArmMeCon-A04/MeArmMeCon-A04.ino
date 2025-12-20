// MeArmMeCon-A04.ino
// Use with MeCon.exe Ver0.4 Windows software for MeArm motion control
// Vendor sketch for ArmUno/MeArm kits. Receives comma-separated servo angles
// (x, y, z, claw) at 9600 baud, ending with the character 'x'.

#include <Servo.h>

// MeArm has 3 servos
Servo xServo;    // base servo - left/right
Servo yServo;    // left side servo - forward/back
Servo zServo;    // right side servo - forward/back

// Servo position values (expects 1-180 deg)
int xPos;
int yPos;
int zPos;

void setup() {
  // Attach servos to pins (User specified 2,3,4,5)
  xServo.attach(2);
  yServo.attach(3);
  zServo.attach(4);

  // Initialize serial port
  Serial.begin(9600);
  // Debug: uncomment to send a banner on startup
  // Serial.print("*** MeCon Test V04 ***.");
}

void loop() {
  // Packet pattern: xVal,yVal,zVal,clawVal followed by 'x'
  while (Serial.available() > 0) {
    xPos = Serial.parseInt();
    yPos = Serial.parseInt();
    zPos = Serial.parseInt();

    // Detect end-of-packet marker 'x'
    if (Serial.read() == 'x') {
      xServo.write(xPos);
      yServo.write(yPos);
      zServo.write(zPos);
    }
  }
}
