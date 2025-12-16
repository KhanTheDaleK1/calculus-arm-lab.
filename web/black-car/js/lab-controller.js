class LabController {
    constructor() {
        this.port = null;
        this.writer = null;
        this.isConnected = false;
        this.currentLab = -1;
        this.dataBuffer = [];
        this.serialBuffer = "";
        this.smoothingWindowSize = 5; // For a basic moving average smoothing
        
        // SOP Content
        this.sopData = {
            1: "<h3>Lab 1: MVT Drag Race</h3><b>Setup:</b> Place robot on a long straight track (floor).<br><b>Action:</b> Press Start. Robot accelerates for 2s, coasts, then stops.<br><b>Goal:</b> Analyze Position vs Time to find max velocity (MVT).",
            2: "<h3>Lab 2: Riemann Braking</h3><b>Setup:</b> Place robot on a long straight track.<br><b>Action:</b> Press Start. Robot hits max speed immediately, then brakes.<br><b>Goal:</b> Integrate Velocity vs Time (Riemann Sums) to find total distance.",
            3: "<h3>Lab 3: Trig Oscillator</h3><b>Setup:</b> Large open floor area required.<br><b>Action:</b> Press Start. Robot drives in a sinusoidal 'snake' pattern.<br><b>Goal:</b> Model the path as y = Asin(Bx).",
            4: "<h3>Lab 4: Radar Trap</h3><b>Setup:</b> Robot is STATIONARY. Place perpendicular to the walking path.<br><b>Action:</b> Press Start. Walk past the robot in a straight line.<br><b>Goal:</b> Use Related Rates to find dx/dt from dh/dt.<br><b>Note:</b> Stay within the 15° sensor cone!",
            5: "<h3>Lab 5: Harmonic Motion</h3><b>Setup:</b> Robot is STATIONARY facing UP (or sideways). Place oscillating weight directly in front of sensor.<br><b>Action:</b> Start weight bouncing. Press Start.<br><b>Goal:</b> Verify a(t) is proportional to -y(t)."
        };
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
        // Fix: Accumulate data in buffer
        this.serialBuffer += data;
        
        // Split by newline
        const lines = this.serialBuffer.split('\n');
        
        // Keep the last element (incomplete line) in the buffer
        this.serialBuffer = lines.pop(); 

        lines.forEach(line => {
            this.processLine(line.trim());
        });
    }

    processLine(data) {
        if (data.length === 0) return;

        // Handle Drive Mode Telemetry
        if (this.currentLab === 0) {
            // Distance
            if (data.includes("D:")) {
                const parts = data.split("D:");
                if (parts.length > 1) {
                    const valStr = parts[1].split("|")[0].trim();
                    const val = parseInt(valStr);
                    if (!isNaN(val)) document.getElementById('val-distance').innerText = val;
                }
            }
            // Line Sensors
            if (data.includes("L:")) {
                const parts = data.split("L:");
                if (parts.length > 1) {
                    const valStr = parts[1].trim(); 
                    if (valStr.length >= 3) {
                        const l = valStr[0] === '1' ? '⚫' : '⚪';
                        const m = valStr[1] === '1' ? '⚫' : '⚪';
                        const r = valStr[2] === '1' ? '⚫' : '⚪';
                        document.getElementById('val-line').innerText = `${l} ${m} ${r}`;
                    }
                }
            }
            return; 
        }

        // Handle Lab Mode Data (CSV)
        if (data.includes(',')) {
            const parts = data.split(',');
            if (parts.length >= 2) {
                const t = parseFloat(parts[0]);
                const y = parseFloat(parts[1]);
                
                // Filter out obviously bad parses (e.g. if t is NaN or y is NaN)
                if (!isNaN(t) && !isNaN(y)) {
                    this.dataBuffer.push({t, y});
                    this.updateGraph();
                    this.updateText();
                }
            }
        }
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
        this.dataBuffer = [];
        
        const titleEl = document.getElementById('lab-title');
        const runBtn = document.getElementById('btn-run');
        const labControls = document.getElementById('lab-controls');
        const plotArea = document.getElementById('plot-area');
        const dataSection = document.getElementById('data-section');
        const drivePanel = document.getElementById('drive-panel');
        
        // UI Switching
        if (id === 0) {
            // Drive Mode
            titleEl.innerText = "Free Drive Mode";
            labControls.style.display = 'none';
            plotArea.style.display = 'none';
            dataSection.style.display = 'none';
            drivePanel.style.display = 'flex';
            this.send('S'); // Stop any running lab
        } else {
            // Lab Mode
            labControls.style.display = 'flex';
            plotArea.style.display = 'block';
            dataSection.style.display = 'block';
            drivePanel.style.display = 'none';
            // Show SOP Button
            document.getElementById('btn-sop').style.display = 'inline-block';
        }
        
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
        } else if (id === 4) {
            titleEl.innerHTML = "Lab 4: Radar Trap <span style='font-size:0.6em; color:#888;'>Hypotenuse h(t)</span>";
            runBtn.innerText = "▶ START RADAR";
            this.initGraph("Time (s)", "Hypotenuse (cm)");
            document.getElementById('data-output').value = "WARNING: Max angle 15°. Keep track short. Don't sample faster than 20Hz.";
        } else if (id === 5) {
            titleEl.innerHTML = "Lab 5: Harmonic Motion <span style='font-size:0.6em; color:#888;'>Position y(t)</span>";
            runBtn.innerText = "▶ START MONITOR";
            this.initGraph("Time (s)", "Position (cm)");
            document.getElementById('data-output').value = "Place robot below weight. Ensure clear line of sight.";
        }
    }
    
    showSOP() {
        const modal = document.getElementById('sop-modal');
        const content = document.getElementById('sop-content');
        
        if (this.sopData[this.currentLab]) {
            content.innerHTML = this.sopData[this.currentLab];
        } else {
            content.innerHTML = "<h3>Instructions</h3><p>Select a lab to view instructions.</p>";
        }
        modal.style.display = "flex";
    }

    closeSOP() {
        document.getElementById('sop-modal').style.display = "none";
    }

    startRun() {
        if (!this.isConnected) return alert("Connect Robot First!");
        this.dataBuffer = []; 
        this.updateText();
        if (this.currentLab === 1) this.send('1');
        if (this.currentLab === 2) this.send('2');
        if (this.currentLab === 3) this.send('3');
        if (this.currentLab === 4) this.send('4');
        if (this.currentLab === 5) this.send('5');
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
        if (this.dataBuffer.length === 0) return;

        const t = this.dataBuffer.map(d => d.t);
        const rawY = this.dataBuffer.map(d => d.y);

        let smoothedY = [];
        if (rawY.length < this.smoothingWindowSize) {
            smoothedY = rawY; // Not enough data for smoothing yet
        } else {
            for (let i = 0; i < rawY.length; i++) {
                const start = Math.max(0, i - Math.floor(this.smoothingWindowSize / 2));
                const end = Math.min(rawY.length, i + Math.ceil(this.smoothingWindowSize / 2));
                const window = rawY.slice(start, end);
                const sum = window.reduce((a, b) => a + b, 0);
                smoothedY.push(sum / window.length);
            }
        }
        
        Plotly.update('plot-area', { x: [t], y: [smoothedY] });
    }

    updateText() {
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
    alert("Data copied!");
});

