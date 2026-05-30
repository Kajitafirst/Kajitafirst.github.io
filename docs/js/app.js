/**
 * app.js — Main Application Logic
 *
 * Orchestrates:
 *   - Parameter loading (JSON)
 *   - UI event handling
 *   - Quantum simulation → drum pattern generation
 *   - Audio playback
 *   - Visualization animation
 */

(function () {
    'use strict';

    // ============================================================
    // State
    // ============================================================
    const state = {
        params: null,       // Loaded from params.json: { kick: {N,L,V,on_mps,theta}, ... }
        patterns: {},       // Generated patterns: { kick: number[], ... }
        activeParts: [],    // Currently selected parts
        bpm: 120,
        measures: 4,
        noiseLevel: 0,
        velocity: 0.8,
        isGenerating: false,
        isPlaying: false,
        audioCtx: null,
    };

    // ============================================================
    // DOM Elements
    // ============================================================
    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    let visualizer = null;
    let sequencer = null;

    // ============================================================
    // Initialise
    // ============================================================
    async function init() {
        // Load parameters
        await loadParams();

        // Create visualizer
        visualizer = new CircuitVisualizer(
            $('#circuit-canvas'),
            $('#grid-canvas')
        );

        // Bind UI
        bindUI();

        // Update initial state from UI
        updateActivePartsFromUI();
        updateStatusText('Ready');
    }

    async function loadParams() {
        try {
            const resp = await fetch('data/params.json');
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            state.params = await resp.json();
            console.log('✅ Parameters loaded:', Object.keys(state.params));
        } catch (e) {
            console.error('Failed to load params.json:', e);
            updateStatusText('⚠ パラメータの読み込みに失敗しました');
        }
    }

    // ============================================================
    // UI Binding
    // ============================================================
    function bindUI() {
        // Part toggle buttons
        $$('.part-toggle').forEach(btn => {
            btn.addEventListener('click', () => {
                btn.classList.toggle('active');
                updateActivePartsFromUI();
            });
        });

        // Sliders
        bindSlider('bpm-slider', 'bpm-value', v => { state.bpm = v; return v; });
        bindSlider('measures-slider', 'measures-value', v => { state.measures = v; return v; });
        bindSlider('noise-slider', 'noise-value', v => {
            state.noiseLevel = v / 100 * Math.PI * 0.3;
            return (v / 100).toFixed(2);
        });
        bindSlider('velocity-slider', 'velocity-value', v => {
            state.velocity = v / 100;
            return v;
        });

        // Generate button
        $('#generate-btn').addEventListener('click', handleGenerate);

        // Play / Stop
        $('#play-btn').addEventListener('click', handlePlay);
        $('#stop-btn').addEventListener('click', handleStop);
    }

    function bindSlider(sliderId, valueId, onChange) {
        const slider = $(`#${sliderId}`);
        const valueEl = $(`#${valueId}`);
        slider.addEventListener('input', () => {
            const display = onChange(parseInt(slider.value, 10));
            valueEl.textContent = display;
        });
        // Fire once for initial value
        const display = onChange(parseInt(slider.value, 10));
        valueEl.textContent = display;
    }

    function updateActivePartsFromUI() {
        state.activeParts = [];
        $$('.part-toggle.active').forEach(btn => {
            state.activeParts.push(btn.dataset.part);
        });
    }

    function updateStatusText(text) {
        const el = $('#status-text');
        if (el) el.textContent = text;
    }

    function setStatusActive(active) {
        const dot = $('#status-dot');
        if (dot) {
            dot.classList.toggle('active', active);
        }
    }

    // ============================================================
    // Generation
    // ============================================================
    async function handleGenerate() {
        if (state.isGenerating) return;
        if (!state.params) {
            updateStatusText('⚠ パラメータが読み込まれていません');
            return;
        }
        if (state.activeParts.length === 0) {
            updateStatusText('⚠ パートを1つ以上選択してください');
            return;
        }

        // Stop any playback
        handleStop();

        state.isGenerating = true;
        const btn = $('#generate-btn');
        btn.classList.add('generating');
        btn.innerHTML = '<span class="spinner"></span> Generating...';
        setStatusActive(true);

        // Ensure audio context is created (needs user gesture)
        ensureAudioContext();

        // Reset visualizer
        visualizer.reset();

        state.patterns = {};
        const allEvents = {};
        const totalSteps = state.measures * 16;
        
        visualizer.initGeneration(state.activeParts, totalSteps);

        // Generate pattern for each selected part
        for (const part of state.activeParts) {
            const partConfig = state.params[part];
            if (!partConfig) {
                console.warn(`No params for part: ${part}`);
                continue;
            }

            updateStatusText(`Generating ${part}...`);

            const sim = new PQCSimulator(partConfig);
            const measurePatterns = [];
            const allPartEvents = [];

            // Generate one pattern per measure
            for (let m = 0; m < state.measures; m++) {
                const { pattern, events } = sim.run(state.noiseLevel);
                measurePatterns.push(pattern);
                allPartEvents.push(...events.map(e => ({
                    ...e,
                    step: e.step + m * partConfig.N
                })));
            }

            // Flatten pattern
            const flatPattern = measurePatterns.flat();
            state.patterns[part] = flatPattern;
            allEvents[part] = allPartEvents;

            // Animate this part's generation for ALL measures
            await visualizer.animatePartGeneration(
                part,
                allPartEvents,
                flatPattern,
                0.04 // 40ms per step
            );
        }

        // Set patterns on visualizer
        visualizer.setPatterns(state.patterns, state.activeParts);
        // Store events for playback circuit view
        if (state.activeParts.length > 0 && allEvents[state.activeParts[0]]) {
            visualizer.genEvents = allEvents[state.activeParts[0]];
        }

        // Show playback controls
        $('#playback-controls').style.display = 'flex';

        state.isGenerating = false;
        btn.classList.remove('generating');
        btn.innerHTML = '<span class="btn-icon">⚡</span> Generate';
        setStatusActive(false);
        updateStatusText(`Generated — ${state.activeParts.length} parts × ${state.measures} measures`);
    }

    // ============================================================
    // Playback
    // ============================================================
    function ensureAudioContext() {
        if (!state.audioCtx) {
            state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (state.audioCtx.state === 'suspended') {
            state.audioCtx.resume();
        }
    }

    function handlePlay() {
        if (state.isPlaying) return;
        if (Object.keys(state.patterns).length === 0) return;

        ensureAudioContext();

        state.isPlaying = true;
        const playBtn = $('#play-btn');
        playBtn.classList.add('playing');
        playBtn.textContent = '▶ Playing';
        setStatusActive(true);
        updateStatusText('Playing...');

        sequencer = new DrumSequencer(state.audioCtx);
        visualizer.startPlayback();

        sequencer.start(
            state.patterns,
            state.bpm,
            state.velocity,
            (step) => {
                visualizer.onPlaybackStep(step);
            },
            true // loop
        );
    }

    function handleStop() {
        if (!state.isPlaying && !sequencer) return;

        state.isPlaying = false;

        if (sequencer) {
            sequencer.stop();
            sequencer = null;
        }

        visualizer.stopPlayback();

        const playBtn = $('#play-btn');
        playBtn.classList.remove('playing');
        playBtn.textContent = '▶ Play';
        setStatusActive(false);
        updateStatusText('Stopped');
    }

    // ============================================================
    // Boot
    // ============================================================
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
