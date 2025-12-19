// ! CONFIG
const CONFIG = {
    carrierFreq: 1200,   // 1200 Hz Tone (Standard for Audio Modems)
    baudRate: 20,        // Default Baud
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

    // ! Populate Mic list on load
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
            console.error("An error occurred during mic detection:", err.name, err.message);
            if (err.name === 'NotAllowedError') {
                sel.innerHTML = '<option>Error: Permission Denied</option>';
            } else {
                sel.innerHTML = `<option>Error: ${err.name}</option>`;
            }
        });
    } else {
        sel.innerHTML = '<option>Not Supported</option>';
    }
}


// --- DSP CLASSES ---

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

        const viewStep = 10; 
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
            if (i % viewStep === 0) {
                points.push({ i: this.lpfI, q: this.lpfQ });
            }
        }
        this.phase = this.phase % (2 * Math.PI);
        return points;
    }
}

class QPSKModulator {
    constructor(sampleRate, carrier, baud) {
        this.sampleRate = sampleRate;
        this.omega = 2 * Math.PI * carrier / sampleRate;
        this.symbolPeriod = Math.floor(sampleRate / baud);
    }

    generateAudioBuffer(text, ctx) {
        let bits = [];
        for (let i = 0; i < text.length; i++) {
            const charCode = text.charCodeAt(i);
            for (let b = 7; b >= 0; b--) bits.push((charCode >> b) & 1);
        }
        if (bits.length % 2 !== 0) bits.push(0);
        const totalSamples = (bits.length / 2) * this.symbolPeriod;
        const buffer = ctx.createBuffer(1, totalSamples, this.sampleRate);
        const data = buffer.getChannelData(0);
        let phase = 0;
        let sampleIdx = 0;
        for (let i = 0; i < bits.length; i += 2) {
            const b0 = bits[i];
            const b1 = bits[i+1];
            let targetPhase = 0;
            if (b0 === 0 && b1 === 0) targetPhase = 0.25 * Math.PI;
            if (b0 === 0 && b1 === 1) targetPhase = 0.75 * Math.PI;
            if (b0 === 1 && b1 === 1) targetPhase = 1.25 * Math.PI;
            if (b0 === 1 && b1 === 0) targetPhase = 1.75 * Math.PI;
            for (let t = 0; t < this.symbolPeriod; t++) {
                data[sampleIdx] = Math.sin(phase + targetPhase);
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
                noiseSuppression: false, 
                latency: 0 
            }
        });
        
        if (micSource) try { micSource.disconnect(); } catch(e){}
        micSource = audioCtx.createMediaStreamSource(stream);
        micSource.connect(analyser);

        CONFIG.sampleRate = audioCtx.sampleRate;
        receiver = new CostasLoopReceiver(CONFIG.sampleRate, CONFIG.carrierFreq);
        modemEngine = new QPSKModulator(CONFIG.sampleRate, CONFIG.carrierFreq, CONFIG.baudRate);

        isRunning = true;
        const s = document.getElementById('status-badge');
        s.innerText = "Receiving";
        s.className = "status-badge success";
        
        const btn = document.getElementById('btn-toggle-scan');
        if(btn) {
            btn.innerText = "Stop Scan";
            btn.classList.remove('primary');
            btn.classList.add('action'); 
            btn.style.background = '#d32f2f'; 
            btn.style.borderColor = '#d32f2f';
        }
        
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
    
