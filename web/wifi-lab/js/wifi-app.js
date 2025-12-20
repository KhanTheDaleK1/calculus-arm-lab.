// ! CONFIG
const APP_VERSION = "wifi-lab-2025-02-10b";
window.__wifiLabInstanceCount = (window.__wifiLabInstanceCount || 0) + 1;
if (window.__wifiLabInitialized) {
    // Avoid double-binding if script is loaded twice.
    console.warn("WiFi Lab already initialized.");
}
const CONFIG = {
    carrierFreq: 1200,   
    baudRate: 20,        
    sampleRate: 44100,   
    squelch: 0.05        
};

const THEME = { accent: '#d05ce3', bg: '#141414', grid: '#333' };

// ! STATE
let audioCtx, analyser, micSource;
let masterGain;
let isRunning = false;
let waveArray;
let calibrationScale = 1.0; 
let calibrationClipped = false;
let calibrationValid = false;
let calibrationAttempted = false;
let defaultCalApplied = false;
let userGain = 1.0;
let txGain = 0.5;
let txActive = false;
let lastFrameErrLog = 0;
window.__diagnoseInProgress = window.__diagnoseInProgress || false;

// ! SCOPE HISTORY STATE
let isScopePaused = false;
let scopeHistory = [];
const MAX_SCOPE_HISTORY = 300; // ~7 seconds at 44.1kHz and 1024 buffer
let scopeHistoryOffset = 0; 

function initCanvas(id) {
    const c = document.getElementById(id);
    if(c) { 
        c.width = c.clientWidth || 400; 
        c.height = c.clientHeight || 150; 
    }
}

function debugLog(message) {
    const el = document.getElementById('debug-console');
    if (!el) return;
    if (!el.dataset.hasLogs) {
        el.textContent = "";
        el.dataset.hasLogs = "1";
    }
    const ts = new Date().toISOString().slice(11, 19);
    const line = document.createElement('div');
    line.textContent = `[${ts}] ${message}`;
    el.appendChild(line);
    while (el.children.length > 40) el.removeChild(el.firstChild);
    el.scrollTop = el.scrollHeight;
}

// ! RX/TX STATE
let modemEngine;
let modemBufferSource = null;
let receiver;

