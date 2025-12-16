(() => {
    const els = {
        deviceSelect: document.getElementById('device-select'),
        deviceLabel: document.getElementById('device-label'),
        micStatus: document.getElementById('mic-status'),
        btnStart: document.getElementById('btn-start'),
        btnStop: document.getElementById('btn-stop'),
        ampRms: document.getElementById('amp-rms'),
        ampPeak: document.getElementById('amp-peak'),
        ampDb: document.getElementById('amp-db'),
        freqFundamental: document.getElementById('freq-fundamental'),
        freqConfidence: document.getElementById('freq-confidence'),
        scopeCanvas: document.getElementById('scope-canvas'),
        scopeScrub: document.getElementById('scope-scrub'),
        scopePeriod: document.getElementById('scope-period'),
        scopeTimebase: document.getElementById('scope-timebase'),
        scopeTimebaseVal: document.getElementById('scope-timebase-val'),
        scopeGain: document.getElementById('scope-gain'),
        scopeGainVal: document.getElementById('scope-gain-val'),
        spectrumCanvas: document.getElementById('spectrum-canvas'),
        historyCanvas: document.getElementById('history-canvas'),
        btnFreeze: document.getElementById('btn-freeze'),
        btnClearHistory: document.getElementById('btn-clear-history'),
        btnScopeSnap: document.getElementById('btn-scope-snap'),
        btnSpectrumSnap: document.getElementById('btn-spectrum-snap'),
        btnHistorySnap: document.getElementById('btn-history-snap'),
        dopplerBase: document.getElementById('doppler-base'),
        dopplerMeasured: document.getElementById('doppler-measured'),
        dopplerDelta: document.getElementById('doppler-delta'),
        dopplerSpeed: document.getElementById('doppler-speed'),
        sonarDelay: document.getElementById('sonar-delay'),
        sonarDistance: document.getElementById('sonar-distance'),
        sonarStatus: document.getElementById('sonar-status'),
        btnSonar: document.getElementById('btn-sonar'),
        btnSonarReset: document.getElementById('btn-sonar-reset'),
        speedDistance: document.getElementById('speed-distance'),
        btnSpeedStart: document.getElementById('btn-speed-start'),
        btnSpeedReset: document.getElementById('btn-speed-reset'),
        speedDt: document.getElementById('speed-dt'),
        speedEst: document.getElementById('speed-est'),
        speedStatus: document.getElementById('speed-status'),
        speedTemp: document.getElementById('speed-temp'),
        speedExpected: document.getElementById('speed-expected'),
        toneSlider: document.getElementById('tone-slider'),
        toneValue: document.getElementById('tone-value'),
        toneGain: document.getElementById('tone-gain'),
        toneGainVal: document.getElementById('tone-gain-val'),
        btnTone: document.getElementById('btn-tone'),
        btnToneStop: document.getElementById('btn-tone-stop')
    };

    const scopeCtx = els.scopeCanvas.getContext('2d');
    const spectrumCtx = els.spectrumCanvas.getContext('2d');
    const historyCtx = els.historyCanvas.getContext('2d');

    let audioCtx;
    let analyser;
    let analyserFreq;
    let micStream;
    let sourceNode;
    let rafId;
    let dataArray;
    let freqArray;
    let freeze = false;
    let currentFreq = null;
    let frequencyHistory = [];
    let sampleRate = 44100;
    let hoverFreq = null;
    let scopeBuffers = [];
    let scopeIndex = 0;
    const maxScopeBuffers = 600;
    let lastBuffer = null;
    let lastScopeBuffer = null;
    let scopeTimebaseMs = 50;
    let scopeGainMult = 3;
    const scopeDivisions = 10;

    // Sonar
    let sonarListening = false;
    let sonarStartTime = 0;
    let sonarDetected = false;
    let sonarTemplate = null;
    let sonarPingSample = 0;
    let sonarBlankSamples = 0;
    let sonarSearchSamples = 0;
    let totalSamplesProcessed = 0;
    const sonarBuffers = [];
    const sonarBlankMs = 10;
    const sonarWindowMs = 400;
    const baseSpeed = () => {
        const t = parseFloat(els.speedTemp.value) || 0;
        return 331.4 + 0.6 * t;
    };

    // Acoustic stopwatch
    let speedListening = false;
    let clapTimes = [];
    let speedState = 'idle';
    let speedLockoutUntil = 0;
    let speedSecondDeadline = 0;

    // Tone generator
    let toneOsc = null;
    let toneGainNode = null;

    async function enumerateDevices() {
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const mics = devices.filter(d => d.kind === 'audioinput');
            els.deviceSelect.innerHTML = '<option value="">Select Mic...</option>';
            mics.forEach(d => {
                const opt = document.createElement('option');
                opt.value = d.deviceId;
                opt.textContent = d.label || `Mic ${els.deviceSelect.length}`;
                els.deviceSelect.appendChild(opt);
            });
            if (mics.length === 0) {
                const opt = document.createElement('option');
                opt.textContent = 'No microphones found';
                opt.disabled = true;
                els.deviceSelect.appendChild(opt);
            }
        } catch (err) {
            console.error(err);
        }
    }

    function setStatus(text, connected = false) {
        els.micStatus.textContent = text;
        els.micStatus.classList.toggle('connected', connected);
        els.micStatus.classList.toggle('disconnected', !connected);
    }

    function updateExpectedSpeed() {
        const c = baseSpeed();
        els.speedExpected.textContent = `${c.toFixed(1)} m/s`;
    }

    function updateScopeTuning() {
        if (els.scopeTimebase) {
            scopeTimebaseMs = parseFloat(els.scopeTimebase.value) || scopeTimebaseMs;
            els.scopeTimebaseVal.textContent = scopeTimebaseMs.toFixed(0);
        }
        if (els.scopeGain) {
            scopeGainMult = parseFloat(els.scopeGain.value) || scopeGainMult;
            els.scopeGainVal.textContent = scopeGainMult.toFixed(1);
        }
    }

    async function startMic() {
        try {
            stopMic();
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            sampleRate = audioCtx.sampleRate;
            const constraints = {
                audio: {
                    deviceId: els.deviceSelect.value ? { exact: els.deviceSelect.value } : undefined,
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false
                }
            };
            micStream = await navigator.mediaDevices.getUserMedia(constraints);
            sourceNode = audioCtx.createMediaStreamSource(micStream);

            analyser = audioCtx.createAnalyser();
            analyser.fftSize = 2048;
            analyser.smoothingTimeConstant = 0.1;
            analyserFreq = audioCtx.createAnalyser();
            analyserFreq.fftSize = 2048;
            analyserFreq.smoothingTimeConstant = 0.8;

            dataArray = new Float32Array(analyser.fftSize);
            freqArray = new Uint8Array(analyserFreq.frequencyBinCount);
            sonarTemplate = buildPingTemplate(sampleRate);
            sonarBlankSamples = Math.round((sonarBlankMs / 1000) * sampleRate);
            sonarSearchSamples = Math.round((sonarWindowMs / 1000) * sampleRate);
            totalSamplesProcessed = 0;
            sonarBuffers.length = 0;

            sourceNode.connect(analyser);
            sourceNode.connect(analyserFreq);

            els.deviceLabel.textContent = micStream.getAudioTracks()[0]?.label || 'Microphone';
            setStatus('Mic Live', true);
            updateExpectedSpeed();
            animate();
            enumerateDevices();
        } catch (err) {
            console.error(err);
            setStatus('Mic Error', false);
        }
    }

    function stopMic() {
        if (rafId) cancelAnimationFrame(rafId);
        stopTone();
        if (micStream) micStream.getTracks().forEach(t => t.stop());
        if (audioCtx) audioCtx.close();
        micStream = null;
        audioCtx = null;
        sourceNode = null;
        analyser = null;
        analyserFreq = null;
        sonarTemplate = null;
        sonarListening = false;
        sonarDetected = false;
        sonarBuffers.length = 0;
        totalSamplesProcessed = 0;
        setStatus('Mic Idle', false);
    }

    function calculateAmplitude(buffer) {
        let sumSquares = 0;
        let peak = 0;
        for (let i = 0; i < buffer.length; i++) {
            const v = buffer[i];
            sumSquares += v * v;
            peak = Math.max(peak, Math.abs(v));
        }
        const rms = Math.sqrt(sumSquares / buffer.length);
        const db = rms > 0 ? (20 * Math.log10(rms)).toFixed(1) : '-∞';
        return { rms, peak, db };
    }

    function autoCorrelate(buffer, sampleRate) {
        // Basic autocorrelation: returns freq + normalized confidence
        const SIZE = buffer.length;
        let rms = 0;
        for (let i = 0; i < SIZE; i++) {
            rms += buffer[i] * buffer[i];
        }
        rms = Math.sqrt(rms / SIZE);
        if (rms < 0.01) return { freq: null, confidence: 0 };

        let r1 = 0;
        let r2 = SIZE - 1;
        const threshold = 0.2;
        for (let i = 0; i < SIZE / 2; i++) {
            if (Math.abs(buffer[i]) < threshold) { r1 = i; break; }
        }
        for (let i = 1; i < SIZE / 2; i++) {
            if (Math.abs(buffer[SIZE - i]) < threshold) { r2 = SIZE - i; break; }
        }
        buffer = buffer.slice(r1, r2);
        const newSize = buffer.length;
        const c = new Array(newSize).fill(0);
        for (let i = 0; i < newSize; i++) {
            for (let j = 0; j < newSize - i; j++) {
                c[i] = c[i] + buffer[j] * buffer[j + i];
            }
        }
        let d = 0;
        while (c[d] > c[d + 1]) d++;
        let maxval = -1;
        let maxpos = -1;
        for (let i = d; i < newSize; i++) {
            if (c[i] > maxval) {
                maxval = c[i];
                maxpos = i;
            }
        }
        let T0 = maxpos;
        if (T0 > 0 && T0 < c.length - 1) {
            const x1 = c[T0 - 1];
            const x2 = c[T0];
            const x3 = c[T0 + 1];
            const a = (x1 + x3 - 2 * x2) / 2;
            const b = (x3 - x1) / 2;
            if (a) T0 = T0 - b / (2 * a);
        }
        const freq = sampleRate / T0;
        const confidence = maxval && c[0] ? (maxval / c[0]) : 0;
        return { freq, confidence };
    }

    function buildPingTemplate(sr) {
        // Matches the short 2 kHz ping envelope used when triggering sonar
        const upMs = 3;
        const sustainMs = 10;
        const downMs = 3;
        const totalMs = (upMs + sustainMs + downMs) / 1000;
        const totalSamples = Math.max(1, Math.floor(totalMs * sr));
        const template = new Float32Array(totalSamples);
        for (let i = 0; i < totalSamples; i++) {
            const t = i / sr;
            let amp = 1;
            if (t < upMs / 1000) {
                amp = t / (upMs / 1000);
            } else if (t > (upMs + sustainMs) / 1000) {
                const downT = t - (upMs + sustainMs) / 1000;
                amp = Math.max(0, 1 - downT / (downMs / 1000));
            }
            template[i] = Math.sin(2 * Math.PI * 2000 * t) * amp;
        }
        return template;
    }

    function collectSamples(startSample, endSample) {
        const result = [];
        for (let i = 0; i < sonarBuffers.length; i++) {
            const { start, data } = sonarBuffers[i];
            const bufferEnd = start + data.length;
            if (bufferEnd <= startSample || start >= endSample) continue;
            const sliceStart = Math.max(0, startSample - start);
            const sliceEnd = Math.min(data.length, endSample - start);
            result.push(data.slice(sliceStart, sliceEnd));
        }
        if (!result.length) return null;
        const totalLen = result.reduce((sum, arr) => sum + arr.length, 0);
        const merged = new Float32Array(totalLen);
        let offset = 0;
        result.forEach(arr => {
            merged.set(arr, offset);
            offset += arr.length;
        });
        return merged;
    }

    function normalizedCrossCorrelation(signal, template) {
        if (!signal || signal.length < template.length) return { offset: -1, correlation: 0 };
        let templateEnergy = 0;
        for (let i = 0; i < template.length; i++) templateEnergy += template[i] * template[i];
        let maxCorr = 0;
        let bestOffset = -1;
        const maxOffset = signal.length - template.length;
        for (let offset = 0; offset <= maxOffset; offset++) {
            let dot = 0;
            let energy = 0;
            for (let i = 0; i < template.length; i++) {
                const s = signal[offset + i];
                dot += template[i] * s;
                energy += s * s;
            }
            if (energy === 0) continue;
            const corr = dot / Math.sqrt(templateEnergy * energy);
            if (corr > maxCorr) {
                maxCorr = corr;
                bestOffset = offset;
            }
        }
        return { offset: bestOffset, correlation: maxCorr };
    }

    function flashButton(btn, label = 'Copied!') {
        if (!btn) return;
        const original = btn.textContent;
        btn.textContent = label;
        setTimeout(() => { btn.textContent = original; }, 900);
    }

    async function spectrumSnapshot() {
        if (!analyserFreq || !freqArray) return;
        try {
            analyserFreq.getByteFrequencyData(freqArray);
            const lines = ['Frequency (Hz),Amplitude (dB)'];
            const binHz = sampleRate / analyserFreq.fftSize;
            for (let i = 0; i < freqArray.length; i++) {
                const mag = Math.max(freqArray[i], 1e-6);
                const db = 20 * Math.log10(mag / 255);
                const freq = i * binHz;
                lines.push(`${freq.toFixed(1)},${db.toFixed(2)}`);
            }
            const csv = lines.join('\n');
            await navigator.clipboard.writeText(csv);
            flashButton(els.btnSpectrumSnap);
        } catch (err) {
            console.error('Snapshot failed', err);
        }
    }

    async function historySnapshot() {
        if (!frequencyHistory.length) return;
        try {
            const lines = ['Time (s),Frequency (Hz)'];
            const t0 = frequencyHistory[0].time;
            frequencyHistory.forEach(p => {
                lines.push(`${(p.time - t0).toFixed(3)},${p.freq.toFixed(2)}`);
            });
            const csv = lines.join('\n');
            await navigator.clipboard.writeText(csv);
            flashButton(els.btnHistorySnap);
        } catch (err) {
            console.error('Snapshot failed', err);
        }
    }

    function getScopeGain() {
        return scopeGainMult || 1;
    }

    function getScopeDisplayBuffer(buffer) {
        if (!buffer || !buffer.length) return null;
        const windowSamples = Math.max(8, Math.min(buffer.length, Math.round((scopeTimebaseMs / 1000) * sampleRate)));
        const start = Math.max(0, buffer.length - windowSamples);
        const slice = buffer.slice(start, start + windowSamples);
        lastScopeBuffer = slice;
        return slice;
    }

    async function scopeSnapshot() {
        const source = lastScopeBuffer || (lastBuffer ? getScopeDisplayBuffer(lastBuffer) : null);
        if (!source || !source.length) return;
        try {
            const lines = ['Time (s),Voltage'];
            const dt = 1 / sampleRate;
            for (let i = 0; i < source.length; i++) {
                lines.push(`${(i * dt).toFixed(6)},${source[i].toFixed(6)}`);
            }
            const csv = lines.join('\n');
            await navigator.clipboard.writeText(csv);
            flashButton(els.btnScopeSnap);
        } catch (err) {
            console.error('Snapshot failed', err);
        }
    }

    function drawScope(buffer, opts = {}) {
        const displayBuffer = getScopeDisplayBuffer(buffer);
        if (!displayBuffer || !displayBuffer.length) return;
        const { width, height } = els.scopeCanvas;
        scopeCtx.fillStyle = '#000';
        scopeCtx.fillRect(0, 0, width, height);

        // Shaded energy (area under f(t)^2) when frozen
        if (opts.showEnergy) {
            scopeCtx.fillStyle = 'rgba(208,92,227,0.2)';
            scopeCtx.beginPath();
            const sliceWidth = width / displayBuffer.length;
            let x = 0;
            scopeCtx.moveTo(0, height);
            const gainBoost = getScopeGain();
            for (let i = 0; i < displayBuffer.length; i++) {
                const squared = Math.min(1, displayBuffer[i] * displayBuffer[i] * gainBoost * gainBoost);
                const y = height - squared * height;
                scopeCtx.lineTo(x, y);
                x += sliceWidth;
            }
            scopeCtx.lineTo(width, height);
            scopeCtx.closePath();
            scopeCtx.fill();
        }

        // Waveform
        scopeCtx.lineWidth = 2;
        scopeCtx.strokeStyle = '#2ed573';
        scopeCtx.beginPath();
        const sliceWidth = width / displayBuffer.length;
        let x = 0;
        const gain = getScopeGain();
        for (let i = 0; i < displayBuffer.length; i++) {
            const amplified = Math.max(-1, Math.min(1, displayBuffer[i] * gain));
            const v = amplified * 0.5 + 0.5;
            const y = v * height;
            if (i === 0) scopeCtx.moveTo(x, y);
            else scopeCtx.lineTo(x, y);
            x += sliceWidth;
        }
        scopeCtx.stroke();

        // Highlight period from spectrum hover
        if (hoverFreq) {
            const periodSec = 1 / hoverFreq;
            const periodSamples = periodSec * sampleRate;
            const periodPx = (periodSamples / buffer.length) * width;
            scopeCtx.fillStyle = 'rgba(46,213,115,0.15)';
            scopeCtx.fillRect(0, 0, Math.min(periodPx, width), height);
            els.scopePeriod.textContent = `T ≈ ${(periodSec * 1000).toFixed(2)} ms @ ${hoverFreq.toFixed(1)} Hz`;
        } else {
            els.scopePeriod.textContent = 'T: -- ms';
        }

        // Axes labels
        scopeCtx.fillStyle = '#888';
        scopeCtx.font = '10px monospace';
        scopeCtx.textAlign = 'right';
        scopeCtx.fillText('Amplitude', 40, 12);
        scopeCtx.textAlign = 'center';
        scopeCtx.fillText('Time (ms)', width / 2, height - 4);
    }

    function drawSpectrum() {
        analyserFreq.getByteFrequencyData(freqArray);
        const { width, height } = els.spectrumCanvas;
        spectrumCtx.fillStyle = '#000';
        spectrumCtx.fillRect(0, 0, width, height);
        const barWidth = width / freqArray.length;
        for (let i = 0; i < freqArray.length; i++) {
            const value = freqArray[i];
            const barHeight = (value / 255) * height;
            const x = i * barWidth;
            spectrumCtx.fillStyle = '#d05ce3';
            spectrumCtx.fillRect(x, height - barHeight, barWidth + 1, barHeight);
        }

        // Draw frequency grid lines every 25 Hz up to 8 kHz for reference
        spectrumCtx.strokeStyle = 'rgba(255,255,255,0.08)';
        spectrumCtx.lineWidth = 1;
        spectrumCtx.beginPath();
        const nyquist = sampleRate / 2;
        for (let f = 25; f <= 8000; f += 25) {
            const x = (f / nyquist) * width;
            spectrumCtx.moveTo(x, 0);
            spectrumCtx.lineTo(x, height);
        }
        spectrumCtx.stroke();

        // Label every 500 Hz to avoid clutter
        spectrumCtx.fillStyle = '#888';
        spectrumCtx.font = '10px monospace';
        spectrumCtx.textAlign = 'center';
        spectrumCtx.textBaseline = 'top';
        for (let f = 0; f <= 8000; f += 500) {
            const x = (f / nyquist) * width;
            spectrumCtx.fillText(`${f / 1000 >= 1 ? (f / 1000).toFixed(1) + 'k' : f}`, x, 2);
        }

        // Hover highlight
        if (hoverFreq) {
            const x = (hoverFreq / nyquist) * width;
            spectrumCtx.strokeStyle = '#2ed573';
            spectrumCtx.lineWidth = 2;
            spectrumCtx.beginPath();
            spectrumCtx.moveTo(x, 0);
            spectrumCtx.lineTo(x, height);
            spectrumCtx.stroke();
            spectrumCtx.fillStyle = '#2ed573';
            spectrumCtx.textBaseline = 'bottom';
            spectrumCtx.fillText(`${hoverFreq.toFixed(1)} Hz`, x, height - 2);
        }

        // Axis labels
        spectrumCtx.fillStyle = '#888';
        spectrumCtx.font = '10px monospace';
        spectrumCtx.textAlign = 'right';
        spectrumCtx.fillText('Magnitude (dBFS)', width - 4, 12);
        spectrumCtx.textAlign = 'center';
        spectrumCtx.textBaseline = 'bottom';
        spectrumCtx.fillText('Frequency (Hz)', width / 2, height - 2);
    }

    function drawHistory() {
        const { width, height } = els.historyCanvas;
        historyCtx.fillStyle = '#000';
        historyCtx.fillRect(0, 0, width, height);
        historyCtx.strokeStyle = '#1e90ff';
        historyCtx.lineWidth = 2;
        historyCtx.beginPath();
        const maxPoints = frequencyHistory.length;
        if (!maxPoints) return;
        const maxFreq = Math.max(...frequencyHistory.map(f => f.freq));
        const minFreq = Math.min(...frequencyHistory.map(f => f.freq));
        const range = Math.max(50, maxFreq - minFreq || 1);
        frequencyHistory.forEach((p, idx) => {
            const x = (idx / (maxPoints - 1)) * width;
            const norm = (p.freq - minFreq) / range;
            const y = height - norm * height;
            if (idx === 0) historyCtx.moveTo(x, y);
            else historyCtx.lineTo(x, y);
        });
        historyCtx.stroke();
    }

    function handleDoppler(measuredFreq) {
        const base = parseFloat(els.dopplerBase.value) || 0;
        if (!measuredFreq || !base) {
            els.dopplerMeasured.textContent = '-- Hz';
            els.dopplerDelta.textContent = '-- Hz';
            els.dopplerSpeed.textContent = '-- m/s';
            return;
        }
        const delta = measuredFreq - base;
        const velocity = (baseSpeed() * delta) / base;
        els.dopplerMeasured.textContent = `${measuredFreq.toFixed(1)} Hz`;
        els.dopplerDelta.textContent = `${delta >= 0 ? '+' : ''}${delta.toFixed(1)} Hz`;
        els.dopplerSpeed.textContent = `${velocity.toFixed(2)} m/s`;
    }

    function animate() {
        if (!analyser || !audioCtx) return;
        analyser.getFloatTimeDomainData(dataArray);
        const bufferCopy = new Float32Array(dataArray);
        lastBuffer = bufferCopy;
        const scopedBuffer = getScopeDisplayBuffer(bufferCopy);
        if (scopedBuffer) scopeBuffers.push(scopedBuffer);
        sonarBuffers.push({ start: totalSamplesProcessed, data: bufferCopy });
        totalSamplesProcessed += bufferCopy.length;
        const maxSonarSamples = sampleRate * 3; // keep ~3s of history
        while (sonarBuffers.length && totalSamplesProcessed - sonarBuffers[0].start > maxSonarSamples) {
            sonarBuffers.shift();
        }
        if (scopeBuffers.length > maxScopeBuffers) scopeBuffers.shift();
        scopeIndex = scopeBuffers.length - 1;
        els.scopeScrub.max = Math.max(scopeBuffers.length - 1, 0);
        els.scopeScrub.value = scopeIndex;

        const amp = calculateAmplitude(bufferCopy);
        els.ampRms.textContent = amp.rms.toFixed(3);
        els.ampPeak.textContent = amp.peak.toFixed(3);
        els.ampDb.textContent = `${amp.db}`;

        const rmsGate = 0.01;
        let freqResult = { freq: null, confidence: 0 };
        if (amp.rms >= rmsGate) {
            freqResult = autoCorrelate(bufferCopy, audioCtx.sampleRate);
        }
        const passesConfidence = freqResult.freq && freqResult.confidence >= 0.9;
        currentFreq = passesConfidence ? freqResult.freq : null;
        if (currentFreq) {
            els.freqFundamental.textContent = `${currentFreq.toFixed(1)} Hz`;
            els.freqConfidence.textContent = freqResult.confidence.toFixed(2);
        } else {
            els.freqFundamental.textContent = '-- Hz';
            els.freqConfidence.textContent = freqResult.confidence ? freqResult.confidence.toFixed(2) : amp.rms.toFixed(3);
        }
        handleDoppler(currentFreq);

        const now = audioCtx.currentTime;
        if (sonarListening && !sonarDetected) detectSonarEcho(now);

        // Acoustic stopwatch clap detection
        if (speedListening && now > speedLockoutUntil && amp.peak > 0.45) {
            if (speedState === 'waitingFirst') {
                clapTimes = [now];
                speedState = 'waitingSecond';
                speedLockoutUntil = now + 0.2;
                speedSecondDeadline = now + 3;
                els.speedStatus.textContent = 'First clap recorded! Walk away and clap again.';
            } else if (speedState === 'waitingSecond') {
                clapTimes.push(now);
                const dt = (clapTimes[1] - clapTimes[0]) * 1000;
                const dist = parseFloat(els.speedDistance.value) || 0;
                const estimated = dist && dt ? (dist / (dt / 1000)) : 0;
                els.speedDt.textContent = `${dt.toFixed(1)} ms`;
                els.speedEst.textContent = estimated ? `${estimated.toFixed(2)} m/s` : '--';
                els.speedStatus.textContent = 'Done';
                speedListening = false;
                speedState = 'idle';
            }
        } else if (speedListening && speedState === 'waitingSecond' && now > speedSecondDeadline) {
            speedListening = false;
            speedState = 'idle';
            els.speedStatus.textContent = 'Timeout waiting for second clap. Try again.';
        }

        if (!freeze) {
            drawScope(scopedBuffer || bufferCopy, { showEnergy: false });
            drawSpectrum();
            if (currentFreq) {
                frequencyHistory.push({ time: now, freq: currentFreq });
                if (frequencyHistory.length > 300) frequencyHistory.shift();
                drawHistory();
            }
        } else if (scopeBuffers.length) {
            const idx = parseInt(els.scopeScrub.value, 10) || scopeBuffers.length - 1;
            const buf = scopeBuffers[Math.max(0, Math.min(idx, scopeBuffers.length - 1))];
            drawScope(buf, { showEnergy: true });
        }

        rafId = requestAnimationFrame(animate);
    }

    function toggleFreeze() {
        freeze = !freeze;
        els.btnFreeze.textContent = freeze ? '▶️ Resume' : '⏸️ Freeze';
        els.btnFreeze.classList.toggle('secondary', freeze);
        els.scopeScrub.disabled = !freeze;
        if (!freeze) {
            els.scopeScrub.value = scopeBuffers.length ? scopeBuffers.length - 1 : 0;
        } else if (scopeBuffers.length) {
            drawScope(scopeBuffers[scopeBuffers.length - 1], { showEnergy: true });
        }
    }

    function clearHistory() {
        frequencyHistory = [];
        drawHistory();
    }

    function triggerSonar() {
        if (!audioCtx) {
            setStatus('Start mic first', false);
            return;
        }
        if (!sonarTemplate) {
            sonarTemplate = buildPingTemplate(sampleRate);
            sonarBlankSamples = Math.round((sonarBlankMs / 1000) * sampleRate);
            sonarSearchSamples = Math.round((sonarWindowMs / 1000) * sampleRate);
        }
        const t = audioCtx.currentTime + 0.05;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(2000, t);
        gain.gain.setValueAtTime(0.0, audioCtx.currentTime);
        gain.gain.linearRampToValueAtTime(0.8, t);
        gain.gain.linearRampToValueAtTime(0.0, t + 0.015);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(t);
        osc.stop(t + 0.03);

        sonarListening = true;
        sonarDetected = false;
        sonarStartTime = t;
        sonarPingSample = Math.round(sonarStartTime * sampleRate);
        els.sonarStatus.textContent = 'Listening for echo...';
        els.sonarDelay.textContent = '-- ms';
        els.sonarDistance.textContent = '-- m';
    }

    function detectSonarEcho(now) {
        if (!sonarListening || !sonarTemplate) return;
        const searchStart = sonarPingSample + sonarBlankSamples;
        const searchEnd = searchStart + sonarSearchSamples;
        const latestSample = totalSamplesProcessed;
        if (latestSample < searchStart + sonarTemplate.length) return;
        const window = collectSamples(searchStart, searchEnd);
        if (!window || window.length < sonarTemplate.length) return;
        const { offset, correlation } = normalizedCrossCorrelation(window, sonarTemplate);
        if (offset >= 0 && correlation >= 0.45) {
            sonarDetected = true;
            sonarListening = false;
            const detectedSample = searchStart + offset;
            const dtMs = ((detectedSample - sonarPingSample) / sampleRate) * 1000;
            const distance = (baseSpeed() * (dtMs / 1000)) / 2;
            els.sonarDelay.textContent = `${dtMs.toFixed(1)} ms`;
            els.sonarDistance.textContent = `${distance.toFixed(3)} m`;
            els.sonarStatus.textContent = `Echo detected (corr ${correlation.toFixed(2)})`;
        } else if (now - sonarStartTime > (sonarBlankMs + sonarWindowMs) / 1000 + 0.1) {
            sonarListening = false;
            els.sonarStatus.textContent = 'No echo detected';
        }
    }

    function resetSonar() {
        sonarListening = false;
        sonarDetected = false;
        els.sonarStatus.textContent = 'Idle';
        els.sonarDelay.textContent = '-- ms';
        els.sonarDistance.textContent = '-- m';
    }

    function startSpeedListen() {
        clapTimes = [];
        speedListening = true;
        speedState = 'waitingFirst';
        speedLockoutUntil = 0;
        speedSecondDeadline = 0;
        els.speedStatus.textContent = 'Waiting for first clap...';
        els.speedDt.textContent = '-- ms';
        els.speedEst.textContent = '-- m/s';
    }

    function resetSpeed() {
        speedListening = false;
        clapTimes = [];
        speedState = 'idle';
        speedLockoutUntil = 0;
        speedSecondDeadline = 0;
        els.speedStatus.textContent = 'Idle';
        els.speedDt.textContent = '-- ms';
        els.speedEst.textContent = '-- m/s';
    }

    async function startTone() {
        if (!audioCtx) {
            await startMic();
        }
        if (audioCtx.state === 'suspended') {
            await audioCtx.resume();
        }
        stopTone();
        toneOsc = audioCtx.createOscillator();
        toneGainNode = audioCtx.createGain();
        toneOsc.type = 'sine';
        toneOsc.frequency.value = parseFloat(els.toneSlider.value);
        const targetGain = parseFloat(els.toneGain.value);
        const t = audioCtx.currentTime;
        toneGainNode.gain.setValueAtTime(0, t);
        toneGainNode.gain.setTargetAtTime(targetGain, t, 0.05);
        toneOsc.connect(toneGainNode).connect(audioCtx.destination);
        toneOsc.start(t);
    }

    function stopTone() {
        if (toneGainNode && audioCtx) {
            const t = audioCtx.currentTime;
            toneGainNode.gain.cancelScheduledValues(t);
            toneGainNode.gain.setTargetAtTime(0, t, 0.05);
        }
        if (toneOsc && audioCtx) {
            toneOsc.stop(audioCtx.currentTime + 0.1);
        } else if (toneOsc) {
            toneOsc.stop();
        }
        if (toneGainNode) toneGainNode.disconnect();
        toneOsc = null;
        toneGainNode = null;
    }

    // Event wiring
    els.btnStart.addEventListener('click', () => {
        startMic();
    });
    els.btnStop.addEventListener('click', stopMic);
    els.btnFreeze.addEventListener('click', toggleFreeze);
    els.btnClearHistory.addEventListener('click', clearHistory);
    els.btnSonar.addEventListener('click', triggerSonar);
    els.btnSonarReset.addEventListener('click', resetSonar);
    els.btnSpeedStart.addEventListener('click', startSpeedListen);
    els.btnSpeedReset.addEventListener('click', resetSpeed);
    els.btnTone.addEventListener('click', startTone);
    els.btnToneStop.addEventListener('click', stopTone);
    if (els.btnSpectrumSnap) els.btnSpectrumSnap.addEventListener('click', spectrumSnapshot);
    if (els.btnHistorySnap) els.btnHistorySnap.addEventListener('click', historySnapshot);
    els.toneSlider.addEventListener('input', (e) => {
        els.toneValue.textContent = e.target.value;
        if (toneOsc) toneOsc.frequency.value = parseFloat(e.target.value);
    });
    els.toneGain.addEventListener('input', (e) => {
        els.toneGainVal.textContent = e.target.value;
        if (toneGainNode && audioCtx) {
            const t = audioCtx.currentTime;
            toneGainNode.gain.setTargetAtTime(parseFloat(e.target.value), t, 0.05);
        }
    });
    els.scopeScrub.addEventListener('input', (e) => {
        const idx = parseInt(e.target.value, 10);
        scopeIndex = idx;
        if (scopeBuffers[idx]) drawScope(scopeBuffers[idx], { showEnergy: true });
    });
    els.speedTemp.addEventListener('input', updateExpectedSpeed);

    els.spectrumCanvas.addEventListener('mousemove', (e) => {
        const rect = els.spectrumCanvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const nyquist = sampleRate / 2;
        hoverFreq = Math.min(nyquist, Math.max(0, (x / rect.width) * nyquist));
    });
    els.spectrumCanvas.addEventListener('mouseleave', () => {
        hoverFreq = null;
    });

    if (navigator.mediaDevices?.getUserMedia) {
        enumerateDevices();
    } else {
        setStatus('Mic unsupported', false);
    }

    updateExpectedSpeed();
})();