    const btn = document.getElementById('btn-toggle-scan');
    if(btn) {
        btn.innerText = "Start Scan";
        btn.classList.add('primary');
        btn.classList.remove('action');
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
    
    // If we are not running, we might need user interaction to start audio context
    // and we should warn them a tone is coming.
    if (!wasRunning) {
         const proceed = confirm("Calibration will play a test tone and activate your microphone for 1 second.\n\nEnsure your speakers are ON and volume is up.\n\nClick OK to start.");
         if (!proceed) return;
    }

    s.innerText = "Calibrating...";
    s.className = "status-badge info";

    try {
        await initAudioGraph();

        // 1. Ensure Mic is Connected
        // If not running, or if running but somehow micSource is missing
        if (!micSource) {
            const devId = document.getElementById('device-select').value;
            // Get a temporary stream
            tempStream = await navigator.mediaDevices.getUserMedia({ 
                audio: { 
                    deviceId: devId ? { exact: devId } : undefined,
                    echoCancellation: false, 
                    autoGainControl: false, 
                    noiseSuppression: false
                } 
            });
            micSource = audioCtx.createMediaStreamSource(tempStream);
            micSource.connect(analyser);
        }

        // 2. Play Tone
        const osc = audioCtx.createOscillator();
        osc.frequency.setValueAtTime(CONFIG.carrierFreq, audioCtx.currentTime);
        osc.type = 'sine';
        
        const toneGain = audioCtx.createGain();
        toneGain.gain.setValueAtTime(0.5, audioCtx.currentTime); 
        
        osc.connect(toneGain).connect(masterGain);
        osc.start();

        // Wait for audio path to stabilize
        await new Promise(r => setTimeout(r, 500)); 

        // 3. Measure
        const magnitudes = [];
        const calibrationDuration = 1000; 
        const startTime = performance.now();

        const finish = () => {
             osc.stop();
             osc.disconnect();

             // Cleanup temp mic if we opened it
             if (tempStream) {
                 if (micSource) micSource.disconnect();
                 micSource = null;
                 tempStream.getTracks().forEach(t => t.stop());
             }

             if (magnitudes.length === 0) {
                 alert("Calibration Failed: No Audio Detected.");
                 s.innerText = "Calib Failed";
                 s.className = "status-badge error";
             } else {
                 const avg = magnitudes.reduce((a,b)=>a+b,0) / magnitudes.length;
                 
                 // Check against noise floor
                 if (avg < 0.005) {
                     alert("Signal too weak to calibrate.\nPlease increase volume or move mic closer to speaker.");
                     s.innerText = "Weak Signal";
                     s.className = "status-badge error";
                 } else {
                     const target = 0.75; // Target amplitude
                     calibrationScale = target / avg;
                     
                     // Cap gain to reasonable limits (e.g. 0.1x to 50x)
                     if (calibrationScale > 50) calibrationScale = 50;
                     if (calibrationScale < 0.1) calibrationScale = 0.1;

                     alert(`Calibration Complete!\n\nSignal Level: ${(avg*100).toFixed(1)}%\nApplied Gain: ${calibrationScale.toFixed(2)}x`);
                     
                     if (wasRunning) {
                        s.innerText = "Receiving";
                        s.className = "status-badge success";
                     } else {
                        s.innerText = "Calibrated";
                        s.className = "status-badge success";
                     }
                 }
             }
        };

        const listen = () => {
            if (performance.now() - startTime > calibrationDuration) {
                finish();
                return;
            }
            analyser.getFloatTimeDomainData(waveArray);
            
            // Calculate RMS
            let e = 0;
            for(let x of waveArray) e += x*x;
            const mag = Math.sqrt(e/waveArray.length);
            
            magnitudes.push(mag);
            requestAnimationFrame(listen);
        };
        listen();

    } catch(e) {
        console.error(e);
        alert("Calibration Error: " + e.message);
        s.innerText = "Error";
        s.className = "status-badge error";
    }
}

function drawConstellation(points) {
    const c = document.getElementById('constellation-canvas');
    if (!c) return;
    const ctx = c.getContext('2d');
    const w = c.width, h = c.height;

    ctx.fillStyle = 'rgba(0,0,0,0.15)'; 
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = '#333';
    ctx.beginPath();
    ctx.moveTo(w/2, 0); ctx.lineTo(w/2, h);
    ctx.moveTo(0, h/2); ctx.lineTo(w, h/2);
    ctx.stroke();

    if (!points || points.length === 0) return;

    ctx.fillStyle = THEME.accent;
    ctx.shadowBlur = 10;
    ctx.shadowColor = THEME.accent;

    for(let p of points) {
        const x = (p.i * 3 + 1) * (w/2);
        const y = (-p.q * 3 + 1) * (h/2);
        if (x < 0 || x > w || y < 0 || y > h) continue;
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI*2);
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
    ctx.strokeStyle = '#222'; ctx.beginPath();
    ctx.moveTo(0, h/2); ctx.lineTo(w, h/2); ctx.stroke();

    if(!buffer) return;

    ctx.lineWidth = 2;
    ctx.strokeStyle = THEME.accent;
    ctx.beginPath();
    const step = w / buffer.length;
    let x = 0;
    for(let i=0; i<buffer.length; i+=2) {
        const v = buffer[i];
        const y = (h/2) - (v * h/2 * 1.5);
        if(i===0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        x += step * 2;
    }
    ctx.stroke();
}

async function transmitModemData() {
    let text = document.getElementById('modem-input').value || "HI";
    if (text.length > 200) text = text.slice(0, 200);
    
    await initAudioGraph();
    if (!modemEngine) modemEngine = new QPSKModulator(audioCtx.sampleRate, CONFIG.carrierFreq, CONFIG.baudRate);
    
    const buffer = modemEngine.generateAudioBuffer(text, audioCtx);
    
    if (modemBufferSource) try { modemBufferSource.stop(); } catch(e){}
    modemBufferSource = audioCtx.createBufferSource();
    modemBufferSource.buffer = buffer;
    modemBufferSource.connect(masterGain);
    if (analyser) modemBufferSource.connect(analyser);
    modemBufferSource.start();
    
    if (!isRunning) {
        isRunning = true;
        loop();
        setTimeout(() => { if(isRunning && !micSource) isRunning = false; }, 2000);
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
