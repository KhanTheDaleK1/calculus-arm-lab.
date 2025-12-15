// js/app.js

// --- STATE ---
let state = {
    target: { x: 90, y: 90, z: 90 }, // direct joint angles
    angles: { base: 90, shoulder: 90, elbow: 90 },
    telemetry: { dist: 0 },
    history: {
        x: [], y: [], z: [], time: []
    },
    recording: false,
    startTime: 0
};

// --- SERIAL CONNECTION ---
let port;
let writer;
let keepReading = false;
let knownPorts = [];
let serialReader = null;
let writableStreamClosed = null;
let readableStreamClosed = null;

const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

// 1. Initialize: Check for available ports on load
async function initSerial() {
    if (!navigator.serial) {
        alert("Web Serial API not supported. Please use Chrome or Edge.");
        return;
    }

    // Listen for devices being plugged in/out
    navigator.serial.addEventListener('connect', refreshPorts);
    navigator.serial.addEventListener('disconnect', refreshPorts);

    await refreshPorts();
}

// 2. Refresh the Dropdown List
async function refreshPorts() {
    try {
        knownPorts = await navigator.serial.getPorts();
        const selector = document.getElementById('serial-port-list');
        
        // Save current selection if possible
        const currentVal = selector.value;
        
        // Clear (except first option)
        selector.innerHTML = '<option value="prompt">🔌 Add New Device...</option>';
        
        knownPorts.forEach((p, index) => {
            const { usbProductId, usbVendorId } = p.getInfo();
            const option = document.createElement('option');
            option.value = index;
            option.textContent = `Arduino / Device (ID: ${usbVendorId || '?'})`;
            selector.appendChild(option);
        });

        // Restore selection or default to first known device
        if (knownPorts.length > 0) {
            selector.value = 0; // Default to first device
        }
    } catch (e) {
        console.error("Error listing ports:", e);
    }
}

// 3. Connect Button Logic
async function handleConnectClick() {
    const selector = document.getElementById('serial-port-list');
    
    if (selector.value === "prompt") {
        // A. Request NEW Port (Opens Browser Picker)
        try {
            port = await navigator.serial.requestPort();
            await openSelectedPort(port);
            await refreshPorts(); // Update list after permission granted
        } catch (err) {
            console.warn("User cancelled selection or error:", err);
        }
    } else {
        // B. Open EXISTING Port from List
        const index = parseInt(selector.value);
        if (knownPorts[index]) {
            await openSelectedPort(knownPorts[index]);
        }
    }
}

// 4. Open and Start Reading
async function openSelectedPort(selectedPort) {
    try {
        port = selectedPort;
        await port.open({ baudRate: 115200 });
        
        // Setup Writer
        const textEncoder = new TextEncoderStream();
        writableStreamClosed = textEncoder.readable.pipeTo(port.writable);
        writer = textEncoder.writable.getWriter();
        
        // Setup Reader
        readLoop();
        
        // UI Update
        document.getElementById('status-indicator').textContent = "Connected";
        document.getElementById('status-indicator').className = "status connected";
        document.getElementById('btn-open-port').textContent = "Disconnect";
        document.getElementById('btn-open-port').onclick = handleDisconnect; // Swap handler
        document.getElementById('serial-port-list').disabled = true;
        
        console.log("Serial Connected");
    } catch (err) {
        console.error("Connection Failed:", err);
        alert("Failed to open port. It might be in use by another app.");
    }
}

async function handleDisconnect() {
    // Simple page reload to clear state cleanly (easiest for Serial API)
    location.reload(); 
}

// ... readLoop() and handleSerialData() remain the same ...
async function readLoop() {
    keepReading = true;
    const textDecoder = new TextDecoderStream();
    readableStreamClosed = port.readable.pipeTo(textDecoder.writable);
    serialReader = textDecoder.readable.getReader();


    try {
        while (keepReading) {
            const { value, done } = await serialReader.read();
            if (done) break;
            if (value) handleSerialData(value);
        }
    } catch (error) {
        console.error(error);
    } finally {
        serialReader.releaseLock();
    }
}

