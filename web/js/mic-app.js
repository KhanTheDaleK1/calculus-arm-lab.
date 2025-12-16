// CONFIG
const CONFIG = { fftSize: 2048, silenceThresh: 0.02, confidenceThresh: 0.90 };
const THEME = { accent: '#d05ce3', bg: '#141414', grid: '#333' }; // Mom's Purple

// STATE
let audioCtx, analyser, micSource, toneOsc, toneGain;
let isRunning = false;
let dataArray; // For Spectrum (Uint8 is fine for visuals)
let waveArray; // For Scope (Float32 for HD Smoothness)
let scopeZoomX = 1, scopeGainY = 1;
let freqHistory = [];
let historyStart = null;

// STOPWATCH STATE
let clapState = 'IDLE'; 
let clapStart = 0;

window.onload = () => {
    // 1. SETUP UI
    initCanvas('spectrum-canvas');
    initCanvas('scope-canvas');
    initCanvas('history-canvas');

    // 2. LOAD MICS: populate device list from available audio inputs
    navigator.mediaDevices.enumerateDevices().then(devs => {
        const sel = document.getElementById('device-select');
        sel.innerHTML = '';
        devs.filter(d => d.kind === 'audioinput').forEach(d => {
            const opt = document.createElement('option');
            opt.value = d.deviceId;
            opt.text = d.label || `Mic ${sel.length+1}`;
            sel.appendChild(opt);
        });
    });

    // 3. LISTENERS
    document.getElementById('btn-start').onclick = startEngine;
    document.getElementById('btn-stop').onclick = stopEngine;
    
    // Tuning controls: horizontal zoom and vertical gain for scope
    document.getElementById('scope-timebase').oninput = (e) => scopeZoomX = parseInt(e.target.value);
    document.getElementById('scope-gain').oninput = (e) => scopeGainY = parseFloat(e.target.value);
    
    // Copy Buttons: export CSVs
    document.getElementById('btn-copy-spectrum').onclick = copySpectrum;
    document.getElementById('btn-copy-scope').onclick = copyScope;

    // Tone generator controls
    document.getElementById('btn-tone-toggle').onclick = toggleTone;
    document.getElementById('tone-freq').oninput = updateTone;
    document.getElementById('tone-vol').oninput = updateTone;

    // Stopwatch: acoustic speed-of-sound
    document.getElementById('btn-speed-start').onclick = armStopwatch;
};

function initCanvas(id) {
    const c = document.getElementById(id);
    c.width = c.clientWidth; // High DPI handling could go here
    c.height = c.clientHeight;
}

// --- ENGINE ---
async function startEngine() {
    if (isRunning) return;
    try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = CONFIG.fftSize;

        const devId = document.getElementById('device-select').value;
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: devId ? {exact: devId} : undefined } });
        
        micSource = audioCtx.createMediaStreamSource(stream);
        micSource.connect(analyser);

        const len = analyser.frequencyBinCount;
        dataArray = new Uint8Array(len);   // Spectrum (Standard)
        waveArray = new Float32Array(len); // Scope (High Def)

        isRunning = true;
        document.getElementById('mic-status').innerText = "LIVE";
        document.getElementById('mic-status').style.color = "#2ed573"; // Success Green
        loop();
    } catch (e) {
        alert("Mic Error: " + e);
    }
}

function stopEngine() {
    isRunning = false;
    if(audioCtx) audioCtx.close();
    document.getElementById('mic-status').innerText = "Idle";
    document.getElementById('mic-status').style.color = "#888";
}

function loop() {
    if (!isRunning) return;
    requestAnimationFrame(loop);

    analyser.getByteFrequencyData(dataArray);   // FFT magnitude bins
    analyser.getFloatTimeDomainData(waveArray); // Float wave (-1..1) for HD scope

    drawSpectrum();
    drawScope();
    analyze();
    drawHistory();
    processStopwatch();
}

// --- DRAWING ---
function drawSpectrum() {
    const c = document.getElementById('spectrum-canvas');
    const ctx = c.getContext('2d');
    const w = c.width, h = c.height;

    ctx.fillStyle = '#000'; ctx.fillRect(0,0,w,h);
    const barW = (w / dataArray.length) * 2.5;
    let x = 0;

    for(let i=0; i<dataArray.length; i++) {
        const barH = (dataArray[i]/255) * h;
        // Mom's Purple Gradient Heatmap
        const pct = i/dataArray.length;
        ctx.fillStyle = `hsl(${280 + (pct*60)}, 100%, ${50 + (barH/h)*20}%)`; 
        ctx.fillRect(x, h-barH, barW, barH);
        x += barW + 1;
    }
}

