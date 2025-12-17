import serial
import time

try:
    # // TODO: Make serial port configurable via CLI argument.
    ser = serial.Serial('/dev/ttyACM0', 9600, timeout=1)
    # // HACK: Wait for Arduino auto-reset/reboot after serial connection.
    time.sleep(2) # Wait for reboot
    
    print("Sending Forward Command...")
    ser.write(b'F') # Send 'F'
    
    start = time.time()
    while time.time() - start < 3:
        if ser.in_waiting:
            line = ser.readline().decode('utf-8', errors='ignore').strip()
            print(f"Received: {line}")

    print("Sending Stop...")
    ser.write(b'S')

except Exception as e:
    print(f"Error: {e}")
