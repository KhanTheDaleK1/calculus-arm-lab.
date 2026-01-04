// CONFIG
const CONFIG = { fftSize: 2048, silenceThresh: 0.02, confidenceThresh: 0.90 };

// STATE
let audioCtx, analyser, micSource, toneOsc, toneGain;
let isRunning = false;
let dataArray, timeArray; // Buffers
let scopeZoomX = 1, scopeGainY = 1;

// STOPWATCH STATE
let clapState = 'IDLE'; // IDLE, ARMED, LOCKOUT, WAITING_2
let clapStart = 0;

window.onload = () => {
    // 1. SETUP UI
    initCanvas('spectrum-canvas');
    initCanvas('scope-canvas');
    initCanvas('history-canvas');

    // 2. LOAD MICS
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

    // 3. EVENT LISTENERS
    document.getElementById('btn-start').onclick = startEngine;
    document.getElementById('btn-stop').onclick = stopEngine;
    
    // Scope Tuning (Matched your uploaded IDs)
    document.getElementById('scope-timebase').oninput = (e) => scopeZoomX = parseInt(e.target.value);
    document.getElementById('scope-gain').oninput = (e) => scopeGainY = parseFloat(e.target.value);
    
    // Copy Buttons
    document.getElementById('btn-copy-spectrum').onclick = copySpectrum;
    document.getElementById('btn-copy-scope').onclick = copyScope;

    // Tone Gen
    document.getElementById('btn-tone-toggle').onclick = toggleTone;
    document.getElementById('tone-freq').oninput = updateTone;
    document.getElementById('tone-vol').oninput = updateTone;

    // Stopwatch
    document.getElementById('btn-speed-start').onclick = armStopwatch;
};

function initCanvas(id) {
    const c = document.getElementById(id);
    if (!c) return;
    c.width = c.clientWidth;
    c.height = c.clientHeight;
}

// --- ENGINE ---
async function startEngine() {
    if (isRunning) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = CONFIG.fftSize;

    const devId = document.getElementById('device-select').value;
    
    try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw new Error("Browser API not supported. Note: Mic requires HTTPS or localhost.");
        }
        
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: devId ? {exact: devId} : undefined } });
        
        micSource = audioCtx.createMediaStreamSource(stream);
        micSource.connect(analyser);

        const len = analyser.frequencyBinCount;
        dataArray = new Uint8Array(len);
        timeArray = new Uint8Array(len);

        isRunning = true;
        document.getElementById('mic-status').innerText = "LIVE";
        document.getElementById('mic-status').style.color = "#00ff00";
        loop();
    } catch (err) {
        console.error("Mic Error:", err);
        alert("Microphone Error:\n" + err.message + "\n\n(Ensure you allowed permissions and are using HTTPS/localhost)");
        stopEngine();
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

    analyser.getByteFrequencyData(dataArray);
    analyser.getByteTimeDomainData(timeArray);

    drawSpectrum();
    drawScope();
    analyze();
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
        ctx.fillStyle = `hsl(${i/dataArray.length * 360}, 100%, 50%)`;
        ctx.fillRect(x, h-barH, barW, barH);
        x += barW + 1;
    }
}

