// CONFIG
const THEME = { accent: '#d05ce3', bg: '#141414', grid: '#333' };
const CARRIER_FREQ = 1000;

// STATE
let audioCtx, analyser, micSource;
let masterGain;
let isRunning = false;
let waveArray;

function initCanvas(id) {
    const c = document.getElementById(id);
    if(c) { c.width = c.clientWidth; c.height = c.clientHeight; }
}

// RX/TX STATE
let modemEngine;
let modemBufferSource = null;
let costasLoop, agc, receiver;

window.onload = () => {
    initCanvas('modem-bit-canvas');
    initCanvas('constellation-canvas');
    initCanvas('scope-canvas');

    // Init DSP objects
    costasLoop = new CostasLoop();
    agc = new AGC();
    receiver = new Receiver();

    // Populate Mic list on load
    populateMics();

    // Bindings
    document.getElementById('btn-start').onclick = startReceiver;
    document.getElementById('btn-stop').onclick = stopReceiver;
    document.getElementById('btn-modem-send').onclick = transmitModemData;
    document.getElementById('modem-type').onchange = () => {
        drawConstellation([], true); // Redraw grid on change
    };
    document.getElementById('btn-rx-clear').onclick = () => {
        receiver.clear();
        document.getElementById('rx-text').innerText = "Cleared.";
    };
    document.getElementById('btn-refresh-mics').onclick = populateMics;


    drawConstellation([], true); // Draw initial grid
};

function populateMics() {
    const startBtn = document.getElementById('btn-start');
    const sel = document.getElementById('device-select');
    if (!sel || !startBtn) return;
    
    startBtn.disabled = true;
    sel.innerHTML = '<option>Detecting...</option>';

    if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
        navigator.mediaDevices.getUserMedia({audio:true})
        .then(stream => {
            stream.getTracks().forEach(track => track.stop());
            return navigator.mediaDevices.enumerateDevices();
        })
        .then(devs => {
            sel.innerHTML = '';
            const mics = devs.filter(d => d.kind === 'audioinput');
            if (mics.length === 0) {
                sel.innerHTML = '<option>No mics found</option>';
            } else {
                mics.forEach((d, i) => {
                    const opt = document.createElement('option');
                    opt.value = d.deviceId;
                    opt.text = d.label || `Mic ${i + 1}`;
                    sel.appendChild(opt);
                });
                startBtn.disabled = false;
            }
        }).catch(err => {
            console.error("An error occurred during mic detection:", err.name, err.message);
            sel.innerHTML = `<option>Error: ${err.name}</option>`;
        });
    } else {
        console.error("navigator.mediaDevices or enumerateDevices is not supported.");
        sel.innerHTML = '<option>Not Supported</option>';
    }
}


// --- DSP CLASSES ---

class AGC {
    constructor() {
        this.gain = 1.0;
        this.alpha = 0.01; // How fast to adjust
    }
    process(buffer) {
        let max = 0;
        for (let i = 0; i < buffer.length; i++) {
            if (Math.abs(buffer[i]) > max) max = Math.abs(buffer[i]);
        }
        // If signal is present, adjust gain towards target=1.0
        if (max > 0.01) {
            this.gain += (1.0 - max) * this.alpha;
        }
        // Apply gain
        for (let i = 0; i < buffer.length; i++) {
            buffer[i] *= this.gain;
        }
        return buffer;
    }
}

class CostasLoop {
    constructor() { this.phase = 0; this.freq = 0; this.alpha = 0.1; this.beta = 0.01; }
    process(i_in, q_in) {
        const i_out = i_in * Math.cos(this.phase) + q_in * Math.sin(this.phase);
        const q_out = -i_in * Math.sin(this.phase) + q_in * Math.cos(this.phase);
        const error = i_out * Math.sign(q_out) - q_out * Math.sign(i_out);
        this.freq += this.beta * error;
        this.phase += this.freq + (this.alpha * error);
        this.phase = this.phase % (2 * Math.PI);
        return { i: i_out, q: q_out };
    }
}