function drawScope() {
    const c = document.getElementById('scope-canvas');
    const ctx = c.getContext('2d');
    const w = c.width, h = c.height;

    // Clear
    ctx.fillStyle = '#0b0b0b'; 
    ctx.fillRect(0,0,w,h);
    
    // Center Line
    ctx.beginPath();
    ctx.strokeStyle = '#222'; 
    ctx.moveTo(0, h/2); ctx.lineTo(w, h/2); 
    ctx.stroke(); 

    // Waveform Style
    ctx.lineWidth = 2;
    ctx.strokeStyle = THEME.accent; // Mom's Purple
    ctx.lineJoin = 'round'; // Smooth corners
    ctx.beginPath();

    // Determine segment ~10ms with zoom and edge trigger
    const sampleRate = audioCtx ? audioCtx.sampleRate : 48000;
    const maxSamples = Math.min(waveArray.length, Math.max(32, Math.floor(sampleRate * 0.01 * scopeZoomX)));
    let startIdx = 0;
    // Edge trigger: find first rising zero-crossing above small threshold
    for (let i = 1; i < maxSamples; i++) {
        if (waveArray[i-1] < 0 && waveArray[i] >= 0 && Math.abs(waveArray[i]) > 0.02) { startIdx = i; break; }
    }

    const drawLen = Math.min(maxSamples, waveArray.length - startIdx);
    const sliceW = w / drawLen;
    
    let x = 0;

    // Helper to map Float (-1.0 to 1.0) to Canvas Y
    const getY = (idx) => {
        let val = waveArray[startIdx + idx]; // Range -1 to 1
        // Apply Gain (Y-Axis Zoom)
        val = val * scopeGainY; 
        // Invert for Canvas (0 is top)
        // 0 -> h/2.  1 -> 0.  -1 -> h.
        return (1 - val) * (h/2);
    };

    ctx.moveTo(0, getY(0));

    // SMOOTHING ALGORITHM
    // Instead of lineTo(x,y), we use quadraticCurveTo
    // We draw from Midpoint to Midpoint to ensure continuity
    for(let i=1; i < drawLen - 1; i++) {
        const xNext = i * sliceW;
        const yNext = getY(i);
        
        // Look ahead
        const xNext2 = (i + 1) * sliceW;
        const yNext2 = getY(i + 1);

        // Control Point (current point)
        // End Point (midpoint between current and next)
        const xMid = (xNext + xNext2) / 2;
        const yMid = (yNext + yNext2) / 2;

        ctx.quadraticCurveTo(xNext, yNext, xMid, yMid);
    }
    
    ctx.stroke();
}

// --- ANALYSIS ---
function analyze() {
    // RMS Calculation (Float version)
    let sum=0;
    for(let i=0; i<waveArray.length; i++) {
        sum += waveArray[i] * waveArray[i]; // No need to subtract 128
    }
    const rms = Math.sqrt(sum/waveArray.length);
    document.getElementById('amp-rms').innerText = rms.toFixed(3);
    
    // Safety check for log(0)
    const db = rms > 0 ? (20*Math.log10(rms)) : -100;
    document.getElementById('amp-db').innerText = db.toFixed(1);

    // Gate
    if (rms < CONFIG.silenceThresh) {
        document.getElementById('freq-fundamental').innerText = "-- Hz";
        document.getElementById('freq-confidence').innerText = "Low Signal";
        return;
    }
    
    const pitch = autoCorrelate(waveArray, audioCtx.sampleRate);
    if (pitch === -1) {
        document.getElementById('freq-fundamental').innerText = "-- Hz";
        document.getElementById('freq-confidence').innerText = "Noisy";
    } else {
        document.getElementById('freq-fundamental').innerText = Math.round(pitch) + " Hz";
        document.getElementById('freq-confidence').innerText = "Locked";
        updateHistory(pitch);
        updateDoppler(pitch);
    }
}

