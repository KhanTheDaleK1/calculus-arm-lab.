/**
 * CalculusArm Dynamics Lab - Core Logic (FK-first, v3.0)
 * - Configuration space (theta1/2/3) -> Task space (x,y,z) via forward kinematics
 * - Time-series plotting of Cartesian position
 * - Live linear regression (local linear approximation)
 * - Web Serial control + browser flasher with version display
 */

// --- STATE ---
let port, writer;
let keepReading = false;
let serialReader = null;
let readableStreamClosed = null;
let writableStreamClosed = null;

let state = {
    theta1: 90, // base (deg)
    theta2: 90, // shoulder (deg)
    theta3: 90, // elbow (deg)
    x: 0, y: 0, z: 0, // computed task-space (cm)
    recording: false,
    startTime: 0,
    history: { x: [], y: [], z: [], time: [] }
};

// Arm geometry (mm)
const L1 = 80; // upper link
const L2 = 80; // forearm link

const clamp = (v, min, max) => Math.min(Math.max(v, min), max);
const D2R = Math.PI / 180;
function getEl(id) {
    let el = document.getElementById(id);
    if (el) return el;
    // Fallbacks for legacy cached IDs
    if (id === 'slider-base') return document.getElementById('slider-x');
    if (id === 'slider-shoulder') return document.getElementById('slider-y');
    if (id === 'slider-elbow') return document.getElementById('slider-z');
    if (id === 'val-base') return document.getElementById('val-x');
    if (id === 'val-shoulder') return document.getElementById('val-y');
    if (id === 'val-elbow') return document.getElementById('val-z');
    return null;
}
const delay = (ms) => new Promise(res => setTimeout(res, ms));

// --- FORWARD KINEMATICS ---
function computeFK() {
    const t1 = state.theta1 * D2R;
    const t2 = state.theta2 * D2R;
    const t3 = state.theta3 * D2R;

    // Simple planar model: shoulder elevation t2, elbow relative to shoulder
    const r_planar = L1 * Math.cos(t2) + L2 * Math.cos(t2 + t3 - Math.PI / 2);
    const z_mm = L1 * Math.sin(t2) + L2 * Math.sin(t2 + t3 - Math.PI / 2);

    const x_mm = r_planar * Math.cos(t1);
    const y_mm = r_planar * Math.sin(t1);

    state.x = x_mm / 10;
    state.y = y_mm / 10;
    state.z = z_mm / 10;
}

function updateUI() {
    // send to serial if connected
    if (port && writer) {
        writer.write(`S:${state.theta1},${state.theta2},${state.theta3}\n`);
    }

    // task-space readout
    document.getElementById('out-x').textContent = state.x.toFixed(2);
    document.getElementById('out-y').textContent = state.y.toFixed(2);
    document.getElementById('out-z').textContent = state.z.toFixed(2);

    updatePlot(state.x, state.y, state.z);
}

function update() {
    const s1 = getEl('slider-base');
    const s2 = getEl('slider-shoulder');
    const s3 = getEl('slider-elbow');
    if (s1) state.theta1 = parseInt(s1.value, 10);
    if (s2) state.theta2 = parseInt(s2.value, 10);
    if (s3) state.theta3 = parseInt(s3.value, 10);

    const v1 = getEl('val-base');
    const v2 = getEl('val-shoulder');
    const v3 = getEl('val-elbow');
    if (v1) v1.textContent = `${state.theta1}°`;
    if (v2) v2.textContent = `${state.theta2}°`;
    if (v3) v3.textContent = `${state.theta3}°`;

    // FK
    computeFK();
    updateUI();
}

// --- PLOTTING ---
function initPlot() {
    const common = { mode: 'lines', type: 'scatter', line: { width: 2 } };
    const traceX = { ...common, x: [], y: [], name: 'x(t)', line: { color: '#ff4757' } };
    const traceY = { ...common, x: [], y: [], name: 'y(t)', line: { color: '#2ed573' } };
    const traceZ = { ...common, x: [], y: [], name: 'z(t)', line: { color: '#1e90ff' } };

    const layout = {
        title: 'Task Space Trajectory (Cartesian)',
        paper_bgcolor: '#1e1e1e',
        plot_bgcolor: '#121212',
        font: { color: '#e0e0e0', family: 'monospace' },
        xaxis: { title: 'Time (s)', gridcolor: '#333', zerolinecolor: '#666' },
        yaxis: { title: 'Position (cm)', gridcolor: '#333', zerolinecolor: '#666' },
        margin: { l: 50, r: 20, t: 40, b: 40 },
        legend: { orientation: 'h', y: 1.1 }
    };
    Plotly.newPlot('plot-container', [traceX, traceY, traceZ], layout, { responsive: true });
}

