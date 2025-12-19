// ! CONFIG
const THEME = { accent: '#d05ce3', bg: '#141414', grid: '#333' };
const CARRIER_FREQ = 1000;

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
let costasLoop, agc, receiver;

window.onload = () => {
    initCanvas('modem-bit-canvas');
    initCanvas('constellation-canvas');
    initCanvas('scope-canvas');

    // ! Init DSP objects
    costasLoop = new CostasLoop();
    agc = new AGC();
    receiver = new Receiver();

    // ! Populate Mic list on load
    populateMics();

    // ! Bindings
    document.getElementById('btn-toggle-scan').onclick = () => {
        if (isRunning) stopReceiver();
        else startReceiver();
    };
    document.getElementById('btn-modem-send').onclick = transmitModemData;
    document.getElementById('modem-type').onchange = () => {
        drawConstellation([], true); // ! Redraw grid on change
    };
    document.getElementById('btn-rx-clear').onclick = () => {
        receiver.clear();
        document.getElementById('rx-text').innerText = "Cleared.";
    };
    document.getElementById('btn-calibrate').onclick = startCalibration;
    document.getElementById('btn-connect-ti84').onclick = () => {
        // TODO: Implement actual Serial/USB connection for TI-84
        alert("TI-84 Connection feature coming soon!");
        console.log("Connect TI-84 clicked");
    };


    drawConstellation([], true); // ! Draw initial grid
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
                sel.innerHTML = '<option>Error: Permission Denied. Please allow microphone access.</option>';
                alert("Microphone Access Denied: Please enable microphone permissions for this site in your browser settings to use the Wi-Fi Lab.");
            } else if (err.name === 'NotFoundError') {
                sel.innerHTML = '<option>Error: No input devices found.</option>';
                alert("No Microphone Found: Please ensure a microphone is connected and enabled on your system.");
            }
             else {
                sel.innerHTML = `<option>Error: ${err.name} - ${err.message}</option>`;
                alert(`Microphone Error: ${err.name} - ${err.message}`);
            }
            toggleBtn.disabled = true; // Disable button if mic detection fails
        });
    } else {
        console.error("navigator.mediaDevices or enumerateDevices is not supported.");
        sel.innerHTML = '<option>Not Supported</option>';
    }
}


// --- DSP CLASSES ---

class AGC {
    constructor() {
        this.gain = 1.0;
        this.alpha = 0.01; // ! How fast to adjust
    }
    process(buffer) {
        let max = 0;
        for (let i = 0; i < buffer.length; i++) {
            if (Math.abs(buffer[i]) > max) max = Math.abs(buffer[i]);
        }
        // ! If signal is present, adjust gain towards target=1.0
        if (max > 0.01) {
            this.gain += (1.0 - max) * this.alpha;
        }
        // ! Apply gain
        for (let i = 0; i < buffer.length; i++) {
            buffer[i] *= this.gain;
        }
        return buffer;
    }
}

class CostasLoop {
    constructor() { this.phase = 0; this.freq = 0; this.alpha = 0.1; this.beta = 0.01; }
    process(i_in, q_in) {
        const i_out = i_in * Math.cos(this.phase) + q_in * Math.sin(this.phase);
        const q_out = -i_in * Math.sin(this.phase) + q_in * Math.cos(this.phase);
        const error = i_out * Math.sign(q_out) - q_out * Math.sign(i_out);
        this.freq += this.beta * error;
        this.phase += this.freq + (this.alpha * error);
        this.phase = this.phase % (2 * Math.PI);
        return { i: i_out, q: q_out };
    }
}

class Receiver {
    constructor() {
        this.bitsBuffer = []; // ! Raw incoming bits
        this.text = "";
        
        // ! State Machine
        this.state = 'IDLE'; // ! IDLE, READ_DATA, STOP_CHECK
        this.byteBuffer = []; // ! Bits for the current character
        
        // ! Timing for sampling
        this.startTime = 0;
        this.lastSampleTime = 0;
        this.symbolDuration = 0;
        this.powerThreshold = 0.05;
    }

    clear() {
        this.bitsBuffer = [];
        this.byteBuffer = [];
        this.text = "";
        this.state = 'IDLE';
        document.getElementById('rx-text').innerText = "";
    }