window.onload = () => {
    if (window.__wifiLabInitialized) return;
    window.__wifiLabInitialized = true;
    initCanvas('modem-bit-canvas');
    initCanvas('constellation-canvas');
    initCanvas('scope-canvas');
    debugLog(`WiFi Lab JS ${APP_VERSION} (instance ${window.__wifiLabInstanceCount})`);

    if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
        const msg = "⚠️ SECURITY ERROR: HTTPS required for Microphone access.";
        console.error(msg);
        document.getElementById('rx-text').innerHTML = `<span style="color:#ff5555">${msg}</span>`;
    }

    populateMics();

    const toggleBtn = document.getElementById('btn-toggle-scan');
    if (toggleBtn) {
        toggleBtn.disabled = false; 
        toggleBtn.onclick = () => {
            if (isRunning) stopReceiver();
            else startReceiver();
        };
    }

    const sendBtn = document.getElementById('btn-modem-send');
    if (sendBtn) sendBtn.onclick = transmitModemData;

    const refreshTransmitterPreview = () => {
        const text = document.getElementById('modem-input').value || "";
        const type = document.getElementById('modem-type').value;
        const baud = parseInt(document.getElementById('modem-baud').value);
        
        // Use a dummy audio context or just the math for preview
        const engine = new ModemEngine(44100, CONFIG.carrierFreq, baud);
        // We need a way to get bits without needing a full AudioBuffer/Context if possible, 
        // but generateAudioBuffer is fine if we pass a mock context or just handle the null ctx
        const { bits } = engine.generateAudioBuffer(text, type, { createBuffer: () => ({ getChannelData: () => new Float32Array() }) });
        
        const bitstreamEl = document.getElementById('modem-bitstream');
        if (bitstreamEl) bitstreamEl.innerText = bits.length > 0 ? bits.join('') : "...";
        drawBinaryStream(bits);
    };

    document.getElementById('modem-input').oninput = refreshTransmitterPreview;
    document.getElementById('modem-type').onchange = () => {
        drawConstellation([], true); 
        refreshTransmitterPreview();
    };

    document.getElementById('modem-baud').onchange = (e) => {
        const newBaud = parseInt(e.target.value);
        if (receiver) receiver.updateBaud(newBaud);
        refreshTransmitterPreview();
    };
    
    // Initial preview
    refreshTransmitterPreview();

    document.getElementById('btn-rx-clear').onclick = () => {
        if (receiver) receiver.clear();
    };
    
    document.getElementById('btn-calibrate').onclick = startCalibration;

    const diagnoseBtn = document.getElementById('btn-rx-diagnose');
    if (diagnoseBtn) diagnoseBtn.onclick = runRxDiagnostics;
    
    document.getElementById('btn-connect-ti84').onclick = () => {
        alert("TI-84 Connection: To import data, export the CSV from this lab and use TI-Connect CE to drag the file into your calculator as a List (L1/L2).");
    };

    const exportWaveBtn = document.getElementById('btn-export-waveform');
    if (exportWaveBtn) exportWaveBtn.onclick = exportWaveform;

    const exportConstBtn = document.getElementById('btn-export-evm');
    if (exportConstBtn) exportConstBtn.onclick = exportConstellation;

    const gainSlider = document.getElementById('rx-gain');
    const gainVal = document.getElementById('rx-gain-val');
    if (gainSlider) {
        gainSlider.oninput = (e) => {
            userGain = parseFloat(e.target.value) / 100.0;
            if (gainVal) gainVal.innerText = userGain.toFixed(1) + 'x';
        };
    }

    // Scope Controls
    const pauseBtn = document.getElementById('btn-scope-pause');
    const historyControls = document.getElementById('scope-history-controls');
    const historyRange = document.getElementById('scope-history-range');
    const historyTime = document.getElementById('scope-history-time');

    if (pauseBtn) {
        pauseBtn.onclick = () => {
            isScopePaused = !isScopePaused;
            pauseBtn.innerHTML = isScopePaused ? `<i class="fas fa-play"></i> Resume` : `<i class="fas fa-pause"></i> Pause`;
            if (isScopePaused) {
                historyControls.style.display = 'flex';
                historyRange.max = scopeHistory.length - 1;
                historyRange.value = 0;
                scopeHistoryOffset = 0;
                updateScopeHistoryLabel();
            } else {
                historyControls.style.display = 'none';
            }
        };
    }

    if (historyRange) {
        historyRange.oninput = (e) => {
            scopeHistoryOffset = parseInt(e.target.value);
            updateScopeHistoryLabel();
            if (isScopePaused && scopeHistory.length > 0) {
                const data = scopeHistory[scopeHistory.length - 1 - scopeHistoryOffset];
                if (data) drawScope(data);
            }
        };
    }

    function updateScopeHistoryLabel() {
        const sec = (scopeHistoryOffset * (analyser ? analyser.fftSize/2 : 1024) / 44100).toFixed(1);
        historyTime.innerText = `-${sec}s`;
    }

    drawConstellation([], true); 
};

function populateMics() {
    const sel = document.getElementById('device-select');
    if (!sel) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
        sel.innerHTML = '<option>Browser Not Supported</option>';
        return;
    }
    navigator.mediaDevices.enumerateDevices()
    .then(devs => {
        const mics = devs.filter(d => d.kind === 'audioinput');
        sel.innerHTML = '';
        if (mics.length === 0) {
            sel.innerHTML = '<option>No Mics Found</option>';
        } else {
            mics.forEach((d, i) => {
                const opt = document.createElement('option');
                opt.value = d.deviceId;
                opt.text = d.label || `Microphone ${i + 1} (Grant Permission)`;
                sel.appendChild(opt);
            });
        }
    }).catch(err => {
        console.error(err);
        sel.innerHTML = '<option>Error detecting mics</option>';
    });
}

// ==========================================
// ! DSP CLASSES
// ==========================================

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

class CostasLoopReceiver {
    constructor(sampleRate, carrierFreq, baud) {
        this.sampleRate = sampleRate;
        this.freq = 2 * Math.PI * carrierFreq / sampleRate;
        this.phase = 0;
        this.errorInt = 0; 
        this.alpha = 0.05; 
        this.beta = 0.002; 
        this.lpfI = 0;
        this.lpfQ = 0;
        this.lpfAlpha = 0.1; 
        this.updateBaud(baud);
        this.symbolCounter = 0;
        this.isSyncing = false;
                this.bitBuffer = [];
                this.message = "";
                this.state = 'IDLE'; 
                this.byteBuffer = [];
                this.lastPoints = []; // Store recent points for export
            }
        
            updateBaud(newBaud) {
                this.baud = newBaud;
                this.samplesPerSymbol = this.sampleRate / newBaud;
            }
        
