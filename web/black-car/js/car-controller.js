class CarController {
    constructor() {
        this.port = null;
        this.writer = null;
        this.reader = null;
        this.isConnected = false;
        this.mode = 'USB'; // 'USB' or 'BLE'
    }

    // * Connect USB
    async connectUSB() {
        if ("serial" in navigator) {
            try {
                this.port = await navigator.serial.requestPort();
                await this.port.open({ baudRate: 9600 });
                this.setupWriter();
                this.readLoop();
                this.isConnected = true;
                this.mode = 'USB';
                this.updateStatus("Connected (USB)");
                return true;
            } catch (err) {
                console.error("USB Connection Error:", err);
                this.updateStatus("Error: " + err.message);
                return false;
            }
        } else {
            alert("Web Serial API not supported in this browser.");
            return false;
        }
    }

    // * Connect BLE
    async connectBLE() {
        // Standard HM-10 / HC-05 / HC-08 UUIDs
        // Service: 0000ffe0-0000-1000-8000-00805f9b34fb (0xFFE0)
        // Characteristic: 0000ffe1-0000-1000-8000-00805f9b34fb (0xFFE1)
        
        try {
            console.log("Requesting Bluetooth Device...");
            const device = await navigator.bluetooth.requestDevice({
                filters: [{ services: [0xFFE0] }], // Standard Serial Service
                optionalServices: [0xFFE0]
            });
            
            device.addEventListener('gattserverdisconnected', () => {
                this.isConnected = false;
                this.updateStatus("Disconnected (BLE)");
            });

            console.log("Connecting to GATT Server...");
            const server = await device.gatt.connect();

            console.log("Getting Service...");
            const service = await server.getPrimaryService(0xFFE0);

            console.log("Getting Characteristic...");
            this.characteristic = await service.getCharacteristic(0xFFE1);
            
            // Notification for incoming data
            await this.characteristic.startNotifications();
            this.characteristic.addEventListener('characteristicvaluechanged', (event) => {
                const decoder = new TextDecoder();
                this.handleData(decoder.decode(event.target.value));
            });

            this.isConnected = true;
            this.mode = 'BLE';
            this.updateStatus("Connected (BLE)");
            return true;
        } catch (err) {
            console.error("BLE Connection Error:", err);
            this.updateStatus("BLE Error: " + err.message);
            return false;
        }
    }

    setupWriter() {
        const encoder = new TextEncoderStream();
        const writableStreamClosed = encoder.readable.pipeTo(this.port.writable);
        this.writer = encoder.writable.getWriter();
    }

    async readLoop() {
        const decoder = new TextDecoderStream();
        const readableStreamClosed = this.port.readable.pipeTo(decoder.writable);
        const reader = decoder.readable.getReader();

        try {
            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                if (value) {
                    this.handleData(value);
                }
            }
        } catch (error) {
            console.error("Read Error:", error);
        }
    }

    handleData(data) {
        // Data format: "D:25|L:101" or separate lines "D:25" / "L:101"
        console.log("RX:", data);
        
        // * Parse Distance
        if (data.includes("D:")) {
            const parts = data.split("D:");
            if (parts.length > 1) {
                // Handle potential trailing chars if pipe is used
                const valStr = parts[1].split("|")[0].trim();
                const val = parseInt(valStr);
                if (!isNaN(val)) {
                    const el = document.getElementById('val-distance');
                    if (el) el.innerText = val;
                }
            }
        }

        // * Parse Line Sensors
        if (data.includes("L:")) {
            const parts = data.split("L:");
            if (parts.length > 1) {
                const valStr = parts[1].trim(); // "101"
                // Expecting 3 chars
                if (valStr.length >= 3) {
                    const l = valStr[0] === '1' ? '⚫' : '⚪';
                    const m = valStr[1] === '1' ? '⚫' : '⚪';
                    const r = valStr[2] === '1' ? '⚫' : '⚪';
                    
                    const el = document.getElementById('val-line');
                    if (el) el.innerText = `${l} ${m} ${r}`;
                }
            }
        }
    }

    async send(command) {
        if (!this.isConnected) return;

        console.log("TX:", command);

        if (this.mode === 'USB') {
            if (this.writer) {
                await this.writer.write(command);
            }
        } else if (this.mode === 'BLE') {
            const encoder = new TextEncoder();
            await this.characteristic.writeValue(encoder.encode(command));
        }
    }

    updateStatus(msg) {
        const el = document.getElementById('status-indicator');
        if (el) {
            el.innerText = msg;
            el.className = msg.includes("Connected") ? "status-badge success" : "status-badge warn";
        }
    }
}

const car = new CarController();

// * UI Bindings
document.getElementById('btn-connect-usb').addEventListener('click', () => car.connectUSB());
document.getElementById('btn-connect-ble').addEventListener('click', () => car.connectBLE());

// * Control Buttons
const bindBtn = (id, cmd) => {
    const btn = document.getElementById(id);
    if(btn) {
        // Mouse/Touch Down -> Start Move
        btn.addEventListener('mousedown', () => car.send(cmd));
        btn.addEventListener('touchstart', (e) => { e.preventDefault(); car.send(cmd); });
        
        // Mouse/Touch Up -> Stop
        btn.addEventListener('mouseup', () => car.send('S'));
        btn.addEventListener('touchend', (e) => { e.preventDefault(); car.send('S'); });
    }
};

bindBtn('btn-fwd', 'F');
bindBtn('btn-back', 'B');
bindBtn('btn-left', 'L');
bindBtn('btn-right', 'R');
bindBtn('btn-stop', 'S'); // Explicit Stop Button

// * Mode Toggles
document.getElementById('btn-auto').addEventListener('click', () => car.send('A'));
document.getElementById('btn-manual').addEventListener('click', () => car.send('M'));

// * Keyboard Controls
document.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (e.key === 'w' || e.key === 'ArrowUp') car.send('F');
    if (e.key === 's' || e.key === 'ArrowDown') car.send('B');
    if (e.key === 'a' || e.key === 'ArrowLeft') car.send('L');
    if (e.key === 'd' || e.key === 'ArrowRight') car.send('R');
});

document.addEventListener('keyup', (e) => {
    if (['w','s','a','d','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) {
        car.send('S');
    }
});