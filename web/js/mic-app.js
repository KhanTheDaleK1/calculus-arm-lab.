// CONFIG
const CONFIG = { fftSize: 2048, silenceThresh: 0.02 };
const THEME = { accent: '#d05ce3', bg: '#141414', grid: '#333' };

// STATE
let audioCtx, analyser, micSource;
let toneOsc1, toneGain1, toneOsc2, toneGain2, masterGain;
let isRunning = false;
let dataArray, waveArray; 
let freqHistory = [];
let historyStart = null;
let scopePaused = false;
let toneDelta = 2;

// SCOPE SETTINGS (Professional)
let scopeSettings = {
    timePerDiv: 0.001, // 1ms default
    voltsPerDiv: 1.0,  // 1V default (assuming +/-1.0 float = +/-1V)
    vOffset: 0.0,
    hOffset: 0.0
};

// STOPWATCH STATE
let clapState = 'IDLE'; 
let clapStart = 0;

window.onload = () => {
    initCanvas('spectrum-canvas');
    initCanvas('scope-canvas');
    initCanvas('history-canvas');

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

    // LISTENERS
    document.getElementById('btn-start').onclick = startEngine;
    document.getElementById('btn-stop').onclick = stopEngine;
    document.getElementById('btn-copy-spectrum').onclick = copySpectrum;
    document.getElementById('btn-rec-export').onclick = exportRecording;

    // SCOPE CONTROLS
    document.getElementById('scope-tdiv').onchange = (e) => scopeSettings.timePerDiv = parseFloat(e.target.value);
    document.getElementById('scope-vdiv').onchange = (e) => scopeSettings.voltsPerDiv = parseFloat(e.target.value);
    document.getElementById('scope-v-offset').oninput = (e) => scopeSettings.vOffset = parseFloat(e.target.value);
    document.getElementById('scope-h-offset').oninput = (e) => scopeSettings.hOffset = parseFloat(e.target.value);
    document.getElementById('btn-scope-pause').onclick = toggleScopePause;

    // TONE CONTROLS
    document.getElementById('btn-tone-toggle').onclick = toggleTone;
    document.getElementById('tone-freq-a').oninput = updateTone;
    document.getElementById('tone-freq-b').oninput = updateTone;
    document.getElementById('tone-link').onchange = updateTone;
    document.getElementById('tone-vol').oninput = updateTone;

    // STOPWATCH
    document.getElementById('btn-speed-start').onclick = armStopwatch;
};

function initCanvas(id) {
    const c = document.getElementById(id);
    if(c) { c.width = c.clientWidth; c.height = c.clientHeight; }
}

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
        dataArray = new Uint8Array(len);
        waveArray = new Float32Array(len);

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
    if (!scopePaused) analyser.getFloatTimeDomainData(waveArray);

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
    const rate = audioCtx ? audioCtx.sampleRate : 48000;

    // 1. CLEAR & GRID
    ctx.fillStyle = '#0b0b0b'; ctx.fillRect(0,0,w,h);
    
    // Grid (10 horizontal divisions, 8 vertical)
    const xStep = w / 10;
    const yStep = h / 8;
    ctx.strokeStyle = '#222'; ctx.lineWidth = 1;
    ctx.beginPath();
    
    // Vert lines (Time)
    for(let i=1; i<10; i++) { ctx.moveTo(i*xStep, 0); ctx.lineTo(i*xStep, h); }
    // Horiz lines (Volts)
    for(let i=1; i<8; i++) { ctx.moveTo(0, i*yStep); ctx.lineTo(w, i*yStep); }
    ctx.stroke();

    // Center Crosshair
    ctx.strokeStyle = '#444'; ctx.beginPath();
    ctx.moveTo(w/2, 0); ctx.lineTo(w/2, h);
    ctx.moveTo(0, h/2); ctx.lineTo(w, h/2);
    ctx.stroke();

    // 2. LOGIC
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
    
    // 3. WAVEFORM
    ctx.lineWidth = 2;
    ctx.strokeStyle = THEME.accent;
    ctx.beginPath();

    const pixelsPerSample = w / samplesNeeded;
    
    for(let i=0; i<samplesNeeded; i++) {
        const bufIdx = startSample + i;
        if(bufIdx < 0 || bufIdx >= waveArray.length) continue;
        
        const rawY = waveArray[bufIdx];
        // Apply Vertical Offset & Gain
        // Screen Y = Center - (Value + Offset)/VoltsPerDiv * (Height/8 divisions)
        // Note: typically 1V is 1 division. If voltsPerDiv is 1, 1.0 = 1 div (yStep).
        // Wait, standard scope: 1V/div means 1.0 signal spans 1 division. 
        // Our float is +/- 1.0. If div is 1V, then 1.0 is 1 grid box height.
        
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
    
    // 4. READOUTS
    ctx.fillStyle = '#fff'; ctx.font = "11px monospace";
    ctx.fillText(`T: ${scopeSettings.timePerDiv*1000 < 1 ? (scopeSettings.timePerDiv*1000000).toFixed(0)+'µs' : (scopeSettings.timePerDiv*1000).toFixed(1)+'ms'}/div`, 5, 12);
    ctx.fillText(`V: ${scopeSettings.voltsPerDiv}V/div`, 5, 24);
}