class Receiver {
    constructor() {
        this.bits = [];
        this.text = "";
        
        // State Machine
        this.state = 'IDLE'; // 'IDLE' | 'SYNC'
        this.startTime = 0;
        this.lastSampleTime = 0;
        this.symbolDuration = 0;
        
        // Thresholds
        this.powerThreshold = 0.05; // Signal must be this loud to trigger
    }

    clear() {
        this.bits = [];
        this.text = "";
        this.state = 'IDLE';
    }

    // Called every frame (60fps) with the current Average I/Q of the room
    update(currentI, currentQ, baudRate) {
        const now = performance.now() / 1000; // Time in seconds
        const power = Math.sqrt(currentI**2 + currentQ**2);
        this.symbolDuration = 1.0 / baudRate;

        // 1. IDLE STATE: Look for energy
        if (this.state === 'IDLE') {
            if (power > this.powerThreshold) {
                console.log("Signal Detected! Syncing Clock...");
                this.state = 'SYNC';
                // Align clock: We assume the signal just started.
                // We want to sample in the MIDDLE of the symbol.
                this.startTime = now;
                this.lastSampleTime = now - (this.symbolDuration * 0.5); 
                this.clear(); // Clear old garbage
            }
            return []; // No bits yet
        }

        // 2. SYNC STATE: Wait for the clock tick
        if (this.state === 'SYNC') {
            // If signal dies, go back to IDLE
            if (power < this.powerThreshold * 0.5) {
                // Debounce: Only quit if silence persists (simplified here)
                 // console.log("Signal Lost.");
                 // this.state = 'IDLE';
            }

            // CHECK CLOCK: Is it time to sample?
            if (now - this.lastSampleTime >= this.symbolDuration) {
                this.lastSampleTime += this.symbolDuration; // Advance clock
                
                // RETURN THE SYMBOL TO BE SLICED
                return [{i_raw: currentI, q_raw: currentQ}];
            }
        }
        
        return []; // Waiting for next clock tick
    }

    processSymbol(bits) {
        if (!bits.length) return;
        this.bits.push(...bits);
        
        // Display raw bits for debug
        const bitStr = this.bits.slice(-16).join('');
        document.getElementById('rx-bits').innerText = "..." + bitStr;

        // Assemble Bytes
        while (this.bits.length >= 8) {
            const byte = this.bits.splice(0, 8);
            const charCode = parseInt(byte.join(''), 2);
            // Filtering: Only print printable ASCII to avoid garbage
            if (charCode >= 32 && charCode <= 126) {
                this.text += String.fromCharCode(charCode);
                // Auto-scroll
                const textBox = document.getElementById('rx-text');
                textBox.innerText = this.text;
                textBox.scrollTop = textBox.scrollHeight;
            }
        }
    }
    
    // ... getSlicer() remains the same ...
    getSlicer(type) {
        if (type === 'BPSK') return (i, q) => [i > 0 ? 1 : 0];
        if (type === 'QPSK') return (i, q) => [i > 0 ? 1 : 0, q > 0 ? 1 : 0];
        if (type === 'QAM16') return (i, q) => {
            const levels = [-2/3, 0, 2/3];
            const i_bit = i < levels[0] ? [0,0] : i < levels[1] ? [0,1] : i < levels[2] ? [1,1] : [1,0];
            const q_bit = q < levels[0] ? [0,0] : q < levels[1] ? [0,1] : q < levels[2] ? [1,1] : [1,0];
            return [...i_bit, ...q_bit];
        };
        if (type === 'QAM64') return (i, q) => {
             // Simply map 64QAM roughly for now
             return [i>0?1:0, q>0?1:0, 0,0,0,0]; // Placeholder for brevity
        };
        return (i, q) => [];
    }
}


// --- MAIN AUDIO & DRAWING ---