function autoCorrelate(buf, rate) {
    const SIZE = buf.length;
    let bestOffset = -1;
    let bestCorr = 0;

    // Search Range: 50Hz to 2000Hz (approx)
    // 48000 / 50 = 960 samples max offset
    // 48000 / 2000 = 24 samples min offset
    const MAX_SAMPLES = Math.floor(rate/50);
    const MIN_SAMPLES = Math.floor(rate/2000);

    for (let offset = MIN_SAMPLES; offset < MAX_SAMPLES && offset < SIZE/2; offset++) {
        let corr = 0;
        // Simple difference function (lower is better match)
        for (let i=0; i<SIZE-offset; i++) {
            corr += Math.abs(buf[i] - buf[i+offset]);
        }
        // Invert to make it a "Correlation" (1.0 is perfect)
        corr = 1 - (corr / (SIZE-offset)); 
        
        if (corr > bestCorr) {
            bestCorr = corr;
            bestOffset = offset;
        }
    }
    
    // Confidence Threshold
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
    ctx.fillStyle = '#050505';
    ctx.fillRect(0,0,w,h);
    ctx.strokeStyle = '#222';
    ctx.beginPath();
    ctx.moveTo(0, h/2);
    ctx.lineTo(w, h/2);
    ctx.stroke();

    const maxF = Math.max(500, Math.max(...freqHistory.map(p => p.f)));
    const minF = 0;
    const len = freqHistory.length;
    ctx.strokeStyle = THEME.accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < len; i++) {
        const x = (i / (len - 1)) * w;
        const y = h - ((freqHistory[i].f - minF) / (maxF - minF)) * h;
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
    const speed = 343 * (shift / base); // m/s, simple moving source approximation
    const shiftEl = document.getElementById('doppler-shift');
    const speedEl = document.getElementById('doppler-speed');
    if (shiftEl) shiftEl.innerText = shift.toFixed(1) + " Hz";
    if (speedEl) speedEl.innerText = speed.toFixed(2) + " m/s";
}

// --- TONE ---
function toggleTone() {
    const btn = document.getElementById('btn-tone-toggle');
    if (toneOsc) {
        toneOsc.stop(); toneOsc = null;
        btn.classList.remove('active'); btn.innerText = "Play Tone";
    } else {
        if (audioCtx.state === 'suspended') audioCtx.resume();
        toneOsc = audioCtx.createOscillator();
        toneGain = audioCtx.createGain();
        toneOsc.connect(toneGain);
        toneGain.connect(audioCtx.destination);
        updateTone();
        toneOsc.start();
        btn.classList.add('active'); btn.innerText = "Stop Tone";
    }
}

function updateTone() {
    if (!toneOsc) return;
    const f = document.getElementById('tone-freq').value;
    const v = document.getElementById('tone-vol').value;
    toneOsc.frequency.value = f;
    toneGain.gain.value = v;
    document.getElementById('tone-freq-val').innerText = f;
    document.getElementById('tone-vol-val').innerText = Math.round(v*100);
}

// --- STOPWATCH ---
function armStopwatch() {
    clapState = 'ARMED';
    document.getElementById('speed-status').innerText = "Waiting for CLAP 1...";
    document.getElementById('speed-dt').innerText = "-- ms";
}

function processStopwatch() {
    if (clapState === 'IDLE') return;
    const rms = parseFloat(document.getElementById('amp-rms').innerText);
    const THRESH = 0.15; // Trigger threshold
    const now = Date.now();

    if (clapState === 'ARMED' && rms > THRESH) {
        clapStart = now;
        clapState = 'LOCKOUT';
        document.getElementById('speed-status').innerText = "Clap 1! Waiting...";
    }
    else if (clapState === 'LOCKOUT' && (now - clapStart > 300)) {
        clapState = 'WAITING_2';
        document.getElementById('speed-status').innerText = "Ready for CLAP 2...";
    }
    else if (clapState === 'WAITING_2' && rms > THRESH) {
        const diff = now - clapStart;
        document.getElementById('speed-dt').innerText = diff + " ms";
        
        const dist = parseFloat(document.getElementById('speed-distance').value);
        const speed = dist / (diff/1000);
        document.getElementById('speed-est').innerText = speed.toFixed(1) + " m/s";
        
        clapState = 'IDLE';
        document.getElementById('speed-status').innerText = "Done!";
    }
}

// --- EXPORT CSV (Updated for Floats) ---
function copyScope() {
    if (!waveArray) return alert("Start the microphone first!");
    // Export high-res waveform
    let csv = "Time(s),Amplitude\n";
    const step = 1/audioCtx.sampleRate;
    for(let i=0; i<waveArray.length; i++) {
        csv += `${(i*step).toFixed(5)},${waveArray[i].toFixed(4)}\n`;
    }
    navigator.clipboard.writeText(csv)
        .then(() => alert("Copied High-Res Scope Data!"))
        .catch(err => alert("Copy failed: " + err));
}

function copySpectrum() {
    if (!dataArray) return alert("Start the microphone first!");
    // Export magnitude bins
    let csv = "Freq(Hz),Magnitude\n";
    const bin = (audioCtx.sampleRate/2) / dataArray.length;
    for(let i=0; i<dataArray.length; i++) {
        csv += `${(i*bin).toFixed(1)},${dataArray[i]}\n`;
    }
    navigator.clipboard.writeText(csv)
        .then(() => alert("Copied Spectrum Data!"))
        .catch(err => alert("Copy failed: " + err));
}
