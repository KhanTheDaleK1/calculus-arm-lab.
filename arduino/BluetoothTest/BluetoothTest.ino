/*
 * Bluetooth HC-01/HC-05/HC-06 Serial Passthrough Test
 * 
 * Instructions:
 * 1. Upload this sketch to your Arduino Uno.
 * 2. Open the Serial Monitor (Tools -> Serial Monitor).
 * 3. Set Serial Monitor baud rate to 115200.
 * 4. Select "Both NL & CR" (Newline & Carriage Return).
 * 5. Type "AT" (if in AT mode) or pair with your phone and send text.
 * 
 * Pin Configuration (SoftwareSerial):
 * - BT TX  -> Arduino Pin 2 (RX)
 * - BT RX  -> Arduino Pin 3 (TX) through voltage divider if needed (3.3V logic)
 * 
 * Note: If using an ESP13 Shield, check if the BT header is tied to D0/D1. 
 * If so, you cannot use SoftwareSerial easily on those pins and might need
 * to unplug the shield to upload, then put the shield switch to "Run".
 */

#include <SoftwareSerial.h>

// * CONFIGURATION
// Change these if your shield uses different pins (e.g., 10/11)
const int BT_RX_PIN = 2; // Connect to Module TX
const int BT_TX_PIN = 3; // Connect to Module RX
const int BT_BAUD   = 9600; // Default for HC-05/06

SoftwareSerial BTSerial(BT_RX_PIN, BT_TX_PIN); // RX, TX

void setup() {
  // * Start USB Serial (Debug)
  Serial.begin(115200);
  Serial.println("----------------------------------");
  Serial.println("  Bluetooth Serial Passthrough");
  Serial.println("  USB <--> Bluetooth Module");
  Serial.println("----------------------------------");
  Serial.print("BT RX Pin: "); Serial.println(BT_RX_PIN);
  Serial.print("BT TX Pin: "); Serial.println(BT_TX_PIN);
  Serial.print("BT Baud:   "); Serial.println(BT_BAUD);
  Serial.println("----------------------------------");

  // * Start Bluetooth Serial
  BTSerial.begin(BT_BAUD);
}

void loop() {
  // * 1. USB -> Bluetooth
  // Read from PC, send to BT
  if (Serial.available()) {
    char c = Serial.read();
    BTSerial.write(c);
  }

  // * 2. Bluetooth -> USB
  // Read from BT, send to PC
  if (BTSerial.available()) {
    char c = BTSerial.read();
    Serial.write(c);
  }
}
