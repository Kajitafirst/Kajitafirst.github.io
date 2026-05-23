/**
 * audio-engine.js — Web Audio API Drum Synthesizer & Sequencer
 *
 * Provides synthesized drum sounds for 6 parts:
 *   kick, snare, tom, hh (hi-hat), crash, ride
 *
 * Uses oscillator + noise synthesis (no external samples needed).
 * Lookahead scheduling ensures tight timing even during heavy rendering.
 */

// ============================================================
// Noise Buffer (shared, created once)
// ============================================================
let _noiseBuffer = null;

function getNoiseBuffer(ctx) {
    if (_noiseBuffer && _noiseBuffer.sampleRate === ctx.sampleRate) return _noiseBuffer;
    const length = ctx.sampleRate * 2; // 2 seconds of noise
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
        data[i] = Math.random() * 2 - 1;
    }
    _noiseBuffer = buffer;
    return buffer;
}

// ============================================================
// Drum Synthesizer
// ============================================================
class DrumSynth {
    constructor(ctx) {
        this.ctx = ctx;
        // Master compressor for glue
        this.compressor = ctx.createDynamicsCompressor();
        this.compressor.threshold.value = -12;
        this.compressor.knee.value = 6;
        this.compressor.ratio.value = 4;
        this.compressor.attack.value = 0.003;
        this.compressor.release.value = 0.15;
        this.compressor.connect(ctx.destination);
    }

    /**
     * Create a noise source node at the given time.
     */
    _noise(time, duration) {
        const source = this.ctx.createBufferSource();
        source.buffer = getNoiseBuffer(this.ctx);
        // Random offset so it doesn't sound identical each time
        source.playbackRate.value = 1;
        source.start(time, Math.random() * 1.5, duration);
        return source;
    }

    /**
     * Kick drum: sine wave pitch sweep + click transient
     */
    kick(time, velocity = 0.8) {
        const ctx = this.ctx;
        const v = velocity;

        // Body oscillator
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(160, time);
        osc.frequency.exponentialRampToValueAtTime(38, time + 0.12);

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(v * 1.0, time);
        gain.gain.setValueAtTime(v * 0.9, time + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, time + 0.45);

        osc.connect(gain);
        gain.connect(this.compressor);
        osc.start(time);
        osc.stop(time + 0.45);

        // Click transient
        const click = ctx.createOscillator();
        click.type = 'sine';
        click.frequency.setValueAtTime(900, time);
        click.frequency.exponentialRampToValueAtTime(150, time + 0.015);

        const clickGain = ctx.createGain();
        clickGain.gain.setValueAtTime(v * 0.65, time);
        clickGain.gain.exponentialRampToValueAtTime(0.001, time + 0.04);

        click.connect(clickGain);
        clickGain.connect(this.compressor);
        click.start(time);
        click.stop(time + 0.04);
    }

    /**
     * Snare drum: noise burst + body tone
     */
    snare(time, velocity = 0.8) {
        const ctx = this.ctx;
        const v = velocity;

        // Noise component
        const noise = this._noise(time, 0.18);
        const noiseHP = ctx.createBiquadFilter();
        noiseHP.type = 'highpass';
        noiseHP.frequency.value = 2000;

        const noiseBP = ctx.createBiquadFilter();
        noiseBP.type = 'bandpass';
        noiseBP.frequency.value = 5000;
        noiseBP.Q.value = 0.8;

        const noiseGain = ctx.createGain();
        noiseGain.gain.setValueAtTime(v * 0.7, time);
        noiseGain.gain.exponentialRampToValueAtTime(0.001, time + 0.18);

        noise.connect(noiseHP);
        noiseHP.connect(noiseBP);
        noiseBP.connect(noiseGain);
        noiseGain.connect(this.compressor);

        // Body tone
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(220, time);
        osc.frequency.exponentialRampToValueAtTime(120, time + 0.06);

        const oscGain = ctx.createGain();
        oscGain.gain.setValueAtTime(v * 0.45, time);
        oscGain.gain.exponentialRampToValueAtTime(0.001, time + 0.1);

        osc.connect(oscGain);
        oscGain.connect(this.compressor);
        osc.start(time);
        osc.stop(time + 0.1);
    }

    /**
     * Tom: medium-frequency sine with pitch envelope
     */
    tom(time, velocity = 0.8) {
        const ctx = this.ctx;
        const v = velocity;

        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(180, time);
        osc.frequency.exponentialRampToValueAtTime(80, time + 0.15);

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(v * 0.8, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + 0.3);

        osc.connect(gain);
        gain.connect(this.compressor);
        osc.start(time);
        osc.stop(time + 0.3);
    }