// Buffer for fragmented serial data
let serialBuffer = "";

function handleSerialData(chunk) {
    serialBuffer += chunk;
    let lines = serialBuffer.split('\n');
    
    // Process all complete lines
    while (lines.length > 1) {
        let line = lines.shift().trim();
        if (line.startsWith("DATA:")) {
            parseTelemetry(line.substring(5));
        }
    }
    serialBuffer = lines[0]; // Keep incomplete line
}

function parseTelemetry(dataStr) {
    // Expected: Base,Shoulder,Elbow,Distance
    let parts = dataStr.split(',');
    if (parts.length >= 4) {
        let dist = parseFloat(parts[3]);
        if (dist > 0) {
            state.telemetry.dist = dist;
            document.getElementById('sonar-dist').textContent = dist.toFixed(1);
        }
    }
}

async function sendCommand(b, s, e) {
    if (writer) {
        const cmd = `S:${Math.round(b)},${Math.round(s)},${Math.round(e)}\n`;
        await writer.write(cmd);
    }
}

// --- DIRECT CONTROL ---
function update() {
    // 1. Get direct joint targets
    let x = parseFloat(document.getElementById('slider-x').value); // base
    let y = parseFloat(document.getElementById('slider-y').value); // shoulder
    let z = parseFloat(document.getElementById('slider-z').value); // elbow
    
    // Update labels
    document.getElementById('val-x').textContent = x;
    document.getElementById('val-y').textContent = y;
    document.getElementById('val-z').textContent = z;

    // Clamp and set state
    state.angles.base = clamp(x, 0, 180);
    state.angles.shoulder = clamp(y, 0, 180);
    state.angles.elbow = clamp(z, 0, 180);

    // Update Text
    document.getElementById('out-base').textContent = Math.round(state.angles.base) + "°";
    document.getElementById('out-shoulder').textContent = Math.round(state.angles.shoulder) + "°";
    document.getElementById('out-elbow').textContent = Math.round(state.angles.elbow) + "°";

    // Send to Arduino
    sendCommand(state.angles.base, state.angles.shoulder, state.angles.elbow);
    
    // Math Updates (use base/shoulder as x/y for plotting function demonstration)
    let r = Math.sqrt(state.angles.base**2 + state.angles.shoulder**2).toFixed(2);
    document.getElementById('math-r').textContent = r;
    
    // Plotting (base on x-axis, shoulder on y-axis)
    updatePlot(state.angles.base, state.angles.shoulder, state.angles.elbow);
}

// --- PLOTTING ---
function initPlot() {
    const baseTrace = { x: [], y: [], mode: 'lines', type: 'scatter', name: 'Base (X)', line: { color: '#ff4757', width: 2 } };
    const shoulderTrace = { x: [], y: [], mode: 'lines', type: 'scatter', name: 'Shoulder (Y)', line: { color: '#2ed573', width: 2 } };
    const elbowTrace = { x: [], y: [], mode: 'lines', type: 'scatter', name: 'Elbow (Z)', line: { color: '#1e90ff', width: 2 } };

    const layout = {
        title: 'Joint Angles vs Time',
        paper_bgcolor: '#1e1e1e',
        plot_bgcolor: '#121212',
        font: { color: '#e0e0e0', family: 'monospace' },
        xaxis: {
            title: 'Time (s)',
            gridcolor: '#333',
            zerolinecolor: '#666'
        },
        yaxis: {
            title: 'Angle (deg)',
            range: [0, 180],
            gridcolor: '#333',
            zerolinecolor: '#666',
            dtick: 30
        },
        legend: { orientation: 'h', y: 1.1 },
        margin: { l: 50, r: 20, t: 40, b: 40 }
    };

    Plotly.newPlot('plot-container', [baseTrace, shoulderTrace, elbowTrace], layout, { responsive: true });
}

