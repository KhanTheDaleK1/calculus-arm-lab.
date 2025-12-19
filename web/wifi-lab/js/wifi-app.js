// ! CONFIG
const CONFIG = {
    carrierFreq: 1200,   
    baudRate: 20,        
    sampleRate: 44100,   
    squelch: 0.05        
};

const THEME = { accent: '#d05ce3', bg: '#141414', grid: '#333' };

// ! STATE
let audioCtx, analyser, micSource;
let masterGain;
let isRunning = false;
let waveArray;

function initCanvas(id) {
    const c = document.getElementById(id);
    if(c) { c.width = c.clientWidth; c.height = c.clientHeight; }
}

// ! RX/TX STATE
let modemEngine;
let modemBufferSource = null;
let receiver;

window.onload = () => {
    initCanvas('modem-bit-canvas');
    initCanvas('constellation-canvas');
    initCanvas('scope-canvas');

    populateMics();

    // ! Bindings
    const toggleBtn = document.getElementById('btn-toggle-scan');
    if (toggleBtn) {
        toggleBtn.onclick = () => {
            if (isRunning) stopReceiver();
            else startReceiver();
        };
    }

    const sendBtn = document.getElementById('btn-modem-send');
    if (sendBtn) sendBtn.onclick = transmitModemData;

    document.getElementById('modem-type').onchange = () => {
        drawConstellation([], true); 
    };
    
    document.getElementById('btn-rx-clear').onclick = () => {
        if (receiver) receiver.clear();
    };
    
    document.getElementById('btn-calibrate').onclick = startCalibration;
    
    document.getElementById('btn-connect-ti84').onclick = () => {
        alert("TI-84 Connection feature coming soon!");
    };

    drawConstellation([], true); 
};

function populateMics() {
    const toggleBtn = document.getElementById('btn-toggle-scan');
    const sel = document.getElementById('device-select');
    if (!sel || !toggleBtn) return;
    
    toggleBtn.disabled = true;
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
                toggleBtn.disabled = false;
            }
        }).catch(err => {
            console.error("Mic detection error:", err);
            sel.innerHTML = '<option>Error: Check Permissions</option>';
        });
    } else {
        sel.innerHTML = '<option>Not Supported</option>';
    }
}

// ==========================================
// ! DSP CLASSES
// ==========================================

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

class CostasLoopReceiver {
    constructor(sampleRate, carrierFreq, baud) {
        this.sampleRate = sampleRate;
        this.freq = 2 * Math.PI * carrierFreq / sampleRate;
        this.phase = 0;
        this.errorInt = 0; 
        this.alpha = 0.05; 
        this.beta = 0.002; 
        this.lpfI = 0;
        this.lpfQ = 0;
        this.lpfAlpha = 0.1; 
        
        // Decoding State
        this.baud = baud;
        this.samplesPerSymbol = sampleRate / baud;
        this.symbolCounter = 0;
        this.isSyncing = false;
        this.bitBuffer = [];
        this.message = "";
        this.state = 'IDLE'; // IDLE, DATA
        this.byteBuffer = [];
    }

    clear() {
        this.message = "";
        this.bitBuffer = [];
        this.byteBuffer = [];
        this.state = 'IDLE';
        this.isSyncing = false;
        document.getElementById('rx-text').innerText = "Waiting for signal...";
    }

    processBlock(inputBuffer, modulationType) {
        const points = [];
        let energySum = 0;
        for(let s of inputBuffer) energySum += s*s;
        const rms = Math.sqrt(energySum / inputBuffer.length);
        
        const uiText = document.getElementById('rx-text');

        for (let i = 0; i < inputBuffer.length; i++) {
            const sample = inputBuffer[i];
            const loI = Math.cos(this.phase);
            const loQ = -Math.sin(this.phase);
            let rawI = sample * loI;
            let rawQ = sample * loQ;
            this.lpfI = this.lpfI + this.lpfAlpha * (rawI - this.lpfI);
            this.lpfQ = this.lpfQ + this.lpfAlpha * (rawQ - this.lpfQ);

            const signI = this.lpfI > 0 ? 1 : -1;
            const signQ = this.lpfQ > 0 ? 1 : -1;
            const error = (signI * this.lpfQ) - (signQ * this.lpfI);

            this.errorInt += error * this.beta; 
            this.phase += this.freq + (error * this.alpha) + this.errorInt;

            // --- Symbol Sampling ---
            if (rms > CONFIG.squelch) {
                if (!this.isSyncing) {
                    this.isSyncing = true;
                    this.symbolCounter = Math.floor(this.samplesPerSymbol / 2); // Sample at middle
                }
                
                this.symbolCounter--;
                if (this.symbolCounter <= 0) {
                    this.symbolCounter = this.samplesPerSymbol;
                    // We just hit a symbol center!
                    const bits = this.slice(this.lpfI, this.lpfQ, modulationType);
                    this.processBits(bits);
                    points.push({ i: this.lpfI, q: this.lpfQ });
                }
            } else {
                this.isSyncing = false;
            }
        }
        this.phase = this.phase % (2 * Math.PI);
        return points;
    }

