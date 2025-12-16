// --- CONFIGURATION ---
const CONFIG = {
    fftSize: 2048,
    scopeSize: 2048, // Must match fftSize for AnalyserNode
    silenceThreshold: 0.02, // RMS must be > 2% to detect pitch
    confidenceThreshold: 0.92 // Autocorrelation match > 92%
};

// --- STATE ---
let audioCtx, analyser, micSource, toneOsc, toneGain;
let isRunning = false;
let animationId;
let dataArray, timeArray;
let canvasCtx = {};

// Scope Tuning
let scopeZoomX = 1;
let scopeGainY = 1;

// Stopwatch State
let clapState = 'IDLE'; // IDLE, ARMED, LOCKOUT, WAITING_2
let clapStartTime = 0;
let lastClapTime = 0;

// --- INITIALIZATION ---
window.onload = () => {
    initCanvas('spectrumCanvas');
    initCanvas('scopeCanvas');
    initCanvas('historyCanvas');
    
    // Check for browser support
    navigator.mediaDevices.enumerateDevices().then(devices => {
        const sel = document.getElementById('micSelect');
        sel.innerHTML = '';
        devices.filter(d => d.kind === 'audioinput').forEach(d => {
            const opt = document.createElement('option');
            opt.value = d.deviceId;
            opt.text = d.label || `Microphone ${sel.length + 1}`;
            sel.appendChild(opt);
        });
    });

    // Event Listeners
    document.getElementById('startBtn').onclick = startEngine;
    document.getElementById('stopBtn').onclick = stopEngine;
    
    // Sliders
    document.getElementById('timebaseConfig').oninput = (e) => scopeZoomX = parseInt(e.target.value);
    document.getElementById('gainConfig').oninput = (e) => scopeGainY = parseFloat(e.target.value);
    
    // Tone
    document.getElementById('toggleToneBtn').onclick = toggleTone;
    document.getElementById('toneFreq').oninput = updateTone;
    document.getElementById('toneVol').oninput = updateTone;
    document.getElementById('toneType').onchange = updateTone;
    
    // Tools
    document.getElementById('pingBtn').onclick = runSonarPing;
    document.getElementById('clapBtn').onclick = armClapTrigger;
};

function toggleSOP(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.toggle('open');
}

function initCanvas(id) {
    const c = document.getElementById(id);
    c.width = c.clientWidth;
    c.height = c.clientHeight;
    canvasCtx[id] = c.getContext('2d');
}

// --- AUDIO ENGINE ---
async function startEngine() {
    if (isRunning) return;
    
    try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = CONFIG.fftSize;
        
        const deviceId = document.getElementById('micSelect').value;
        const constraints = { audio: { deviceId: deviceId ? { exact: deviceId } : undefined } };
        
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        micSource = audioCtx.createMediaStreamSource(stream);
        micSource.connect(analyser);
        // Do NOT connect mic to destination (feedback loop!)

        const bufferLength = analyser.frequencyBinCount;
        dataArray = new Uint8Array(bufferLength); // FFT
        timeArray = new Uint8Array(bufferLength); // Scope

        isRunning = true;
        drawLoop();
        document.getElementById('startBtn').style.opacity = '0.5';
    } catch (e) {
        alert("Microphone Access Denied: " + e);
    }
}

function stopEngine() {
    isRunning = false;
    cancelAnimationFrame(animationId);
    if(audioCtx) audioCtx.close();
    document.getElementById('startBtn').style.opacity = '1';
}

// --- MAIN LOOP ---
function drawLoop() {
    if (!isRunning) return;
    animationId = requestAnimationFrame(drawLoop);
    
    analyser.getByteFrequencyData(dataArray); // FFT
    analyser.getByteTimeDomainData(timeArray); // Scope
    
    // 1. Draw Spectrum
    drawSpectrum();
    
    // 2. Draw Oscilloscope (Dynamic)
    drawScope();
    
    // 3. Pitch & Volume
    analyzeSignal();
    
    // 4. Tools Logic (Stopwatch)
    processClapLogic();
}

// --- VISUALIZERS ---
function drawSpectrum() {
    const ctx = canvasCtx['spectrumCanvas'];
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    
    const barWidth = (w / dataArray.length) * 2.5;
    let x = 0;
    
    let maxVal = 0;
    let maxIndex = 0;

    for(let i = 0; i < dataArray.length; i++) {
        const barHeight = dataArray[i] / 255 * h;
        
        // Heatmap Color
        const r = barHeight + (25 * (i/dataArray.length));
        const g = 250 * (i/dataArray.length);
        const b = 50;

        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(x, h - barHeight, barWidth, barHeight);
        
        if (dataArray[i] > maxVal) { maxVal = dataArray[i]; maxIndex = i; }
        x += barWidth + 1;
    }
    
    // Update Peak Freq
    const nyquist = audioCtx.sampleRate / 2;
    const peakFreq = (maxIndex / dataArray.length) * nyquist;
    document.getElementById('peakFreq').innerText = Math.round(peakFreq);
}

