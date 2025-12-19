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
let calibrationScale = 1.0; 

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

    if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
        const msg = "⚠️ SECURITY ERROR: HTTPS required for Microphone access.";
        console.error(msg);
        document.getElementById('rx-text').innerHTML = `<span style="color:#ff5555">${msg}</span>`;
    }

    populateMics();

    const toggleBtn = document.getElementById('btn-toggle-scan');
    if (toggleBtn) {
        toggleBtn.disabled = false; 
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

    document.getElementById('modem-baud').onchange = (e) => {
        const newBaud = parseInt(e.target.value);
        if (receiver) receiver.updateBaud(newBaud);
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
    const sel = document.getElementById('device-select');
    if (!sel) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
        sel.innerHTML = '<option>Browser Not Supported</option>';
        return;
    }
    navigator.mediaDevices.enumerateDevices()
    .then(devs => {
        const mics = devs.filter(d => d.kind === 'audioinput');
        sel.innerHTML = '';
        if (mics.length === 0) {
            sel.innerHTML = '<option>No Mics Found</option>';
        } else {
            mics.forEach((d, i) => {
                const opt = document.createElement('option');
                opt.value = d.deviceId;
                opt.text = d.label || `Microphone ${i + 1} (Grant Permission)`;
                sel.appendChild(opt);
            });
        }
    }).catch(err => {
        console.error(err);
        sel.innerHTML = '<option>Error detecting mics</option>';
    });
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
        this.updateBaud(baud);
        this.symbolCounter = 0;
        this.isSyncing = false;
        this.bitBuffer = [];
        this.message = "";
        this.state = 'IDLE'; 
        this.byteBuffer = [];
    }

    updateBaud(newBaud) {
        this.baud = newBaud;
        this.samplesPerSymbol = this.sampleRate / newBaud;
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
        
        for (let i = 0; i < inputBuffer.length; i++) {
            const sample = inputBuffer[i] * calibrationScale; // Apply calibration
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

            if (rms > CONFIG.squelch) {
                if (!this.isSyncing) {
                    this.isSyncing = true;
                    this.symbolCounter = Math.floor(this.samplesPerSymbol / 2); 
                }
                this.symbolCounter--;
                if (this.symbolCounter <= 0) {
                    this.symbolCounter = this.samplesPerSymbol;
                    const bits = this.slice(this.lpfI, this.lpfQ, modulationType);
                    this.processBits(bits);
                    points.push({ i: this.lpfI, q: this.lpfQ });
                }
            } else {
                this.isSyncing = false;
                this.state = 'IDLE'; 
            }
        }
        this.phase = this.phase % (2 * Math.PI);
        return points;
    }

    slice(I, Q, type) {
        // Gain adjusted by calibrationScale now, so thresholds are normalized
        const sI = I * 2.0; 
        const sQ = Q * 2.0;
        if (type === 'BPSK') return [sI > 0 ? 1 : 0];
        if (type === 'QPSK') return [sI > 0 ? 1 : 0, sQ > 0 ? 1 : 0];
        if (type === 'QAM16') {
            const sl = (v) => v < -0.66 ? [0,0] : v < 0 ? [0,1] : v < 0.66 ? [1,1] : [1,0];
            return [...sl(sI), ...sl(sQ)];
        }
        return [sI > 0 ? 1 : 0]; 
    }

        processBits(newBits) {

            this.bitBuffer.push(...newBits);

    

            // Loop until we don't have enough bits to proceed

            while (true) {

                if (this.state === 'IDLE') {

                    if (this.bitBuffer.length === 0) break;

                    

                    // Peek at the first bit

                    const bit = this.bitBuffer[0];

                    

                    if (bit === 0) { 

                        // Found START BIT (0). Consume it and switch to DATA.

                        this.bitBuffer.shift(); 

                        this.state = 'DATA';

                        this.byteBuffer = [];

                    } else {

                        // Found a 1 (Idle/Preamble). Consume it and ignore.

                        this.bitBuffer.shift();

                    }

                } 

                else if (this.state === 'DATA') {

                    if (this.bitBuffer.length === 0) break;

                    

                    // Collect 8 data bits

                    this.byteBuffer.push(this.bitBuffer.shift());

                    

                    if (this.byteBuffer.length === 8) {

                        this.state = 'STOP';

                    }

                } 

                else if (this.state === 'STOP') {

                    if (this.bitBuffer.length === 0) break;

                    

                    const stopBit = this.bitBuffer.shift();

                    

                    if (stopBit === 1) {

                        // VALID FRAME. Decode the Byte.

                        const charCode = parseInt(this.byteBuffer.join(''), 2);

                        // Filter printable characters

                        if (charCode >= 32 && charCode <= 126) {

                            this.message += String.fromCharCode(charCode);

                            document.getElementById('rx-text').innerText = this.message;

                        }

                    } else {

                        // FRAMING ERROR (Bit Slip). Discard byte.

                        console.warn("Framing Error: Expected Stop Bit (1), got 0");

                    }

                    

                    // Reset for next character

                    this.state = 'IDLE';

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
        // Robust Preamble: All 1s (Idle High) so the receiver ignores it while syncing phase/gain
        for(let p=0; p<40; p++) bits.push(1); 

        for (let i = 0; i < text.length; i++) {
            const charCode = text.charCodeAt(i);
            bits.push(0); 
            for (let b = 7; b >= 0; b--) bits.push((charCode >> b) & 1);
            bits.push(1); 
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

// --- MAIN AUDIO ---

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
        const sel = document.getElementById('device-select');
        const constraints = { audio: (sel && sel.value && sel.value.length > 5) ? { deviceId: { exact: sel.value } } : true };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
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
        populateMics();
    } catch(e) { 
        console.error(e);
        document.getElementById('rx-text').innerHTML = `<span style="color:#ff5555">Error: ${e.message}</span>`;
    }
}

function stopReceiver() {
    isRunning = false;
    if(micSource) {
        const stream = micSource.mediaStream;
        if (stream) stream.getTracks().forEach(t => t.stop());
        micSource.disconnect();
    }
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
    const s = document.getElementById('status-badge');
    s.innerText = "Calibrating...";
    s.className = "status-badge info";
    await initAudioGraph();
    
    // Create a temporary stream if receiver is not running
    let tempStream = null;
    if (!micSource) {
        const sel = document.getElementById('device-select');
        const constraints = { audio: (sel && sel.value && sel.value.length > 5) ? { deviceId: { exact: sel.value } } : true };
        tempStream = await navigator.mediaDevices.getUserMedia(constraints);
        micSource = audioCtx.createMediaStreamSource(tempStream);
        micSource.connect(analyser);
    }

    // Play modulated sync sequence for calibration
    const engine = new ModemEngine(audioCtx.sampleRate, CONFIG.carrierFreq, 20);
    const buffer = engine.generateAudioBuffer("CALIBRATE", "QPSK", audioCtx);
    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(masterGain);
    source.start();

    const magnitudes = [];
    const startTime = performance.now();
    const listen = () => {
        if (performance.now() - startTime > 1500) {
            source.stop();
            if (tempStream) {
                tempStream.getTracks().forEach(t => t.stop());
                micSource = null;
            }
            if (magnitudes.length > 0) {
                const avg = magnitudes.reduce((a,b)=>a+b,0) / magnitudes.length;
                calibrationScale = 0.5 / Math.max(avg, 0.001);
                s.innerText = "Calibrated";
                s.className = "status-badge success";
            } else {
                s.innerText = "Failed";
                s.className = "status-badge error";
            }
            return;
        }
        analyser.getFloatTimeDomainData(waveArray);
        let e = 0; for(let x of waveArray) e += x*x;
        magnitudes.push(Math.sqrt(e/waveArray.length));
        requestAnimationFrame(listen);
    };
    listen();
}

function drawConstellation(points, clear = false) {
    const c = document.getElementById('constellation-canvas');
    if (!c) return;
    const ctx = c.getContext('2d');
    const w = c.width, h = c.height;
    ctx.fillStyle = clear ? '#0b0b0b' : 'rgba(0,0,0,0.2)'; 
    ctx.fillRect(0,0,w,h);
    ctx.strokeStyle = '#333'; ctx.beginPath();
    ctx.moveTo(w/2,0); ctx.lineTo(w/2,h); ctx.moveTo(0,h/2); ctx.lineTo(w,h/2); ctx.stroke();
    const type = document.getElementById('modem-type').value;
    const ideal = getIdealPoints(type);
    ctx.fillStyle = '#444';
    for (let p of ideal) {
        ctx.beginPath(); ctx.arc((p.I*0.8+1)*w/2, (-p.Q*0.8+1)*h/2, 3, 0, 7); ctx.fill();
    }
    if (!points) return;
    ctx.fillStyle = THEME.accent;
    ctx.shadowBlur = 10; ctx.shadowColor = THEME.accent;
    for (let p of points) {
        const x = (p.i*2.0*0.8+1)*w/2;
        const y = (-p.q*2.0*0.8+1)*h/2;
        if (x >= 0 && x <= w && y >= 0 && y <= h) {
            ctx.beginPath(); ctx.arc(x, y, 4, 0, 7); ctx.fill();
        }
    }
    ctx.shadowBlur = 0;
}

function drawScope(buffer) {
    const c = document.getElementById('scope-canvas');
    if (!c) return;
    const ctx = c.getContext('2d');
    const w = c.width, h = c.height;
    ctx.fillStyle = '#0b0b0b'; ctx.fillRect(0,0,w,h);
    ctx.strokeStyle = THEME.accent; ctx.beginPath();
    for(let i=0; i<w; i+=2) {
        const v = buffer[Math.floor(i/w*buffer.length)];
        const y = (h/2) - (v*h/2*2);
        if(i===0) ctx.moveTo(i,y); else ctx.lineTo(i,y);
    }
    ctx.stroke();
}

async function transmitModemData() {
    const text = document.getElementById('modem-input').value || "HI";
    const type = document.getElementById('modem-type').value;
    const baud = parseInt(document.getElementById('modem-baud').value);
    const sendBtn = document.getElementById('btn-modem-send');
    await initAudioGraph();
    const engine = new ModemEngine(audioCtx.sampleRate, CONFIG.carrierFreq, baud);
    const buffer = engine.generateAudioBuffer(text, type, audioCtx);
    if (modemBufferSource) try { modemBufferSource.stop(); } catch(e){}
    modemBufferSource = audioCtx.createBufferSource();
    modemBufferSource.buffer = buffer;
    modemBufferSource.connect(masterGain);
    if(analyser) modemBufferSource.connect(analyser);
    if (sendBtn) {
        sendBtn.innerText = "SENDING...";
        sendBtn.disabled = true;
        modemBufferSource.onended = () => {
            sendBtn.innerText = "SEND";
            sendBtn.disabled = false;
        };
    }
    modemBufferSource.start();
}

window.addEventListener('resize', () => {
    initCanvas('modem-bit-canvas');
    initCanvas('constellation-canvas');
    initCanvas('scope-canvas');
});
