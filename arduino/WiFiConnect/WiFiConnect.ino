/*
 * Bluetooth Hardware Serial Test (Pins 0 & 1) - 9600 Baud
 * 
 * Instructions:
 * 1. UNPLUG SHIELD/BLUETOOTH.
 * 2. Upload this sketch.
 * 3. PLUG SHIELD BACK IN.
 * 4. Open Serial Monitor (9600 baud).
 */

void setup() {
  Serial.begin(9600); 
}

void loop() {
  if (Serial.available()) {
    char c = Serial.read();
    Serial.write(c);
  }
}