            clear() {
                this.message = "";
                this.bitBuffer = [];
                this.byteBuffer = [];
                this.state = 'IDLE';
                this.isSyncing = false;
                this.lastPoints = [];
                document.getElementById('rx-text').innerText = "Waiting for signal...";
            }
        
            processBlock(inputBuffer, modulationType) {
                const points = [];
                let energySum = 0;
                for(let s of inputBuffer) energySum += s*s;
                const rms = Math.sqrt(energySum / inputBuffer.length);
                
                for (let i = 0; i < inputBuffer.length; i++) {
                    const sample = inputBuffer[i] * calibrationScale * userGain; // Apply calibration and user gain
                    const loI = Math.cos(this.phase);
                    const loQ = -Math.sin(this.phase);
                    let rawI = sample * loI;
                    let rawQ = sample * loQ;
                    this.lpfI = this.lpfI + this.lpfAlpha * (rawI - this.lpfI);
                    this.lpfQ = this.lpfQ + this.lpfAlpha * (rawQ - this.lpfQ);
        
                    const signI = this.lpfI > 0 ? 1 : -1;
                    const signQ = this.lpfQ > 0 ? 1 : -1;
                    const error = (signI * this.lpfQ) - (signQ * this.lpfI);
        
                    this.errorInt += error * this.beta; 
                    this.phase += this.freq + (error * this.alpha) + this.errorInt;
        
                    if (rms > CONFIG.squelch) {
                        if (!this.isSyncing) {
                            this.isSyncing = true;
                            this.symbolCounter = Math.floor(this.samplesPerSymbol / 2); 
                        }
                        
                        this.symbolCounter--;
                        if (this.symbolCounter <= 0) {
                            this.symbolCounter = this.samplesPerSymbol;
                            const bits = this.slice(this.lpfI, this.lpfQ, modulationType);
                            this.processBits(bits);
                            const p = { i: this.lpfI, q: this.lpfQ };
                            points.push(p);
                            this.lastPoints.push(p);
                            if (this.lastPoints.length > 1000) this.lastPoints.shift(); // Keep last 1000
                        }
                    } else {
                        this.isSyncing = false;
                        this.state = 'IDLE'; 
                    }
                }
                this.phase = this.phase % (2 * Math.PI);
                return points;
            }

    slice(I, Q, type) {
        // Gain adjusted by calibrationScale now, so thresholds are normalized
        const sI = I * 2.0; 
        const sQ = Q * 2.0;
        if (type === 'BPSK') return [sI > 0 ? 1 : 0];
        if (type === 'QPSK') return [sI > 0 ? 1 : 0, sQ > 0 ? 1 : 0];
        if (type === 'QAM16') {
            const sl = (v) => v < -0.66 ? [0,0] : v < 0 ? [0,1] : v < 0.66 ? [1,1] : [1,0];
            return [...sl(sI), ...sl(sQ)];
        }
        return [sI > 0 ? 1 : 0]; 
    }

        processBits(newBits) {

            this.bitBuffer.push(...newBits);

    

            // Loop until we don't have enough bits to proceed

            while (true) {

                if (this.state === 'IDLE') {

                    if (this.bitBuffer.length === 0) break;

                    

                    // Peek at the first bit

                    const bit = this.bitBuffer[0];

                    

                    if (bit === 0) { 

                        // Found START BIT (0). Consume it and switch to DATA.

                        this.bitBuffer.shift(); 

                        this.state = 'DATA';

                        this.byteBuffer = [];

                    } else {

                        // Found a 1 (Idle/Preamble). Consume it and ignore.

                        this.bitBuffer.shift();

                    }

                } 

                else if (this.state === 'DATA') {

                    if (this.bitBuffer.length === 0) break;

                    

                    // Collect 8 data bits

                    this.byteBuffer.push(this.bitBuffer.shift());

                    

                    if (this.byteBuffer.length === 8) {

                        this.state = 'STOP';

                    }

                } 

                else if (this.state === 'STOP') {

                    if (this.bitBuffer.length === 0) break;

                    

                    const stopBit = this.bitBuffer.shift();

                    

                    if (stopBit === 1) {

                        // VALID FRAME. Decode the Byte.

                        const charCode = parseInt(this.byteBuffer.join(''), 2);

                        // Filter printable characters

                        if (charCode >= 32 && charCode <= 126) {

                            this.message += String.fromCharCode(charCode);

                            document.getElementById('rx-text').innerText = this.message;

                        }

                    } else {

                        // FRAMING ERROR (Bit Slip). Discard byte.

                        console.warn("Framing Error: Expected Stop Bit (1), got 0");
                        const now = Date.now();
                        if (now - lastFrameErrLog > 1000) {
                            debugLog("Framing error: expected stop bit 1, got 0.");
                            lastFrameErrLog = now;
                        }

                    }

                    

                    // Reset for next character

                    this.state = 'IDLE';

                }

            }

        }
}

