
// CONFIG
const THEME = { accent: '#d05ce3', bg: '#141414', grid: '#333' };

// STATE
let audioCtx, analyser, micSource;
let masterGain; // For playing the TX sound
let isRunning = false;
let waveArray; // Float32 buffer for analysis

// MODEM STATE
let modemEngine;
let modemBufferSource = null;

window.onload = () => {
    initCanvas('modem-bit-canvas');
    initCanvas('constellation-canvas');
    initCanvas('scope-canvas');

    // Device Detection
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
                        opt.text = d.label || `Mic ${i + 1}`;
                        sel.appendChild(opt);
                    });
                }
            }
        });
    }

    // Bindings
    document.getElementById('btn-start').onclick = startReceiver;
    document.getElementById('btn-stop').onclick = stopReceiver;
    document.getElementById('btn-modem-send').onclick = transmitModemData;
};

function initCanvas(id) {
    const c = document.getElementById(id);
    if(c) { c.width = c.clientWidth; c.height = c.clientHeight; }
}

async function initAudioGraph() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') await audioCtx.resume();
    
    if (!analyser) {
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 2048;
    }
    
    const len = analyser.frequencyBinCount;
    if(!waveArray) waveArray = new Float32Array(len);

    if (!masterGain) {
        masterGain = audioCtx.createGain();
        masterGain.connect(audioCtx.destination);
    }
}

async function startReceiver() {
    if (isRunning) return;
    try {
        await initAudioGraph();
        
        const devId = document.getElementById('device-select').value;
        const stream = await navigator.mediaDevices.getUserMedia({ 
            audio: { 
                deviceId: devId ? {exact: devId} : undefined,
                echoCancellation: false, 
                noiseSuppression: false, 
                autoGainControl: false 
            } 
        });
        
        if (micSource) try { micSource.disconnect(); } catch(e){}
        micSource = audioCtx.createMediaStreamSource(stream);
        micSource.connect(analyser);

        isRunning = true;
        const s = document.getElementById('status-badge');
        s.innerText = "Receiving";
        s.className = "status-badge success";
        loop();

    } catch(e) { 
        alert("Microphone Error: " + e); 
    }
}

function stopReceiver() {
    isRunning = false;
    if(audioCtx) audioCtx.close();
    audioCtx = null;
    analyser = null;
    micSource = null;
    
    const s = document.getElementById('status-badge');
    s.innerText = "Idle";
    s.className = "status-badge warn";
}

function loop() {
    if (!isRunning && !modemBufferSource) return; // Stop if neither RX nor TX is active
    
    requestAnimationFrame(loop);
    
    if (analyser) {
        analyser.getFloatTimeDomainData(waveArray);
        drawScope();
        drawConstellation();
    }
}

// --- VISUALIZATION ---

