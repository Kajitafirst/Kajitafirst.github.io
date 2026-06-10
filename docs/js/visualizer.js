/**
 * visualizer.js — Lightweight Quantum Measurement & Drum Grid Visualizer
 *
 * Two Canvas views:
 *   1. Circuit canvas: A single-observation quantum circuit (3 qubits,
 *      RZ-RX-RZ + CP gates, measure q[0]) drawn statically.
 *      16 measurement results shown as 0/1 with part-colored glow.
 *   2. Grid canvas: drum pattern grid with playback cursor.
 *
 * Performance: No continuous animation loop. Redraws only on state change
 * using a dirty-flag approach with requestAnimationFrame coalescing.
 */

// ============================================================
// Colour Palette (mirrors CSS variables)
// ============================================================
const PART_COLORS = {
    kick:  '#ff3355',
    snare: '#ffaa00',
    tom:   '#00ff66',
    hh:    '#00ddff',
    crash: '#ff44ff',
    ride:  '#4488ff',
};

const PART_LABELS = {
    kick:  'KICK',
    snare: 'SNR',
    tom:   'TOM',
    hh:    'HH',
    crash: 'CRS',
    ride:  'RIDE',
};

// ============================================================
// Circuit Visualizer
// ============================================================
class CircuitVisualizer {
    constructor(circuitCanvas, gridCanvas) {
        this.cCanvas = circuitCanvas;
        this.gCanvas = gridCanvas;
        this.cCtx = circuitCanvas.getContext('2d');
        this.gCtx = gridCanvas.getContext('2d');

        // Generation state
        this.genPartName = '';
        this.genPattern = [];
        this.genTimer = null;
        this.nextMeasureStep = 0;
        this.genOnComplete = null;
        this.measureOffset = 0;

        // Measurement results: { result: 0|1, revealed: boolean }
        this.measureSlots = [];

        // History of generated parts
        this.genPartHistory = [];

        // Playback state
        this.patterns = {};
        this.playbackStep = -1;
        this.activeParts = [];

        // Mode
        this.mode = 'idle'; // 'idle', 'generating', 'ready', 'playing'

        // Dirty flag for efficient redraw
        this._dirty = true;
        this._rafId = null;

        this._resize();
        window.addEventListener('resize', () => {
            this._resize();
            this._requestRedraw();
        });

        // Initial draw
        this._requestRedraw();
    }

    _resize() {
        const dpr = window.devicePixelRatio || 1;

        const cRect = this.cCanvas.parentElement.getBoundingClientRect();
        this.cCanvas.width = cRect.width * dpr;
        this.cCanvas.height = cRect.height * dpr;
        this.cCanvas.style.width = cRect.width + 'px';
        this.cCanvas.style.height = cRect.height + 'px';
        this.cCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.cW = cRect.width;
        this.cH = cRect.height;

        const gRect = this.gCanvas.parentElement.getBoundingClientRect();
        this.gCanvas.width = gRect.width * dpr;
        this.gCanvas.height = gRect.height * dpr;
        this.gCanvas.style.width = gRect.width + 'px';
        this.gCanvas.style.height = gRect.height + 'px';
        this.gCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.gW = gRect.width;
        this.gH = gRect.height;
    }

    // ---- Dirty-flag redraw (no continuous loop) ----
    _requestRedraw() {
        if (this._rafId) return; // already queued
        this._rafId = requestAnimationFrame(() => {
            this._rafId = null;
            this._draw();
        });
    }

    _draw() {
        this._drawCircuitCanvas();
        this._drawGridCanvas();
    }

    destroy() {
        if (this._rafId) cancelAnimationFrame(this._rafId);
        if (this.genTimer) clearInterval(this.genTimer);
    }

    // ============================================================
    // Circuit Canvas Drawing
    // ============================================================
    _drawCircuitCanvas() {
        const ctx = this.cCtx;
        const w = this.cW;
        const h = this.cH;

        // Clear
        ctx.fillStyle = '#060612';
        ctx.fillRect(0, 0, w, h);

        if (this.mode === 'idle') {
            this._drawStaticCircuit(ctx, w, h);
            this._drawIdleMessage(ctx, w, h);
            return;
        }

        if (this.mode === 'generating' || this.mode === 'ready') {
            this._drawGenerationView(ctx, w, h);
        }

        if (this.mode === 'playing') {
            this._drawPlaybackView(ctx, w, h);
        }
    }

