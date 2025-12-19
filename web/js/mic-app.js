// * CONFIG
const CONFIG = { fftSize: 2048, silenceThresh: 0.02 };
const THEME = { accent: '#d05ce3', bg: '#141414', grid: '#333' };

// * STATE
let audioCtx, analyser, micSource;
let toneOsc1, toneGain1, toneOsc2, toneGain2, masterGain;
let isRunning = false;
let dataArray, waveArray; 
let freqHistory = [];
let historyStart = null;
let scopePaused = false;
let toneDelta = 2;

// * SCOPE SETTINGS
let scopeSettings = {
    timePerDiv: 0.001,
    voltsPerDiv: 1.0,
    vOffset: 0.0,
    hOffset: 0.0
};

// * DATA BUFFER
const REC_SEC = 10;
let recBuffer = null;
let recHead = 0;
let recNode = null;

// * STOPWATCH
let clapState = 'IDLE'; 
let clapStart = 0;

window.onload = () => {
    initCanvas('spectrum-canvas');
    initCanvas('scope-canvas');
    initCanvas('history-canvas');

    // ! Robust Device Detection
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
                        opt.text = d.label || `Microphone ${i + 1}`;
                        sel.appendChild(opt);
                    });
                }
            }
        }).catch(err => console.error("Device Enumeration Error:", err));
    }

    // * Safety Binder
    const bind = (id, event, handler) => {
        const el = document.getElementById(id);
        if (el) el[event] = handler;
        else console.warn(`Element ${id} not found. Event ${event} for ${handler.name || handler} not bound.`);
    };

    bind('btn-start', 'onclick', startEngine);
    bind('btn-stop', 'onclick', stopEngine);
    bind('btn-copy-spectrum', 'onclick', copySpectrum);
    bind('btn-rec-export', 'onclick', exportRecording);

    // * Pro Scope Controls
    bind('scope-tdiv', 'onchange', (e) => scopeSettings.timePerDiv = parseFloat(e.target.value));
    bind('scope-vdiv', 'onchange', (e) => scopeSettings.voltsPerDiv = parseFloat(e.target.value));
    bind('scope-v-offset', 'oninput', (e) => scopeSettings.vOffset = parseFloat(e.target.value));
    bind('scope-h-offset', 'oninput', (e) => scopeSettings.hOffset = parseFloat(e.target.value));
    bind('btn-scope-pause', 'onclick', toggleScopePause);

    // * Pro Tone Controls
    bind('btn-tone-toggle', 'onclick', toggleTone);
    bind('tone-freq-a', 'oninput', updateTone);
    bind('tone-freq-b', 'oninput', updateTone);
    bind('tone-link', 'onchange', updateTone);
    bind('tone-vol', 'oninput', updateTone);
    bind('tone-type-a', 'onchange', updateTone);
    bind('tone-type-b', 'onchange', updateTone);

    bind('btn-speed-start', 'onclick', armStopwatch);

    // * Spectrum Modal
    bind('spectrum-canvas', 'onclick', openSpectrumModal);
    bind('btn-close-modal', 'onclick', closeSpectrumModal);
    bind('spectrum-modal', 'onclick', (e) => {
        if (e.target.id === 'spectrum-modal') closeSpectrumModal();
    });
};

function openSpectrumModal() {
    document.getElementById('spectrum-modal').style.display = 'flex';
    initCanvas('spectrum-modal-canvas');
}

function closeSpectrumModal() {
    document.getElementById('spectrum-modal').style.display = 'none';
}

function initCanvas(id) {
    const c = document.getElementById(id);
    if(c) { c.width = c.clientWidth; c.height = c.clientHeight; }
}

async function initAudioGraph() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') await audioCtx.resume();
    
    // * Main Analyser (Mono Mix)
    if (!analyser) {
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = CONFIG.fftSize;
    }
    
    // * Arrays
    const len = analyser.frequencyBinCount;
    if(!dataArray) dataArray = new Uint8Array(len);
    if(!waveArray) waveArray = new Float32Array(len);
}