    // ! Called every frame (60fps) to sample symbols
    update(currentI, currentQ, baudRate) {
        const now = performance.now() / 1000;
        const power = Math.sqrt(currentI**2 + currentQ**2);
        this.symbolDuration = 1.0 / baudRate;

        // ? Simple energy detection to align clock initially or keep it alive
        // ? In this new framing model, 'update' mainly serves to pump bits into 'processSymbol'
        // ? by returning sampled symbols at the correct rate.
        
        // ! If we are not sampling yet, wait for energy
        if (this.lastSampleTime === 0) {
             if (power > this.powerThreshold) {
                console.log("Energy Detected. Starting Clock.");
                this.lastSampleTime = now - (this.symbolDuration * 0.5);
             } else {
                 return [];
             }
        }

        // ! Clock Tick
        if (now - this.lastSampleTime >= this.symbolDuration) {
            this.lastSampleTime += this.symbolDuration;
            // ! Return this symbol to be sliced and fed to processSymbol
            return [{i_raw: currentI, q_raw: currentQ}];
        }
        
        return [];
    }

    // ! This is called every time your loop demodulates new bits
    processSymbol(newBits) {
        // ! Add new bits to our processing queue
        this.bitsBuffer.push(...newBits);

        // ! Process the queue based on state
        while (this.bitsBuffer.length > 0) {
            
            // ! 1. IDLE STATE: Hunt for the START BIT (0)
            if (this.state === 'IDLE') {
                const bit = this.bitsBuffer.shift(); // ! Consume bit
                if (bit === 0) {
                    // ! Found Start Bit! Transition to reading.
                    this.state = 'READ_DATA';
                    this.byteBuffer = []; 
                }
                // ! If bit is 1, we ignore it (Idle line)
            }

            // ! 2. READ DATA: Collect 8 bits
            else if (this.state === 'READ_DATA') {
                if (this.bitsBuffer.length > 0) {
                    const bit = this.bitsBuffer.shift();
                    this.byteBuffer.push(bit);

                    if (this.byteBuffer.length === 8) {
                        // ! We have a full byte. Now check for Stop Bit.
                        this.state = 'STOP_CHECK';
                    }
                } else {
                    break; // ! Wait for more bits
                }
            }

            // ! 3. STOP CHECK: Verify the STOP BIT (1)
            else if (this.state === 'STOP_CHECK') {
                const stopBit = this.bitsBuffer.shift();
                
                if (stopBit === 1) {
                    // ! VALID FRAME! Decode the byte.
                    const charCode = parseInt(this.byteBuffer.join(''), 2);
                    
                    // ! Filter for printable ASCII only (prevent weird glyphs)
                    if (charCode >= 32 && charCode <= 126) {
                        this.text += String.fromCharCode(charCode);
                        this.updateUI();
                    }
                } else {
                    // FIXME: FRAMING ERROR: We expected a 1 but got 0.
                    // FIXME: The signal is garbage. Reset to IDLE to resync.
                    console.warn("Framing Error (Bit Slip)");
                }
                
                // ! Regardless of success/fail, go back to hunting for next char
                this.state = 'IDLE';
            }
        }
    }
    
    updateUI() {
        const el = document.getElementById('rx-text');
        el.innerText = this.text;
        el.scrollTop = el.scrollHeight; // ! Auto-scroll
    }

