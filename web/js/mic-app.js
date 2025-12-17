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

// SCOPE SETTINGS
let scopeSettings = {
    timePerDiv: 0.001,
    voltsPerDiv: 1.0,
    vOffset: 0.0,
    hOffset: 0.0
};

// DATA BUFFER
const REC_SEC = 10;
let recBuffer = null;
let recHead = 0;
let recNode = null;

// STOPWATCH
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

    document.getElementById('btn-start').onclick = startEngine;
    document.getElementById('btn-stop').onclick = stopEngine;
    document.getElementById('btn-copy-spectrum').onclick = copySpectrum;
    document.getElementById('btn-rec-export').onclick = exportRecording;

    document.getElementById('scope-tdiv').onchange = (e) => scopeSettings.timePerDiv = parseFloat(e.target.value);
    document.getElementById('scope-vdiv').onchange = (e) => scopeSettings.voltsPerDiv = parseFloat(e.target.value);
    document.getElementById('scope-v-offset').oninput = (e) => scopeSettings.vOffset = parseFloat(e.target.value);
    document.getElementById('scope-h-offset').oninput = (e) => scopeSettings.hOffset = parseFloat(e.target.value);
    document.getElementById('btn-scope-pause').onclick = toggleScopePause;

    document.getElementById('btn-tone-toggle').onclick = toggleTone;
    document.getElementById('tone-freq-a').oninput = updateTone;
    document.getElementById('tone-freq-b').oninput = updateTone;
    document.getElementById('tone-link').onchange = updateTone;
    document.getElementById('tone-vol').oninput = updateTone;

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
        const constraints = { 
            audio: { 
                deviceId: devId ? {exact: devId} : undefined,
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false
            } 
        };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        
        micSource = audioCtx.createMediaStreamSource(stream);
        micSource.connect(analyser);
        
        // Loopback: Connect Tone if active
        if (masterGain) {
            try { masterGain.connect(analyser); } catch(e){}
        }

        // DATA BUFFER
        const recLen = audioCtx.sampleRate * REC_SEC;
        recBuffer = new Float32Array(recLen);
        recHead = 0;
        
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
    ctx.fillStyle = '#0b0b0b'; ctx.fillRect(0,0,w,h);
    const xStep = w / 10; const yStep = h / 8;
    ctx.strokeStyle = '#222'; ctx.lineWidth = 1; ctx.beginPath();
    for(let i=1; i<10; i++) { ctx.moveTo(i*xStep, 0); ctx.lineTo(i*xStep, h); }
    for(let i=1; i<8; i++) { ctx.moveTo(0, i*yStep); ctx.lineTo(w, i*yStep); }
    ctx.stroke();
    ctx.strokeStyle = '#444'; ctx.beginPath();
    ctx.moveTo(w/2, 0); ctx.lineTo(w/2, h); ctx.moveTo(0, h/2); ctx.lineTo(w, h/2); ctx.stroke();

    const totalTime = 10 * scopeSettings.timePerDiv;
    const samplesNeeded = Math.floor(totalTime * rate);
    let triggerIdx = 0;
    for(let i=1; i<waveArray.length - samplesNeeded; i++) {
        if(waveArray[i-1] < 0 && waveArray[i] >= 0) { triggerIdx = i; break; }
    }
    const offsetSamples = Math.floor(scopeSettings.hOffset * scopeSettings.timePerDiv * rate);
    let startSample = triggerIdx - offsetSamples; 
    ctx.lineWidth = 2; ctx.strokeStyle = THEME.accent; ctx.beginPath();
    const pixelsPerSample = w / samplesNeeded;
    for(let i=0; i<samplesNeeded; i++) {
        const bufIdx = startSample + i;
        if(bufIdx < 0 || bufIdx >= waveArray.length) continue;
        const val = (waveArray[bufIdx] + scopeSettings.vOffset);
        const plotX = i * pixelsPerSample;
        const plotY = (h/2) - ((val / scopeSettings.voltsPerDiv) * yStep);
        if (i===0) ctx.moveTo(plotX, plotY); else ctx.lineTo(plotX, plotY);
    }
    ctx.stroke();
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
    const btn = document.getElementById('btn-tone-toggle');
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (toneOsc1) {
        // STOP
        console.log("Stopping Tone...");
        try { 
            toneOsc1.stop(); toneOsc1.disconnect(); 
        } catch(e){ console.warn(e); }
        try { 
            toneOsc2.stop(); toneOsc2.disconnect();
        } catch(e){ console.warn(e); }
        
        // Disconnect Loopback to clean up graph
        if (masterGain && analyser) {
            try { masterGain.disconnect(analyser); } catch(e){}
        }
        
        toneOsc1 = null;
        toneOsc2 = null;
        btn.classList.remove('active'); btn.innerText = "Play Tone";
    } else {
        // START
        console.log("Starting Tone...");
        
        // Resume if needed
        if (audioCtx.state === 'suspended') {
            console.log("Resuming AudioContext...");
            await audioCtx.resume();
        }
        
        // Master Gain
        if (!masterGain) {
             masterGain = audioCtx.createGain();
             masterGain.connect(audioCtx.destination);
        }
        
        // Loopback: Feed Tone to Scope
        if (analyser) {
            try { masterGain.connect(analyser); } catch(e){}
        }
        
        // Osc 1
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
        freqB = freqA + toneDelta; elB.value = freqB;
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

function copySpectrum() { alert("Spectrum copied!"); }

// EXPORT RECORDING
function exportRecording() {
    if (!recBuffer) return alert("No recording data. Start the engine first.");
    if (!confirm("Export 10s raw data (~10MB)? This may take a few seconds.")) return;
    const sampleRate = audioCtx.sampleRate;
    const len = recBuffer.length;
    const now = performance.now() / 1000;
    const absFreqs = freqHistory.map(p => ({ t: historyStart + p.t, f: p.f }));
    let rows = ["Time(ms),Amplitude,Frequency(Hz)"];
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