    slice(I, Q, type) {
        if (type === 'BPSK') return [I > 0 ? 1 : 0];
        if (type === 'QPSK') return [I > 0 ? 1 : 0, Q > 0 ? 1 : 0];
        if (type === 'QAM16') {
            const i_bit = I < -0.4 ? [0,0] : I < 0 ? [0,1] : I < 0.4 ? [1,1] : [1,0];
            const q_bit = Q < -0.4 ? [0,0] : Q < 0 ? [0,1] : Q < 0.4 ? [1,1] : [1,0];
            return [...i_bit, ...q_bit];
        }
        return [I > 0 ? 1 : 0]; // Default
    }

    processBits(newBits) {
        this.bitBuffer.push(...newBits);

        while (this.bitBuffer.length >= 1) {
            if (this.state === 'IDLE') {
                // Hunt for START bit (0)
                if (this.bitBuffer.shift() === 0) {
                    this.state = 'DATA';
                    this.byteBuffer = [];
                }
            } else if (this.state === 'DATA') {
                if (this.bitBuffer.length >= 8) {
                    const byteBits = this.bitBuffer.splice(0, 8);
                    const charCode = parseInt(byteBits.join(''), 2);
                    if (charCode >= 32 && charCode <= 126) {
                        this.message += String.fromCharCode(charCode);
                        document.getElementById('rx-text').innerText = this.message;
                    }
                    this.state = 'IDLE'; // Back to hunting
                } else {
                    break; 
                }
            }
        }
    }
}

class ModemEngine {
    constructor(sampleRate, carrier, baud) {
        this.sampleRate = sampleRate;
        this.omega = 2 * Math.PI * carrier / sampleRate;
        this.symbolPeriod = Math.floor(sampleRate / baud);
    }

    generateAudioBuffer(text, type, ctx) {
        let bits = [];
        
        // Preamble for AGC/PLL
        bits.push(...new Array(16).fill(1));

        for (let i = 0; i < text.length; i++) {
            const charCode = text.charCodeAt(i);
            bits.push(0); // START BIT
            for (let b = 7; b >= 0; b--) bits.push((charCode >> b) & 1);
            bits.push(1); // STOP BIT
        }

        const idealPoints = getIdealPoints(type);
        const bitsPerSymbol = Math.log2(idealPoints.length);
        while (bits.length % bitsPerSymbol !== 0) bits.push(1);

        const totalSymbols = bits.length / bitsPerSymbol;
        const totalSamples = totalSymbols * this.symbolPeriod;
        const buffer = ctx.createBuffer(1, totalSamples, this.sampleRate);
        const data = buffer.getChannelData(0);

        let phase = 0;
        let sampleIdx = 0;
        for (let i = 0; i < bits.length; i += bitsPerSymbol) {
            const chunk = bits.slice(i, i + bitsPerSymbol);
            const symbolIndex = parseInt(chunk.join(''), 2);
            const point = idealPoints[symbolIndex % idealPoints.length];
            for (let t = 0; t < this.symbolPeriod; t++) {
                data[sampleIdx] = (point.I * Math.cos(phase) - point.Q * Math.sin(phase));
                phase += this.omega;
                sampleIdx++;
            }
        }
        return buffer;
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
            audio: { deviceId: selectedDeviceId ? { exact: selectedDeviceId } : undefined }
        });
        micSource = audioCtx.createMediaStreamSource(stream);
        micSource.connect(analyser);

        const baud = parseInt(document.getElementById('modem-baud').value);
        receiver = new CostasLoopReceiver(audioCtx.sampleRate, CONFIG.carrierFreq, baud);

        isRunning = true;
        document.getElementById('status-badge').innerText = "Receiving";
        document.getElementById('status-badge').className = "status-badge success";
        document.getElementById('btn-toggle-scan').innerText = "Stop Scan";
        document.getElementById('btn-toggle-scan').style.background = "#d32f2f";
        
        loop();
    } catch(e) { alert("Mic Error: " + e.message); }
}

