// ! CONFIG
const CONFIG = {
    carrierFreq: 1200,   
    baudRate: 20,        
    sampleRate: 44100,   
    squelch: 0.01        
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
        document.getElementById('rx-text').innerText = "Cleared.";
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
    constructor(sampleRate, carrierFreq) {
        this.sampleRate = sampleRate;
        this.freq = 2 * Math.PI * carrierFreq / sampleRate;
        this.phase = 0;
        this.errorInt = 0; 
        this.alpha = 0.05; 
        this.beta = 0.002; 
        this.lpfI = 0;
        this.lpfQ = 0;
        this.lpfAlpha = 0.1; 
        this.text = "";
    }

    clear() {
        this.text = "";
        document.getElementById('rx-text').innerText = "";
    }

    processBlock(inputBuffer) {
        const points = [];
        let energySum = 0;
        for(let s of inputBuffer) energySum += s*s;
        const rms = Math.sqrt(energySum / inputBuffer.length);
        if (rms < CONFIG.squelch) return [];

        const viewStep = 8; 
        for (let i = 0; i < inputBuffer.length; i++) {
            const sample = inputBuffer[i];
            const loI = Math.cos(this.phase);
            const loQ = -Math.sin(this.phase);
            let rawI = sample * loI;
            let rawQ = sample * loQ;
            this.lpfI = this.lpfI + this.lpfAlpha * (rawI - this.lpfI);
            this.lpfQ = this.lpfQ + this.lpfAlpha * (rawQ - this.lpfQ);

            // Generic Error Detector for PSK/QAM
            // For BPSK/QPSK, this is standard. For higher QAM, it still tracks carrier phase.
            const signI = this.lpfI > 0 ? 1 : -1;
            const signQ = this.lpfQ > 0 ? 1 : -1;
            const error = (signI * this.lpfQ) - (signQ * this.lpfI);

            this.errorInt += error * this.beta; 
            this.phase += this.freq + (error * this.alpha) + this.errorInt;
            
            if (i % viewStep === 0) {
                points.push({ i: this.lpfI, q: this.lpfQ });
            }
        }
        this.phase = this.phase % (2 * Math.PI);
        return points;
    }
}

class ModemEngine {
    constructor(sampleRate, carrier, baud) {
        this.sampleRate = sampleRate;
        this.carrier = carrier;
        this.baud = baud;
        this.omega = 2 * Math.PI * carrier / sampleRate;
        this.symbolPeriod = Math.floor(sampleRate / baud);
    }

    generateAudioBuffer(text, type, ctx) {
        // 1. Convert Text to Bits
        let bits = [];
        for (let i = 0; i < text.length; i++) {
            const charCode = text.charCodeAt(i);
            for (let b = 7; b >= 0; b--) bits.push((charCode >> b) & 1);
        }

        const idealPoints = getIdealPoints(type);
        const bitsPerSymbol = Math.log2(idealPoints.length);

        // Pad bits to match symbol size
        while (bits.length % bitsPerSymbol !== 0) bits.push(0);

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
                // Modulate: I*cos - Q*sin
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
            audio: { 
                deviceId: selectedDeviceId ? { exact: selectedDeviceId } : undefined, 
                echoCancellation: false, 
                autoGainControl: false, 
                noiseSuppression: false 
            }
        });
        
        if (micSource) try { micSource.disconnect(); } catch(e){}
        micSource = audioCtx.createMediaStreamSource(stream);
        micSource.connect(analyser);

        receiver = new CostasLoopReceiver(audioCtx.sampleRate, CONFIG.carrierFreq);
        modemEngine = new ModemEngine(audioCtx.sampleRate, CONFIG.carrierFreq, CONFIG.baudRate);

        isRunning = true;
        const s = document.getElementById('status-badge');
        s.innerText = "Receiving";
        s.className = "status-badge success";
        
        const btn = document.getElementById('btn-toggle-scan');
        if(btn) {
            btn.innerText = "Stop Scan";
            btn.style.background = '#d32f2f'; 
            btn.style.borderColor = '#d32f2f';
        }
        
        loop();

    } catch(e) { 
        console.error("Start Error:", e);
        alert("Mic Error: " + e.message); 
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
    
    const btn = document.getElementById('btn-toggle-scan');
    if(btn) {
        btn.innerText = "Start Scan";
        btn.style.background = '';
        btn.style.borderColor = '';
    }
}

function loop() {
    if (!isRunning) return;
    requestAnimationFrame(loop);
    
    analyser.getFloatTimeDomainData(waveArray);
    drawScope(waveArray);
    
    if (receiver) {
        const constellationPoints = receiver.processBlock(waveArray);
        drawConstellation(constellationPoints);
    }
}

// --- CALIBRATION ---
let calibrationScale = 1.0; 

