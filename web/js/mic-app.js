// CONFIG
const CONFIG = { fftSize: 2048, silenceThresh: 0.02, confidenceThresh: 0.90 };
const THEME = { accent: '#d05ce3', bg: '#141414', grid: '#333' }; // Mom's Purple

// STATE
let audioCtx, analyser, micSource;
let toneOsc1, toneGain1, toneOsc2, toneGain2, masterGain;
let isRunning = false;
let dataArray; // For Spectrum (Uint8 is fine for visuals)
let waveArray; // For Scope (Float32 for HD Smoothness)
let scopeZoomX = 1, scopeGainY = 1;
let freqHistory = [];
let historyStart = null;
let scopePaused = false;
let freqBuffer = [];
const RMA_SIZE = 5;
let toneDelta = 2; // Difference between Osc1 and Osc2

// RECORDING BUFFER
const REC_SEC = 10;
let recBuffer = null;
let recHead = 0;
let recNode = null;

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
    document.getElementById('tone-freq-a').oninput = updateTone;
    document.getElementById('tone-freq-b').oninput = updateTone;
    document.getElementById('tone-link').onchange = updateTone;
    document.getElementById('tone-vol').oninput = updateTone;

    // Stopwatch: acoustic speed-of-sound
    document.getElementById('btn-speed-start').onclick = armStopwatch;

    // Scope pause/resume
    document.getElementById('btn-scope-pause').onclick = toggleScopePause;
    document.getElementById('btn-rec-export').onclick = exportRecording;
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

        // --- DATA BUFFER (10s Circular) ---
        const recLen = audioCtx.sampleRate * REC_SEC;
        recBuffer = new Float32Array(recLen);
        recHead = 0;
        
        // Use ScriptProcessor for continuous capture
        // Buffer size 4096 gives ~85ms latency, fine for recording
        recNode = audioCtx.createScriptProcessor(4096, 1, 1);
        recNode.onaudioprocess = (e) => {
            const input = e.inputBuffer.getChannelData(0);
            for(let i=0; i<input.length; i++) {
                recBuffer[recHead++] = input[i];
                if(recHead >= recLen) recHead = 0;
            }
        };
        
        // Connect: Source -> Rec -> Mute -> Dest (to keep processor alive without feedback)
        const mute = audioCtx.createGain();
        mute.gain.value = 0;
        micSource.connect(recNode);
        recNode.connect(mute);
        mute.connect(audioCtx.destination);

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
    if (!scopePaused) analyser.getFloatTimeDomainData(waveArray); // Float wave (-1..1) for HD scope

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
    
    let maxVal = -1;
    let maxIdx = -1;
    let peakX = 0;

    for(let i=0; i<dataArray.length; i++) {
        const val = dataArray[i];
        if (val > maxVal) {
            maxVal = val;
            maxIdx = i;
            peakX = x + (barW/2);
        }

        const barH = (val/255) * h;
        // Mom's Purple Gradient Heatmap
        const pct = i/dataArray.length;
        ctx.fillStyle = `hsl(${280 + (pct*60)}, 100%, ${50 + (barH/h)*20}%)`; 
        ctx.fillRect(x, h-barH, barW, barH);
        x += barW + 1;
    }
    
    // Draw Peak Indicator (Threshold > 30 to avoid noise)
    if (maxVal > 30 && peakX < w) {
        const nyquist = audioCtx ? audioCtx.sampleRate / 2 : 24000;
        const freq = maxIdx * (nyquist / dataArray.length);
        
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(peakX, 0); ctx.lineTo(peakX, h);
        ctx.stroke();
        ctx.setLineDash([]);
        
        // Label
        ctx.fillStyle = '#fff';
        ctx.font = '12px monospace';
        ctx.textAlign = (peakX > w - 80) ? 'right' : 'left'; // Smart alignment
        ctx.fillText(freq.toFixed(1) + " Hz", peakX + (peakX > w - 80 ? -5 : 5), 20);
    }
}