function updatePlot(x, y, z) {
    if (!state.recording) return;

    const t = (Date.now() - state.startTime) / 1000;

    // speed magnitude
    if (state.history.time.length > 0) {
        const lastIdx = state.history.time.length - 1;
        const dt = t - state.history.time[lastIdx];
        if (dt > 0.05) {
            const dx = x - state.history.x[lastIdx];
            const dy = y - state.history.y[lastIdx];
            const dz = z - state.history.z[lastIdx];
            const speed = Math.sqrt((dx*dx + dy*dy + dz*dz) / (dt*dt));
            const velEl = document.getElementById('math-vel');
            if (velEl) velEl.textContent = speed.toFixed(2);
        }
    }

    state.history.x.push(x);
    state.history.y.push(y);
    state.history.z.push(z);
    state.history.time.push(t);

    Plotly.extendTraces('plot-container', {
        x: [[t], [t], [t]],
        y: [[x], [y], [z]]
    }, [0, 1, 2]);

    updateFunctionDisplay();
}

// --- REGRESSION ---
function calculateRegression(times, values) {
    const n = times.length;
    if (n < 2) return { m: 0, b: 0 };
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    for (let i = 0; i < n; i++) {
        sumX += times[i];
        sumY += values[i];
        sumXY += times[i] * values[i];
        sumXX += times[i] * times[i];
    }
    const denom = (n * sumXX - sumX * sumX);
    if (denom === 0) return { m: 0, b: 0 };
    const m = (n * sumXY - sumX * sumY) / denom;
    const b = (sumY - m * sumX) / n;
    return { m, b };
}

function updateFunctionDisplay() {
    const sliceSize = 30;
    const len = state.history.time.length;
    if (len < 2) return;

    const startIdx = Math.max(0, len - sliceSize);
    const times = state.history.time.slice(startIdx);
    const xs = state.history.x.slice(startIdx);
    const ys = state.history.y.slice(startIdx);
    const zs = state.history.z.slice(startIdx);

    const modelX = calculateRegression(times, xs);
    const modelY = calculateRegression(times, ys);
    const modelZ = calculateRegression(times, zs);

    const fmtLine = (m, b) => `${m.toFixed(2)}t ${b >= 0 ? "+ " : "- "}${Math.abs(b).toFixed(2)}`;

    const fx = document.getElementById('func-x');
    const fy = document.getElementById('func-y');
    const fz = document.getElementById('func-z');
    if (fx) fx.textContent = `x(t) ≈ ${fmtLine(modelX.m, modelX.b)}`;
    if (fy) fy.textContent = `y(t) ≈ ${fmtLine(modelY.m, modelY.b)}`;
    if (fz) fz.textContent = `z(t) ≈ ${fmtLine(modelZ.m, modelZ.b)}`;
}

// --- SERIAL ---
async function initSerial() {
    if (!navigator.serial) {
        alert("Web Serial API not supported. Use Chrome/Edge.");
        return;
    }
    navigator.serial.addEventListener('connect', refreshPorts);
    navigator.serial.addEventListener('disconnect', refreshPorts);
    await refreshPorts();
}

let knownPorts = [];
async function refreshPorts() {
    try {
        knownPorts = await navigator.serial.getPorts();
        const selector = document.getElementById('serial-port-list');
        selector.innerHTML = '<option value="prompt">🔌 Add New Device...</option>';
        knownPorts.forEach((p, index) => {
            const { usbProductId, usbVendorId } = p.getInfo();
            const option = document.createElement('option');
            option.value = index;
            option.textContent = `Device ${index+1} (VID:${usbVendorId || "?"})`;
            selector.appendChild(option);
        });
        if (knownPorts.length > 0) selector.value = 0;
    } catch (e) {
        console.error("Error listing ports:", e);
    }
}

