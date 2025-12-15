// js/app.js

// --- CONFIGURATION ---
const ARM_GEOMETRY = {
    L1: 8.0, // Shoulder to Elbow (cm)
    L2: 8.0  // Elbow to Wrist (cm)
};

// --- STATE ---
let state = {
    target: { x: 0, y: 15, z: 5 }, // Cartesian Targets
    angles: { base: 90, shoulder: 90, elbow: 90 }, // Servo Angles
    telemetry: { dist: 0 },
    history: {
        x: [], y: [], time: []
    },
    recording: false,
    startTime: 0
};

// --- SERIAL CONNECTION ---
let port;
let writer;
let keepReading = false;
let knownPorts = [];

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
        const writableStreamClosed = textEncoder.readable.pipeTo(port.writable);
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
    const readableStreamClosed = port.readable.pipeTo(textDecoder.writable);
    const reader = textDecoder.readable.getReader();


    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            if (value) handleSerialData(value);
        }
    } catch (error) {
        console.error(error);
    } finally {
        reader.releaseLock();
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

// --- INVERSE KINEMATICS ---
function calculateIK(x, y, z) {
    // 1. Base Angle (Atan2 of Y/X)
    // Note: MeArm 90 is center. 0 is Right, 180 is Left.
    // X=0 -> 90. X>0 -> <90. X<0 -> >90.
    let thetaBase = Math.atan2(x, y) * (180 / Math.PI);
    let baseAngle = 90 + thetaBase; // Adjust mapping as needed

    // 2. Planar Distance (Distance from base pivot to target on ground)
    let r_planar = Math.sqrt(x*x + y*y);
    
    // 3. Wrist Coordinate (in Shoulder-Elbow Plane)
    // R (horizontal) = r_planar
    // Z (vertical) = z
    let R = r_planar;
    let Z = z;
    
    let L1 = ARM_GEOMETRY.L1;
    let L2 = ARM_GEOMETRY.L2;
    
    // Distance from Shoulder pivot to Wrist
    let hypotenuse = Math.sqrt(R*R + Z*Z);
    
    // Clamp reach
    if (hypotenuse > (L1 + L2)) hypotenuse = L1 + L2;
    
    // Law of Cosines for Elbow (Inner Angle)
    // c^2 = a^2 + b^2 - 2ab cos(C)
    // hyp^2 = L1^2 + L2^2 - 2*L1*L2*cos(elbow_inner)
    let cos_angle_elbow = (L1*L1 + L2*L2 - hypotenuse*hypotenuse) / (2 * L1 * L2);
    // Clamp domain for acos
    if (cos_angle_elbow > 1.0) cos_angle_elbow = 1.0;
    if (cos_angle_elbow < -1.0) cos_angle_elbow = -1.0;
    
    let angle_elbow_rad = Math.acos(cos_angle_elbow);
    // Convert to servo angle (MeArm Geometry dependent)
    // Usually 90 is 90 degrees.
    let elbowAngle = 180 - (angle_elbow_rad * (180/Math.PI)); 

    // Shoulder Calculation
    // Angle of the hypotenuse
    let angle_hyp = Math.atan2(Z, R);
    
    // Angle from hypotenuse to L1 (Law of Cosines again)
    // L2^2 = L1^2 + hyp^2 - 2*L1*hyp*cos(alpha)
    let cos_angle_alpha = (L1*L1 + hypotenuse*hypotenuse - L2*L2) / (2 * L1 * hypotenuse);
    if (cos_angle_alpha > 1.0) cos_angle_alpha = 1.0;
    let angle_alpha = Math.acos(cos_angle_alpha);
    
    let shoulder_rad = angle_hyp + angle_alpha;
    let shoulderAngle = shoulder_rad * (180/Math.PI);

    return {
        base: baseAngle,
        shoulder: shoulderAngle,
        elbow: elbowAngle
    };
}

// --- UI UPDATES ---
function update() {
    // 1. Get Targets
    let x = parseFloat(document.getElementById('slider-x').value);
    let y = parseFloat(document.getElementById('slider-y').value);
    let z = parseFloat(document.getElementById('slider-z').value);
    
    // Update labels
    document.getElementById('val-x').textContent = x;
    document.getElementById('val-y').textContent = y;
    document.getElementById('val-z').textContent = z;

    // 2. Calculate IK
    let angles = calculateIK(x, y, z);
    
    // 3. Update Text
    document.getElementById('out-base').textContent = Math.round(angles.base) + "°";
    document.getElementById('out-shoulder').textContent = Math.round(angles.shoulder) + "°";
    document.getElementById('out-elbow').textContent = Math.round(angles.elbow) + "°";

    // 4. Send to Arduino (Throttled)
    sendCommand(angles.base, angles.shoulder, angles.elbow);
    
    // 5. Math Updates
    let r = Math.sqrt(x*x + y*y).toFixed(2);
    document.getElementById('math-r').textContent = r;
    
    // 6. Plotting
    updatePlot(x, y);
}

// --- PLOTTING ---
function initPlot() {
    let trace1 = {
        x: [],
        y: [],
        mode: 'lines+markers',
        type: 'scatter',
        name: 'Trajectory',
        line: { color: '#00ff9d' }
    };

    let layout = {
        title: 'Top-Down Trajectory (X vs Y)',
        paper_bgcolor: '#1e1e1e',
        plot_bgcolor: '#121212',
        font: { color: '#e0e0e0' },
        xaxis: { range: [-20, 20], title: 'X Axis (cm)' },
        yaxis: { range: [0, 30], title: 'Y Axis (cm)' }
    };

    Plotly.newPlot('plot-container', [trace1], layout);
}

function updatePlot(x, y) {
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
    state.history.time.push(t);

    Plotly.extendTraces('plot-container', {
        x: [[x]],
        y: [[y]]
    }, [0]);
}

// --- EVENT LISTENERS ---
document.getElementById('btn-open-port').addEventListener('click', handleConnectClick);
window.addEventListener('load', initSerial);

['slider-x', 'slider-y', 'slider-z'].forEach(id => {
    document.getElementById(id).addEventListener('input', update);
});

document.getElementById('btn-record').addEventListener('click', () => {
    state.recording = !state.recording;
    let btn = document.getElementById('btn-record');
    if (state.recording) {
        btn.textContent = "⏹ Stop Recording";
        btn.style.backgroundColor = "#ff4757";
        state.startTime = Date.now();
    } else {
        btn.textContent = "🔴 Record Trace";
        btn.style.backgroundColor = "#333";
    }
});

document.getElementById('btn-clear').addEventListener('click', () => {
    state.history.x = [];
    state.history.y = [];
    state.history.time = [];
    Plotly.newPlot('plot-container', [{
        x: [], y: [], mode: 'lines+markers', type: 'scatter', line: { color: '#00ff9d' }
    }], {
        paper_bgcolor: '#1e1e1e',
        plot_bgcolor: '#121212',
        font: { color: '#e0e0e0' },
        xaxis: { range: [-20, 20], title: 'X' },
        yaxis: { range: [0, 30], title: 'Y' }
    });
});

// Initialize
initPlot();
update(); // Initial calculation
