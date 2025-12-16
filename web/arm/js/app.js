/**
 * CalculusArm v5.0 - Platinum Edition
 * Consolidated Logic: Kinematics, Plotting, Serial, Flashing, Jokes
 */

// --- UTILS ---
function log(msg) {
    const box = document.getElementById('log-output');
    if(!box) return;
    const time = new Date().toLocaleTimeString();
    box.innerHTML += `<div>[${time}] ${msg}</div>`;
    box.scrollTop = box.scrollHeight;
}

function toggleLog() {
    const panel = document.getElementById('sys-log-panel');
    const icon = document.getElementById('log-icon');
    panel.classList.toggle('collapsed');
    icon.textContent = panel.classList.contains("collapsed") ? "🐨" : "▼";
}

// --- STATE ---
let port, writer;
let keepReading = false;
let serialReader = null;
let readableStreamClosed = null;
let writableStreamClosed = null;

let state = {
    theta1: 90, theta2: 90, theta3: 90,
    x: 0, y: 0, z: 0,
    recording: false,
    startTime: 0,
    liveBuffer: [],
    history: { x: [], y: [], z: [], time: [] }
};

const L1 = 80; 
const L2 = 80; 
const D2R = Math.PI / 180;

// --- KINEMATICS ---
function computeFK() {
    const t1 = state.theta1 * D2R;
    const t2 = state.theta2 * D2R;
    const t3 = (state.theta3 - 90) * D2R; 

    const r = (L1 * Math.cos(t2)) + (L2 * Math.cos(t2 + t3));
    const z = (L1 * Math.sin(t2)) + (L2 * Math.sin(t2 + t3));
    
    const x = r * Math.cos(t1);
    const y = r * Math.sin(t1);

    state.x = x / 10; 
    state.y = y / 10;
    state.z = z / 10;
}

function updateUI() {
    if (port && writer) {
        const cmd = `S:${state.theta1},${state.theta2},${state.theta3}\n`;
        writer.write(cmd).catch(err => log("Serial Error: "+err));
    }

    document.getElementById('out-x').textContent = state.x.toFixed(2);
    document.getElementById('out-y').textContent = state.y.toFixed(2);
    document.getElementById('out-z').textContent = state.z.toFixed(2);

    updateMath(state.x, state.y, state.z);
    updatePlot(state.x, state.y, state.z);
}

function update() {
    state.theta1 = parseInt(document.getElementById('slider-theta1').value);
    state.theta2 = parseInt(document.getElementById('slider-theta2').value);
    state.theta3 = parseInt(document.getElementById('slider-theta3').value);

    const showDegRad = (idDeg, idRad, val) => {
        document.getElementById(idDeg).textContent = val + "°";
        document.getElementById(idRad).textContent = (val * D2R).toFixed(2) + "rad";
    };
    showDegRad('val-theta1-deg', 'val-theta1-rad', state.theta1);
    showDegRad('val-theta2-deg', 'val-theta2-rad', state.theta2);
    showDegRad('val-theta3-deg', 'val-theta3-rad', state.theta3);

    computeFK();
    updateUI();
}

// --- MATH ---
function updateMath(x, y, z) {
    const now = performance.now() / 1000;
    state.liveBuffer.push({ t: now, x, y, z });
    while (state.liveBuffer.length > 0 && (now - state.liveBuffer[0].t > 1.0)) {
        state.liveBuffer.shift();
    }

    const buf = state.liveBuffer;
    if (buf.length < 2) return;

    // Velocity
    const last = buf[buf.length-1];
    const prev = buf[buf.length-2];
    const dt = last.t - prev.t;
    
    if (dt > 0.001) {
        const vx = (last.x - prev.x) / dt;
        const vy = (last.y - prev.y) / dt;
        const vz = (last.z - prev.z) / dt;
        
        document.getElementById('vel-x').textContent = vx.toFixed(2);
        document.getElementById('vel-y').textContent = vy.toFixed(2);
        document.getElementById('vel-z').textContent = vz.toFixed(2);
        
        const speed = Math.sqrt(vx*vx + vy*vy + vz*vz);
        document.getElementById('math-speed').textContent = speed.toFixed(2);
        
        if (state.recording) updateTangents(vx, vy, vz);
    }

    // Regression
    const t0 = buf[0].t;
    const times = buf.map(p => p.t - t0);
    const mx = calculateRegression(times, buf.map(p => p.x));
    const my = calculateRegression(times, buf.map(p => p.y));
    const mz = calculateRegression(times, buf.map(p => p.z));

    const fmt = (m, b) => {
        if (Math.abs(m) < 0.05) m = 0;
        return `${m.toFixed(2)}t ${b >= 0 ? "+" : "-"} ${Math.abs(b).toFixed(2)}`;
    };

    document.getElementById('func-x').textContent = `x(t) ≈ ${fmt(mx.m, mx.b)}`;
    document.getElementById('func-y').textContent = `y(t) ≈ ${fmt(my.m, my.b)}`;
    document.getElementById('func-z').textContent = `z(t) ≈ ${fmt(mz.m, mz.b)}`;
}