function drawScope() {
    const c = document.getElementById('scope-canvas');
    const ctx = c.getContext('2d');
    const w = c.width, h = c.height;

    // 1. Calculate Scope Parameters FIRST
    const sampleRate = audioCtx ? audioCtx.sampleRate : 48000;
    // Base 10ms * zoom. 
    const maxSamples = Math.min(waveArray.length, Math.max(32, Math.floor(sampleRate * 0.01 * scopeZoomX)));
    
    let startIdx = 0;
    // Edge trigger
    for (let i = 1; i < maxSamples; i++) {
        if (waveArray[i-1] < 0 && waveArray[i] >= 0 && Math.abs(waveArray[i]) > 0.02) { startIdx = i; break; }
    }
    const drawLen = Math.min(maxSamples, waveArray.length - startIdx);
    const totalTimeMs = (drawLen / sampleRate) * 1000;

    // 2. Clear
    ctx.fillStyle = '#0b0b0b'; 
    ctx.fillRect(0,0,w,h);
    
    // 3. Grid Layer
    const valToY = (v) => (1 - (v * scopeGainY)) * (h/2);

    // X-Axis: Vertical lines & Labels
    ctx.strokeStyle = '#1b1b1b';
    ctx.lineWidth = 1;
    ctx.font = "10px monospace";
    ctx.textAlign = "center";
    ctx.fillStyle = "#666";

    // Draw Grid and Labels
    const xStep = w / 10;
    for (let xg = xStep; xg < w; xg += xStep) {
        // Line
        ctx.beginPath();
        ctx.moveTo(xg, 0); ctx.lineTo(xg, h);
        ctx.stroke();
        
        // Time Label
        let t = (xg / w) * totalTimeMs;
        ctx.fillText(t.toFixed(1) + "ms", xg, h - 5);
    }

    // Y-Axis: Horizontal lines
    const levels = [1.0, 0.5, 0.0, -0.5, -1.0];
    ctx.textAlign = "left";
    
    levels.forEach(lev => {
        const y = valToY(lev);
        if (y >= -10 && y <= h + 10) {
            ctx.strokeStyle = (lev === 0) ? '#444' : '#222';
            ctx.beginPath();
            ctx.moveTo(0, y); ctx.lineTo(w, y);
            ctx.stroke();
            
            ctx.fillStyle = '#666';
            ctx.fillText(lev.toFixed(1), 5, y - 2);
        }
    });

    // 4. Waveform
    ctx.lineWidth = 2;
    ctx.strokeStyle = THEME.accent;
    ctx.lineJoin = 'round';
    ctx.beginPath();

    const sliceW = w / drawLen;
    const getY = (idx) => valToY(waveArray[startIdx + idx]);

    ctx.moveTo(0, getY(0));

    for(let i=1; i < drawLen - 1; i++) {
        const xNext = i * sliceW;
        const yNext = getY(i);
        const xNext2 = (i + 1) * sliceW;
        const yNext2 = getY(i + 1);
        const xMid = (xNext + xNext2) / 2;
        const yMid = (yNext + yNext2) / 2;
        ctx.quadraticCurveTo(xNext, yNext, xMid, yMid);
    }
    ctx.stroke();
}

// Function to calculate rolling moving average
function getSmoothedFreq(newFreq) {
    freqBuffer.push(newFreq);
    if (freqBuffer.length > RMA_SIZE) {
        freqBuffer.shift(); // Remove oldest element
    }
    const sum = freqBuffer.reduce((a, b) => a + b, 0);
    return sum / freqBuffer.length; // Average
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
        // Clear Doppler on Silence
        if(document.getElementById('doppler-shift')) document.getElementById('doppler-shift').innerText = "-- Hz";
        if(document.getElementById('doppler-speed')) document.getElementById('doppler-speed').innerText = "-- m/s";
        freqBuffer = []; // Clear buffer if pitch is lost
        return;
    }
    
    const pitch = autoCorrelate(waveArray, audioCtx.sampleRate);
    if (pitch === -1) {
        document.getElementById('freq-fundamental').innerText = "-- Hz";
        document.getElementById('freq-confidence').innerText = "Noisy";
        // Clear Doppler on Noise
        if(document.getElementById('doppler-shift')) document.getElementById('doppler-shift').innerText = "-- Hz";
        if(document.getElementById('doppler-speed')) document.getElementById('doppler-speed').innerText = "-- m/s";
        freqBuffer = []; // Clear buffer if pitch is lost
    } else {
        document.getElementById('freq-fundamental').innerText = Math.round(pitch) + " Hz";
        document.getElementById('freq-confidence').innerText = "Locked";
        updateHistory(pitch);

        const smoothedPitch = getSmoothedFreq(pitch); // Apply smoothing

        updateDoppler(smoothedPitch); // Feed smoothed pitch to Doppler
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
    
    // Velocity Clamping (Sanity Filter)
    if (Math.abs(speed) > 35.0) {
        if (shiftEl) shiftEl.innerText = "-- Hz";
        if (speedEl) speedEl.innerText = "Noise/Interference";
    } else {
        if (shiftEl) shiftEl.innerText = shift.toFixed(1) + " Hz";
        if (speedEl) speedEl.innerText = speed.toFixed(2) + " m/s";
    }
}

