/**
 * CalculusArm Dynamics Lab - Core Logic (v3.1 - Hotfix)
 * Fixes: ID Cache Crash, Math Units, Serial Binding
 */

// --- STATE ---
let port, writer;
let keepReading = false;
let serialReader = null;
let readableStreamClosed = null;
let writableStreamClosed = null;

let state = {
    theta1: 90, // Base
    theta2: 90, // Shoulder
    theta3: 90, // Elbow
    x: 0, y: 0, z: 0,
    recording: false,
    startTime: 0,
    history: { x: [], y: [], z: [], time: [] }
};

const L1 = 80;
const L2 = 80;
const D2R = Math.PI / 180; // Degrees to Radians

// --- HELPER: Safe DOM Element Retrieval ---
// Handles the "Old Cache" vs "New Code" conflict
function getEl(id) {
    let el = document.getElementById(id);
    if (el) return el;
    // Fallbacks for legacy IDs (Cache protection)
    if (id === 'slider-base') return document.getElementById('slider-x');
    if (id === 'slider-shoulder') return document.getElementById('slider-y');
    if (id === 'slider-elbow') return document.getElementById('slider-z');
    if (id === 'val-base') return document.getElementById('val-x');
    if (id === 'val-shoulder') return document.getElementById('val-y');
    if (id === 'val-elbow') return document.getElementById('val-z');
    return null; // Fail gracefully
}

// --- FORWARD KINEMATICS ---
function computeFK() {
    const t1 = state.theta1;
    const t2 = state.theta2;
    const t3 = state.theta3;

    // Geometric Model (Standard MeArm Layout)
    // Theta2 (Shoulder): 0=Horizontal, 90=Up
    // Theta3 (Elbow): 90=Right Angle to Humerus
    // Note: We use (t2 + t3 - 90) to linearize the forearm angle relative to horizon
    
    // R (Radius in Planar projection)
    const r_planar = (L1 * Math.cos(t2 * D2R)) + (L2 * Math.cos((t2 + t3 - 90) * D2R));
    
    // Z (Height)
    const z_mm = (L1 * Math.sin(t2 * D2R)) + (L2 * Math.sin((t2 + t3 - 90) * D2R));
    
    // X, Y (Cartesian Rotation of Base)
    // t1=90 is Forward (Y axis)
    const x_mm = r_planar * Math.cos(t1 * D2R);
    const y_mm = r_planar * Math.sin(t1 * D2R);

    // Convert to CM
    state.x = x_mm / 10;
    state.y = y_mm / 10;
    state.z = z_mm / 10;
}

function updateUI() {
    if (port && writer) {
        writer.write(`S:${state.theta1},${state.theta2},${state.theta3}\n`);
    }
    
    const outX = document.getElementById('out-x');
    const outY = document.getElementById('out-y');
    const outZ = document.getElementById('out-z');
    
    if(outX) outX.textContent = state.x.toFixed(2);
    if(outY) outY.textContent = state.y.toFixed(2);
    if(outZ) outZ.textContent = state.z.toFixed(2);
    
    updatePlot(state.x, state.y, state.z);
}

function update() {
    // Robust input reading
    const s1 = getEl('slider-base');
    const s2 = getEl('slider-shoulder');
    const s3 = getEl('slider-elbow');

    if (s1) state.theta1 = parseInt(s1.value, 10);
    if (s2) state.theta2 = parseInt(s2.value, 10);
    if (s3) state.theta3 = parseInt(s3.value, 10);
    
    const v1 = getEl('val-base');
    const v2 = getEl('val-shoulder');
    const v3 = getEl('val-elbow');

    if (v1) v1.textContent = state.theta1 + "°";
    if (v2) v2.textContent = state.theta2 + "°";
    if (v3) v3.textContent = state.theta3 + "°";
    
    computeFK();
    updateUI();
}