function calculateRegression(times, values) {
    const n = times.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    for (let i = 0; i < n; i++) {
        sumX += times[i]; sumY += values[i];
        sumXY += times[i] * values[i]; sumXX += times[i] * times[i];
    }
    const denom = (n * sumXX - sumX * sumX);
    if (Math.abs(denom) < 0.0001) return { m: 0, b: values[0] || 0 };
    const m = (n * sumXY - sumX * sumY) / denom;
    const b = (sumY - m * sumX) / n;
    return { m, b };
}

// --- PLOTTING ---
function initPlot() {
    log("Initializing Plot...");
    const common = { mode: 'lines', type: 'scatter', line: { width: 2 } };
    const traceX = { ...common, x: [], y: [], name: 'x(t)', line: { color: '#ff4757' } };
    const traceY = { ...common, x: [], y: [], name: 'y(t)', line: { color: '#2ed573' } };
    const traceZ = { ...common, x: [], y: [], name: 'z(t)', line: { color: '#1e90ff' } };

    const tanStyle = { mode: 'lines', type: 'scatter', showlegend: false, line: { width: 1, dash: 'dot' } };
    const tanX = { ...tanStyle, x: [], y: [], line: { ...tanStyle.line, color: '#ff4757' }, opacity: 0.7 };
    const tanY = { ...tanStyle, x: [], y: [], line: { ...tanStyle.line, color: '#2ed573' }, opacity: 0.7 };
    const tanZ = { ...tanStyle, x: [], y: [], line: { ...tanStyle.line, color: '#1e90ff' }, opacity: 0.7 };

    const layout = {
        title: 'Task Space (x,y,z vs Time)',
        paper_bgcolor: '#1e1e1e', plot_bgcolor: '#121212',
        font: { color: '#e0e0e0', family: 'monospace' },
        margin: { l: 40, r: 10, t: 40, b: 30 },
        legend: { orientation: 'h', y: 1.1 },
        xaxis: { title: 'Time (s)', gridcolor:'#333' },
        yaxis: { title: 'Pos (cm)', gridcolor:'#333' }
    };
    
    try {
        Plotly.newPlot('plot-container', [traceX, traceY, traceZ, tanX, tanY, tanZ], layout, {responsive: true});
        log("Plot Ready.");
    } catch(e) { log("Plot Crash: " + e.message); }
}

function updatePlot(x, y, z) {
    if (!state.recording) return;
    const t = (Date.now() - state.startTime) / 1000;
    
    state.history.x.push(x);
    state.history.y.push(y);
    state.history.z.push(z);
    state.history.time.push(t);

    Plotly.extendTraces('plot-container', {
        x: [[t], [t], [t]],
        y: [[x], [y], [z]]
    }, [0, 1, 2]);
}

function updateTangents(vx, vy, vz) {
    if (!state.recording || state.history.time.length === 0) return;
    const t = state.history.time[state.history.time.length-1];
    const x = state.history.x[state.history.x.length-1];
    const y = state.history.y[state.history.y.length-1];
    const z = state.history.z[state.history.z.length-1];

    const dt = 1.0; 
    Plotly.restyle('plot-container', {
        x: [[t, t+dt], [t, t+dt], [t, t+dt]],
        y: [[x, x+vx*dt], [y, y+vy*dt], [z, z+vz*dt]]
    }, [3, 4, 5]);
}

// --- SERIAL ---
async function initSerial() {
    if (!navigator.serial) { log("Web Serial not supported."); return; }
    navigator.serial.addEventListener('connect', refreshPorts);
    navigator.serial.addEventListener('disconnect', refreshPorts);
    await refreshPorts();
}