// --- TONE (Superposition Engine) ---
async function toggleTone() {
    const btn = document.getElementById('btn-tone-toggle');
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    
    if (toneOsc1) {
        // STOP
        try { 
            toneOsc1.stop(); 
            toneOsc1.disconnect(); 
        } catch(e){}
        try { 
            toneOsc2.stop(); 
            toneOsc2.disconnect();
        } catch(e){}
        toneOsc1 = null;
        toneOsc2 = null;
        btn.classList.remove('active'); btn.innerText = "Play Tone";
    } else {
        // START
        try {
            if (audioCtx.state === 'suspended') await audioCtx.resume();
        } catch (e) {
            console.error("Audio Context Resume Failed", e);
        }
        
        // Architecture: Osc1(0.5) + Osc2(0.5) -> Master -> Dest
        if (!masterGain) {
             masterGain = audioCtx.createGain();
             masterGain.connect(audioCtx.destination);
        }
        
        // Osc 1
        toneOsc1 = audioCtx.createOscillator();
        toneOsc1.type = 'sine';
        toneGain1 = audioCtx.createGain();
        toneGain1.gain.value = 0.5; // Mixing Ratio
        toneOsc1.connect(toneGain1);
        toneGain1.connect(masterGain);
        
        // Osc 2
        toneOsc2 = audioCtx.createOscillator();
        toneOsc2.type = 'sine';
        toneGain2 = audioCtx.createGain();
        toneGain2.gain.value = 0.5; // Mixing Ratio
        toneOsc2.connect(toneGain2);
        toneGain2.connect(masterGain);
        
        updateTone();
        
        toneOsc1.start();
        toneOsc2.start();
        
        btn.classList.add('active'); btn.innerText = "Stop Tone";
    }
}

function updateTone(e) {
    const vol = document.getElementById('tone-vol').value;
    document.getElementById('tone-vol-val').innerText = Math.round(vol*100);
    if(masterGain) masterGain.gain.value = vol;

    const elA = document.getElementById('tone-freq-a');
    const elB = document.getElementById('tone-freq-b');
    const elLink = document.getElementById('tone-link');
    
    let freqA = parseInt(elA.value);
    let freqB = parseInt(elB.value);
    const linked = elLink.checked;

    // Link Logic: Lock B to A + Delta
    if (e && e.target.id === 'tone-freq-a') {
        if (linked) {
            freqB = freqA + toneDelta;
            // Clamp
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
    
    // Update Oscillators
    if (toneOsc1) toneOsc1.frequency.value = freqA;
    if (toneOsc2) toneOsc2.frequency.value = freqB;
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

function toggleScopePause() {
    scopePaused = !scopePaused;
    const btn = document.getElementById('btn-scope-pause');
    if (btn) btn.textContent = scopePaused ? "Resume" : "Pause";
}

function exportRecording() {
    if (!recBuffer) return alert("No recording data.");
    if (!confirm("Export 10s raw data (~10MB)? This may take a few seconds.")) return;
    
    const sampleRate = audioCtx.sampleRate;
    const len = recBuffer.length;
    const now = performance.now() / 1000;
    
    // Prepare Frequency Lookup
    // absolute time = historyStart + t
    const absFreqs = freqHistory.map(p => ({ t: historyStart + p.t, f: p.f }));
    
    let rows = ["Time(ms),Amplitude,Frequency(Hz)"];
    let fIdx = 0;
    
    for (let i = 0; i < len; i++) {
        // Unwrapping: Oldest is at recHead
        const idx = (recHead + i) % len;
        const amp = recBuffer[idx];
        
        // Time(ms) relative to start of buffer
        const t_ms = (i / sampleRate) * 1000;
        const t_abs = now - ((len - 1 - i) / sampleRate);
        
        // Sync Frequency
        while(fIdx < absFreqs.length - 1 && absFreqs[fIdx+1].t <= t_abs) {
            fIdx++;
        }
        
        let freq = "";
        if (absFreqs.length > 0) {
            // Hold value if within 0.2s window
            if (Math.abs(t_abs - absFreqs[fIdx].t) < 0.2) {
                freq = Math.round(absFreqs[fIdx].f);
            }
        }
        
        rows.push(`${t_ms.toFixed(2)},${amp.toFixed(4)},${freq}`);
    }
    
    const blob = new Blob([rows.join('\n')], {type: 'text/csv'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mic_lab_data.csv';
    a.click();
    URL.revokeObjectURL(url);
}