    // ---- Draw a single-observation quantum circuit (static) ----
    _drawStaticCircuit(ctx, w, h) {
        const nq = 3;
        const marginL = 50;
        const marginR = 50;
        const marginT = 30;
        const circuitH = h * 0.55;
        const wireSpacing = circuitH / (nq + 1);
        const usableW = w - marginL - marginR;

        // Gate layout for one MPS observation step:
        // Layer: [RZ, RX, RZ] on each qubit → [CP+RX] entanglement → Measure q[0]
        // We show a simplified version: RZ, RX, RZ on wires, then CP, then M

        const gateColumns = [
            { x: 0.08, gates: [{q: 0, label: 'RZ', color: '#4488ff'}, {q: 1, label: 'RZ', color: '#4488ff'}, {q: 2, label: 'RZ', color: '#4488ff'}] },
            { x: 0.19, gates: [{q: 0, label: 'RX', color: '#aa44ff'}, {q: 1, label: 'RX', color: '#aa44ff'}, {q: 2, label: 'RX', color: '#aa44ff'}] },
            { x: 0.30, gates: [{q: 0, label: 'RZ', color: '#4488ff'}, {q: 1, label: 'RZ', color: '#4488ff'}, {q: 2, label: 'RZ', color: '#4488ff'}] },
            { x: 0.43, gates: [{q: 0, label: 'CP', color: '#00cc88', target: 1}] },
            { x: 0.56, gates: [{q: 1, label: 'RX', color: '#aa44ff'}, {q: 1, label: 'CP', color: '#00cc88', target: 2}] },
            { x: 0.69, gates: [{q: 2, label: 'RX', color: '#aa44ff'}, {q: 2, label: 'CP', color: '#00cc88', target: 0}] },
            { x: 0.82, gates: [{q: 0, label: 'RX', color: '#aa44ff'}] },
        ];

        ctx.save();
        ctx.globalAlpha = 0.4;

        // Draw qubit wires
        for (let i = 0; i < nq; i++) {
            const y = marginT + wireSpacing * (i + 1);
            ctx.strokeStyle = 'rgba(100, 120, 255, 0.3)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(marginL, y);
            ctx.lineTo(w - marginR, y);
            ctx.stroke();

            // Qubit labels
            ctx.fillStyle = 'rgba(100, 120, 255, 0.6)';
            ctx.font = '10px "JetBrains Mono", monospace';
            ctx.textAlign = 'right';
            ctx.fillText('q[' + i + ']', marginL - 8, y + 4);
        }

        // Draw gates
        for (const col of gateColumns) {
            const gx = marginL + usableW * col.x;
            for (const gate of col.gates) {
                const gy = marginT + wireSpacing * (gate.q + 1);

                // Box
                ctx.fillStyle = gate.color + '20';
                ctx.strokeStyle = gate.color + '55';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.roundRect(gx - 16, gy - 12, 32, 24, 4);
                ctx.fill();
                ctx.stroke();

                // Label
                ctx.fillStyle = gate.color;
                ctx.font = 'bold 10px "JetBrains Mono", monospace';
                ctx.textAlign = 'center';
                ctx.fillText(gate.label, gx, gy + 4);

                // CP connection line
                if (gate.label === 'CP' && gate.target !== undefined) {
                    const y2 = marginT + wireSpacing * (gate.target + 1);
                    ctx.strokeStyle = gate.color + '44';
                    ctx.lineWidth = 1;
                    ctx.setLineDash([3, 3]);
                    ctx.beginPath();
                    if (gate.target > gate.q) {
                        ctx.moveTo(gx, gy + 12);
                        ctx.lineTo(gx, y2 - 12);
                    } else {
                        // Draw line upwards for CP(2->0)
                        ctx.moveTo(gx, gy - 12);
                        ctx.lineTo(gx, y2 + 12);
                    }
                    ctx.stroke();
                    ctx.setLineDash([]);
                    // Target dot
                    ctx.fillStyle = gate.color + '66';
                    ctx.beginPath();
                    ctx.arc(gx, y2, 3, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
        }

        // Measurement symbol on q[0]
        const mx = marginL + usableW * 0.90;
        const my = marginT + wireSpacing;
        ctx.strokeStyle = 'rgba(0, 229, 255, 0.5)';
        ctx.lineWidth = 1.5;
        // Meter box
        ctx.beginPath();
        ctx.roundRect(mx - 14, my - 14, 28, 28, 4);
        ctx.stroke();
        // Arc
        ctx.beginPath();
        ctx.arc(mx, my + 2, 8, Math.PI, 0, false);
        ctx.stroke();
        // Needle
        ctx.beginPath();
        ctx.moveTo(mx, my + 2);
        ctx.lineTo(mx + 5, my - 7);
        ctx.stroke();
        // Label
        ctx.fillStyle = 'rgba(0, 229, 255, 0.6)';
        ctx.font = 'bold 8px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText('M', mx, my + 22);

        ctx.restore();
    }

    _drawIdleMessage(ctx, w, h) {
        ctx.fillStyle = 'rgba(136, 136, 170, 0.5)';
        ctx.font = '13px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Generate をクリックして量子ドラムパターンを生成', w / 2, h * 0.82);
        ctx.textAlign = 'left';
    }

    // ---- Generation view: circuit + 16 measurement results ----
    _drawGenerationView(ctx, w, h) {
        const partColor = PART_COLORS[this.genPartName] || '#00e5ff';
        const partLabel = PART_LABELS[this.genPartName] || '';

        // Draw circuit in upper portion
        this._drawStaticCircuit(ctx, w, h);

        // Measurement results section (bottom half)
        const resultsY = h * 0.55;
        const resultsH = h - resultsY;
        const N = 16;
        const marginLR = 30;
        const gridW = w - 2 * marginLR;
        const cellW = gridW / N;
        const cellSize = Math.min(cellW * 0.72, resultsH * 0.38, 36);

        // Title
        ctx.fillStyle = partColor;
        ctx.font = 'bold 12px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        if (this.mode === 'generating') {
            ctx.fillText('⚡ ' + partLabel + ' 測定中', w / 2, resultsY + 16);
        } else {
            ctx.fillText('✓ 測定完了', w / 2, resultsY + 16);
            return;
        }

        // Slot center row
        const slotsY = resultsY + resultsH * 0.45;

        // Draw 16 slots
        for (let i = 0; i < N; i++) {
            const cx = marginLR + i * cellW + cellW / 2;
            const cy = slotsY;

            const slot = this.measureSlots[i];
            const isRevealed = slot && slot.revealed;
            const result = slot ? slot.result : null;

            // Step number
            ctx.fillStyle = 'rgba(136, 136, 170, 0.3)';
            ctx.font = '7px "JetBrains Mono", monospace';
            ctx.textAlign = 'center';
            ctx.fillText(String(i + 1), cx, cy - cellSize / 2 - 6);

            if (isRevealed && result === 1) {
                // Glowing active slot
                ctx.save();
                ctx.shadowColor = partColor;
                ctx.shadowBlur = 12;
                ctx.fillStyle = partColor + 'cc';
                ctx.beginPath();
                ctx.roundRect(cx - cellSize / 2, cy - cellSize / 2, cellSize, cellSize, 6);
                ctx.fill();
                ctx.restore();

                // "1" text
                ctx.fillStyle = '#fff';
                ctx.font = 'bold 16px "JetBrains Mono", monospace';
                ctx.textAlign = 'center';
                ctx.fillText('1', cx, cy + 6);

            } else if (isRevealed && result === 0) {
                // Dim slot
                ctx.fillStyle = 'rgba(25, 25, 45, 0.8)';
                ctx.strokeStyle = 'rgba(60, 60, 90, 0.4)';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.roundRect(cx - cellSize / 2, cy - cellSize / 2, cellSize, cellSize, 6);
                ctx.fill();
                ctx.stroke();

                ctx.fillStyle = 'rgba(100, 100, 140, 0.5)';
                ctx.font = '14px "JetBrains Mono", monospace';
                ctx.textAlign = 'center';
                ctx.fillText('0', cx, cy + 5);

            } else {
                // Unrevealed
                ctx.fillStyle = 'rgba(20, 20, 40, 0.5)';
                ctx.strokeStyle = 'rgba(60, 60, 100, 0.2)';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.roundRect(cx - cellSize / 2, cy - cellSize / 2, cellSize, cellSize, 6);
                ctx.fill();
                ctx.stroke();

                ctx.fillStyle = 'rgba(80, 80, 120, 0.2)';
                ctx.font = '12px "JetBrains Mono", monospace';
                ctx.textAlign = 'center';
                ctx.fillText('?', cx, cy + 5);
            }
        }

        // Part legend
        this._drawPartLegend(ctx, w, h);
    }

    _drawPartLegend(ctx, w, h) {
        if (this.genPartHistory.length === 0) return;

        const legendY = h - 16;
        const legendSpacing = 70;
        const startX = w / 2 - ((this.genPartHistory.length - 1) * legendSpacing) / 2;

        for (let i = 0; i < this.genPartHistory.length; i++) {
            const entry = this.genPartHistory[i];
            const x = startX + i * legendSpacing;
            const isCurrent = entry.part === this.genPartName && this.mode === 'generating';

            // Dot
            ctx.fillStyle = isCurrent ? entry.color : entry.color + '66';
            ctx.beginPath();
            ctx.arc(x - 12, legendY, 3, 0, Math.PI * 2);
            ctx.fill();

            // Label
            ctx.fillStyle = isCurrent ? entry.color : 'rgba(136, 136, 170, 0.4)';
            ctx.font = (isCurrent ? 'bold ' : '') + '9px "JetBrains Mono", monospace';
            ctx.textAlign = 'left';
            ctx.fillText(PART_LABELS[entry.part] || entry.part, x - 5, legendY + 3);
        }
    }

    _triggerMeasurement(step) {
        if (step >= this.genPattern.length) return;

        const result = this.genPattern[step];

        // Mark slot as revealed
        if (this.measureSlots[step]) {
            this.measureSlots[step].revealed = true;
            this.measureSlots[step].result = result;
        }

        // Update the DAW grid in real-time
        this.patterns[this.genPartName][this.measureOffset + step] = result;

        this._requestRedraw();
    }

    // ---- Playback view ----
    _drawPlaybackView(ctx, w, h) {
        const parts = this.activeParts;
        const nParts = parts.length;
        if (nParts === 0) return;

        const N = 16;
        const margin = { left: 50, right: 20, top: 30, bottom: 20 };
        const gridW = w - margin.left - margin.right;
        const gridH = h - margin.top - margin.bottom;
        const cellW = gridW / N;
        const rowH = Math.min(gridH / nParts, 40);
        const totalH = rowH * nParts;
        const offsetY = margin.top + (gridH - totalH) / 2;

        // Column headers
        ctx.fillStyle = 'rgba(136, 136, 170, 0.3)';
        ctx.font = '8px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        for (let i = 0; i < N; i++) {
            if (i % 4 === 0) {
                ctx.fillText(String(i + 1), margin.left + i * cellW + cellW / 2, offsetY - 6);
            }
        }

        for (let p = 0; p < nParts; p++) {
            const part = parts[p];
            const color = PART_COLORS[part] || '#888';
            const pattern = this.patterns[part];
            const rowY = offsetY + p * rowH;
            const totalSteps = pattern.length;

            // Part label
            ctx.fillStyle = color;
            ctx.font = 'bold 10px "JetBrains Mono", monospace';
            ctx.textAlign = 'right';
            ctx.fillText(PART_LABELS[part] || part.toUpperCase(), margin.left - 8, rowY + rowH / 2 + 3);

            for (let i = 0; i < N; i++) {
                const measureOffset = this.playbackStep >= 0
                    ? Math.floor(this.playbackStep / N) * N
                    : 0;
                const actualIdx = measureOffset + i;
                const val = actualIdx < totalSteps ? pattern[actualIdx] : 0;
                const stepInPattern = this.playbackStep >= 0 ? (this.playbackStep % N) : -1;
                const isActive = (i === stepInPattern);

                const cx = margin.left + i * cellW + cellW / 2;
                const cy = rowY + rowH / 2;
                const r = Math.min(cellW * 0.3, rowH * 0.3, 8);

                ctx.save();
                if (val === 1) {
                    if (isActive) {
                        ctx.shadowColor = color;
                        ctx.shadowBlur = 14;
                    }
                    ctx.fillStyle = isActive ? color : color + '99';
                } else {
                    ctx.fillStyle = isActive ? 'rgba(60, 60, 100, 0.4)' : 'rgba(35, 35, 60, 0.3)';
                }
                ctx.beginPath();
                ctx.arc(cx, cy, isActive && val === 1 ? r * 1.2 : r, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
            }
        }

        // Playback cursor
        if (this.playbackStep >= 0) {
            const cursorIdx = this.playbackStep % N;
            const cursorX = margin.left + cursorIdx * cellW + cellW / 2;
            ctx.strokeStyle = 'rgba(0, 229, 255, 0.4)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(cursorX, offsetY - 2);
            ctx.lineTo(cursorX, offsetY + totalH + 2);
            ctx.stroke();
        }
    }

    // ============================================================
    // Grid Canvas Drawing
    // ============================================================
    _drawGridCanvas() {
        const ctx = this.gCtx;
        const w = this.gW;
        const h = this.gH;

        // Clear
        ctx.fillStyle = '#060612';
        ctx.fillRect(0, 0, w, h);

        if (this.activeParts.length === 0 || Object.keys(this.patterns).length === 0) {
            ctx.fillStyle = 'rgba(136, 136, 170, 0.4)';
            ctx.font = '13px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('ドラムパターンがここに表示されます', w / 2, h / 2);
            ctx.textAlign = 'left';
            return;
        }

        this._drawDrumGrid(ctx, w, h);
    }

    _drawDrumGrid(ctx, w, h) {
        const parts = this.activeParts;
        const nParts = parts.length;
        if (nParts === 0) return;

        const firstPart = parts[0];
        const totalSteps = this.patterns[firstPart].length;

        const labelWidth = 55;
        const margin = { top: 16, right: 16, bottom: 16, left: labelWidth + 8 };
        const gridW = w - margin.left - margin.right;
        const gridH = h - margin.top - margin.bottom;
        const cellW = gridW / totalSteps;
        const cellH = gridH / nParts;
        const gap = 2;

        // Step numbers
        ctx.fillStyle = 'rgba(136, 136, 170, 0.3)';
        ctx.font = '8px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        for (let s = 0; s < totalSteps; s++) {
            if (s % 4 === 0) {
                const x = margin.left + s * cellW + cellW / 2;
                ctx.fillText(String(s + 1), x, margin.top - 4);
            }
        }

        // Beat separators
        for (let s = 0; s <= totalSteps; s += 4) {
            const x = margin.left + s * cellW;
            ctx.strokeStyle = 'rgba(100, 120, 255, 0.08)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x, margin.top);
            ctx.lineTo(x, margin.top + gridH);
            ctx.stroke();
        }

        // Measure separators
        for (let s = 0; s <= totalSteps; s += 16) {
            const x = margin.left + s * cellW;
            ctx.strokeStyle = 'rgba(100, 120, 255, 0.2)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(x, margin.top);
            ctx.lineTo(x, margin.top + gridH);
            ctx.stroke();
        }

        // Draw cells
        for (let p = 0; p < nParts; p++) {
            const part = parts[p];
            const color = PART_COLORS[part] || '#888';
            const pattern = this.patterns[part];
            const rowY = margin.top + p * cellH;

            // Part label
            ctx.fillStyle = color;
            ctx.font = 'bold 10px "JetBrains Mono", monospace';
            ctx.textAlign = 'right';
            ctx.fillText(PART_LABELS[part] || part.toUpperCase(), labelWidth, rowY + cellH / 2 + 3);
            ctx.textAlign = 'left';

            // Row background
            if (p % 2 === 0) {
                ctx.fillStyle = 'rgba(255, 255, 255, 0.01)';
                ctx.fillRect(margin.left, rowY, gridW, cellH);
            }

            for (let s = 0; s < totalSteps; s++) {
                const x = margin.left + s * cellW + gap / 2;
                const y = rowY + gap / 2;
                const cw = cellW - gap;
                const ch = cellH - gap;

                const isActive = pattern[s] === 1;
                const isPlaying = this.playbackStep >= 0 && s === (this.playbackStep % totalSteps);
                const isCurrent = isActive && isPlaying;

                if (isActive) {
                    ctx.save();
                    if (isCurrent) {
                        ctx.shadowColor = color;
                        ctx.shadowBlur = 16;
                        ctx.fillStyle = color;
                    } else {
                        ctx.fillStyle = color + 'cc';
                    }
                    ctx.beginPath();
                    ctx.roundRect(x, y, cw, ch, 3);
                    ctx.fill();
                    ctx.restore();
                } else {
                    ctx.fillStyle = 'rgba(255, 255, 255, 0.02)';
                    ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
                    ctx.lineWidth = 0.5;
                    ctx.beginPath();
                    ctx.roundRect(x, y, cw, ch, 3);
                    ctx.fill();
                    ctx.stroke();
                }
            }
        }

        // Playback cursor
        if (this.playbackStep >= 0 && this.mode === 'playing') {
            const cursorX = margin.left + (this.playbackStep % totalSteps) * cellW + cellW / 2;
            ctx.save();
            ctx.strokeStyle = 'rgba(0, 229, 255, 0.7)';
            ctx.shadowColor = '#00e5ff';
            ctx.shadowBlur = 8;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(cursorX, margin.top - 4);
            ctx.lineTo(cursorX, margin.top + gridH + 4);
            ctx.stroke();

            ctx.fillStyle = '#00e5ff';
            ctx.beginPath();
            ctx.arc(cursorX, margin.top - 6, 3, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
    }

    // ============================================================
    // Public API
    // ============================================================

    /**
     * Prepare visualizer for a multi-part generation process.
     */
    initGeneration(activeParts, totalSteps) {
        this.mode = 'generating';
        this.activeParts = activeParts;
        this.patterns = {};
        this.genPartHistory = [];
        for (const part of activeParts) {
            this.patterns[part] = new Array(totalSteps).fill(0);
            this.genPartHistory.push({
                part: part,
                color: PART_COLORS[part] || '#888'
            });
        }
        this._requestRedraw();
    }

    /**
     * Start generation animation for a single part (16 steps).
     * Uses setInterval instead of rAF loop for timed reveals.
     * Resolves when all 16 measurements are shown.
     */
    animatePartGeneration(partName, events, pattern, delayPerStep = 0.08, measureOffset = 0) {
        return new Promise(resolve => {
            this.mode = 'generating';
            this.genPartName = partName;
            this.genPattern = pattern;
            this.nextMeasureStep = 0;
            this.genOnComplete = resolve;
            this.measureOffset = measureOffset;

            // Initialize 16 measurement slots
            this.measureSlots = [];
            for (let i = 0; i < 16; i++) {
                this.measureSlots.push({
                    result: null,
                    revealed: false
                });
            }

            this._requestRedraw();

            // Use setInterval to reveal one measurement at a time
            const intervalMs = delayPerStep * 1000;
            if (this.genTimer) clearInterval(this.genTimer);

            this.genTimer = setInterval(() => {
                if (this.nextMeasureStep < this.genPattern.length) {
                    this._triggerMeasurement(this.nextMeasureStep);
                    this.nextMeasureStep++;
                } else {
                    // All measurements done — wait a brief moment then complete
                    clearInterval(this.genTimer);
                    this.genTimer = null;
                    setTimeout(() => {
                        if (this.genOnComplete) {
                            const fn = this.genOnComplete;
                            this.genOnComplete = null;
                            fn();
                        }
                    }, 200);
                }
            }, intervalMs);
        });
    }

    /**
     * Set patterns and switch to "ready" mode.
     */
    setPatterns(patterns, activeParts) {
        this.patterns = patterns;
        this.activeParts = activeParts;
        this.mode = 'ready';
        this.playbackStep = -1;
        this._requestRedraw();
    }

    /**
     * Called on each playback step.
     */
    onPlaybackStep(step) {
        this.playbackStep = step;
        this._requestRedraw();
    }

    startPlayback() {
        this.mode = 'playing';
        this._requestRedraw();
    }

    stopPlayback() {
        this.mode = 'ready';
        this.playbackStep = -1;
        this._requestRedraw();
    }

    reset() {
        this.mode = 'idle';
        this.patterns = {};
        this.activeParts = [];
        this.playbackStep = -1;
        this.measureSlots = [];
        this.genPartHistory = [];
        this.genPattern = [];
        if (this.genTimer) {
            clearInterval(this.genTimer);
            this.genTimer = null;
        }
        this._requestRedraw();
    }
}

// Export
window.CircuitVisualizer = CircuitVisualizer;