// --- MATH ---
function calculateRegression(times, values) {
    const n = times.length;
    if (n < 2) return { m: 0, b: 0 };
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    for (let i = 0; i < n; i++) {
        sumX += times[i]; sumY += values[i];
        sumXY += times[i] * values[i]; sumXX += times[i] * times[i];
    }
    const denom = (n * sumXX - sumX * sumX);
    if (denom === 0) return { m: 0, b: 0 };
    const m = (n * sumXY - sumX * sumY) / denom;
    const b = (sumY - m * sumX) / n;
    return { m, b };
}

function updateFunctionDisplay() {
    const slice = 30;
    const len = state.history.time.length;
    if (len < 2) return;
    const start = Math.max(0, len - slice);
    
    const times = state.history.time.slice(start);
    const xs = state.history.x.slice(start);
    const ys = state.history.y.slice(start);
    const zs = state.history.z.slice(start);

    const mx = calculateRegression(times, xs);
    const my = calculateRegression(times, ys);
    const mz = calculateRegression(times, zs);

    const fmt = (m, b) => `${m.toFixed(2)}t ${b >= 0 ? "+" : "-"} ${Math.abs(b).toFixed(2)}`;
    
    const fx = document.getElementById('func-x');
    const fy = document.getElementById('func-y');
    const fz = document.getElementById('func-z');
    
    if (fx) fx.textContent = `x(t) ≈ ${fmt(mx.m, mx.b)}`;
    if (fy) fy.textContent = `y(t) ≈ ${fmt(my.m, my.b)}`;
    if (fz) fz.textContent = `z(t) ≈ ${fmt(mz.m, mz.b)}`;
}

// --- PLOTTING ---
function initPlot() {
    const common = { mode: 'lines', type: 'scatter', line: { width: 2 } };
    const traceX = { ...common, x: [], y: [], name: 'x(t)', line: { color: '#ff4757' } };
    const traceY = { ...common, x: [], y: [], name: 'y(t)', line: { color: '#2ed573' } };
    const traceZ = { ...common, x: [], y: [], name: 'z(t)', line: { color: '#1e90ff' } };

    const layout = {
        title: 'Task Space Trajectory (x,y,z vs t)',
        paper_bgcolor: '#1e1e1e', plot_bgcolor: '#121212',
        font: { color: '#e0e0e0', family: 'monospace' },
        xaxis: { title: 'Time (s)', gridcolor: '#333' },
        yaxis: { title: 'Position (cm)', gridcolor: '#333' },
        margin: { l: 50, r: 20, t: 40, b: 40 },
        legend: { orientation: 'h', y: 1.1 }
    };
    Plotly.newPlot('plot-container', [traceX, traceY, traceZ], layout, {responsive: true});
}