class ModemEngine {
    constructor(sampleRate, carrier, baud) {
        this.sampleRate = sampleRate;
        this.omega = 2 * Math.PI * carrier / sampleRate;
        this.symbolPeriod = Math.floor(sampleRate / baud);
    }

    generateAudioBuffer(text, type, ctx) {
        let bits = [];
        // Robust Preamble: All 1s (Idle High) so the receiver ignores it while syncing phase/gain
        for(let p=0; p<40; p++) bits.push(1); 

        for (let i = 0; i < text.length; i++) {
            const charCode = text.charCodeAt(i);
            bits.push(0); 
            for (let b = 7; b >= 0; b--) bits.push((charCode >> b) & 1);
            bits.push(1); 
        }
        const idealPoints = getIdealPoints(type);
        let maxMag = 1;
        for (const p of idealPoints) {
            const mag = Math.sqrt((p.I * p.I) + (p.Q * p.Q));
            if (mag > maxMag) maxMag = mag;
        }
        const norm = maxMag > 0 ? 1 / maxMag : 1;
        const bitsPerSymbol = Math.log2(idealPoints.length);
        while (bits.length % bitsPerSymbol !== 0) bits.push(1);
        const totalSymbols = bits.length / bitsPerSymbol;
        const totalSamples = totalSymbols * this.symbolPeriod;
        let buffer = null;
        if (ctx && ctx.createBuffer) {
            buffer = ctx.createBuffer(1, totalSamples, this.sampleRate);
            const data = buffer.getChannelData(0);
            let phase = 0;
            let sampleIdx = 0;
            for (let i = 0; i < bits.length; i += bitsPerSymbol) {
                const chunk = bits.slice(i, i + bitsPerSymbol);
                const symbolIndex = parseInt(chunk.join(''), 2);
                const point = idealPoints[symbolIndex % idealPoints.length];
                for (let t = 0; t < this.symbolPeriod; t++) {
                    const I = point.I * norm;
                    const Q = point.Q * norm;
                    data[sampleIdx] = (I * Math.cos(phase) - Q * Math.sin(phase));
                    phase += this.omega;
                    sampleIdx++;
                }
            }
        }
        return { buffer, bits };
    }
}

// --- MAIN AUDIO ---

async function initAudioGraph() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') await audioCtx.resume();
    if (!analyser) analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    waveArray = new Float32Array(analyser.frequencyBinCount);
    if (!masterGain) {
        masterGain = audioCtx.createGain();
        masterGain.gain.value = txGain;
        masterGain.connect(audioCtx.destination);
    }
}

async function startReceiver() {
    if (isRunning) return;
    try {
        await initAudioGraph();
        const sel = document.getElementById('device-select');
        const constraints = { audio: (sel && sel.value && sel.value.length > 5) ? { deviceId: { exact: sel.value } } : true };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        micSource = audioCtx.createMediaStreamSource(stream);
        micSource.connect(analyser);
        const baud = parseInt(document.getElementById('modem-baud').value);
        receiver = new CostasLoopReceiver(audioCtx.sampleRate, CONFIG.carrierFreq, baud);
        isRunning = true;
        document.getElementById('status-badge').innerText = "Receiving";
        document.getElementById('status-badge').className = "status-badge success";
        document.getElementById('btn-toggle-scan').innerText = "Stop Scan";
        document.getElementById('btn-toggle-scan').style.background = "#d32f2f";
        loop();
        populateMics();
    } catch(e) { 
        console.error(e);
        document.getElementById('rx-text').innerHTML = `<span style="color:#ff5555">Error: ${e.message}</span>`;
    }
}

function stopReceiver() {
    isRunning = false;
    if(micSource) {
        const stream = micSource.mediaStream;
        if (stream) stream.getTracks().forEach(t => t.stop());
        micSource.disconnect();
    }
    if(audioCtx) audioCtx.close();
    audioCtx = null;
    micSource = null;
    scopeHistory = []; // Clear history on stop
    document.getElementById('status-badge').innerText = "Idle";
    document.getElementById('status-badge').className = "status-badge warn";
    document.getElementById('btn-toggle-scan').innerText = "Start Scan";
    document.getElementById('btn-toggle-scan').style.background = "";
}