function updatePlot(x, y, z) {
    if (!state.recording) return;

    // Add point to history
    let t = (Date.now() - state.startTime) / 1000;
    
    // Calculate Velocity (dx/dt) roughly
    if (state.history.x.length > 0) {
        let lastX = state.history.x[state.history.x.length-1];
        let lastT = state.history.time[state.history.time.length-1];
        let dt = t - lastT;
        if (dt > 0) {
            let vx = (x - lastX) / dt;
            document.getElementById('math-vel-x').textContent = vx.toFixed(2);
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

// --- EVENT LISTENERS ---
document.getElementById('btn-open-port').addEventListener('click', handleConnectClick);
document.getElementById('btn-flash').addEventListener('click', handleFlashClick);
window.addEventListener('load', () => {
    initSerial();
    initPlot();
    update();
});

['slider-x', 'slider-y', 'slider-z'].forEach(id => {
    document.getElementById(id).addEventListener('input', update);
});

document.getElementById('btn-record').addEventListener('click', () => {
    state.recording = !state.recording;
    let btn = document.getElementById('btn-record');
    if (state.recording) {
        btn.textContent = "⏹ Stop Trace";
        btn.style.backgroundColor = "#ff4757";
        state.startTime = Date.now();
    } else {
        btn.textContent = "🔴 Record Function";
        btn.style.backgroundColor = "#333";
    }
});

document.getElementById('btn-clear').addEventListener('click', () => {
    state.history.x = [];
    state.history.y = [];
    state.history.z = [];
    state.history.time = [];
    initPlot(); // redraw empty traces
});

// --- FLASHING (browser-based) ---
async function handleFlashClick() {
    if (!port) { alert("Connect to the Arduino first."); return; }
    
    const btn = document.getElementById('btn-flash');
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = "⏳ Preparing...";

    try {
        // Force existing readers/writers to release the port
        keepReading = false;
        if (serialReader) {
            try { await serialReader.cancel(); } catch (_) {}
        }
        if (writer) {
            try { await writer.close(); } catch (_) {}
            try { writer.releaseLock(); } catch (_) {}
        }
        if (readableStreamClosed) {
            try { await readableStreamClosed.catch(() => {}); } catch (_) {}
        }
        if (writableStreamClosed) {
            try { await writableStreamClosed.catch(() => {}); } catch (_) {}
        }
        // small pause to allow streams to unwind
        await new Promise(r => setTimeout(r, 200));
        try { await port.close(); } catch (_) {}

        // Re-open raw for flashing
        await port.open({ baudRate: 115200 });

        // Fetch version metadata (optional)
        let versionText = "Unknown";
        try {
            const vResp = await fetch('firmware/version.json?v=' + Date.now());
            if (vResp.ok) {
                const vData = await vResp.json();
                versionText = vData.revision || versionText;
            }
        } catch (e) {
            console.warn("Version fetch failed", e);
        }

        btn.textContent = "⬇️ Downloading HEX...";
        const resp = await fetch('firmware/latest.hex?v=' + Date.now());
        if (!resp.ok) throw new Error("Firmware not found (build may still be running).");
        const hex = await resp.text();

        btn.textContent = "🔄 Resetting...";
        const flasher = new STK500(port, { debug: false });
        await flasher.reset();

        btn.textContent = "🔥 Writing 0%";
        await flasher.flashHex(hex, (pct) => {
            btn.textContent = `🔥 Writing ${pct}%`;
        });

        alert(`✅ Firmware flashed successfully.\nRevision: ${versionText}\nReconnecting...`);
    } catch (err) {
        console.error(err);
        alert("❌ Flash failed: " + err.message + "\nTry pressing RESET as you click Flash.");
    } finally {
        try { await port.close(); } catch (_) {}
        btn.disabled = false;
        btn.textContent = original;
        location.reload();
    }
}

// Initialize
initPlot();
update(); // Initial calculation
