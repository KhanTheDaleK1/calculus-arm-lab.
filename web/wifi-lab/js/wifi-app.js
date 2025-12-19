// CONFIG
const THEME = { accent: '#d05ce3', bg: '#141414', grid: '#333' };
const CARRIER_FREQ = 1000;

// STATE
let audioCtx, analyser, micSource;
let masterGain;
let isRunning = false;
let waveArray;

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

    // Device Detection
    if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
        navigator.mediaDevices.enumerateDevices().then(devs => {
            const sel = document.getElementById('device-select');
            if (sel) {
                sel.innerHTML = '';
                const mics = devs.filter(d => d.kind === 'audioinput');
                if (mics.length === 0) {
                    const opt = document.createElement('option');
                    opt.text = "No Mics / Permission Needed";
                    sel.appendChild(opt);
                } else {
                    mics.forEach((d, i) => {
                        const opt = document.createElement('option');
                        opt.value = d.deviceId;
                        opt.text = d.label || `Mic ${i + 1}`;
                        sel.appendChild(opt);
                    });
                }
            }
        });
    }

    // Bindings
    document.getElementById('btn-start').onclick = startReceiver;
    document.getElementById('btn-stop').onclick = stopReceiver;
    document.getElementById('btn-modem-send').onclick = transmitModemData;
    document.getElementById('modem-type').onchange = () => {
        drawConstellation([]); // Redraw grid on change
    };
    document.getElementById('btn-rx-clear').onclick = () => {
        receiver.clear();
        document.getElementById('rx-text').innerText = "Cleared.";
    };

    drawConstellation([]); // Draw initial grid
};


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
    constructor() { this.bits = []; this.text = ""; }
    clear() { this.bits = []; this.text = ""; }
    processSymbol(bits) {
        this.bits.push(...bits);
        if (this.bits.length >= 8) {
            const byte = this.bits.splice(0, 8);
            const charCode = parseInt(byte.join(''), 2);
            this.text += String.fromCharCode(charCode);
        }
    }
    getSlicer(type) {
        if (type === 'BPSK') return (i, q) => [i > 0 ? 1 : 0];
        if (type === 'QPSK') return (i, q) => [i > 0 ? 1 : 0, q > 0 ? 1 : 0];
        if (type === 'QAM16') return (i, q) => {
            const levels = [-2/3, 0, 2/3]; // Decision boundaries for {-1, -1/3, 1/3, 1}
            const i_bits = i < levels[0] ? [0,0] : i < levels[1] ? [0,1] : i < levels[2] ? [1,1] : [1,0];
            const q_bits = q < levels[0] ? [0,0] : q < levels[1] ? [0,1] : q < levels[2] ? [1,1] : [1,0];
            return [...i_bits, ...q_bits];
        };
        // 64-QAM is more complex, uses 7 boundaries.
        if (type === 'QAM64') return (i, q) => {
            const levels = [-6/7, -4/7, -2/7, 0, 2/7, 4/7, 6/7];
            const toBits = v => {
                if (v < levels[0]) return [0,0,0]; if (v < levels[1]) return [0,0,1];
                if (v < levels[2]) return [0,1,1]; if (v < levels[3]) return [0,1,0];
                if (v < levels[4]) return [1,1,0]; if (v < levels[5]) return [1,1,1];
                if (v < levels[6]) return [1,0,1]; return [1,0,0];
            };
            return [...toBits(i), ...toBits(q)];
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
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: document.getElementById('device-select').value || undefined, echoCancellation: false, autoGainControl: false, noiseSuppression: false, latency: 0 }});
        if (micSource) micSource.disconnect();
        micSource = audioCtx.createMediaStreamSource(stream);
        micSource.connect(analyser);
        isRunning = true;
        document.getElementById('status-badge').innerText = "Receiving";
        document.getElementById('status-badge').className = "status-badge success";
        loop();
    } catch(e) { alert("Mic Error: " + e); }
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
    
    // Apply AGC
    const usePll = document.getElementById('rx-pll-enable').checked;
    if (usePll) {
        waveArray = agc.process(waveArray);
    }

    drawScope(waveArray);
    
    // Demodulate and Draw
    const type = document.getElementById('modem-type').value;
    const baud = parseInt(document.getElementById('modem-baud').value);
    const samplesPerSymbol = audioCtx.sampleRate / baud;
    
    const symbols = demodulate(waveArray, samplesPerSymbol);
    drawConstellation(symbols);
}

function demodulate(buffer, samplesPerSymbol) {
    const omega = 2 * Math.PI * CARRIER_FREQ;
    const rate = audioCtx.sampleRate;
    const symbols = [];

    for (let i = 0; i < buffer.length - samplesPerSymbol; i += samplesPerSymbol) {
        let i_sum = 0, q_sum = 0;
        for (let j = 0; j < samplesPerSymbol; j++) {
            const t = (i + j) / rate;
            const val = buffer[i + j];
            i_sum += val * Math.cos(omega * t);
            q_sum += val * -Math.sin(omega * t);
        }
        // Average the integration
        let i_raw = (i_sum / samplesPerSymbol) * 2;
        let q_raw = (q_sum / samplesPerSymbol) * 2;
        
        symbols.push({i_raw, q_raw});
    }
    return symbols;
}

function drawConstellation(symbols) {
    const c = document.getElementById('constellation-canvas');
    if (!c) return;
    const ctx = c.getContext('2d');
    const w = c.width, h = c.height;

    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.fillRect(0, 0, w, h);
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
    
    const usePll = document.getElementById('rx-pll-enable').checked;
    const slicer = receiver.getSlicer(type);
    let total_error = 0;

    ctx.fillStyle = THEME.accent;
    symbols.forEach(s => {
        let {i_raw, q_raw} = s;
        
        // Manual Gain
        i_raw *= document.getElementById('rx-pll-enable').checked ? 1.0 : rxSettings.gain;
        q_raw *= document.getElementById('rx-pll-enable').checked ? 1.0 : rxSettings.gain;
        
        let i_final = i_raw;
        let q_final = q_raw;

        if (usePll) {
            const locked = costasLoop.process(i_raw, q_raw);
            i_final = locked.i;
            q_final = locked.q;
        }

        // Slice to get bits
        const bits = slicer(i_final, q_final);
        document.getElementById('rx-bits').innerText = bits.join('');
        receiver.processSymbol(bits);
        
        // Find nearest ideal point for EVM
        let min_dist_sq = Infinity;
        let nearest_point = {I:0, Q:0};
        for(const p of idealPoints) {
            const dist_sq = (i_final - p.I)**2 + (q_final - p.Q)**2;
            if (dist_sq < min_dist_sq) {
                min_dist_sq = dist_sq;
                nearest_point = p;
            }
        }
        total_error += min_dist_sq;
        
        // Plot
        const px = (w/2) + (i_final * (w/2) * scale);
        const py = (h/2) - (q_final * (h/2) * scale);
        ctx.beginPath();
        ctx.arc(px, py, 3, 0, Math.PI*2);
        ctx.fill();
    });

    document.getElementById('rx-text').innerText = receiver.text;
    document.getElementById('rx-evm').innerText = (Math.sqrt(total_error / symbols.length) * 100).toFixed(1) + '%';
    rxHistory = symbols;
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
    for(let i=0; i<w; i++) {
        const idx = Math.floor((i/w) * buffer.length);
        const v = buffer[idx];
        const y = (h/2) - (v * h/2 * 0.9);
        if(i===0) ctx.moveTo(x, y); else ctx.lineTo(i, y);
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