function loop() {
    if (!isRunning) return;
    requestAnimationFrame(loop);
    analyser.getFloatTimeDomainData(waveArray);
    
    // Peak Detection
    let maxRaw = 0;
    let clippedCount = 0;
    let energySum = 0;
    for(let i=0; i<waveArray.length; i++) {
        const sample = waveArray[i];
        const abs = Math.abs(sample);
        if(abs > maxRaw) maxRaw = abs;
        if (abs >= 0.999) clippedCount++;
        energySum += sample * sample;
    }

    const rms = Math.sqrt(energySum / waveArray.length);
    const calibratedPeak = maxRaw * calibrationScale;
    const scaledPeak = calibratedPeak * userGain;
    const peakPercent = scaledPeak * 100;
    const peakEl = document.getElementById('rx-peak');
    const rmsEl = document.getElementById('rx-raw-rms');
    const calScaleEl = document.getElementById('rx-cal-scale');
    const calStatusEl = document.getElementById('rx-cal-status');
    const clipRatio = clippedCount / waveArray.length;
    
    if (peakEl) {
        peakEl.innerText = Math.round(peakPercent) + '%';
        
        // 1. Check for Hardware Clipping (Mic is too hot in System Settings)
        if (maxRaw >= 0.999 && clipRatio > 0.005) {
            peakEl.style.color = '#ff5555';
            peakEl.innerText = "HW CLIP! (Turn down System Mic)";
        } 
        // 2. Check for Software Clipping (Gain slider is too high)
        else if (peakPercent > 95) {
            peakEl.style.color = '#ff5555';
            peakEl.innerText += " (Gain too high)";
        } 
        else if (peakPercent > 70) {
            peakEl.style.color = '#ffb86c';
        } else {
            peakEl.style.color = '#50fa7b';
        }
    }
    
    if (txActive && maxRaw >= 0.999 && clipRatio > 0.005) {
        txGain = Math.max(0.05, txGain * 0.7);
        if (masterGain) masterGain.gain.value = txGain;
        debugLog(`TX auto-attenuate: txGain=${txGain.toFixed(2)}.`);
    }

    if (rmsEl) rmsEl.innerText = rms.toFixed(3);
    if (calScaleEl) calScaleEl.innerText = calibrationScale.toFixed(2) + 'x';
    if (calStatusEl) {
        if (!calibrationAttempted) {
            calStatusEl.innerText = "Idle";
            calStatusEl.style.color = '#888';
        } else if (!calibrationValid) {
            if (!defaultCalApplied && calibrationScale === 1.0) {
                calibrationScale = 2.0;
                defaultCalApplied = true;
                debugLog("Calibration fallback applied: cal=2.00x.");
            }
            calStatusEl.innerText = "No Signal";
            calStatusEl.style.color = '#ffb86c';
        } else if (calibrationClipped) {
            calStatusEl.innerText = "Input Hot";
            calStatusEl.style.color = '#ffb86c';
        } else {
            calStatusEl.innerText = "OK";
            calStatusEl.style.color = '#50fa7b';
        }
    }

    // Record history
    scopeHistory.push(new Float32Array(waveArray));
    if (scopeHistory.length > MAX_SCOPE_HISTORY) scopeHistory.shift();

    if (!isScopePaused) {
        drawScope(waveArray);
    }

    if (receiver) {
        const type = document.getElementById('modem-type').value;
        const points = receiver.processBlock(waveArray, type);
        drawConstellation(points);
    }
}