function drawScope() {
    const ctx = canvasCtx['scopeCanvas'];
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    ctx.fillStyle = '#141414'; // Dark gray background
    ctx.fillRect(0, 0, w, h);
    
    // Draw Grid
    ctx.strokeStyle = '#333';
    ctx.beginPath();
    ctx.moveTo(0, h/2); ctx.lineTo(w, h/2); // Center Line
    ctx.stroke();

    ctx.lineWidth = 2;
    ctx.strokeStyle = '#00ff00';
    ctx.beginPath();
    
    const sliceWidth = w * 1.0 / (timeArray.length / scopeZoomX); // Zoom X Logic
    let x = 0;
    
    // Start drawing
    for(let i = 0; i < timeArray.length; i++) {
        if (i > timeArray.length / scopeZoomX) break; // Crop if zoomed in

        let v = timeArray[i] / 128.0; // Standard 0..2 float
        let y = v * h/2; // Standard Y

        // Gain Logic (Center expansion)
        // v ranges from 0 to 2, 1 is center.
        let deviation = v - 1;
        deviation = deviation * scopeGainY;
        v = 1 + deviation;
        y = v * h/2; // Map back to pixels

        // Clamp visual
        if (y < 0) y = 0;
        if (y > h) y = h;

        if(i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
        x += sliceWidth;
    }
    ctx.stroke();
}

// --- ANALYSIS (FIXED BUGS) ---
function analyzeSignal() {
    // 1. RMS (Volume)
    let sum = 0;
    for(let i = 0; i < timeArray.length; i++) {
        let val = (timeArray[i] - 128) / 128;
        sum += val * val;
    }
    const rms = Math.sqrt(sum / timeArray.length);
    document.getElementById('rmsLevel').innerText = rms.toFixed(3);
    
    // 2. Pitch (AutoCorrelate with Noise Gate)
    if (rms < CONFIG.silenceThreshold) {
        document.getElementById('fundamentalFreq').innerText = "-- Hz";
        document.getElementById('confidence').innerText = "Low Signal";
        document.getElementById('pitchNote').innerText = "Signal too quiet";
        return;
    }
    
    const pitch = autoCorrelate(timeArray, audioCtx.sampleRate);
    if (pitch === -1) {
        document.getElementById('fundamentalFreq').innerText = "-- Hz";
        document.getElementById('confidence').innerText = "Noisy";
        document.getElementById('pitchNote').innerText = "Waveform irregular";
    } else {
        document.getElementById('fundamentalFreq').innerText = Math.round(pitch) + " Hz";
        document.getElementById('confidence').innerText = "Locked";
        document.getElementById('pitchNote').innerText = "";
    }
}

// Improved Autocorrelation
function autoCorrelate(buf, sampleRate) {
    const SIZE = buf.length;
    let rms = 0;

    // Normalization
    // Use raw values (0-255) centered at 128
    const center = 128;
    
    // Brute force autocorrelation
    let bestOffset = -1;
    let bestCorrelation = 0;
    
    // Search range: roughly 50Hz to 4000Hz
    // sampleRate / 4000 = minPeriod
    // sampleRate / 50 = maxPeriod
    
    for (let offset = 10; offset < SIZE/2; offset++) {
        let correlation = 0;
        
        for (let i=0; i<SIZE-offset; i++) {
            correlation += (buf[i]-center) * (buf[i+offset]-center);
        }
        
        // Normalize
        // (Simplified for performance, pure peak finding)
        if (correlation > bestCorrelation) {
            bestCorrelation = correlation;
            bestOffset = offset;
        }
    }
    
    // Confidence Check (Simplified)
    // If the correlation is strong enough relative to energy
    if (bestCorrelation > 1000) { // Arbitrary energy threshold
        return sampleRate / bestOffset;
    }
    return -1;
}

// --- TONE GENERATOR (FIXED) ---
function toggleTone() {
    const btn = document.getElementById('toggleToneBtn');
    
    if (toneOsc) {
        // STOP
        toneOsc.stop();
        toneOsc = null;
        btn.classList.remove('active');
        btn.innerText = "ACTIVATE TONE";
    } else {
        // START (FIX: Resume context)
        if (audioCtx.state === 'suspended') audioCtx.resume();
        
        toneOsc = audioCtx.createOscillator();
        toneGain = audioCtx.createGain();
        toneOsc.connect(toneGain);
        toneGain.connect(audioCtx.destination);
        
        updateTone(); // Apply settings
        toneOsc.start();
        btn.classList.add('active');
        btn.innerText = "STOP TONE";
    }
}

function updateTone() {
    if(!toneOsc) {
        // Update Labels even if off
        document.getElementById('toneFreqLabel').innerText = document.getElementById('toneFreq').value;
        document.getElementById('toneVolLabel').innerText = Math.round(document.getElementById('toneVol').value * 100);
        return;
    }
    
    const freq = document.getElementById('toneFreq').value;
    const type = document.getElementById('toneType').value;
    const vol = document.getElementById('toneVol').value;
    
    toneOsc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    toneOsc.type = type;
    toneGain.gain.setValueAtTime(vol, audioCtx.currentTime);
    
    document.getElementById('toneFreqLabel').innerText = freq;
    document.getElementById('toneVolLabel').innerText = Math.round(vol * 100);
}

// --- STOPWATCH (STATE MACHINE) ---
function armClapTrigger() {
    clapState = 'ARMED';
    document.getElementById('clapStatus').innerText = "Status: WAITING FOR CLAP 1...";
    document.getElementById('clapStatus').style.color = "yellow";
    document.getElementById('clapBtn').innerText = "RESET";
}

function processClapLogic() {
    if (clapState === 'IDLE') return;
    
    // Check volume spike
    const rms = parseFloat(document.getElementById('rmsLevel').innerText);
    const CLAP_THRESH = 0.2; // Adjust based on mic
    
    const now = Date.now();
    
    if (clapState === 'ARMED' && rms > CLAP_THRESH) {
        // CLAP 1 DETECTED
        clapStartTime = now;
        clapState = 'LOCKOUT';
        lastClapTime = now;
        document.getElementById('clapStatus').innerText = "Status: CLAP 1 DETECTED. BACK OFF...";
    }
    
    if (clapState === 'LOCKOUT') {
        if (now - lastClapTime > 200) { // 200ms debounce
            clapState = 'WAITING_2';
            document.getElementById('clapStatus').innerText = "Status: WAITING FOR CLAP 2...";
            document.getElementById('clapStatus').style.color = "#00ff00";
        }
    }
    
    if (clapState === 'WAITING_2' && rms > CLAP_THRESH) {
        // CLAP 2 DETECTED
        const diff = now - clapStartTime;
        document.getElementById('stopwatchResult').innerText = diff + " ms";
        
        // Calculate Speed
        const dist = parseFloat(document.getElementById('clapDist').value);
        // Speed = Distance * 2 (Round trip? No, user separated claps) -> Dist / (Time/1000)
        // If claps are echo based: Speed = (2 * Dist) / Time
        // Assuming two people clapping: Speed = Dist / Time
        
        const speed = dist / (diff / 1000);
        document.getElementById('calculatedSpeed').innerText = speed.toFixed(1) + " m/s";
        
        clapState = 'IDLE';
        document.getElementById('clapStatus').innerText = "Status: DONE";
        document.getElementById('clapBtn').innerText = "ARM TRIGGER";
    }
}

// --- DATA EXPORT ---
function copyScopeData() {
    // Generate CSV from timeArray
    let csv = "Time(ms),Amplitude\n";
    // Each sample is 1/sampleRate seconds.
    // sampleRate ~48000. 1 sample ~0.02ms
    const step = (1 / audioCtx.sampleRate) * 1000; 
    
    for(let i=0; i<timeArray.length; i++) {
        let t = (i * step).toFixed(3);
        let v = (timeArray[i] / 128.0).toFixed(3); // Normalize 0-2
        csv += `${t},${v}\n`;
    }
    
    navigator.clipboard.writeText(csv).then(() => alert("Copied Oscilloscope Data to Clipboard!"));
}

function copySpectrumData() {
    let csv = "Frequency(Hz),Magnitude\n";
    const nyquist = audioCtx.sampleRate / 2;
    const binSize = nyquist / dataArray.length;
    
    for(let i=0; i<dataArray.length; i++) {
        let f = (i * binSize).toFixed(1);
        let m = dataArray[i];
        csv += `${f},${m}\n`;
    }
    navigator.clipboard.writeText(csv).then(() => alert("Copied Spectrum Data to Clipboard!"));
}

// Sonar Placeholder (Requires Speaker Loopback Logic)
function runSonarPing() {
    // Advanced: Create Chirp, Play it, Record, Correlate. 
    // For v2.0 basic: Just blink the status.
    alert("Sonar V2 needs Cross-Correlation module. Use Stopwatch for now.");
}