async function startEngine() {
    if (isRunning) return;
    try {
        await initAudioGraph();

        const devId = document.getElementById('device-select').value;
        const constraints = { 
            audio: { 
                deviceId: devId ? {exact: devId} : undefined,
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false
            } 
        };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        
        if (micSource) try { micSource.disconnect(); } catch(e){}
        micSource = audioCtx.createMediaStreamSource(stream);
        micSource.connect(analyser); // Mono Mix
        
        if (masterGain) {
            try { 
                masterGain.connect(analyser); 
            } catch(e){}
        }

        const recLen = audioCtx.sampleRate * REC_SEC;
        recBuffer = new Float32Array(recLen);
        recHead = 0;
        
        if (recNode) try { recNode.disconnect(); } catch(e){}
        recNode = audioCtx.createScriptProcessor(4096, 1, 1);
        recNode.onaudioprocess = (e) => {
            const input = e.inputBuffer.getChannelData(0);
            for(let i=0; i<input.length; i++) {
                recBuffer[recHead++] = input[i];
                if(recHead >= recLen) recHead = 0;
            }
        };
        const mute = audioCtx.createGain();
        mute.gain.value = 0;
        micSource.connect(recNode);
        recNode.connect(mute);
        mute.connect(audioCtx.destination);

        isRunning = true;
        document.getElementById('mic-status').innerText = "LIVE";
        document.getElementById('mic-status').className = "status-badge success";
        loop();
    } catch (e) { alert("Mic Error: " + e); }
}

function stopEngine() {
    isRunning = false;
    if(audioCtx) audioCtx.close();
    document.getElementById('mic-status').innerText = "Idle";
    document.getElementById('mic-status').className = "status-badge warn";
}

function loop() {
    if (!isRunning) return;
    requestAnimationFrame(loop);
    
    analyser.getByteFrequencyData(dataArray);
    
    if (!scopePaused) {
        analyser.getFloatTimeDomainData(waveArray);
    }
    
    drawSpectrum();
    drawScope();
    analyze();
    drawHistory();
    processStopwatch();
}

function drawSpectrum() {
    drawSpectrumToCanvas('spectrum-canvas');
    const modal = document.getElementById('spectrum-modal');
    if (modal && modal.style.display === 'flex') {
        drawSpectrumToCanvas('spectrum-modal-canvas');
    }
}

function drawSpectrumToCanvas(id) {
    const c = document.getElementById(id);
    if (!c) return;
    const ctx = c.getContext('2d');
    const w = c.width, h = c.height;

    // * 1. CLEAR
    ctx.fillStyle = '#000'; ctx.fillRect(0,0,w,h);

    // * 2. CONFIG LOGSCALE
    const minF = 20;
    const maxF = 20000;
    const logMin = Math.log10(minF);
    const logMax = Math.log10(maxF);
    const scale = w / (logMax - logMin);

    function freqToX(f) {
        if (f < minF) return 0;
        if (f > maxF) return w;
        return (Math.log10(f) - logMin) * scale;
    }

    // * 3. DRAW GRID
    ctx.lineWidth = 1;
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';

    // ? Minor Lines (Dim)
    ctx.strokeStyle = '#222';
    ctx.beginPath();
    for (let d = 1; d < 5; d++) { // Decades 10^1..10^4
        const start = Math.pow(10, d);
        for (let m = 2; m < 10; m++) {
            const f = start * m;
            if (f > maxF) break;
            if (f < minF) continue;
            const x = freqToX(f);
            ctx.moveTo(x, 0); ctx.lineTo(x, h);
        }
    }
    ctx.stroke();

    // ? Major Lines (Bright)
    const majors = [100, 1000, 10000];
    const labels = ["100", "1k", "10k"];
    
    ctx.strokeStyle = '#444';
    ctx.fillStyle = '#888';
    ctx.beginPath();
    for (let i=0; i<majors.length; i++) {
        const f = majors[i];
        const x = freqToX(f);
        ctx.moveTo(x, 0); ctx.lineTo(x, h);
        ctx.fillText(labels[i], x, h - 5);
    }
    ctx.stroke();

    // * 4. DRAW DATA (Log Mapped Path)
    const nyquist = audioCtx ? audioCtx.sampleRate / 2 : 24000;
    
    ctx.beginPath();
    ctx.moveTo(0, h);

    // Iterate through bins and map to log X
    for(let i = 0; i < dataArray.length; i++) {
        const freq = i * (nyquist / dataArray.length);
        if (freq < minF) continue;
        if (freq > maxF) break;

        const x = freqToX(freq);
        const val = dataArray[i];
        const y = h - ((val / 255) * h);
        
        ctx.lineTo(x, y);
    }
    // Close path for fill
    ctx.lineTo(freqToX(maxF), h);
    ctx.lineTo(0, h);

    // Gradient Fill
    const grad = ctx.createLinearGradient(0, h, 0, 0);
    grad.addColorStop(0, 'rgba(208, 92, 227, 0.2)');
    grad.addColorStop(1, 'rgba(208, 92, 227, 0.8)');
    ctx.fillStyle = grad;
    ctx.fill();
    
    // Stroke Top
    ctx.strokeStyle = '#d05ce3';
    ctx.lineWidth = 1;
    ctx.stroke();

    // * 5. PEAK INDICATOR
    // Find max bin
    let maxVal = -1;
    let maxIdx = -1;
    for(let i=0; i<dataArray.length; i++) {
        if (dataArray[i] > maxVal) { maxVal = dataArray[i]; maxIdx = i; }
    }

    if (maxVal > 30) {
        const peakFreq = maxIdx * (nyquist / dataArray.length);
        if (peakFreq >= minF && peakFreq <= maxF) {
            const peakX = freqToX(peakFreq);
            
            // Draw Line
            ctx.strokeStyle = '#fff';
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            ctx.moveTo(peakX, 0); ctx.lineTo(peakX, h);
            ctx.stroke();
            ctx.setLineDash([]);

            // Label
            ctx.fillStyle = '#fff';
            ctx.textAlign = (peakX > w - 80) ? 'right' : 'left';
            ctx.fillText(peakFreq.toFixed(1) + " Hz", peakX + (peakX > w - 80 ? -5 : 5), 20);
        }
    }
}