function drawScope() {
    const c = document.getElementById('scope-canvas');
    const ctx = c.getContext('2d');
    const w = c.width, h = c.height;

    ctx.fillStyle = '#0b0b0b'; ctx.fillRect(0,0,w,h);
    
    ctx.strokeStyle = '#222'; ctx.beginPath();
    ctx.moveTo(0, h/2); ctx.lineTo(w, h/2);
    ctx.stroke();

    if(!waveArray) return;

    // Triggering
    let startIdx = 0;
    for(let i=1; i<waveArray.length-100; i++) {
        if(waveArray[i-1]<0 && waveArray[i]>=0) { startIdx = i; break; }
    }

    ctx.lineWidth = 2;
    ctx.strokeStyle = THEME.accent;
    ctx.beginPath();
    
    const sliceWidth = w / 512; // Draw a portion
    let x = 0;
    
    for(let i=0; i<512; i++) {
        const idx = startIdx + i;
        if(idx >= waveArray.length) break;
        
        const v = waveArray[idx];
        const y = (h/2) - (v * h/2 * 2); // 2x gain for visibility

        if(i===0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
        
        x += sliceWidth;
    }
    ctx.stroke();
}

function drawConstellation() {
    const c = document.getElementById('constellation-canvas');
    if (!c) return;
    const ctx = c.getContext('2d');
    const w = c.width, h = c.height;

    // Persist trace slightly
    ctx.fillStyle = 'rgba(0,0,0,0.1)';
    ctx.fillRect(0, 0, w, h);

    // Draw Axis
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(w/2, 0); ctx.lineTo(w/2, h);
    ctx.moveTo(0, h/2); ctx.lineTo(w, h/2);
    ctx.stroke();

    // --- DRAW IDEAL GRID STATES ---
    const type = document.getElementById('modem-type').value;
    ctx.fillStyle = '#444'; // Dim gray for ideal states
    
    let idealPoints = [];

    if (type === 'BPSK') {
        idealPoints = [{I:-1, Q:0}, {I:1, Q:0}];
    } else if (type === 'QPSK') {
        idealPoints = [{I:-1, Q:-1}, {I:-1, Q:1}, {I:1, Q:-1}, {I:1, Q:1}];
    } else if (type === 'QAM16') {
        const levels = [-3, -1, 1, 3]; // Before normalization division by 3
        // Normalized: -1, -0.33, 0.33, 1
        for(let i of levels) for(let q of levels) idealPoints.push({I:i/3, Q:q/3});
    } else if (type === 'QAM64') {
        const levels = [-7, -5, -3, -1, 1, 3, 5, 7]; // Before normalization div by 7
        for(let i of levels) for(let q of levels) idealPoints.push({I:i/7, Q:q/7});
    }

    // Plot Ideal Points
    const scale = 0.8; // Match the signal scaling
    for(let p of idealPoints) {
        const px = (w/2) + (p.I * w * scale); // Removed extra 0.5 factor from signal logic to match
        const py = (h/2) - (p.Q * h * scale);
        
        ctx.beginPath();
        // Draw small cross or hollow circle
        ctx.arc(px, py, 2, 0, Math.PI*2);
        ctx.fill();
    }

    if (!waveArray) return;

    // Simple I/Q Demodulation Visualization
    // Locked to 1000 Hz for the lab
    const carrierFreq = 1000; 
    const omega = 2 * Math.PI * carrierFreq;
    const rate = audioCtx.sampleRate;
    const now = audioCtx.currentTime;

    // Plot random samples from the buffer to form the cloud
    // We iterate through the buffer
    ctx.fillStyle = THEME.accent;
    
    // Using a step to reduce CPU load, plotting ~50 points per frame
    const step = Math.floor(waveArray.length / 50);

    for (let i = 0; i < waveArray.length; i+=step) {
        const val = waveArray[i];
        
        // This is a naive visualizer. In reality, we need precise phase lock.
        // For the lab, since we are often doing Loopback or just looking for the shape,
        // we simulate the integration over a small window or just instantaneous projection.
        // Let's try instantaneous projection against a localized time base.
        
        // We need 't' relative to the buffer start to be consistent within a frame
        const t = i / rate; 
        
        // This 't' is arbitrary phase unless synced. 
        // But for high-speed constellation, the dots will rotate if not synced. 
        // That's actually a good teaching moment (Phase Offset).
        
        const I = val * Math.cos(omega * t);
        const Q = val * -Math.sin(omega * t);
        
        // Scale and Center
        // val is roughly -1 to 1. I/Q will be roughly -0.5 to 0.5.
        // We multiply by 4 to fill the canvas. 
        // NOTE: In generation, I/Q are ~1.0. 
        // Here, I = val * cos. If val is amplitude 1, I max is 1.
        
        const plotX = (w/2) + (I * w * 0.8);
        const plotY = (h/2) - (Q * h * 0.8);

        ctx.beginPath();
        ctx.arc(plotX, plotY, 2, 0, Math.PI * 2);
        ctx.fill();
    }
}

// --- TRANSMITTER ---

class ModemEngine {
    constructor(sampleRate) {
        this.sampleRate = sampleRate;
        this.frequency = 1000; // 1kHz Carrier
    }

    stringToBits(text) {
        const bits = [];
        for (let i = 0; i < text.length; i++) {
            const charCode = text.charCodeAt(i);
            for (let j = 7; j >= 0; j--) {
                bits.push((charCode >> j) & 1);
            }
        }
        return bits;
    }

    generateWaveform(text, type, baud) {
        const bits = this.stringToBits(text);
        const symbolDuration = 1 / baud;
        const samplesPerSymbol = Math.floor(symbolDuration * this.sampleRate);
        const omega = 2 * Math.PI * this.frequency;

        let symbols = [];
        if (type === 'BPSK') {
            symbols = bits.map(b => ({ I: b ? 1 : -1, Q: 0, bits: [b] }));
        } else if (type === 'QPSK') {
            for (let i = 0; i < bits.length; i += 2) {
                const b1 = bits[i];
                const b2 = bits[i+1] !== undefined ? bits[i+1] : 0;
                // Gray coding
                const I = b1 ? 1 : -1;
                const Q = b2 ? 1 : -1;
                symbols.push({ I, Q, bits: [b1, b2] });
            }
        } else if (type === 'QAM16') {
            for (let i = 0; i < bits.length; i += 4) {
                const b = [bits[i], bits[i+1], bits[i+2], bits[i+3]].map(v => v || 0);
                const I = (b[0] ? 2 : -2) + (b[1] ? 1 : -1);
                const Q = (b[2] ? 2 : -2) + (b[3] ? 1 : -1);
                symbols.push({ I: I / 3, Q: Q / 3, bits: b });
            }
        } else if (type === 'QAM64') {
            for (let i = 0; i < bits.length; i += 6) {
                // Get 6 bits, pad with 0 if necessary
                const b = [];
                for(let k=0; k<6; k++) b.push(bits[i+k] || 0);

                // Map 3 bits to 8 levels (-7 to 7)
                // 4*b2 + 2*b1 + 1*b0 -> 0..7
                // Map to: (val * 2) - 7  -> -7..7
                
                // I Axis (Bits 0,1,2)
                const iVal = (b[0]*4) + (b[1]*2) + b[2];
                const I_raw = (iVal * 2) - 7;
                
                // Q Axis (Bits 3,4,5)
                const qVal = (b[3]*4) + (b[4]*2) + b[5];
                const Q_raw = (qVal * 2) - 7;

                // Normalize (Max amplitude is sqrt(7^2 + 7^2) ≈ 9.9)
                // We'll divide by 7 to keep I/Q within approx -1..1 range for the buffer
                symbols.push({ I: I_raw / 7, Q: Q_raw / 7, bits: b });
            }
        }

        // Sync Header (Alternating Phase) to help visualizer "see" activity before data
        const preamble = [1,0,1,0].map(b => ({ I: b?1:-1, Q: 0, bits: [b] }));
        const fullSymbols = [...preamble, ...symbols];

        const totalSamples = fullSymbols.length * samplesPerSymbol;
        const buffer = new Float32Array(totalSamples);

        for (let s = 0; s < fullSymbols.length; s++) {
            const { I, Q } = fullSymbols[s];
            for (let i = 0; i < samplesPerSymbol; i++) {
                const t = (s * samplesPerSymbol + i) / this.sampleRate;
                buffer[s * samplesPerSymbol + i] = I * Math.cos(omega * t) - Q * Math.sin(omega * t);
            }
        }

        return { buffer, symbols: fullSymbols };
    }
}

async function transmitModemData() {
    let text = document.getElementById('modem-input').value || "HI";
    if (text.length > 200) text = text.slice(0, 200); // Enforce max length
    
    const type = document.getElementById('modem-type').value;
    const baud = parseInt(document.getElementById('modem-baud').value);

    await initAudioGraph();
    
    if (!modemEngine) modemEngine = new ModemEngine(audioCtx.sampleRate);
    const { buffer, symbols } = modemEngine.generateWaveform(text, type, baud);

    // Update Bitstream UI
    const bitStr = symbols.flatMap(s => s.bits).join('');
    document.getElementById('modem-bitstream').innerText = bitStr;
    drawModemBits(symbols);

    // Play
    if (modemBufferSource) try { modemBufferSource.stop(); } catch(e){}
    
    const audioBuffer = audioCtx.createBuffer(1, buffer.length, audioCtx.sampleRate);
    audioBuffer.getChannelData(0).set(buffer);
    
    modemBufferSource = audioCtx.createBufferSource();
    modemBufferSource.buffer = audioBuffer;
    
    modemBufferSource.connect(masterGain);
    if (analyser) modemBufferSource.connect(analyser); // Local Loopback for visuals
    
    modemBufferSource.start();

    // Ensure loop is active to see visuals even if mic is off
    if (!isRunning) {
        requestAnimationFrame(loop);
    }
}

function drawModemBits(symbols) {
    const c = document.getElementById('modem-bit-canvas');
    if (!c) return;
    const ctx = c.getContext('2d');
    const w = c.width, h = c.height;
    ctx.fillStyle = '#000'; ctx.fillRect(0,0,w,h);
    
    const bits = symbols.flatMap(s => s.bits);
    const step = w / bits.length;
    
    ctx.strokeStyle = THEME.accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < bits.length; i++) {
        const x = i * step;
        const y = bits[i] ? h*0.2 : h*0.8;
        if (i === 0) ctx.moveTo(x, y);
        else {
            ctx.lineTo(x, bits[i-1] ? h*0.2 : h*0.8);
            ctx.lineTo(x, y);
        }
        ctx.lineTo(x + step, y);
    }
    ctx.stroke();
}

// Window Resize
let resizeTimeout;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
        initCanvas('modem-bit-canvas');
        initCanvas('constellation-canvas');
        initCanvas('scope-canvas');
    }, 100);
});