function updatePlot(x, y, z) {
    if (!state.recording) return;
    const t = (Date.now() - state.startTime) / 1000;
    
    // Speed
    if (state.history.x.length > 0) {
        const last = state.history.x.length - 1;
        const dt = t - state.history.time[last];
        if (dt > 0.05) {
            const dx = x - state.history.x[last];
            const dy = y - state.history.y[last];
            const dz = z - state.history.z[last];
            const speed = Math.sqrt((dx*dx + dy*dy + dz*dz)/(dt*dt));
            const el = document.getElementById('math-vel');
            if(el) el.textContent = speed.toFixed(2);
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

// --- SERIAL & FLASHING ---
async function initSerial() {
    if (!('serial' in navigator)) return;
    try {
        const ports = await navigator.serial.getPorts();
        const drop = document.getElementById('serial-port-list');
        if (!drop) return;
        drop.innerHTML = '<option value="prompt">🔌 Add New Device...</option>';
        ports.forEach((p, i) => {
            const inf = p.getInfo();
            const opt = document.createElement('option');
            opt.value = i;
            opt.textContent = `Device ${i+1} (VID:${inf.usbVendorId||'?'})`;
            drop.appendChild(opt);
        });
        if(ports.length > 0) drop.value = 0;
    } catch(e) { console.warn(e); }
}

async function handleConnectClick() {
    const drop = document.getElementById('serial-port-list');
    const val = drop.value;
    if (port) { location.reload(); return; }
    try {
        if (val === 'prompt') port = await navigator.serial.requestPort();
        else port = (await navigator.serial.getPorts())[parseInt(val)];
        
        await port.open({ baudRate: 115200 });
        const enc = new TextEncoderStream();
        writableStreamClosed = enc.readable.pipeTo(port.writable);
        writer = enc.writable.getWriter();
        readLoop();
        
        document.getElementById('status-indicator').textContent = "Connected";
        document.getElementById('status-indicator').className = "status connected";
        const btn = document.getElementById('btn-open-port');
        btn.textContent = "Disconnect";
        drop.disabled = true;
    } catch(e) { alert(e); }
}

async function readLoop() {
    keepReading = true;
    const dec = new TextDecoderStream();
    readableStreamClosed = port.readable.pipeTo(dec.writable);
    serialReader = dec.readable.getReader();
    try {
        while(keepReading) {
            const { done } = await serialReader.read();
            if(done) break;
        }
    } catch(e){} finally { serialReader.releaseLock(); }
}

async function handleFlashClick() {
    if (!port) { alert("Connect first."); return; }
    const btn = document.getElementById('btn-flash');
    btn.disabled = true; btn.textContent = "⏳ Prep...";
    
    try {
        keepReading = false;
        if(serialReader) try{ await serialReader.cancel(); }catch(_){}
        if(writer) try{ await writer.close(); writer.releaseLock(); }catch(_){}
        await new Promise(r => setTimeout(r, 200));
        try{ await port.close(); }catch(_){}
        
        await port.open({ baudRate: 115200 });
        
        // Version
        let ver = "Unknown";
        try {
            const r = await fetch('firmware/version.json?v='+Date.now());
            if(r.ok) ver = (await r.json()).revision;
        } catch(_){}

        btn.textContent = "⬇️ DL...";
        const r = await fetch('firmware/latest.hex?v='+Date.now());
        if(!r.ok) throw new Error("No hex found");
        const hex = await r.text();

        btn.textContent = "🔥 Writing...";
        const flasher = new STK500(port, { debug: false });
        await flasher.reset();
        await flasher.flashHex(hex, (p) => btn.textContent = `🔥 ${p}%`);
        
        alert(`✅ Success!\nRev: ${ver}`);
    } catch(e) { alert("Error: " + e.message); }
    finally { location.reload(); }
}

// --- INIT (Crash Proof) ---
window.addEventListener('load', () => {
    initSerial();
    initPlot();
    update();
});

// Bind sliders safely
['slider-base', 'slider-shoulder', 'slider-elbow'].forEach(id => {
    const el = getEl(id);
    if (el) el.addEventListener('input', update);
});

// Bind Buttons safely
const btnConn = document.getElementById('btn-open-port');
if(btnConn) btnConn.addEventListener('click', handleConnectClick);

const btnFlash = document.getElementById('btn-flash');
if(btnFlash) btnFlash.addEventListener('click', handleFlashClick);

const btnRec = document.getElementById('btn-record');
if(btnRec) btnRec.addEventListener('click', () => {
    state.recording = !state.recording;
    if (state.recording) {
        btnRec.textContent = "⏹ Stop";
        btnRec.style.backgroundColor = "#ff4757";
        state.startTime = Date.now();
        // Clear history on new record? Optional.
        // state.history = { x: [], y: [], z: [], time: [] };
    } else {
        btnRec.textContent = "🔴 Record";
        btnRec.style.backgroundColor = "#333";
    }
});

const btnClear = document.getElementById('btn-clear');
if(btnClear) btnClear.addEventListener('click', () => {
    state.history = { x: [], y: [], z: [], time: [] };
    initPlot();
    const v = document.getElementById('math-vel');
    if(v) v.textContent = "0.00";
});
