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
        spectrumCanvas: document.getElementById('spectrum-canvas'),
        historyCanvas: document.getElementById('history-canvas'),
        btnFreeze: document.getElementById('btn-freeze'),
        btnClearHistory: document.getElementById('btn-clear-history'),
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

    // Sonar
    let sonarListening = false;
    let sonarStartTime = 0;
    let sonarIgnoreUntil = 0;
    let sonarDetected = false;
    const baseSpeed = () => {
        const t = parseFloat(els.speedTemp.value) || 0;
        return 331.4 + 0.6 * t;
    };

    // Acoustic stopwatch
    let speedListening = false;
    let clapTimes = [];
    let lastClapTime = 0;

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
        // Basic autocorrelation: returns freq + confidence
        const SIZE = buffer.length;
        let rms = 0;
        for (let i = 0; i < SIZE; i++) {
            rms += buffer[i] * buffer[i];
        }
        rms = Math.sqrt(rms / SIZE);
        if (rms < 0.01) return { freq: null, confidence: rms };

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
        const confidence = maxval / c[0];
        return { freq, confidence: confidence.toFixed(2) };
    }

    function drawScope(buffer, opts = {}) {
        const { width, height } = els.scopeCanvas;
        scopeCtx.fillStyle = '#000';
        scopeCtx.fillRect(0, 0, width, height);

        // Shaded energy (area under f(t)^2) when frozen
        if (opts.showEnergy) {
            scopeCtx.fillStyle = 'rgba(208,92,227,0.2)';
            scopeCtx.beginPath();
            const sliceWidth = width / buffer.length;
            let x = 0;
            scopeCtx.moveTo(0, height);
            for (let i = 0; i < buffer.length; i++) {
                const squared = Math.min(1, buffer[i] * buffer[i] * 9); // apply same gain then square
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
        const sliceWidth = width / buffer.length;
        let x = 0;
        const gain = 3; // boost small signals for clearer view
        for (let i = 0; i < buffer.length; i++) {
            const amplified = Math.max(-1, Math.min(1, buffer[i] * gain));
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
        scopeBuffers.push(bufferCopy);
        if (scopeBuffers.length > maxScopeBuffers) scopeBuffers.shift();
        scopeIndex = scopeBuffers.length - 1;
        els.scopeScrub.max = Math.max(scopeBuffers.length - 1, 0);
        els.scopeScrub.value = scopeIndex;

        const amp = calculateAmplitude(bufferCopy);
        els.ampRms.textContent = amp.rms.toFixed(3);
        els.ampPeak.textContent = amp.peak.toFixed(3);
        els.ampDb.textContent = `${amp.db}`;

        const { freq, confidence } = autoCorrelate(bufferCopy, audioCtx.sampleRate);
        currentFreq = freq;
        if (freq) {
            els.freqFundamental.textContent = `${freq.toFixed(1)} Hz`;
            els.freqConfidence.textContent = confidence;
        } else {
            els.freqFundamental.textContent = '-- Hz';
            els.freqConfidence.textContent = amp.rms.toFixed(3);
        }
        handleDoppler(currentFreq);

        const now = audioCtx.currentTime;
        // Sonar echo detection
        if (sonarListening && !sonarDetected && now > sonarIgnoreUntil && amp.peak > 0.35) {
            sonarDetected = true;
            const dt = (now - sonarStartTime) * 1000;
            const distance = (baseSpeed() * (dt / 1000)) / 2;
            els.sonarDelay.textContent = `${dt.toFixed(1)} ms`;
            els.sonarDistance.textContent = `${distance.toFixed(3)} m`;
            els.sonarStatus.textContent = 'Echo detected';
        }

        // Acoustic stopwatch clap detection
        if (speedListening && amp.peak > 0.45 && now - lastClapTime > 0.15) {
            clapTimes.push(now);
            lastClapTime = now;
            if (clapTimes.length === 1) {
                els.speedStatus.textContent = 'First clap captured';
            } else if (clapTimes.length === 2) {
                const dt = (clapTimes[1] - clapTimes[0]) * 1000;
                const dist = parseFloat(els.speedDistance.value) || 0;
                const estimated = dist && dt ? (dist / (dt / 1000)) : 0;
                els.speedDt.textContent = `${dt.toFixed(1)} ms`;
                els.speedEst.textContent = estimated ? `${estimated.toFixed(2)} m/s` : '--';
                els.speedStatus.textContent = 'Done';
                speedListening = false;
            }
        }

        if (!freeze) {
            drawScope(bufferCopy, { showEnergy: false });
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
        sonarIgnoreUntil = t + 0.05;
        els.sonarStatus.textContent = 'Listening for echo...';
        els.sonarDelay.textContent = '-- ms';
        els.sonarDistance.textContent = '-- m';
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
        els.speedStatus.textContent = 'Listening for two claps';
        els.speedDt.textContent = '-- ms';
        els.speedEst.textContent = '-- m/s';
    }

    function resetSpeed() {
        speedListening = false;
        clapTimes = [];
        els.speedStatus.textContent = 'Idle';
        els.speedDt.textContent = '-- ms';
        els.speedEst.textContent = '-- m/s';
    }

    function startTone() {
        if (!audioCtx) {
            startMic().then(startTone);
            return;
        }
        stopTone();
        toneOsc = audioCtx.createOscillator();
        toneGainNode = audioCtx.createGain();
        toneOsc.type = 'sine';
        toneOsc.frequency.value = parseFloat(els.toneSlider.value);
        toneGainNode.gain.value = parseFloat(els.toneGain.value);
        toneOsc.connect(toneGainNode).connect(audioCtx.destination);
        toneOsc.start();
    }

    function stopTone() {
        if (toneOsc) toneOsc.stop();
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
    els.toneSlider.addEventListener('input', (e) => {
        els.toneValue.textContent = e.target.value;
        if (toneOsc) toneOsc.frequency.value = parseFloat(e.target.value);
    });
    els.toneGain.addEventListener('input', (e) => {
        els.toneGainVal.textContent = e.target.value;
        if (toneGainNode) toneGainNode.gain.value = parseFloat(e.target.value);
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
