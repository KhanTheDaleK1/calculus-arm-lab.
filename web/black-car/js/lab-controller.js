class LabController {
    constructor() {
        this.port = null;
        this.writer = null;
        this.isConnected = false;
        this.currentLab = -1;
        this.dataBuffer = [];
        this.serialBuffer = "";
        this.smoothingWindowSize = 5; // Moving average for display
        this.filterState = { window: [], max: 11, lastValid: null, lastTime: null }; // Median/MAD + EMA filter for radar
        
        // SOP Content
        this.sopData = {
            1: "<h3>Lab 1: Drag Race (Average vs Instant Speed)</h3><ul><li>Setup: Straight floor lane.</li><li>Press START: robot accelerates ~2s, coasts, then stops.</li><li>Look at position-time curve; find slope at steepest point (instant speed) and compare to average speed.</li></ul>",
            2: "<h3>Lab 2: Braking Distance (Integrals)</h3><ul><li>Setup: Straight lane, clear path.</li><li>Press START: robot jumps to top speed, then brakes.</li><li>Integrate velocity-time curve to estimate stopping distance; compare to measured distance.</li></ul>",
            3: "<h3>Lab 3: Trig Oscillator</h3><ul><li>Setup: Open space.</li><li>Press START: robot weaves in a sine-like path.</li><li>Fit y = A·sin(Bx); discuss amplitude and wavelength vs motor commands.</li></ul>",
            4: "<h3>Lab 4: Radar Trap (Related Rates)</h3><ul><li>Setup: Robot stays still, facing walking path ~perpendicular.</li><li>Press START, walk past at steady speed.</li><li>Use distance-time to infer lateral speed; note 15° sensor cone.</li></ul>",
            5: "<h3>Lab 5: Harmonic Motion</h3><ul><li>Setup: Robot still, sensor aimed at bouncing mass.</li><li>Press START while mass oscillates.</li><li>Compare displacement and acceleration signs; discuss a(t) ≈ -ω²·y(t).</li></ul>"
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
                const yRaw = parseFloat(parts[1]);
                
                // Filter out obviously bad parses (e.g. if t is NaN or y is NaN)
                if (!isNaN(t) && !isNaN(yRaw)) {
                    const y = (this.currentLab === 4) ? this.filterRadarSample(yRaw, t) : yRaw;
                    if (y === null) return;
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
        if (!el) return;
        el.innerText = msg;
        el.className = msg.includes("Connected") ? "status-badge success" : "status-badge warn";
    }

    // --- LAB LOGIC ---

    setLab(id) {
        this.currentLab = id;
        this.dataBuffer = [];
        this.filterState = { window: [], max: 11, lastValid: null, lastTime: null };
        this.smoothingWindowSize = (id === 4) ? 9 : 5;
        
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

    // --- FILTERING (Radar Trap) ---

    filterRadarSample(y, t) {
        // Drop clearly invalid echoes (no echo / far wall)
        if (y <= 2 || y >= 380) return this.filterState.lastValid;

        const w = this.filterState.window;
        w.push(y);
        if (w.length > this.filterState.max) w.shift();

        const med = this.median(w);
        const deviations = w.map(v => Math.abs(v - med));
        const mad = this.median(deviations);

        // Hampel-style rejection: tolerate rapid human motion but drop spikes
        const guard = mad < 1 ? 1 : mad; // Prevent divide-by-zero
        const threshold = guard * 3.0 + 8; // Scales with dispersion, small bias
        const last = this.filterState.lastValid;

        // If it's a big jump from both the median and last good point, reject
        const jumpFromLast = (last !== null) ? Math.abs(y - last) : 0;
        if (Math.abs(y - med) > threshold && (last === null || jumpFromLast > threshold)) {
            return last ?? med;
        }

        // Clamp impossible jumps even if median shifts
        const MAX_JUMP = 120; // cm between samples
        if (last !== null && jumpFromLast > MAX_JUMP) {
            return last;
        }

        // Gentle EMA to avoid step changes while following true motion
        const alpha = 0.45;
        const filtered = (last === null) ? y : (last + alpha * (y - last));
        this.filterState.lastValid = filtered;
        this.filterState.lastTime = t;
        return filtered;
    }

    median(arr) {
        if (!arr || arr.length === 0) return 0;
        const sorted = [...arr].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return (sorted.length % 2 === 0) ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
    }
}

const lab = new LabController();

// UI Bindings
document.getElementById('btn-connect').addEventListener('click', () => lab.connect());
document.getElementById('btn-run').addEventListener('click', () => lab.startRun());
document.getElementById('btn-export').addEventListener('click', () => {
    const txt = document.getElementById('data-output').value;
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(() => alert("Data copied!")).catch(() => {
            fallbackCopy();
        });
    } else {
        fallbackCopy();
    }
});

function fallbackCopy() {
    const ta = document.getElementById('data-output');
    ta.select();
    document.execCommand('copy');
    alert("Data copied!");
}

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

// Mode toggles
const labModeBtn = document.getElementById('btn-lab-mode');
const driveModeBtn = document.getElementById('btn-drive-mode');
if (labModeBtn) labModeBtn.addEventListener('click', () => lab.setLab(1));
if (driveModeBtn) driveModeBtn.addEventListener('click', () => lab.setLab(0));

// Init default to Lab 1
lab.setLab(1);

// Joke loader for Black Car
window.addEventListener('load', () => {
    const jokeEl = document.getElementById('car-joke-text');
    if (!jokeEl) return;
    const render = () => {
        if (window.mathJokes && window.mathJokes.length) {
            const j = window.mathJokes[Math.floor(Math.random() * window.mathJokes.length)];
            jokeEl.textContent = `"${j}"`;
        } else {
            setTimeout(render, 200);
        }
    };
    render();
});

// Wire Lab Guide button to open modal
window.addEventListener('load', () => {
    const guideBtn = document.getElementById('btn-sop');
    if (guideBtn) guideBtn.addEventListener('click', () => lab.showSOP());
});