async function refreshPorts() {
    try {
        const ports = await navigator.serial.getPorts();
        const sel = document.getElementById('serial-port-list');
        sel.innerHTML = '<option value="prompt">🔌 Add New Device...</option>';
        ports.forEach((p, i) => {
            const info = p.getInfo();
            const opt = document.createElement('option');
            opt.value = i;
            opt.textContent = `Device ${i+1} (VID:${info.usbVendorId||'?'})`;
            sel.appendChild(opt);
        });
        if(ports.length > 0) sel.value = 0;
    } catch(e) { log("Port listing error: "+e); }
}

async function handleConnect() {
    const sel = document.getElementById('serial-port-list');
    if (port) { location.reload(); return; }
    try {
        if (sel.value === 'prompt') port = await navigator.serial.requestPort();
        else port = (await navigator.serial.getPorts())[parseInt(sel.value)];
        
        await port.open({ baudRate: 115200 });
        log("Port Opened.");
        const enc = new TextEncoderStream();
        writableStreamClosed = enc.readable.pipeTo(port.writable);
        writer = enc.writable.getWriter();
        readLoop();
        
        document.getElementById('status-indicator').textContent = "Connected";
        document.getElementById('status-indicator').className = "status connected";
        document.getElementById('btn-open-port').textContent = "Disconnect";
        sel.disabled = true;
    } catch(e) { log("Connect Error: " + e); alert(e); }
}

async function readLoop() {
    keepReading = true;
    const dec = new TextDecoderStream();
    readableStreamClosed = port.readable.pipeTo(dec.writable);
    serialReader = dec.readable.getReader();
    try {
        while(keepReading) {
            const { value, done } = await serialReader.read();
            if(done) break;
        }
    } catch(e){} finally { serialReader.releaseLock(); }
}

async function handleFlash() {
    if(!port) { alert("Connect first"); return; }
    log("Starting Flash...");
    const btn = document.getElementById('btn-flash');
    btn.disabled = true;
    try {
        keepReading = false;
        if(serialReader) await serialReader.cancel().catch(e=>{});
        if(writer) { await writer.close().catch(e=>{}); writer.releaseLock(); }
        await new Promise(r=>setTimeout(r,200));
        await port.close().catch(e=>{});
        
        await port.open({ baudRate: 115200 });
        const res = await fetch('firmware/latest.hex?v='+Date.now());
        if(!res.ok) throw new Error("No Hex");
        const hex = await res.text();
        
        let rev = "Unknown";
        try {
            const r = await fetch('firmware/version.json?v='+Date.now());
            if(r.ok) rev = (await r.json()).revision;
        } catch(e){}
        
        const flasher = new STK500(port, { debug: false });
        await flasher.reset();
        await flasher.flashHex(hex, (p) => btn.textContent = `🔥 ${p}%`);
        
        alert(`✅ Success! Rev: ${rev}`);
    } catch(e) { log("Flash Error: " + e.message); alert(e.message); } 
    finally { location.reload(); }
}

// --- JOKE LOADER (Robust) ---
function loadJoke() {
    const el = document.getElementById('math-joke-text');
    if(!el) return;
    if(window.mathJokes && window.mathJokes.length > 0) {
        const joke = window.mathJokes[Math.floor(Math.random() * window.mathJokes.length)];
        el.textContent = `"${joke}"`;
        el.style.color = "#d05ce3";
    } else {
        setTimeout(loadJoke, 200); // Retry
    }
}

// --- BOOT ---
window.addEventListener('load', () => {
    log("System Boot...");
    initPlot();
    initSerial();
    update();
    loadJoke();
    
    ['theta1','theta2','theta3'].forEach(id => {
        document.getElementById('slider-'+id).addEventListener('input', update);
    });
    
    document.getElementById('btn-open-port').addEventListener('click', handleConnect);
    document.getElementById('btn-flash').addEventListener('click', handleFlash);
    
    document.getElementById('btn-record').addEventListener('click', () => {
        state.recording = !state.recording;
        const btn = document.getElementById('btn-record');
        if(state.recording) {
            btn.textContent = "⏹ Stop";
            btn.style.backgroundColor = "#ff4757";
            state.startTime = Date.now();
            state.history = { x: [], y: [], z: [], time: [] };
            initPlot(); 
        } else {
            btn.textContent = "🔴 Record";
            btn.style.backgroundColor = "#333";
        }
    });
    
    document.getElementById('btn-clear').addEventListener('click', () => {
        state.history = { x: [], y: [], z: [], time: [] };
        initPlot();
    });
});