function drawScope() {
    const c = document.getElementById('scope-canvas');
    const ctx = c.getContext('2d');
    const w = c.width, h = c.height;
    const rate = audioCtx ? audioCtx.sampleRate : 48000;

    // * 1. CLEAR & GRID
    ctx.fillStyle = '#0b0b0b'; ctx.fillRect(0,0,w,h);
    
    // Grid (10 horizontal divisions, 8 vertical)
    const xStep = w / 10;
    const yStep = h / 8;
    ctx.strokeStyle = '#222'; ctx.lineWidth = 1; ctx.beginPath();
    for(let i=1; i<10; i++) { ctx.moveTo(i*xStep, 0); ctx.lineTo(i*xStep, h); }
    for(let i=1; i<8; i++) { ctx.moveTo(0, i*yStep); ctx.lineTo(w, i*yStep); }
    ctx.stroke();

    // Center Crosshair
    ctx.strokeStyle = '#444'; ctx.beginPath();
    ctx.moveTo(w/2, 0); ctx.lineTo(w/2, h);
    ctx.moveTo(0, h/2); ctx.lineTo(w, h/2);
    ctx.stroke();

    // * 2. LOGIC
    // Total time on screen = 10 divs * timePerDiv
    const totalTime = 10 * scopeSettings.timePerDiv;
    const samplesNeeded = Math.floor(totalTime * rate);
    
    // Triggering (Rising Edge at 0)
    let triggerIdx = 0;
    // Simple edge finder
    for(let i=1; i<waveArray.length - samplesNeeded; i++) {
        if(waveArray[i-1] < 0 && waveArray[i] >= 0) {
            triggerIdx = i;
            break;
        }
    }
    
    // Apply Horizontal Offset (pixels -> samples)
    // Map w/2 (center) to triggerIdx. 
    // hOffset is in "divs". Positive = shift wave right (view left)
    const offsetSamples = Math.floor(scopeSettings.hOffset * scopeSettings.timePerDiv * rate);
    let startSample = triggerIdx - offsetSamples; 
    
    // * 3. WAVEFORM
    ctx.lineWidth = 2;
    ctx.strokeStyle = THEME.accent;
    ctx.beginPath();

    const pixelsPerSample = w / samplesNeeded;
    
    for(let i=0; i<samplesNeeded; i++) {
        const bufIdx = startSample + i;
        if(bufIdx < 0 || bufIdx >= waveArray.length) continue;
        
        const rawY = waveArray[bufIdx];
        // Apply Vertical Offset & Gain
        
        const val = (rawY + scopeSettings.vOffset);
        // Normalize: val / voltsPerDiv = number of divisions deflection
        const divsDeflection = val / scopeSettings.voltsPerDiv;
        const pxDeflection = divsDeflection * yStep;
        
        const plotX = i * pixelsPerSample;
        const plotY = (h/2) - pxDeflection; // Invert Y for canvas

        if (i===0) ctx.moveTo(plotX, plotY);
        else ctx.lineTo(plotX, plotY);
    }
    ctx.stroke();
    
    // * 4. READOUTS
    ctx.fillStyle = '#fff'; ctx.font = "11px monospace";
    ctx.fillText(`T: ${scopeSettings.timePerDiv*1000 < 1 ? (scopeSettings.timePerDiv*1000000).toFixed(0)+'µs' : (scopeSettings.timePerDiv*1000).toFixed(1)+'ms'}/div`, 5, 12);
    ctx.fillText(`V: ${scopeSettings.voltsPerDiv}V/div`, 5, 24);
}