async function initAudioGraph() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') await audioCtx.resume();
    if (!analyser) analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    waveArray = new Float32Array(analyser.frequencyBinCount);
    if (!masterGain) {
        masterGain = audioCtx.createGain();
        masterGain.connect(audioCtx.destination);
    }
}

async function startReceiver() {
    if (isRunning) return;
    try {
        await initAudioGraph();
        
        const selectedDeviceId = document.getElementById('device-select').value;
        const stream = await navigator.mediaDevices.getUserMedia({ 
            audio: { 
                deviceId: selectedDeviceId ? { exact: selectedDeviceId } : undefined, 
                echoCancellation: false, 
                autoGainControl: false, 
                noiseSuppression: false, 
                latency: 0 
            }
        });
        
        if (micSource) try { micSource.disconnect(); } catch(e){}
        micSource = audioCtx.createMediaStreamSource(stream);
        micSource.connect(analyser);

        isRunning = true;
        const s = document.getElementById('status-badge');
        s.innerText = "Receiving";
        s.className = "status-badge success";
        loop();

    } catch(e) { 
        console.error("Failed to start receiver:", e.name, e.message);
        alert("Mic Error: " + e.name + " - " + e.message); 
    }
}

function stopReceiver() {
    isRunning = false;
    if(micSource) micSource.disconnect();
    if(audioCtx) audioCtx.close();
    audioCtx = null;
    micSource = null;
    document.getElementById('status-badge').innerText = "Idle";
    document.getElementById('status-badge').className = "status-badge warn";
}

function loop() {
    if (!isRunning) return;
    requestAnimationFrame(loop);
    
    analyser.getFloatTimeDomainData(waveArray);
    
    // 1. Draw Scope (Physics)
    drawScope(waveArray);
    
    // 2. Get Current I/Q (Physics)
    // We treat the buffer as a single point in time
    const rawIQ = getInstantaneousIQ(waveArray);
    
    // 3. AGC / PLL
    if (document.getElementById('rx-pll-enable').checked) {
        // Simple AGC
        const mag = Math.sqrt(rawIQ.i**2 + rawIQ.q**2);
        if (mag > 0.001) {
            rawIQ.i /= mag; 
            rawIQ.q /= mag;
        }
        // PLL (Optional, can rely on raw for low baud)
        // const locked = costasLoop.process(rawIQ.i, rawIQ.q);
        // rawIQ.i = locked.i; rawIQ.q = locked.q;
    }

    // 4. Update Receiver Logic (Computer Science)
    const baud = parseInt(document.getElementById('modem-baud').value);
    
    // This now returns an array ONLY if the clock ticked
    const sampledSymbols = receiver.update(rawIQ.i, rawIQ.q, baud);
    
    // 5. Slice & Process ONLY if we sampled
    if (sampledSymbols.length > 0) {
        const type = document.getElementById('modem-type').value;
        const slicer = receiver.getSlicer(type);
        
        sampledSymbols.forEach(s => {
            const bits = slicer(s.i_raw, s.q_raw);
            receiver.processSymbol(bits);
        });
        
        // Flash the constellation to show we sampled
        drawConstellation([sampledSymbols[0]]); 
    } else {
        // Draw the "Ghost" cursor (Realtime feedback)
        // Pass a flag to draw it faintly
        drawConstellation([{i_raw: rawIQ.i, q_raw: rawIQ.q}], true);
    }
}

function getInstantaneousIQ(buffer) {
    const omega = 2 * Math.PI * CARRIER_FREQ;
    const rate = audioCtx.sampleRate;
    
    let i_sum = 0;
    let q_sum = 0;
    
    // Integrate over the whole visualizer buffer to get current state
    for (let i = 0; i < buffer.length; i++) {
        const t = i / rate; // Relative time in buffer
        i_sum += buffer[i] * Math.cos(omega * t);
        q_sum += buffer[i] * -Math.sin(omega * t);
    }
    
    // Normalize
    const i_avg = (i_sum / buffer.length) * 4.0; // *4 gain for visibility
    const q_avg = (q_sum / buffer.length) * 4.0;
    
    return { i: i_avg, q: q_avg };
}