async function runRxDiagnostics() {
    try {
        if (window.__diagnoseInProgress) {
            debugLog("RX diagnose: already running.");
            return;
        }
        window.__diagnoseInProgress = true;
        debugLog("Diagnose clicked.");
        if (!analyser || !waveArray) {
            debugLog("RX diagnose: receiver not running.");
            alert("Start the receiver first.");
            window.__diagnoseInProgress = false;
            return;
        }
        debugLog("RX diagnose: starting baseline collection.");
        const diagEl = document.getElementById('rx-diagnose-output');
        const status = document.getElementById('status-badge');
        const btn = document.getElementById('btn-rx-diagnose');
        if (btn) btn.innerText = "Diagnosing...";
        if (btn) btn.disabled = true;
        if (status) {
            status.innerText = "Diagnosing...";
            status.className = "status-badge info";
        }
        if (diagEl) diagEl.innerText = "Diagnose: collecting baseline...";

        const collect = async (label, ms) => {
            const start = performance.now();
            let maxRaw = 0;
            let clipCount = 0;
            let sampleCount = 0;
            let energySum = 0;
            while (performance.now() - start < ms) {
                analyser.getFloatTimeDomainData(waveArray);
                for (let i = 0; i < waveArray.length; i++) {
                    const v = waveArray[i];
                    const a = Math.abs(v);
                    if (a > maxRaw) maxRaw = a;
                    if (a >= 0.999) clipCount++;
                    energySum += v * v;
                    sampleCount++;
                }
                await new Promise(r => requestAnimationFrame(r));
            }
            const rms = Math.sqrt(energySum / Math.max(sampleCount, 1));
            const calibratedPeak = maxRaw * (calibrationScale || 1);
            const scaledPeak = calibratedPeak * (userGain || 1);
            return {
                label,
                rms: rms.toFixed(4),
                maxRaw: maxRaw.toFixed(4),
                clipRatio: (clipCount / Math.max(sampleCount, 1)).toFixed(6),
                calScale: (calibrationScale || 1).toFixed(3),
                userGain: (userGain || 1).toFixed(3),
                calibratedPeak: calibratedPeak.toFixed(4),
                scaledPeak: scaledPeak.toFixed(4)
            };
        };

        const baseline = await collect("baseline", 1500);
        console.log("RX Diagnose baseline:", baseline);
        debugLog(`RX baseline rms=${baseline.rms} max=${baseline.maxRaw} clip=${baseline.clipRatio} cal=${baseline.calScale} gain=${baseline.userGain}`);
        if (status) status.innerText = "Diagnose: Send 'HI' now...";
        if (diagEl) {
            diagEl.innerText = `Baseline rms=${baseline.rms} max=${baseline.maxRaw} clip=${baseline.clipRatio} cal=${baseline.calScale} gain=${baseline.userGain}`;
        }
        await new Promise(r => setTimeout(r, 400));
        const duringTx = await collect("during-tx", 3000);
        console.log("RX Diagnose during-tx:", duringTx);
        debugLog(`RX during-tx rms=${duringTx.rms} max=${duringTx.maxRaw} clip=${duringTx.clipRatio} calPk=${duringTx.calibratedPeak} scaledPk=${duringTx.scaledPeak}`);
        if (diagEl) {
            diagEl.innerText += ` | Tx rms=${duringTx.rms} max=${duringTx.maxRaw} clip=${duringTx.clipRatio} calPk=${duringTx.calibratedPeak} scaledPk=${duringTx.scaledPeak}`;
        }

        if (status) {
            status.innerText = "Diagnose complete";
            status.className = "status-badge success";
            setTimeout(() => {
                if (isRunning) {
                    status.innerText = "Receiving";
                    status.className = "status-badge success";
                } else {
                    status.innerText = "Idle";
                    status.className = "status-badge warn";
                }
            }, 1200);
        }
        if (btn) btn.innerText = "Diagnose";
        if (btn) btn.disabled = false;
        window.__diagnoseInProgress = false;
    } catch (err) {
        debugLog(`RX diagnose error: ${err.message || err}`);
        const btn = document.getElementById('btn-rx-diagnose');
        if (btn) btn.innerText = "Diagnose";
        if (btn) btn.disabled = false;
        window.__diagnoseInProgress = false;
    }
}

