class LabController {
    constructor() {
        this.port = null;
        this.writer = null;
        this.isConnected = false;
        this.currentLab = 0;
        this.dataBuffer = [];
        this.startTime = 0;
    }

    async connect() {
        if ("serial" in navigator) {
            try {
                this.port = await navigator.serial.requestPort();
                await this.port.open({ baudRate: 9600 });
                this.setupWriter();
                this.readLoop();
                this.isConnected = true;
                this.updateStatus("Connected");
                document.getElementById('btn-run').disabled = false;
            } catch (err) {
                console.error("Connection Error:", err);
                alert("Connection Failed: " + err.message);
            }
        } else {
            alert("Web Serial API not supported.");
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
                if (value) this.handleData(value);
            }
        } catch (error) {
            console.error("Read Error:", error);
        }
    }

    handleData(data) {
        // Expecting format: "DATA:time,value" or raw lines
        // For simplicity, let's assume the Arduino sends lines like "1.2,45.0"
        // We'll filter for numbers.
        
        const lines = data.split('\n');
        lines.forEach(line => {
            line = line.trim();
            if (line.length === 0) return;
            
            // Check if it looks like CSV "time,val"
            if (line.includes(',')) {
                const parts = line.split(',');
                if (parts.length >= 2) {
                    const t = parseFloat(parts[0]);
                    const y = parseFloat(parts[1]);
                    
                    if (!isNaN(t) && !isNaN(y)) {
                        this.dataBuffer.push({t, y});
                        this.updateGraph();
                        this.updateText();
                    }
                }
            }
        });
    }

    async send(cmd) {
        if (this.writer) await this.writer.write(cmd);
    }

    updateStatus(msg) {
        const el = document.getElementById('status-indicator');
        el.innerText = msg;
        el.className = "status connected";
    }

    // --- LAB LOGIC ---

    setLab(id) {
        this.currentLab = id;
        this.dataBuffer = []; // Clear data
        
        const titleEl = document.getElementById('lab-title');
        const runBtn = document.getElementById('btn-run');
        
        if (id === 1) {
            titleEl.innerHTML = "Lab 1: MVT Drag Race <span style='font-size:0.6em; color:#888;'>Position s(t)</span>";
            runBtn.innerText = "▶ START DRAG RACE";
            this.initGraph("Time (s)", "Position (cm)");
        } else if (id === 2) {
            titleEl.innerHTML = "Lab 2: Riemann Braking <span style='font-size:0.6em; color:#888;'>Velocity v(t)</span>";
            runBtn.innerText = "▶ START BRAKING TEST";
            this.initGraph("Time (s)", "Velocity (cm/s)");
        } else if (id === 3) {
            titleEl.innerHTML = "Lab 3: Trig Oscillator <span style='font-size:0.6em; color:#888;'>Offset y(x)</span>";
            runBtn.innerText = "▶ START OSCILLATOR";
            this.initGraph("Time (s)", "Offset (cm)");
        }
    }

    startRun() {
        if (!this.isConnected) return alert("Connect Robot First!");
        
        this.dataBuffer = []; // Reset data
        this.updateText();
        
        // Send command to firmware to start specific lab routine
        // Protocol: '1' -> Lab 1, '2' -> Lab 2, '3' -> Lab 3
        if (this.currentLab === 1) this.send('1');
        if (this.currentLab === 2) this.send('2');
        if (this.currentLab === 3) this.send('3');
    }

    // --- VISUALIZATION ---

    initGraph(xLabel, yLabel) {
        Plotly.newPlot('plot-area', [{
            x: [],
            y: [],
            mode: 'lines+markers',
            marker: {color: '#d05ce3'},
            line: {color: '#d05ce3'}
        }], {
            paper_bgcolor: '#000',
            plot_bgcolor: '#111',
            xaxis: { title: xLabel, color: '#888' },
            yaxis: { title: yLabel, color: '#888' },
            margin: { t: 20, r: 20, b: 40, l: 40 }
        });
    }

    updateGraph() {
        const t = this.dataBuffer.map(d => d.t);
        const y = this.dataBuffer.map(d => d.y);
        
        Plotly.update('plot-area', {
            x: [t],
            y: [y]
        });
    }

    updateText() {
        // Format for TI-84: Just simple CSV
        let txt = "Time,Value\n";
        this.dataBuffer.forEach(d => {
            txt += `${d.t.toFixed(2)},${d.y.toFixed(2)}\n`;
        });
        document.getElementById('data-output').value = txt;
    }
}

const lab = new LabController();

// UI Bindings
document.getElementById('btn-connect').addEventListener('click', () => lab.connect());
document.getElementById('btn-run').addEventListener('click', () => lab.startRun());
document.getElementById('btn-export').addEventListener('click', () => {
    const txt = document.getElementById('data-output');
    txt.select();
    document.execCommand('copy');
    alert("Data copied to clipboard!");
});

// Global function for HTML onclick
window.loadLab = (id) => lab.setLab(id);

// Init Default
lab.setLab(1);