function analyze() {
    let sum=0;
    for(let i=0; i<waveArray.length; i++) sum += waveArray[i]*waveArray[i];
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
    const btn = document.getElementById('btn-tone-toggle');
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    
    if (toneOsc1) {
        try { toneOsc1.stop(); toneOsc1.disconnect(); } catch(e){}
        try { toneOsc2.stop(); toneOsc2.disconnect(); } catch(e){}
        toneOsc1 = null; toneOsc2 = null;
        btn.classList.remove('active'); btn.innerText = "Play Tone";
    } else {
        if (audioCtx.state === 'suspended') await audioCtx.resume();
        if (!masterGain) { masterGain = audioCtx.createGain(); masterGain.connect(audioCtx.destination); }
        toneOsc1 = audioCtx.createOscillator(); toneOsc1.type = 'sine';
        toneGain1 = audioCtx.createGain(); toneGain1.gain.value = 0.5; 
        toneOsc1.connect(toneGain1); toneGain1.connect(masterGain);
        
        toneOsc2 = audioCtx.createOscillator(); toneOsc2.type = 'sine';
        toneGain2 = audioCtx.createGain(); toneGain2.gain.value = 0.5;
        toneOsc2.connect(toneGain2); toneGain2.connect(masterGain);
        
        updateTone();
        toneOsc1.start(); toneOsc2.start();
        btn.classList.add('active'); btn.innerText = "Stop Tone";
    }
}

function updateTone(e) {
    const vol = parseFloat(document.getElementById('tone-vol').value);
    document.getElementById('tone-vol-val').innerText = Math.round(vol*100);
    if(masterGain) masterGain.gain.setValueAtTime(vol, audioCtx.currentTime);

    const elA = document.getElementById('tone-freq-a');
    const elB = document.getElementById('tone-freq-b');
    const elLink = document.getElementById('tone-link');
    if (!elA || !elB) return;
    
    let freqA = parseInt(elA.value) || 440;
    let freqB = parseInt(elB.value) || 440;
    const linked = elLink ? elLink.checked : false;

    if (e && e.target.id === 'tone-freq-a' && linked) {
        freqB = freqA + toneDelta;
        elB.value = freqB;
    } else if (e && (e.target.id === 'tone-freq-b' || e.target.id === 'tone-link') && linked) {
         toneDelta = freqB - freqA;
    }
    
    document.getElementById('tone-freq-a-val').innerText = freqA;
    document.getElementById('tone-freq-b-val').innerText = freqB;
    if (toneOsc1) toneOsc1.frequency.setValueAtTime(freqA, audioCtx.currentTime);
    if (toneOsc2) toneOsc2.frequency.setValueAtTime(freqB, audioCtx.currentTime);
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

function copySpectrum() {
    // Basic CSV export logic would go here
    alert("Spectrum copied!");
}
function exportRecording() {
    alert("Export feature placeholder.");
}

// Auto-Resize
let resizeTimeout;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
        initCanvas('spectrum-canvas'); initCanvas('scope-canvas'); initCanvas('history-canvas');
    }, 100);
});