// CONFIG
const CONFIG = { fftSize: 2048, silenceThresh: 0.02, confidenceThresh: 0.90 };
const THEME = { accent: '#d05ce3', bg: '#141414', grid: '#333' }; // Mom's Purple

// STATE
let audioCtx, analyser, micSource, toneOsc, toneGain;
let isRunning = false;
let dataArray, timeArray; 
let scopeZoomX = 1, scopeGainY = 1;

// STOPWATCH STATE
let clapState = 'IDLE'; 
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

    // 3. LISTENERS
    document.getElementById('btn-start').onclick = startEngine;
    document.getElementById('btn-stop').onclick = stopEngine;
    
    // Tuning
    document.getElementById('scope-timebase').oninput = (e) => scopeZoomX = parseInt(e.target.value);
    document.getElementById('scope-gain').oninput = (e) => scopeGainY = parseFloat(e.target.value);
    
    // Copy Buttons
    document.getElementById('btn-copy-spectrum').onclick = copySpectrum;
    document.getElementById('btn-copy-scope').onclick = copyScope;

    // Tone
    document.getElementById('btn-tone-toggle').onclick = toggleTone;
    document.getElementById('tone-freq').oninput = updateTone;
    document.getElementById('tone-vol').oninput = updateTone;

    // Stopwatch
    document.getElementById('btn-speed-start').onclick = armStopwatch;
};

function initCanvas(id) {
    const c = document.getElementById(id);
    c.width = c.clientWidth;
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
        dataArray = new Uint8Array(len);
        timeArray = new Uint8Array(len);

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
        // Purple Gradient Heatmap
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

    ctx.fillStyle = '#0b0b0b'; ctx.fillRect(0,0,w,h);
    
    // Grid
    ctx.beginPath();
    ctx.strokeStyle = '#222'; 
    ctx.moveTo(0, h/2); ctx.lineTo(w, h/2); 
    ctx.stroke(); 

    ctx.lineWidth = 2;
    ctx.strokeStyle = THEME.accent; // Mom's Purple
    ctx.beginPath();

    const sliceW = w * 1.0 / (timeArray.length / scopeZoomX);
    let x = 0;

    for(let i=0; i < timeArray.length; i++) {
        if (i > timeArray.length / scopeZoomX) break;
        
        let v = timeArray[i] / 128.0; 
        let y = v * h/2;

        let dev = v - 1;
        y = (1 + (dev * scopeGainY)) * h/2;

        if (i===0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        x += sliceW;
    }
    ctx.stroke();
}

// --- ANALYSIS ---
function analyze() {
    let sum=0;
    for(let i=0; i<timeArray.length; i++) {
        let v = (timeArray[i]-128)/128;
        sum += v*v;
    }
    const rms = Math.sqrt(sum/timeArray.length);
    document.getElementById('amp-rms').innerText = rms.toFixed(3);
    document.getElementById('amp-db').innerText = (20*Math.log10(rms)).toFixed(1);

    if (rms < CONFIG.silenceThresh) {
        document.getElementById('freq-fundamental').innerText = "-- Hz";
        document.getElementById('freq-confidence').innerText = "Low Signal";
        return;
    }
    
    const pitch = autoCorrelate(timeArray, audioCtx.sampleRate);
    if (pitch === -1) {
        document.getElementById('freq-fundamental').innerText = "-- Hz";
        document.getElementById('freq-confidence').innerText = "Noisy";
    } else {
        document.getElementById('freq-fundamental').innerText = Math.round(pitch) + " Hz";
        document.getElementById('freq-confidence').innerText = "Locked";
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
        corr = 1 - (corr/SIZE); 
        
        if (corr > bestCorr) {
            bestCorr = corr;
            bestOffset = offset;
        }
    }
    if (bestCorr > 0.9) return rate / bestOffset;
    return -1;
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
    const THRESH = 0.2; 
    const now = Date.now();

    if (clapState === 'ARMED' && rms > THRESH) {
        clapStart = now;
        clapState = 'LOCKOUT';
        document.getElementById('speed-status').innerText = "Clap detected... Wait...";
    }
    else if (clapState === 'LOCKOUT' && (now - clapStart > 200)) {
        clapState = 'WAITING_2';
        document.getElementById('speed-status').innerText = "Waiting for CLAP 2...";
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

// --- EXPORT CSV (Robust) ---
function copyScope() {
    if (!timeArray) return alert("Start the microphone first!");
    let csv = "Time(s),Voltage\n";
    const step = 1/audioCtx.sampleRate;
    for(let i=0; i<timeArray.length; i++) {
        csv += `${(i*step).toFixed(4)},${(timeArray[i]/128).toFixed(3)}\n`;
    }
    navigator.clipboard.writeText(csv)
        .then(() => alert("Copied Scope Data to Clipboard!"))
        .catch(err => alert("Copy failed: " + err));
}

function copySpectrum() {
    if (!dataArray) return alert("Start the microphone first!");
    let csv = "Freq(Hz),Magnitude\n";
    const bin = (audioCtx.sampleRate/2) / dataArray.length;
    for(let i=0; i<dataArray.length; i++) {
        csv += `${(i*bin).toFixed(1)},${dataArray[i]}\n`;
    }
    navigator.clipboard.writeText(csv)
        .then(() => alert("Copied Spectrum Data to Clipboard!"))
        .catch(err => alert("Copy failed: " + err));
}