// Drive Bindings
const bindBtn = (id, cmd) => {
    const btn = document.getElementById(id);
    if(btn) {
        btn.addEventListener('mousedown', () => lab.send(cmd));
        btn.addEventListener('touchstart', (e) => { e.preventDefault(); lab.send(cmd); });
        btn.addEventListener('mouseup', () => lab.send('S'));
        btn.addEventListener('touchend', (e) => { e.preventDefault(); lab.send('S'); });
    }
};

bindBtn('btn-fwd', 'F');
bindBtn('btn-back', 'B');
bindBtn('btn-left', 'L');
bindBtn('btn-right', 'R');
bindBtn('btn-stop', 'S');

document.getElementById('btn-auto').addEventListener('click', () => lab.send('A'));
document.getElementById('btn-manual').addEventListener('click', () => lab.send('M'));

// Keyboard
document.addEventListener('keydown', (e) => {
    if (lab.currentLab !== 0) return; // Only drive in Drive Mode
    if (e.repeat) return;
    if (e.key === 'w' || e.key === 'ArrowUp') lab.send('F');
    if (e.key === 's' || e.key === 'ArrowDown') lab.send('B');
    if (e.key === 'a' || e.key === 'ArrowLeft') lab.send('L');
    if (e.key === 'd' || e.key === 'ArrowRight') lab.send('R');
});

document.addEventListener('keyup', (e) => {
    if (lab.currentLab !== 0) return;
    if (['w','s','a','d','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) {
        lab.send('S');
    }
});

// Global function
window.loadLab = (id) => lab.setLab(id);

// Init
lab.setLab(1);