async function startCalibration() {
    const s = document.getElementById('status-badge');
    s.innerText = "Calibrating...";
    s.className = "status-badge info";
    await initAudioGraph();
    calibrationAttempted = true;
    defaultCalApplied = false;
    debugLog("Calibration started.");
    const prevTxGain = masterGain ? masterGain.gain.value : 1.0;
    if (masterGain) masterGain.gain.value = 1.0;
    
    // Create a temporary stream if receiver is not running
    let tempStream = null;
    if (!micSource) {
        const sel = document.getElementById('device-select');
        const constraints = { audio: (sel && sel.value && sel.value.length > 5) ? { deviceId: { exact: sel.value } } : true };
        tempStream = await navigator.mediaDevices.getUserMedia(constraints);
        micSource = audioCtx.createMediaStreamSource(tempStream);
        micSource.connect(analyser);
    }

    // Play modulated sync sequence for calibration
    const engine = new ModemEngine(audioCtx.sampleRate, CONFIG.carrierFreq, 20);
    const { buffer } = engine.generateAudioBuffer("CALIBRATE", "QPSK", audioCtx);
    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(masterGain);
    source.start();

    const magnitudes = [];
    let clipHits = 0;
    let sampleCount = 0;
    let startTime = performance.now();
    let retries = 0;
    const listen = () => {
        if (performance.now() - startTime > 1500) {
            source.stop();
            if (tempStream) {
                tempStream.getTracks().forEach(t => t.stop());
                micSource = null;
            }
            if (magnitudes.length > 0) {
                const avg = magnitudes.reduce((a,b)=>a+b,0) / magnitudes.length;
                const minRms = 0.01;
                if (avg < minRms) {
                    if (retries < 2 && txGain < 0.6) {
                        retries++;
                        txGain = Math.min(0.6, txGain * 2);
                        if (masterGain) masterGain.gain.value = txGain;
                        magnitudes.length = 0;
                        clipHits = 0;
                        sampleCount = 0;
                        startTime = performance.now();
                        s.innerText = "Calibration: Boosting TX...";
                        s.className = "status-badge warn";
                        debugLog(`Calibration retry ${retries}: no signal, txGain=${txGain.toFixed(2)}.`);
                        source.start();
                        return;
                    }
                    calibrationValid = false;
                    calibrationScale = 2.0;
                    s.innerText = "Calibration: Default (No signal)";
                    s.className = "status-badge warn";
                    txGain = Math.min(txGain, 0.2);
                    if (masterGain) masterGain.gain.value = txGain;
                    defaultCalApplied = true;
                    debugLog("Calibration default: no signal (avg RMS too low). Set cal=2.00x, txGain=0.20.");
                    return;
                }
                const targetRms = 0.5;
                const rawScale = targetRms / avg;
                calibrationScale = Math.min(Math.max(rawScale, 0.1), 10);
                calibrationValid = true;
                const clipRatio = clipHits / Math.max(sampleCount, 1);
                calibrationClipped = clipRatio > 0.005;
                calibrationAttempted = true;
                const txTarget = Math.min(1, targetRms / avg);
                const scaleClamped = rawScale !== calibrationScale;
                if (calibrationClipped || (scaleClamped && rawScale > 5)) {
                    txGain = Math.min(txTarget, 0.3);
                } else {
                    txGain = txTarget;
                }
                if (masterGain) masterGain.gain.value = txGain;
                if (calibrationClipped) {
                    s.innerText = "Calibrated (Input Hot)";
                    s.className = "status-badge warn";
                    debugLog(`Calibration done: input hot, scale=${calibrationScale.toFixed(2)}x, txGain=${txGain.toFixed(2)}.`);
                } else if (rawScale !== calibrationScale) {
                    s.innerText = "Calibrated (Clamped)";
                    s.className = "status-badge warn";
                    debugLog(`Calibration done: clamped scale=${calibrationScale.toFixed(2)}x (raw ${rawScale.toFixed(2)}x), txGain=${txGain.toFixed(2)}.`);
                } else {
                    s.innerText = "Calibrated";
                    s.className = "status-badge success";
                    debugLog(`Calibration done: scale=${calibrationScale.toFixed(2)}x, txGain=${txGain.toFixed(2)}.`);
                }
            } else {
                s.innerText = "Failed";
                s.className = "status-badge error";
                if (masterGain) masterGain.gain.value = prevTxGain;
            }
            return;
        }
        analyser.getFloatTimeDomainData(waveArray);
        for (let i = 0; i < waveArray.length; i++) {
            if (Math.abs(waveArray[i]) >= 0.999) clipHits++;
        }
        sampleCount += waveArray.length;
        let e = 0; for(let x of waveArray) e += x*x;
        magnitudes.push(Math.sqrt(e/waveArray.length));
        requestAnimationFrame(listen);
    };
    listen();
}

function drawConstellation(points, clear = false) {
    const c = document.getElementById('constellation-canvas');
    if (!c) return;
    const ctx = c.getContext('2d');
    const w = c.width, h = c.height;
    ctx.fillStyle = clear ? '#0b0b0b' : 'rgba(0,0,0,0.2)'; 
    ctx.fillRect(0,0,w,h);
    ctx.strokeStyle = '#333'; ctx.beginPath();
    ctx.moveTo(w/2,0); ctx.lineTo(w/2,h); ctx.moveTo(0,h/2); ctx.lineTo(w,h/2); ctx.stroke();
    const type = document.getElementById('modem-type').value;
    const ideal = getIdealPoints(type);
    ctx.fillStyle = '#444';
    for (let p of ideal) {
        ctx.beginPath(); ctx.arc((p.I*0.8+1)*w/2, (-p.Q*0.8+1)*h/2, 3, 0, 7); ctx.fill();
    }
    if (!points) return;
    ctx.fillStyle = THEME.accent;
    ctx.shadowBlur = 10; ctx.shadowColor = THEME.accent;
    for (let p of points) {
        const x = (p.i*2.0*0.8+1)*w/2;
        const y = (-p.q*2.0*0.8+1)*h/2;
        if (x >= 0 && x <= w && y >= 0 && y <= h) {
            ctx.beginPath(); ctx.arc(x, y, 4, 0, 7); ctx.fill();
        }
    }
    ctx.shadowBlur = 0;
}