function analyze() {
    let sum=0; for(let i=0; i<waveArray.length; i++) sum += waveArray[i]*waveArray[i];
    const rms = Math.sqrt(sum/waveArray.length);
    document.getElementById('amp-rms').innerText = rms.toFixed(3);
    const db = rms > 0 ? (20*Math.log10(rms)) : -100;
    document.getElementById('amp-db').innerText = db.toFixed(1);
    if (rms < CONFIG.silenceThresh) {
        document.getElementById('freq-fundamental').innerText = "-- Hz";
        document.getElementById('freq-confidence').innerText = "Low Signal";
        document.getElementById('scope-input-freq').innerText = "Freq: --";
        return;
    }
    const pitch = autoCorrelate(waveArray, audioCtx.sampleRate);
    if (pitch === -1) {
        document.getElementById('freq-fundamental').innerText = "-- Hz";
        document.getElementById('freq-confidence').innerText = "Noisy";
        document.getElementById('scope-input-freq').innerText = "Freq: Noise";
    } else {
        const pStr = Math.round(pitch) + " Hz";
        document.getElementById('freq-fundamental').innerText = pStr;
        document.getElementById('freq-confidence').innerText = "Locked";
        document.getElementById('scope-input-freq').innerText = "Freq: " + pStr;
        updateHistory(pitch);
        updateDoppler(pitch);
    }
}

function autoCorrelate(buf, rate) {
    const SIZE = buf.length;
    let bestOffset = -1; let bestCorr = 0;
    const MAX_SAMPLES = Math.floor(rate/50);
    const MIN_SAMPLES = Math.floor(rate/2000);
    for (let offset = MIN_SAMPLES; offset < MAX_SAMPLES && offset < SIZE/2; offset++) {
        let corr = 0;
        for (let i=0; i<SIZE-offset; i++) corr += Math.abs(buf[i] - buf[i+offset]);
        corr = 1 - (corr / (SIZE-offset)); 
        if (corr > bestCorr) { bestCorr = corr; bestOffset = offset; }
    }
    if (bestCorr > 0.92) return rate / bestOffset;
    return -1;
}

function updateHistory(freq) {
    const now = performance.now() / 1000;
    if (historyStart === null) historyStart = now;
    freqHistory.push({ t: now - historyStart, f: freq });
    if (freqHistory.length > 300) freqHistory.shift();
}