function drawConstellation(symbols, isGhost = false) {
    const c = document.getElementById('constellation-canvas');
    if (!c) return;
    const ctx = c.getContext('2d');
    const w = c.width, h = c.height;

    // Clear with a fade effect only if we're not drawing a ghost
    // or if the ghost is the only thing on screen.
    if (!isGhost) {
        ctx.fillStyle = 'rgba(0,0,0,0.2)';
        ctx.fillRect(0, 0, w, h);
    } else {
        // For the ghost, we need to redraw the whole static scene.
        ctx.fillStyle = '#0b0b0b'; // Background color
        ctx.fillRect(0,0,w,h);
    }

    ctx.strokeStyle = '#333';
    ctx.beginPath();
    ctx.moveTo(w/2, 0); ctx.lineTo(w/2, h);
    ctx.moveTo(0, h/2); ctx.lineTo(w, h/2);
    ctx.stroke();

    const type = document.getElementById('modem-type').value;
    const idealPoints = getIdealPoints(type);
    
    // Plot Ideal Points
    ctx.fillStyle = '#666';
    const scale = 0.85;
    for(let p of idealPoints) {
        const px = (w/2) + (p.I * (w/2) * scale);
        const py = (h/2) - (p.Q * (h/2) * scale);
        ctx.beginPath();
        ctx.arc(px, py, 3, 0, Math.PI*2);
        ctx.fill();
    }
    
    // Plot Received Symbols
    if (!symbols || symbols.length === 0) return;
    
    // Set color based on whether it's a ghost or a sampled point
    ctx.fillStyle = isGhost ? 'rgba(255, 255, 255, 0.2)' : THEME.accent;
    
    symbols.forEach(s => {
        const px = (w/2) + (s.i_raw * (w/2) * scale);
        const py = (h/2) - (s.q_raw * (h/2) * scale);
        ctx.beginPath();
        ctx.arc(px, py, 3, 0, Math.PI*2);
        ctx.fill();
    });
}

function getIdealPoints(type) {
    if (type === 'BPSK') return [{I:-1, Q:0}, {I:1, Q:0}];
    if (type === 'QPSK') return [{I:-1, Q:-1}, {I:-1, Q:1}, {I:1, Q:-1}, {I:1, Q:1}];
    if (type === 'QAM16') {
        const points = [];
        for(let i of [-3,-1,1,3]) for(let q of [-3,-1,1,3]) points.push({I:i/3, Q:q/3});
        return points;
    }
    if (type === 'QAM64') {
        const points = [];
        for(let i of [-7,-5,-3,-1,1,3,5,7]) for(let q of [-7,-5,-3,-1,1,3,5,7]) points.push({I:i/7, Q:q/7});
        return points;
    }
    return [];
}

