class LabController {
    constructor() {
        this.port = null;
        this.writer = null;
        this.isConnected = false;
        this.currentLab = -1;
        this.dataBuffer = [];
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
        const lines = data.split('\n');
        lines.forEach(line => {
            line = line.trim();
            if (line.length === 0) return;
            
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
        }
    }

    startRun() {
        if (!this.isConnected) return alert("Connect Robot First!");
        this.dataBuffer = []; 
        this.updateText();
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
        Plotly.update('plot-area', { x: [t], y: [y] });
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