function drawHistory() {
    const c = document.getElementById('history-canvas');
    if (!c || freqHistory.length === 0) return;
    const ctx = c.getContext('2d');
    const w = c.width, h = c.height;
    ctx.fillStyle = '#050505'; ctx.fillRect(0,0,w,h);
    const maxF = Math.max(500, Math.max(...freqHistory.map(p => p.f)));
    const len = freqHistory.length;
    ctx.strokeStyle = THEME.accent; ctx.beginPath();
    for (let i = 0; i < len; i++) {
        const x = (i / (len - 1)) * w;
        const y = h - (freqHistory[i].f / maxF) * h;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
}

function updateDoppler(freq) {
    const baseInput = document.getElementById('doppler-base');
    if (!baseInput) return;
    const base = parseFloat(baseInput.value) || 0;
    if (base <= 0) return;
    const shift = freq - base;
    const speed = 343 * (shift / base);
    const shiftEl = document.getElementById('doppler-shift');
    const speedEl = document.getElementById('doppler-speed');
    if (Math.abs(speed) > 35.0) {
        if(shiftEl) shiftEl.innerText = "-- Hz";
        if(speedEl) speedEl.innerText = "Noise";
    } else {
        if(shiftEl) shiftEl.innerText = shift.toFixed(1) + " Hz";
        if(speedEl) speedEl.innerText = speed.toFixed(2) + " m/s";
    }
}

async function toggleTone() {
    console.log("Toggle Tone Clicked");
    const btn = document.getElementById('btn-tone-toggle');
    const status = document.getElementById('mic-status');
    
    // Ensure Context
    try {
        await initAudioGraph();
    } catch(e) {
        return alert("Audio Init Error: " + e);
    }
    
    if (toneOsc1) {
        // STOP
        console.log("Stopping Tone...");
        try { toneOsc1.stop(); toneOsc1.disconnect(); } catch(e){ console.warn(e); }
        try { toneOsc2.stop(); toneOsc2.disconnect(); } catch(e){ console.warn(e); }
        
        // Disconnect Loopback
        if (masterGain && analyser) {
            try { masterGain.disconnect(analyser); } catch(e){}
        }
        // Removed splitter check
        
        toneOsc1 = null;
        toneOsc2 = null;
        btn.classList.remove('active'); btn.innerText = "Play Tone";
        
        // If Mic is also off, stop the loop to save CPU
        if (!micSource && isRunning) { // Check micSource to know if mic is running. 
            isRunning = false;
            if(status) { status.innerText = "Idle"; status.className = "status-badge warn"; }
        }
        
    } else {
        // START
        console.log("Starting Tone...");
        
        if (!masterGain) {
             masterGain = audioCtx.createGain();
             masterGain.connect(audioCtx.destination);
        }
        
        // Loopback (Send Tone to Visualizer)
        if (analyser) try { masterGain.connect(analyser); } catch(e){}
        // Removed splitter check
        
        // Osc 1
        toneOsc1 = audioCtx.createOscillator();
        const typeA = document.getElementById('tone-type-a').value;
        toneOsc1.type = (typeA === 'none') ? 'sine' : typeA; 
        toneGain1 = audioCtx.createGain();
        toneOsc1.connect(toneGain1);
        toneGain1.connect(masterGain);
        
        // Osc 2
        toneOsc2 = audioCtx.createOscillator();
        const typeB = document.getElementById('tone-type-b').value;
        toneOsc2.type = (typeB === 'none') ? 'sine' : typeB;
        toneGain2 = audioCtx.createGain();
        toneOsc2.connect(toneGain2);
        toneGain2.connect(masterGain);
        
        try { updateTone(); } catch(e) { console.error("Update Tone Failed:", e); }
        
        toneOsc1.start();
        toneOsc2.start();
        
        btn.classList.add('active'); btn.innerText = "Stop Tone";
        
        // ! FIX: FORCE START VISUALIZER LOOP
        if (!isRunning) {
            isRunning = true;
            if(status) { status.innerText = "Tone Gen"; status.className = "status-badge success"; }
            loop();
        }
    }
}

function updateTone(e) {
    const volEl = document.getElementById('tone-vol');
    if (volEl && masterGain) {
        const vol = parseFloat(volEl.value);
        document.getElementById('tone-vol-val').innerText = Math.round(vol*100);
        masterGain.gain.setValueAtTime(vol, audioCtx.currentTime);
    }

    const elA = document.getElementById('tone-freq-a');
    const elB = document.getElementById('tone-freq-b');
    const elLink = document.getElementById('tone-link');
    const typeASelect = document.getElementById('tone-type-a');
    const typeBSelect = document.getElementById('tone-type-b');
    
    if (!elA || !elB || !typeASelect || !typeBSelect) return; 
    
    let freqA = parseInt(elA.value) || 440;
    let freqB = parseInt(elB.value) || 440;
    const typeA = typeASelect.value;
    const typeB = typeBSelect.value;
    const linked = elLink ? elLink.checked : false;

    // Link Logic
    if (e && e.target.id === 'tone-freq-a') {
        if (linked) {
            freqB = freqA + toneDelta;
            if (freqB > 1000) freqB = 1000;
            if (freqB < 50) freqB = 50;
            elB.value = freqB;
        }
    } else if (e && (e.target.id === 'tone-freq-b' || e.target.id === 'tone-link')) {
         if (linked) {
             toneDelta = freqB - freqA;
         }
    }
    
    document.getElementById('tone-freq-a-val').innerText = freqA;
    document.getElementById('tone-freq-b-val').innerText = freqB;
    
    // Determine individual tone gains based on 'Off' selection
    let gainA = 0.5;
    let gainB = 0.5;

    if (typeA === 'none' && typeB !== 'none') {
        gainA = 0;
        gainB = 1.0; 
    } else if (typeB === 'none' && typeA !== 'none') {
        gainB = 0;
        gainA = 1.0; 
    } else if (typeA === 'none' && typeB === 'none') {
        gainA = 0;
        gainB = 0; 
    }

    // Update Oscillators
    if (toneOsc1) {
        toneOsc1.frequency.setValueAtTime(freqA, audioCtx.currentTime);
        // Set type if valid (not 'none')
        if (typeA !== 'none') toneOsc1.type = typeA;
        toneGain1.gain.setValueAtTime(gainA, audioCtx.currentTime);
    }
    if (toneOsc2) {
        toneOsc2.frequency.setValueAtTime(freqB, audioCtx.currentTime);
        // Set type if valid (not 'none')
        if (typeB !== 'none') toneOsc2.type = typeB;
        toneGain2.gain.setValueAtTime(gainB, audioCtx.currentTime);
    }
}

function armStopwatch() {
    clapState = 'ARMED';
    document.getElementById('speed-status').innerText = "Waiting for CLAP 1...";
}

function processStopwatch() {
    if (clapState === 'IDLE') return;
    const rms = parseFloat(document.getElementById('amp-rms').innerText);
    const now = Date.now();
    if (clapState === 'ARMED' && rms > 0.15) {
        clapStart = now; clapState = 'LOCKOUT';
        document.getElementById('speed-status').innerText = "Clap 1! Waiting...";
    } else if (clapState === 'LOCKOUT' && (now - clapStart > 300)) {
        clapState = 'WAITING_2';
        document.getElementById('speed-status').innerText = "Ready for CLAP 2...";
    } else if (clapState === 'WAITING_2' && rms > 0.15) {
        const diff = now - clapStart;
        document.getElementById('speed-dt').innerText = diff + " ms";
        const dist = parseFloat(document.getElementById('speed-distance').value);
        document.getElementById('speed-est').innerText = (dist / (diff/1000)).toFixed(1) + " m/s";
        clapState = 'IDLE'; document.getElementById('speed-status').innerText = "Done!";
    }
}

function toggleScopePause() {
    scopePaused = !scopePaused;
    const btn = document.getElementById('btn-scope-pause');
    if (btn) btn.textContent = scopePaused ? "Resume" : "Pause";
}

function copySpectrum() { alert("Spectrum copied!"); }

// * EXPORT RECORDING
function exportRecording() {
    if (!recBuffer) return alert("No recording data. Start the engine first.");
    
    // * CALCULATOR FUNCTION GENERATION
    let calcFunc = "Unknown";
    const typeA = document.getElementById('tone-type-a') ? document.getElementById('tone-type-a').value : 'none';
    const freqA = document.getElementById('tone-freq-a') ? document.getElementById('tone-freq-a').value : 0;
    
    if (typeA !== 'none') {
        // Known Tone A
        calcFunc = `Y1 = sin(2*pi*${freqA}*X)`;
    } else if (freqHistory.length > 0) {
        // Guess from last detected pitch
        const lastF = Math.round(freqHistory[freqHistory.length-1].f);
        calcFunc = `Y1 = sin(2*pi*${lastF}*X)`;
    }
    
    // Show to user
    prompt("Calculator Function (Copy for TI-84/Desmos):", calcFunc);

    if (!confirm("Export 10s raw data (~10MB)? This may take a few seconds.")) return; 
    
    const sampleRate = audioCtx.sampleRate;
    const len = recBuffer.length;
    const now = performance.now() / 1000;
    const absFreqs = freqHistory.map(p => ({ t: historyStart + p.t, f: p.f }));
    
    let rows = [`# Approx Function: ${calcFunc}`, "Time(ms),Amplitude,Frequency(Hz)"];
    let fIdx = 0;
    for (let i = 0; i < len; i++) {
        const idx = (recHead + i) % len;
        const amp = recBuffer[idx];
        const t_ms = (i / sampleRate) * 1000;
        const t_abs = now - ((len - 1 - i) / sampleRate);
        while(fIdx < absFreqs.length - 1 && absFreqs[fIdx+1].t <= t_abs) fIdx++;
        let freq = "";
        if (absFreqs.length > 0 && Math.abs(t_abs - absFreqs[fIdx].t) < 0.2) {
            freq = Math.round(absFreqs[fIdx].f);
        }
        rows.push(`${t_ms.toFixed(2)},${amp.toFixed(4)},${freq}`);
    }
    const blob = new Blob([rows.join('\n')], {type: 'text/csv'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'mic_lab_data.csv'; a.click();
    URL.revokeObjectURL(url);
}

let resizeTimeout;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
        initCanvas('spectrum-canvas'); initCanvas('scope-canvas'); initCanvas('history-canvas');
    }, 100);
});