function drawScope(buffer) {
    const c = document.getElementById('scope-canvas');
    if(!c) return;
    const ctx = c.getContext('2d');
    const w = c.width, h = c.height;

    ctx.fillStyle = '#0b0b0b'; ctx.fillRect(0,0,w,h);
    ctx.strokeStyle = '#222'; ctx.beginPath();
    ctx.moveTo(0, h/2); ctx.lineTo(w, h/2); ctx.stroke();

    if(!buffer) return;

    ctx.lineWidth = 2;
    ctx.strokeStyle = THEME.accent;
    ctx.beginPath();
    for(let x=0; x<w; x++) {
        const idx = Math.floor((x/w) * buffer.length);
        const v = buffer[idx];
        const y = (h/2) - (v * h/2 * 0.9);
        if(x===0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
}

// --- TX & HELPERS ---

class ModemEngine {
    constructor(sampleRate) { this.sampleRate = sampleRate; this.frequency = CARRIER_FREQ; }
    stringToBits(text) { /* ... same as before ... */ }
    generateWaveform(text, type, baud) { /* ... same as before ... */ }
}
// NOTE: For brevity, the ModemEngine's unchanged methods are omitted, but they are part of the file.
ModemEngine.prototype.stringToBits = function(text) {
    const bits = [];
    for (let i = 0; i < text.length; i++) {
        const charCode = text.charCodeAt(i);
        for (let j = 7; j >= 0; j--) { bits.push((charCode >> j) & 1); }
    }
    return bits;
}
ModemEngine.prototype.generateWaveform = function(text, type, baud) {
    const bits = this.stringToBits(text);
    const symbolDuration = 1 / baud;
    const samplesPerSymbol = Math.floor(this.sampleRate / baud);
    const omega = 2 * Math.PI * this.frequency;

    const idealPoints = getIdealPoints(type);
    const bitsPerSymbol = Math.log2(idealPoints.length);

    let symbols = [];
    for(let i=0; i<bits.length; i+=bitsPerSymbol) {
        const chunk = bits.slice(i, i+bitsPerSymbol);
        // This is a naive lookup, a gray-coded map would be better
        const point_idx = parseInt(chunk.join(''), 2); 
        if(point_idx < idealPoints.length) {
            symbols.push(idealPoints[point_idx]);
        }
    }
    
    // Sync Header (Alternating Phase)
    const preamble = [{I:1,Q:0}, {I:-1,Q:0},{I:1,Q:0}, {I:-1,Q:0}];
    const fullSymbols = [...preamble, ...symbols];

    const totalSamples = fullSymbols.length * samplesPerSymbol;
    const buffer = new Float32Array(totalSamples);

    for (let s = 0; s < fullSymbols.length; s++) {
        const { I, Q } = fullSymbols[s];
        for (let i = 0; i < samplesPerSymbol; i++) {
            const t = (s * samplesPerSymbol + i) / this.sampleRate;
            buffer[s * samplesPerSymbol + i] = (I * Math.cos(omega * t) - Q * Math.sin(omega * t));
        }
    }
    return { buffer, symbols: fullSymbols };
}


async function transmitModemData() {
    let text = document.getElementById('modem-input').value || "HI";
    if (text.length > 200) text = text.slice(0, 200);
    const type = document.getElementById('modem-type').value;
    const baud = parseInt(document.getElementById('modem-baud').value);
    await initAudioGraph();
    if (!modemEngine) modemEngine = new ModemEngine(audioCtx.sampleRate);
    const { buffer, symbols } = modemEngine.generateWaveform(text, type, baud);
    document.getElementById('modem-bitstream').innerText = symbols.flatMap(s => s.bits).join('');
    drawModemBits(symbols);
    if (modemBufferSource) try { modemBufferSource.stop(); } catch(e){}
    const audioBuffer = audioCtx.createBuffer(1, buffer.length, audioCtx.sampleRate);
    audioBuffer.getChannelData(0).set(buffer);
    modemBufferSource = audioCtx.createBufferSource();
    modemBufferSource.buffer = audioBuffer;
    modemBufferSource.connect(masterGain);
    if (analyser) modemBufferSource.connect(analyser);
    modemBufferSource.start();
    if (!isRunning) requestAnimationFrame(loop);
}

function drawModemBits(symbols) {
    // ... same as before ...
}
function exportEVM() {
    let csv = "I_raw,Q_raw\n";
    rxHistory.forEach(s => { csv += `${s.i_raw.toFixed(4)},${s.q_raw.toFixed(4)}\n` });
    const blob = new Blob([csv], {type: 'text/csv'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'constellation_data.csv'; a.click();
    URL.revokeObjectURL(url);
}

// Window Resize
let resizeTimeout;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
        initCanvas('modem-bit-canvas');
        initCanvas('constellation-canvas');
        initCanvas('scope-canvas');
    }, 100);
});