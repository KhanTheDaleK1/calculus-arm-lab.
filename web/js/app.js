/**
 * CalculusArm v4.0 - Synchronized Logic
 */

// --- UTILS ---
function log(msg) {
    const box = document.getElementById('log-output');
    const time = new Date().toLocaleTimeString();
    box.innerHTML += `<div>[${time}] ${msg}</div>`;
    box.scrollTop = box.scrollHeight;
    console.log(msg);
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
    history: { x: [], y: [], z: [], time: [] }
};

const L1 = 80; 
const L2 = 80; 
const D2R = Math.PI / 180;

// --- KINEMATICS ---
function computeFK() {
    const t1 = state.theta1 * D2R;
    const t2 = state.theta2 * D2R;
    // t3 is relative to t2 in geometric model
    const t3 = (state.theta3 - 90) * D2R; 

    // Geometric Projection
    const r = (L1 * Math.cos(t2)) + (L2 * Math.cos(t2 + t3));
    const z = (L1 * Math.sin(t2)) + (L2 * Math.sin(t2 + t3));
    
    const x = r * Math.cos(t1);
    const y = r * Math.sin(t1);

    state.x = x / 10; // mm -> cm
    state.y = y / 10;
    state.z = z / 10;
}

function updateUI() {
    // Send to Serial
    if (port && writer) {
        const cmd = `S:${state.theta1},${state.theta2},${state.theta3}\n`;
        writer.write(cmd).catch(err => log("Write Error: " + err));
    }

    document.getElementById('out-x').textContent = state.x.toFixed(2);
    document.getElementById('out-y').textContent = state.y.toFixed(2);
    document.getElementById('out-z').textContent = state.z.toFixed(2);

    updatePlot(state.x, state.y, state.z);
}

function update() {
    state.theta1 = parseInt(document.getElementById('slider-theta1').value);
    state.theta2 = parseInt(document.getElementById('slider-theta2').value);
    state.theta3 = parseInt(document.getElementById('slider-theta3').value);

    document.getElementById('val-theta1').textContent = state.theta1 + "°";
    document.getElementById('val-theta2').textContent = state.theta2 + "°";
    document.getElementById('val-theta3').textContent = state.theta3 + "°";

    computeFK();
    updateUI();
}

// --- PLOTTING ---
function initPlot() {
    log("Initializing Plot...");
    const common = { mode: 'lines', type: 'scatter', line: { width: 2 } };
    const traceX = { ...common, x: [], y: [], name: 'x(t)', line: { color: '#ff4757' } };
    const traceY = { ...common, x: [], y: [], name: 'y(t)', line: { color: '#2ed573' } };
    const traceZ = { ...common, x: [], y: [], name: 'z(t)', line: { color: '#1e90ff' } };

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
        Plotly.newPlot('plot-container', [traceX, traceY, traceZ], layout, {responsive: true});
        log("Plot Initialized.");
    } catch(e) {
        log("PLOT CRASHED: " + e.message);
    }
}

function updatePlot(x, y, z) {
    if (!state.recording) return;
    const t = (Date.now() - state.startTime) / 1000;
    
    // Velocity
    if (state.history.x.length > 0) {
        const last = state.history.x.length - 1;
        const dt = t - state.history.time[last];
        if (dt > 0.05) {
            const dx = x - state.history.x[last];
            const dy = y - state.history.y[last];
            const dz = z - state.history.z[last];
            const v = Math.sqrt((dx*dx + dy*dy + dz*dz)/(dt*dt));
            document.getElementById('math-vel').textContent = v.toFixed(2);
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
}

// --- SERIAL ---
async function initSerial() {
    if (!navigator.serial) { log("Web Serial not supported."); return; }
    navigator.serial.addEventListener('connect', refreshPorts);
    navigator.serial.addEventListener('disconnect', refreshPorts);
    await refreshPorts();
}

async function refreshPorts() {
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
    } catch(e) { log("Read Error: " + e); } 
    finally { serialReader.releaseLock(); }
}

async function handleFlash() {
    if(!port) { alert("Connect first"); return; }
    log("Starting Flash Process...");
    const btn = document.getElementById('btn-flash');
    btn.disabled = true;
    
    try {
        keepReading = false;
        if(serialReader) await serialReader.cancel().catch(e=>log(e));
        if(writer) { await writer.close().catch(e=>log(e)); writer.releaseLock(); }
        await new Promise(r=>setTimeout(r,200));
        await port.close().catch(e=>log(e));
        
        log("Port Released. Reopening for flasher...");
        await port.open({ baudRate: 115200 });
        
        log("Downloading Firmware...");
        const res = await fetch('firmware/latest.hex?v='+Date.now());
        if(!res.ok) throw new Error("Hex not found");
        const hex = await res.text();
        
        log("Resetting Board...");
        const flasher = new STK500(port, { debug: false });
        await flasher.reset();
        
        log("Writing...");
        await flasher.flashHex(hex, (p) => btn.textContent = `🔥 ${p}%`);
        
        alert("✅ Success! Firmware Updated.");
    } catch(e) {
        log("FLASH FAILED: " + e.message);
        alert("Error: " + e.message);
    } finally {
        location.reload();
    }
}

// --- BOOTSTRAP ---
window.addEventListener('load', () => {
    log("App Starting...");
    initPlot();
    initSerial();
    update(); // Initial FK Calc
    
    // Bindings
    document.getElementById('slider-theta1').addEventListener('input', update);
    document.getElementById('slider-theta2').addEventListener('input', update);
    document.getElementById('slider-theta3').addEventListener('input', update);
    
    document.getElementById('btn-open-port').addEventListener('click', handleConnect);
    document.getElementById('btn-flash').addEventListener('click', handleFlash);
    
    document.getElementById('btn-record').addEventListener('click', () => {
        state.recording = !state.recording;
        const btn = document.getElementById('btn-record');
        if(state.recording) {
            btn.textContent = "⏹ Stop";
            btn.style.backgroundColor = "#ff4757";
            state.startTime = Date.now();
            log("Recording Started");
        } else {
            btn.textContent = "🔴 Record";
            btn.style.backgroundColor = "#333";
            log("Recording Stopped");
        }
    });
    
    document.getElementById('btn-clear').addEventListener('click', () => {
        state.history = { x: [], y: [], z: [], time: [] };
        initPlot();
        log("Graph Cleared");
    });
});