async function handleConnectClick() {
    const selector = document.getElementById('serial-port-list');
    if (port) { await handleDisconnect(); return; }
    try {
        if (selector.value === "prompt") {
            port = await navigator.serial.requestPort();
        } else {
            port = knownPorts[parseInt(selector.value, 10)];
        }
        await port.open({ baudRate: 115200 });

        const textEncoder = new TextEncoderStream();
        writableStreamClosed = textEncoder.readable.pipeTo(port.writable);
        writer = textEncoder.writable.getWriter();

        readLoop();

        document.getElementById('status-indicator').textContent = "Connected";
        document.getElementById('status-indicator').className = "status connected";
        const btn = document.getElementById('btn-open-port');
        btn.textContent = "Disconnect";
        btn.onclick = handleDisconnect;
        selector.disabled = true;
    } catch (err) {
        console.error(err);
        alert("Failed to open port. It might be busy.");
    }
}

async function handleDisconnect() {
    location.reload();
}

async function readLoop() {
    keepReading = true;
    const textDecoder = new TextDecoderStream();
    readableStreamClosed = port.readable.pipeTo(textDecoder.writable);
    serialReader = textDecoder.readable.getReader();
    try {
        while (keepReading) {
            const { value, done } = await serialReader.read();
            if (done) break;
            // Telemetry parsing could go here
        }
    } catch (error) {
        console.error(error);
    } finally {
        serialReader.releaseLock();
    }
}

// --- FLASHING ---
async function handleFlashClick() {
    if (!port) { alert("Connect to the Arduino first."); return; }
    const btn = document.getElementById('btn-flash');
    btn.disabled = true;
    btn.textContent = "⏳ Preparing...";
    try {
        keepReading = false;
        if (serialReader) { try { await serialReader.cancel(); } catch(_){} }
        if (writer) { try { await writer.close(); writer.releaseLock(); } catch(_){} }
        await delay(200);
        try { await port.close(); } catch(_){}

        await port.open({ baudRate: 115200 });

        let versionText = "Unknown";
        try {
            const vResp = await fetch('firmware/version.json?v=' + Date.now());
            if (vResp.ok) versionText = (await vResp.json()).revision;
        } catch(e){}

        btn.textContent = "⬇️ Downloading...";
        const resp = await fetch('firmware/latest.hex?v=' + Date.now());
        if (!resp.ok) throw new Error("Firmware not found.");
        const hex = await resp.text();

        btn.textContent = "🔄 Resetting...";
        const flasher = new STK500(port, { debug: false });
        await flasher.reset();

        btn.textContent = "🔥 Writing...";
        await flasher.flashHex(hex, (pct) => { btn.textContent = `🔥 Writing ${pct}%`; });

        alert(`✅ Success!\nRevision: ${versionText}`);
    } catch (err) {
        alert(`❌ Flash failed: ${err.message}`);
    } finally {
        location.reload();
    }
}

// --- INIT ---
window.addEventListener('load', () => {
    initSerial();
    initPlot();
    update();
});

['slider-base', 'slider-shoulder', 'slider-elbow'].forEach(id => {
    const el = getEl(id);
    if (el) el.addEventListener('input', update);
});
document.getElementById('btn-open-port').addEventListener('click', handleConnectClick);
const flashBtn = document.getElementById('btn-flash');
if (flashBtn) flashBtn.addEventListener('click', handleFlashClick);

document.getElementById('btn-record').addEventListener('click', () => {
    state.recording = !state.recording;
    const btn = document.getElementById('btn-record');
    if (state.recording) {
        btn.textContent = "⏹ Stop Recording";
        btn.style.backgroundColor = "#ff4757";
        state.startTime = Date.now();
        state.history = { x: [], y: [], z: [], time: [] };
    } else {
        btn.textContent = "🔴 Record Trajectory";
        btn.style.backgroundColor = "#333";
    }
});

document.getElementById('btn-clear').addEventListener('click', () => {
    state.history = { x: [], y: [], z: [], time: [] };
    initPlot();
    const fx = document.getElementById('func-x');
    const fy = document.getElementById('func-y');
    const fz = document.getElementById('func-z');
    if (fx) fx.textContent = "x(t) ≈ --";
    if (fy) fy.textContent = "y(t) ≈ --";
    if (fz) fz.textContent = "z(t) ≈ --";
    const velEl = document.getElementById('math-vel');
    if (velEl) velEl.textContent = "0.00";
});