function drawScope() {
    const c = document.getElementById('scope-canvas');
    const ctx = c.getContext('2d');
    const w = c.width, h = c.height;

    ctx.fillStyle = '#111'; ctx.fillRect(0,0,w,h);
    ctx.beginPath();
    ctx.strokeStyle = '#333'; ctx.moveTo(0, h/2); ctx.lineTo(w, h/2); ctx.stroke(); // Center line

    ctx.lineWidth = 2;
    ctx.strokeStyle = '#00ff00';
    ctx.beginPath();

    const sliceW = w * 1.0 / (timeArray.length / scopeZoomX);
    let x = 0;

    for(let i=0; i < timeArray.length; i++) {
        if (i > timeArray.length / scopeZoomX) break;
        
        let v = timeArray[i] / 128.0; // 0..2
        let y = v * h/2;

        // Apply Gain (Center Expansion)
        let dev = v - 1;
        y = (1 + (dev * scopeGainY)) * h/2;

        if (i===0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        x += sliceW;
    }
    ctx.stroke();
}

// --- ANALYSIS (FIXED) ---
function analyze() {
    // 1. RMS
    let sum=0;
    for(let i=0; i<timeArray.length; i++) {
        let v = (timeArray[i]-128)/128;
        sum += v*v;
    }
    const rms = Math.sqrt(sum/timeArray.length);
    document.getElementById('amp-rms').innerText = rms.toFixed(3);
    document.getElementById('amp-db').innerText = (20*Math.log10(rms || 1e-9)).toFixed(1);

    // 2. PITCH (Noise Gated)
    if (rms < CONFIG.silenceThresh) {
        document.getElementById('freq-fundamental').innerText = "-- Hz";
        document.getElementById('freq-confidence').innerText = "Low Signal";
        document.getElementById('freq-note').innerText = "--";
        return;
    }
    
    // Simple AutoCorrelate
    const pitch = autoCorrelate(timeArray, audioCtx.sampleRate);
    if (pitch === -1) {
        document.getElementById('freq-fundamental').innerText = "-- Hz";
        document.getElementById('freq-confidence').innerText = "Noisy";
        document.getElementById('freq-note').innerText = "--";
    } else {
        document.getElementById('freq-fundamental').innerText = Math.round(pitch) + " Hz";
        document.getElementById('freq-confidence').innerText = "Locked";
        document.getElementById('freq-note').innerText = getNote(pitch);
    }
}

function autoCorrelate(buf, rate) {
    const SIZE = buf.length;
    let bestOffset = -1;
    let bestCorr = 0;

    for (let offset = 8; offset < SIZE/2; offset++) {
        let corr = 0;
        for (let i=0; i<SIZE-offset; i++) {
            corr += Math.abs((buf[i]-128) - (buf[i+offset]-128));
        }
        // Invert (Lower diff = higher correlation)
        corr = 1 - (corr/SIZE); 
        
        if (corr > bestCorr) {
            bestCorr = corr;
            bestOffset = offset;
        }
    }
    
    // Confidence Threshold
    if (bestCorr > CONFIG.confidenceThresh) return rate / bestOffset;
    return -1;
}

// --- TONE GEN (FIXED STATE) ---
function toggleTone() {
    const btn = document.getElementById('btn-tone-toggle');
    if (toneOsc) {
        toneOsc.stop(); toneOsc = null;
        btn.classList.remove('active'); btn.innerText = "ACTIVATE";
    } else {
        if (audioCtx.state === 'suspended') audioCtx.resume(); // FIX: Force Resume
        toneOsc = audioCtx.createOscillator();
        toneGain = audioCtx.createGain();
        toneOsc.connect(toneGain);
        toneGain.connect(audioCtx.destination);
        updateTone();
        toneOsc.start();
        btn.classList.add('active'); btn.innerText = "STOP";
    }
}

function updateTone() {
    const f = document.getElementById('tone-freq').value;
    const v = document.getElementById('tone-vol').value;
    if (toneOsc) {
        toneOsc.frequency.value = f;
        toneGain.gain.value = v;
    }
    document.getElementById('tone-freq-val').innerText = f;
    document.getElementById('tone-vol-val').innerText = Math.round(v*100);
}

// --- STOPWATCH (STATE MACHINE FIX) ---
function armStopwatch() {
    clapState = 'ARMED';
    document.getElementById('speed-status').innerText = "WAITING FOR CLAP 1...";
    document.getElementById('speed-dt').innerText = "-- ms";
}

function processStopwatch() {
    if (clapState === 'IDLE') return;
    const rms = parseFloat(document.getElementById('amp-rms').innerText);
    const THRESH = 0.2; // Adjust for mic sensitivity

    const now = Date.now();

    if (clapState === 'ARMED' && rms > THRESH) {
        clapStart = now;
        clapState = 'LOCKOUT'; // Ignore echoes
        document.getElementById('speed-status').innerText = "CLAP 1 DETECTED. WAIT...";
    }
    else if (clapState === 'LOCKOUT' && (now - clapStart > 200)) {
        clapState = 'WAITING_2';
        document.getElementById('speed-status').innerText = "WAITING FOR CLAP 2...";
    }
    else if (clapState === 'WAITING_2' && rms > THRESH) {
        const diff = now - clapStart;
        document.getElementById('speed-dt').innerText = diff + " ms";
        
        const dist = parseFloat(document.getElementById('speed-distance').value);
        const speed = dist / (diff/1000);
        document.getElementById('speed-est').innerText = speed.toFixed(1) + " m/s";
        
        clapState = 'IDLE';
        document.getElementById('speed-status').innerText = "DONE";
    }
}

// --- EXPORT CSV ---
function copyScope() {
    let csv = "Time(s),Voltage\n";
    const step = 1/audioCtx.sampleRate;
    for(let i=0; i<timeArray.length; i++) {
        csv += `${(i*step).toFixed(4)},${(timeArray[i]/128).toFixed(3)}\n`;
    }
    navigator.clipboard.writeText(csv).then(() => alert("Copied Scope Data!"));
}

function copySpectrum() {
    let csv = "Freq(Hz),Magnitude\n";
    const bin = (audioCtx.sampleRate/2) / dataArray.length;
    for(let i=0; i<dataArray.length; i++) {
        csv += `${(i*bin).toFixed(1)},${dataArray[i]}\n`;
    }
    navigator.clipboard.writeText(csv).then(() => alert("Copied Spectrum Data!"));
}

function getNote(frequency) {
    const noteStrings = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    if (!frequency || frequency <= 0) return "--";

    // MIDI Note Calculation: n = 12 * log2(f / 440) + 69
    const noteNum = 12 * (Math.log(frequency / 440) / Math.log(2));
    const midi = Math.round(noteNum) + 69;
    
    const noteName = noteStrings[midi % 12];
    const octave = Math.floor(midi / 12) - 1;
    
    // Calculate cents deviation
    const cents = Math.floor((noteNum - Math.round(noteNum)) * 100);
    
    return `${noteName}${octave} (${cents > 0 ? '+' : ''}${cents}c)`;
}