async function startCalibration() {
    const wasRunning = isRunning;
    let tempStream = null;
    const s = document.getElementById('status-badge');
    
    if (!wasRunning) {
         if (!confirm("Start calibration test tone?")) return;
    }

    s.innerText = "Calibrating...";
    s.className = "status-badge info";

    try {
        await initAudioGraph();
        if (!micSource) {
            const devId = document.getElementById('device-select').value;
            tempStream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: devId ? { exact: devId } : undefined } });
            micSource = audioCtx.createMediaStreamSource(tempStream);
            micSource.connect(analyser);
        }

        const osc = audioCtx.createOscillator();
        osc.frequency.setValueAtTime(CONFIG.carrierFreq, audioCtx.currentTime);
        osc.connect(masterGain);
        osc.start();

        await new Promise(r => setTimeout(r, 600)); 

        const magnitudes = [];
        const startTime = performance.now();

        const listen = () => {
            if (performance.now() - startTime > 1000) {
                osc.stop();
                if (tempStream) {
                    tempStream.getTracks().forEach(t => t.stop());
                    micSource = null;
                }
                if (magnitudes.length === 0) {
                    s.innerText = "No Signal";
                } else {
                    const avg = magnitudes.reduce((a,b)=>a+b,0) / magnitudes.length;
                    calibrationScale = 0.75 / Math.max(avg, 0.001);
                    s.innerText = "Calibrated";
                }
                return;
            }
            analyser.getFloatTimeDomainData(waveArray);
            let e = 0;
            for(let x of waveArray) e += x*x;
            magnitudes.push(Math.sqrt(e/waveArray.length));
            requestAnimationFrame(listen);
        };
        listen();

    } catch(e) { alert(e.message); }
}

function drawConstellation(points, clearGrid = false) {
    const c = document.getElementById('constellation-canvas');
    if (!c) return;
    const ctx = c.getContext('2d');
    const w = c.width, h = c.height;

    ctx.fillStyle = clearGrid ? '#0b0b0b' : 'rgba(0,0,0,0.2)'; 
    ctx.fillRect(0, 0, w, h);

    // Crosshairs
    ctx.strokeStyle = '#333';
    ctx.beginPath();
    ctx.moveTo(w/2, 0); ctx.lineTo(w/2, h);
    ctx.moveTo(0, h/2); ctx.lineTo(w, h/2);
    ctx.stroke();

    // Ideal Grid
    const type = document.getElementById('modem-type').value;
    const ideal = getIdealPoints(type);
    ctx.fillStyle = '#444';
    const scale = 0.8;
    for(let p of ideal) {
        ctx.beginPath();
        ctx.arc((p.I * scale + 1) * w/2, (-p.Q * scale + 1) * h/2, 3, 0, 7);
        ctx.fill();
    }

    if (!points || points.length === 0) return;

    ctx.fillStyle = THEME.accent;
    ctx.shadowBlur = 10;
    ctx.shadowColor = THEME.accent;
    for(let p of points) {
        const x = (p.i * 2.5 * scale + 1) * (w/2);
        const y = (-p.q * 2.5 * scale + 1) * (h/2);
        if (x < 0 || x > w || y < 0 || y > h) continue;
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, 7);
        ctx.fill();
    }
    ctx.shadowBlur = 0;
}

function drawScope(buffer) {
    const c = document.getElementById('scope-canvas');
    if(!c) return;
    const ctx = c.getContext('2d');
    const w = c.width, h = c.height;
    ctx.fillStyle = '#0b0b0b'; ctx.fillRect(0,0,w,h);
    ctx.strokeStyle = THEME.accent; ctx.beginPath();
    const step = w / buffer.length;
    let x = 0;
    for(let i=0; i<buffer.length; i+=2) {
        const y = (h/2) - (buffer[i] * h/2 * 2.0);
        if(i===0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        x += step * 2;
    }
    ctx.stroke();
}

async function transmitModemData() {
    let text = document.getElementById('modem-input').value || "HI";
    const type = document.getElementById('modem-type').value;
    const baud = parseInt(document.getElementById('modem-baud').value);
    
    await initAudioGraph();
    const engine = new ModemEngine(audioCtx.sampleRate, CONFIG.carrierFreq, baud);
    const buffer = engine.generateAudioBuffer(text, type, audioCtx);
    
    if (modemBufferSource) try { modemBufferSource.stop(); } catch(e){}
    modemBufferSource = audioCtx.createBufferSource();
    modemBufferSource.buffer = buffer;
    modemBufferSource.connect(masterGain);
    if (analyser) modemBufferSource.connect(analyser);
    modemBufferSource.start();
    
    if (!isRunning) {
        isRunning = true;
        loop();
        setTimeout(() => { if(isRunning && !micSource) isRunning = false; }, 3000);
    }
}

// ! Window Resize
let resizeTimeout;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
        initCanvas('modem-bit-canvas');
        initCanvas('constellation-canvas');
        initCanvas('scope-canvas');
    }, 100);
});