function stopReceiver() {
    isRunning = false;
    if(micSource) micSource.disconnect();
    if(audioCtx) audioCtx.close();
    audioCtx = null;
    micSource = null;
    document.getElementById('status-badge').innerText = "Idle";
    document.getElementById('status-badge').className = "status-badge warn";
    document.getElementById('btn-toggle-scan').innerText = "Start Scan";
    document.getElementById('btn-toggle-scan').style.background = "";
}

function loop() {
    if (!isRunning) return;
    requestAnimationFrame(loop);
    analyser.getFloatTimeDomainData(waveArray);
    drawScope(waveArray);
    if (receiver) {
        const type = document.getElementById('modem-type').value;
        const points = receiver.processBlock(waveArray, type);
        drawConstellation(points);
    }
}

async function startCalibration() {
    // Shared calibration logic as before
    const s = document.getElementById('status-badge');
    s.innerText = "Calibrating...";
    await initAudioGraph();
    const osc = audioCtx.createOscillator();
    osc.frequency.setValueAtTime(CONFIG.carrierFreq, audioCtx.currentTime);
    osc.connect(masterGain);
    osc.start();
    setTimeout(() => {
        osc.stop();
        s.innerText = isRunning ? "Receiving" : "Calibrated";
    }, 1000);
}

function drawConstellation(points, clear = false) {
    const c = document.getElementById('constellation-canvas');
    const ctx = c.getContext('2d');
    const w = c.width, h = c.height;
    ctx.fillStyle = clear ? '#0b0b0b' : 'rgba(0,0,0,0.2)'; 
    ctx.fillRect(0,0,w,h);
    ctx.strokeStyle = '#333'; ctx.beginPath();
    ctx.moveTo(w/2,0); ctx.lineTo(w/2,h); ctx.moveTo(0,h/2); ctx.lineTo(w,h/2); ctx.stroke();
    
    const type = document.getElementById('modem-type').value;
    const ideal = getIdealPoints(type);
    ctx.fillStyle = '#444';
    ideal.forEach(p => {
        ctx.beginPath(); ctx.arc((p.I*0.8+1)*w/2, (-p.Q*0.8+1)*h/2, 3, 0, 7); ctx.fill();
    });

    if (!points) return;
    ctx.fillStyle = THEME.accent;
    points.forEach(p => {
        const x = (p.i*2+1)*w/2;
        const y = (-p.q*2+1)*h/2;
        ctx.beginPath(); ctx.arc(x, y, 4, 0, 7); ctx.fill();
    });
}

function drawScope(buffer) {
    const c = document.getElementById('scope-canvas');
    const ctx = c.getContext('2d');
    const w = c.width, h = c.height;
    ctx.fillStyle = '#0b0b0b'; ctx.fillRect(0,0,w,h);
    ctx.strokeStyle = THEME.accent; ctx.beginPath();
    for(let i=0; i<w; i++) {
        const v = buffer[Math.floor(i/w*buffer.length)];
        const y = (h/2) - (v*h/2);
        if(i===0) ctx.moveTo(i,y); else ctx.lineTo(i,y);
    }
    ctx.stroke();
}

async function transmitModemData() {
    const text = document.getElementById('modem-input').value || "HI";
    const type = document.getElementById('modem-type').value;
    const baud = parseInt(document.getElementById('modem-baud').value);
    await initAudioGraph();
    const engine = new ModemEngine(audioCtx.sampleRate, CONFIG.carrierFreq, baud);
    const buffer = engine.generateAudioBuffer(text, type, audioCtx);
    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(masterGain);
    if(analyser) source.connect(analyser);
    source.start();
}

// ! Resize handling
window.addEventListener('resize', () => {
    initCanvas('modem-bit-canvas');
    initCanvas('constellation-canvas');
    initCanvas('scope-canvas');
});
