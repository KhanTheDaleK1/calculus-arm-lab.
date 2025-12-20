/*
 * Elegoo Smart Robot Car V3.0 - Servo Test
 * Pin 3 is the standard servo pin on the Elegoo Shield.
 */

#include <Servo.h>

Servo myServo;
const int SERVO_PIN = 10;

void setup() {
  myServo.attach(SERVO_PIN);
  Serial.begin(9600);
  Serial.println("Servo Test Start");
}

void loop() {
  // Sweep 0 to 180
  Serial.println("Sweeping 0 -> 180");
  for (int pos = 0; pos <= 180; pos += 1) { 
    myServo.write(pos);              
    delay(15);                       
  }
  
  delay(500);
  
  // Sweep 180 to 0
  Serial.println("Sweeping 180 -> 0");
  for (int pos = 180; pos >= 0; pos -= 1) { 
    myServo.write(pos);              
    delay(15);                       
  }
  
  delay(500);
}