    getSlicer(type) {
        if (type === 'BPSK') return (i, q) => [i > 0 ? 1 : 0];
        if (type === 'QPSK') return (i, q) => [i > 0 ? 1 : 0, q > 0 ? 1 : 0];
        if (type === 'QAM16') return (i, q) => {
            const levels = [-2/3, 0, 2/3];
            const i_bit = i < levels[0] ? [0,0] : i < levels[1] ? [0,1] : i < levels[2] ? [1,1] : [1,0];
            const q_bit = q < levels[0] ? [0,0] : q < levels[1] ? [0,1] : q < levels[2] ? [1,1] : [1,0];
            return [...i_bit, ...q_bit];
        };
        if (type === 'QAM64') return (i, q) => {
             // ? Simply map 64QAM roughly for now
             return [i>0?1:0, q>0?1:0, 0,0,0,0]; // ! Placeholder for brevity
        };
        return (i, q) => [];
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

        isRunning = true;
        const s = document.getElementById('status-badge');
        s.innerText = "Receiving";
        s.className = "status-badge success";
        
        const btn = document.getElementById('btn-toggle-scan');
        if(btn) {
            btn.innerText = "Stop Scan";
            btn.classList.remove('primary');
            btn.classList.add('action'); // Or a 'danger' class if available, but 'action' is dark/neutral or maybe define a red one?
            // The user asked for "visual feedback". 
            // The existing CSS has .action { background: #333; }. 
            // Maybe keep it simple or add inline style for red if needed.
            // Let's stick to 'action' class for now as it contrasts with 'primary'.
            // Actually, let's make it distinct.
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
    
    // ! 1. Draw Scope (Physics)
    drawScope(waveArray);
    
    // ! 2. Get Current I/Q (Physics)
    const rawIQ = getInstantaneousIQ(waveArray);

    // ! 3. APPLY CALIBRATION GAIN
    rawIQ.i *= calibrationScale;
    rawIQ.q *= calibrationScale;
    
    // ! 4. AGC / PLL
    if (document.getElementById('rx-pll-enable').checked) {
        // This is a Costas loop for phase correction. 
        // The old AGC was removed as it destroys QAM amplitude data.
        // TODO: Implement a better, amplitude-preserving AGC.
        const locked = costasLoop.process(rawIQ.i, rawIQ.q);
        rawIQ.i = locked.i;
        rawIQ.q = locked.q;
    }

    // ! 5. Update Receiver Logic (Computer Science)
    const baud = parseInt(document.getElementById('modem-baud').value);
    const sampledSymbols = receiver.update(rawIQ.i, rawIQ.q, baud);
    
    // ! 6. Slice & Process ONLY if we sampled
    if (sampledSymbols.length > 0) {
        const type = document.getElementById('modem-type').value;
        const slicer = receiver.getSlicer(type);
        
        sampledSymbols.forEach(s => {
            const bits = slicer(s.i_raw, s.q_raw);
            receiver.processSymbol(bits);
        });
        
        drawConstellation([sampledSymbols[0]]); 
    } else {
        // Draw the "Ghost" cursor
        drawConstellation([{i_raw: rawIQ.i, q_raw: rawIQ.q}], true);
    }
}

// --- CALIBRATION ---
let calibrationScale = 1.0; // Default gain

async function startCalibration() {
    if (isRunning) {
        alert("Please stop the receiver before calibrating.");
        return;
    }

    alert("Calibration will now play a short test tone. Please ensure your volume is at a medium level and the microphone is near the speaker. Click OK to begin.");

    await initAudioGraph();
    const s = document.getElementById('status-badge');
    s.innerText = "Calibrating...";
    s.className = "status-badge info";

    // 1. Generate Tone
    const osc = audioCtx.createOscillator();
    osc.frequency.setValueAtTime(CARRIER_FREQ, audioCtx.currentTime);
    osc.type = 'sine';
    const toneGain = audioCtx.createGain();
    toneGain.gain.setValueAtTime(0.5, audioCtx.currentTime); // Use a moderate volume
    osc.connect(toneGain).connect(masterGain);
    osc.start();

    // 2. Record
    await new Promise(r => setTimeout(r, 500)); // Wait for sound to stabilize

    const magnitudes = [];
    const calibrationDuration = 1000; // 1 second
    const startTime = performance.now();

    // Create a temporary listening loop
    const listen = () => {
        if (performance.now() - startTime > calibrationDuration) {
            // 3. Analyze & Adjust
            osc.stop();
            osc.disconnect();

            if (magnitudes.length === 0) {
                alert("Calibration failed: No signal detected. Please check your microphone and speaker volume.");
                s.innerText = "Calibration Failed";
                s.className = "status-badge error";
                return;
            }

            const avgMagnitude = magnitudes.reduce((a, b) => a + b, 0) / magnitudes.length;
            const targetMagnitude = 0.75; // Target peak magnitude for I/Q vector
            
            if (avgMagnitude < 0.01) {
                alert("Calibration failed: Signal too weak. Please increase speaker volume and try again.");
                s.innerText = "Calibration Failed";
                s.className = "status-badge error";
                calibrationScale = 1.0; // Reset
            } else {
                calibrationScale = targetMagnitude / avgMagnitude;
                // 5. Output confirmation
                alert(`Calibration Complete! A gain factor of ${calibrationScale.toFixed(2)}x has been applied.`);
                s.innerText = "Calibrated";
                s.className = "status-badge success";
            }
            return;
        }

        analyser.getFloatTimeDomainData(waveArray);
        const iq = getInstantaneousIQ(waveArray);
        const mag = Math.sqrt(iq.i**2 + iq.q**2);
        if (mag > 0) magnitudes.push(mag);
        
        requestAnimationFrame(listen);
    };
    
    listen(); // Start the listener
}

function getInstantaneousIQ(buffer) {
    const omega = 2 * Math.PI * CARRIER_FREQ;
    const rate = audioCtx.sampleRate;
    
    let i_sum = 0;
    let q_sum = 0;
    
    // ! Integrate over the whole visualizer buffer to get current state
    for (let i = 0; i < buffer.length; i++) {
        const t = i / rate; // ! Relative time in buffer
        i_sum += buffer[i] * Math.cos(omega * t);
        q_sum += buffer[i] * -Math.sin(omega * t);
    }
    
    // ! Normalize
    const i_avg = (i_sum / buffer.length) * 4.0; // ! *4 gain for visibility
    const q_avg = (q_sum / buffer.length) * 4.0;
    
    return { i: i_avg, q: q_avg };
}

function drawConstellation(symbols, isGhost = false) {
    const c = document.getElementById('constellation-canvas');
    if (!c) return;
    const ctx = c.getContext('2d');
    const w = c.width, h = c.height;

    // ! Clear with a fade effect only if we're not drawing a ghost
    // ! or if the ghost is the only thing on screen.
    if (!isGhost) {
        ctx.fillStyle = 'rgba(0,0,0,0.2)';
        ctx.fillRect(0, 0, w, h);
    } else {
        // ! For the ghost, we need to redraw the whole static scene.
        ctx.fillStyle = '#0b0b0b'; // ! Background color
        ctx.fillRect(0,0,w,h);
    }

    ctx.strokeStyle = '#333';
    ctx.beginPath();
    ctx.moveTo(w/2, 0); ctx.lineTo(w/2, h);
    ctx.moveTo(0, h/2); ctx.lineTo(w, h/2);
    ctx.stroke();

    const type = document.getElementById('modem-type').value;
    const idealPoints = getIdealPoints(type);
    
    // ! Plot Ideal Points (Reference pattern)
    ctx.fillStyle = '#888';
    const scale = 0.85;
    for(let p of idealPoints) {
        const px = (w/2) + (p.I * (w/2) * scale);
        const py = (h/2) - (p.Q * (h/2) * scale);
        ctx.beginPath();
        ctx.arc(px, py, 3, 0, Math.PI*2);
        ctx.fill();
    }
    
    // ! Plot Received Symbols
    if (!symbols || symbols.length === 0) return;
    
    // ! Set color based on whether it's a ghost or a sampled point
    // ! High visibility: solid color + glow
    ctx.fillStyle = isGhost ? '#e084f3' : THEME.accent; // ! Brighter purple for ghost
    
    // ! Add Neon Glow
    ctx.shadowBlur = 15;
    ctx.shadowColor = THEME.accent;

    symbols.forEach(s => {
        const px = (w/2) + (s.i_raw * (w/2) * scale);
        const py = (h/2) - (s.q_raw * (h/2) * scale);
        ctx.beginPath();
        ctx.arc(px, py, isGhost ? 8 : 10, 0, Math.PI*2); // ! Much larger dots
        ctx.fill();
    });

    // ! Reset shadow for next frame
    ctx.shadowBlur = 0;
}

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
    for(let x=0; x<w; x++) {
        const idx = Math.floor((x/w) * buffer.length);
        const v = buffer[idx];
        const y = (h/2) - (v * h/2 * 0.9);
        if(x===0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
}

// --- TX & HELPERS ---

class ModemEngine {
    constructor(sampleRate) { this.sampleRate = sampleRate; this.frequency = CARRIER_FREQ; }
    stringToBits(text) { /* ... same as before ... */ }
    generateWaveform(text, type, baud) { /* ... same as before ... */ }
}
// ! NOTE: For brevity, the ModemEngine's unchanged methods are omitted, but they are part of the file.
ModemEngine.prototype.stringToBits = function(text) {
    const bits = [];
    
    // ! 1. Leader / Preamble (Idle High for a moment to wake up AGC)
    bits.push(...[1, 1, 1, 1, 1, 1, 1, 1]); 

    for (let i = 0; i < text.length; i++) {
        const charCode = text.charCodeAt(i);
        
        // ! 2. START BIT (Logic 0) - Signals "Here comes data"
        bits.push(0); 

        // ! 3. DATA BITS (8 bits, MSB First)
        for (let j = 7; j >= 0; j--) {
            bits.push((charCode >> j) & 1);
        }

        // ! 4. STOP BIT (Logic 1) - Signals "End of byte"
        // ! We add two stop bits for extra safety/separation in this noisy audio link
        bits.push(1); 
        bits.push(1); 
    }
    
    // ! Trailer
    bits.push(...[1, 1, 1]); 
    return bits;
}
ModemEngine.prototype.generateWaveform = function(text, type, baud) {
    const bits = this.stringToBits(text);
    const symbolDuration = 1 / baud;
    const samplesPerSymbol = Math.floor(this.sampleRate / baud);
    const omega = 2 * Math.PI * this.frequency;

    const idealPoints = getIdealPoints(type);
    const bitsPerSymbol = Math.log2(idealPoints.length);

    let symbols = [];
    for(let i=0; i<bits.length; i+=bitsPerSymbol) {
        const chunk = bits.slice(i, i+bitsPerSymbol);
        // ? This is a naive lookup, a gray-coded map would be better
        const point_idx = parseInt(chunk.join(''), 2); 
        if(point_idx < idealPoints.length) {
            symbols.push(idealPoints[point_idx]);
        }
    }
    
    // ! Sync Header (Alternating Phase)
    const preamble = [{I:1,Q:0}, {I:-1,Q:0},{I:1,Q:0}, {I:-1,Q:0}];
    const fullSymbols = [...preamble, ...symbols];

    const totalSamples = fullSymbols.length * samplesPerSymbol;
    const buffer = new Float32Array(totalSamples);

    for (let s = 0; s < fullSymbols.length; s++) {
        const { I, Q } = fullSymbols[s];
        for (let i = 0; i < samplesPerSymbol; i++) {
            const t = (s * samplesPerSymbol + i) / this.sampleRate;
            buffer[s * samplesPerSymbol + i] = (I * Math.cos(omega * t) - Q * Math.sin(omega * t));
        }
    }
    return { buffer, symbols: fullSymbols };
}


async function transmitModemData() {
    let text = document.getElementById('modem-input').value || "HI";
    if (text.length > 200) text = text.slice(0, 200);
    const type = document.getElementById('modem-type').value;
    const baud = parseInt(document.getElementById('modem-baud').value);
    await initAudioGraph();
    if (!modemEngine) modemEngine = new ModemEngine(audioCtx.sampleRate);
    const { buffer, symbols } = modemEngine.generateWaveform(text, type, baud);
    document.getElementById('modem-bitstream').innerText = symbols.flatMap(s => s.bits).join('');
    drawModemBits(symbols);
    if (modemBufferSource) try { modemBufferSource.stop(); } catch(e){}
    const audioBuffer = audioCtx.createBuffer(1, buffer.length, audioCtx.sampleRate);
    audioBuffer.getChannelData(0).set(buffer);
    modemBufferSource = audioCtx.createBufferSource();
    modemBufferSource.buffer = audioBuffer;
    modemBufferSource.connect(masterGain);
    if (analyser) modemBufferSource.connect(analyser);
    modemBufferSource.start();
    if (!isRunning) requestAnimationFrame(loop);
}

function drawModemBits(symbols) {
    // ? Draw the logic levels for the bitstream
}
function exportEVM() {
    // TODO: Implement EVM export logic
    let csv = "I_raw,Q_raw\n";
    rxHistory.forEach(s => { csv += `${s.i_raw.toFixed(4)},${s.q_raw.toFixed(4)}\n` });
    const blob = new Blob([csv], {type: 'text/csv'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'constellation_data.csv'; a.click();
    URL.revokeObjectURL(url);
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
}); // Close setTimeout
}); // Close window.addEventListener