function drawScope(buffer) {
    const c = document.getElementById('scope-canvas');
    if (!c) return;
    const ctx = c.getContext('2d');
    const w = c.width, h = c.height;
    ctx.fillStyle = '#0b0b0b'; ctx.fillRect(0,0,w,h);
    ctx.strokeStyle = THEME.accent; ctx.beginPath();
    for(let i=0; i<w; i+=2) {
        const v = buffer[Math.floor(i/w*buffer.length)];
        const y = (h/2) - (v*h/2*2);
        if(i===0) ctx.moveTo(i,y); else ctx.lineTo(i,y);
    }
    ctx.stroke();
}

async function transmitModemData() {
    const text = document.getElementById('modem-input').value || "HI";
    const type = document.getElementById('modem-type').value;
    const baud = parseInt(document.getElementById('modem-baud').value);
    const sendBtn = document.getElementById('btn-modem-send');

    await initAudioGraph();
    const engine = new ModemEngine(audioCtx.sampleRate, CONFIG.carrierFreq, baud);
    const { buffer, bits } = engine.generateAudioBuffer(text, type, audioCtx);
    
    // Update bitstream display
    const bitstreamEl = document.getElementById('modem-bitstream');
    if (bitstreamEl) bitstreamEl.innerText = bits.join('');
    drawBinaryStream(bits);

    if (modemBufferSource) try { modemBufferSource.stop(); } catch(e){}
    modemBufferSource = audioCtx.createBufferSource();
    modemBufferSource.buffer = buffer;
    if (masterGain) masterGain.gain.value = txGain;
    modemBufferSource.connect(masterGain);
    
    if (sendBtn) {
        sendBtn.innerText = "SENDING...";
        sendBtn.disabled = true;
        modemBufferSource.onended = () => {
            sendBtn.innerText = "SEND";
            sendBtn.disabled = false;
            txActive = false;
        };
    }
    txActive = true;
    modemBufferSource.start();
}

function drawBinaryStream(bits) {
    const c = document.getElementById('modem-bit-canvas');
    if (!c) return;
    const ctx = c.getContext('2d');
    
    // Ensure canvas has size before drawing
    if (c.width === 0 || c.height === 0) {
        c.width = c.clientWidth || 400;
        c.height = c.clientHeight || 80;
    }
    
    const w = c.width, h = c.height;
    ctx.fillStyle = '#050505';
    ctx.fillRect(0,0,w,h);
    
    if (!bits || bits.length === 0) return;
    
    ctx.strokeStyle = THEME.accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    
    const step = w / bits.length;
    let x = 0;
    
    const padding = 15; // Padding from top/bottom
    const getY = (bit) => bit === 1 ? padding : h - padding;
    
    ctx.moveTo(0, getY(bits[0]));
    
    for (let i = 0; i < bits.length; i++) {
        const y = getY(bits[i]);
        ctx.lineTo(x, y);
        x += step;
        ctx.lineTo(x, y);
    }
    ctx.stroke();
}



function exportWaveform() {

    if (!waveArray) { alert("No waveform data available. Start the scan first."); return; }

    let csv = "Index,Voltage\n";

    for (let i = 0; i < waveArray.length; i++) {

        csv += `${i},${waveArray[i].toFixed(6)}\n`;

    }

    downloadCSV(csv, "waveform_data.csv");

}



function exportConstellation() {

    if (!receiver || receiver.lastPoints.length === 0) { alert("No constellation data available. Transmit or receive a signal first."); return; }

    let csv = "I,Q\n";

    for (let p of receiver.lastPoints) {

        csv += `${p.i.toFixed(6)},${p.q.toFixed(6)}\n`;

    }

    downloadCSV(csv, "constellation_data.csv");

}



function downloadCSV(csv, filename) {

    const blob = new Blob([csv], { type: 'text/csv' });

    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');

    a.href = url;

    a.download = filename;

    a.click();

    URL.revokeObjectURL(url);

}



window.addEventListener('resize', () => {
    initCanvas('modem-bit-canvas');
    initCanvas('constellation-canvas');
    initCanvas('scope-canvas');
});