    /**
     * Hi-hat: filtered noise, very short decay
     */
    hh(time, velocity = 0.8) {
        const ctx = this.ctx;
        const v = velocity;

        const noise = this._noise(time, 0.08);

        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 7000;

        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 10000;
        bp.Q.value = 1.2;

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(v * 0.35, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + 0.06);

        noise.connect(hp);
        hp.connect(bp);
        bp.connect(gain);
        gain.connect(this.compressor);
    }

    /**
     * Crash cymbal: broadband noise with longer decay
     */
    crash(time, velocity = 0.8) {
        const ctx = this.ctx;
        const v = velocity;

        const noise = this._noise(time, 1.2);

        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 4000;

        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 8000;
        bp.Q.value = 0.5;

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(v * 0.45, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + 1.0);

        noise.connect(hp);
        hp.connect(bp);
        bp.connect(gain);
        gain.connect(this.compressor);
    }

    /**
     * Ride cymbal: tighter than crash with some tone
     */
    ride(time, velocity = 0.8) {
        const ctx = this.ctx;
        const v = velocity;

        // Noise
        const noise = this._noise(time, 0.6);

        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 6000;

        const noiseGain = ctx.createGain();
        noiseGain.gain.setValueAtTime(v * 0.28, time);
        noiseGain.gain.exponentialRampToValueAtTime(0.001, time + 0.5);

        noise.connect(hp);
        hp.connect(noiseGain);
        noiseGain.connect(this.compressor);

        // Ping tone
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = 3500;

        const oscGain = ctx.createGain();
        oscGain.gain.setValueAtTime(v * 0.08, time);
        oscGain.gain.exponentialRampToValueAtTime(0.001, time + 0.3);

        osc.connect(oscGain);
        oscGain.connect(this.compressor);
        osc.start(time);
        osc.stop(time + 0.3);
    }
}

// ============================================================
// Drum Sequencer (lookahead scheduling)
// ============================================================
class DrumSequencer {
    constructor(audioContext) {
        this.ctx = audioContext;
        this.synth = new DrumSynth(audioContext);
        this.isPlaying = false;
        this.currentStep = -1;
        this.totalSteps = 0;
        this.patterns = {};
        this.bpm = 120;
        this.velocity = 0.8;
        this.onStep = null; // callback(stepIndex)
        this.onEnd = null;  // callback()
        this.loop = true;

        // Scheduling internals
        this._lookaheadMs = 25;
        this._scheduleAheadTime = 0.08; // seconds
        this._nextStepTime = 0;
        this._timerId = null;
    }

    /**
     * Start playback.
     * @param {Object} patterns - { partName: number[] } flat arrays of 0/1
     * @param {number} bpm
     * @param {number} velocity - 0..1
     * @param {Function} onStep - callback(stepIndex)
     * @param {boolean} loop
     */
    start(patterns, bpm, velocity, onStep, loop = true) {
        this.stop();

        this.patterns = patterns;
        this.bpm = bpm;
        this.velocity = velocity;
        this.onStep = onStep;
        this.loop = loop;
        this.isPlaying = true;
        this.currentStep = 0;

        // Determine total steps from first pattern
        const firstKey = Object.keys(patterns)[0];
        this.totalSteps = patterns[firstKey].length;
        this._nextStepTime = this.ctx.currentTime + 0.05; // small initial delay

        this._schedule();
    }

    _schedule() {
        if (!this.isPlaying) return;

        const stepDuration = 60.0 / this.bpm / 4; // 16th note

        while (this._nextStepTime < this.ctx.currentTime + this._scheduleAheadTime) {
            if (this.currentStep >= this.totalSteps) {
                if (this.loop) {
                    this.currentStep = 0;
                } else {
                    this.isPlaying = false;
                    if (this.onEnd) this.onEnd();
                    return;
                }
            }

            this._playStep(this.currentStep, this._nextStepTime);

            // Fire callback (use setTimeout for UI timing)
            const step = this.currentStep;
            const delay = Math.max(0, (this._nextStepTime - this.ctx.currentTime) * 1000);
            setTimeout(() => {
                if (this.onStep) this.onStep(step);
            }, delay);

            this.currentStep++;
            this._nextStepTime += stepDuration;
        }

        this._timerId = setTimeout(() => this._schedule(), this._lookaheadMs);
    }

    _playStep(step, time) {
        for (const [part, pattern] of Object.entries(this.patterns)) {
            if (pattern[step] === 1) {
                if (typeof this.synth[part] === 'function') {
                    this.synth[part](time, this.velocity);
                }
            }
        }
    }

    stop() {
        this.isPlaying = false;
        this.currentStep = -1;
        if (this._timerId !== null) {
            clearTimeout(this._timerId);
            this._timerId = null;
        }
    }
}

// Export
window.DrumSynth = DrumSynth;
window.DrumSequencer = DrumSequencer;
