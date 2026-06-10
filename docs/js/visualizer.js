/**
 * visualizer.js — Quantum Measurement & Drum Grid Visualizer
 *
 * Two Canvas views:
 *   1. Circuit canvas: 16-slot quantum measurement display with
 *      background circuit diagram. Results appear in real-time,
 *      "1" results glow with the current part's color.
 *   2. Grid canvas: drum pattern grid with scrolling playback cursor,
 *      cells fill in real-time during generation.
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
// Particle system (lightweight — used only for measurement bursts)
// ============================================================
class Particle {
    constructor(x, y, color, size, vx, vy, life) {
        this.x = x;
        this.y = y;
        this.color = color;
        this.size = size;
        this.vx = vx;
        this.vy = vy;
        this.life = life;
        this.maxLife = life;
    }

    update(dt) {
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        this.life -= dt;
        this.vx *= 0.96;
        this.vy *= 0.96;
    }

    draw(ctx) {
        const alpha = Math.max(0, this.life / this.maxLife);
        const s = this.size * (0.5 + 0.5 * alpha);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.shadowColor = this.color;
        ctx.shadowBlur = 10;
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(this.x, this.y, s, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    get alive() { return this.life > 0; }
}

// ============================================================
// Background Star Field
// ============================================================
class StarField {
    constructor(count = 80) {
        this.stars = [];
        for (let i = 0; i < count; i++) {
            this.stars.push({
                x: Math.random(),
                y: Math.random(),
                size: Math.random() * 1.5 + 0.3,
                speed: Math.random() * 0.005 + 0.001,
                alpha: Math.random() * 0.4 + 0.1,
            });
        }
    }

    draw(ctx, w, h) {
        for (const s of this.stars) {
            s.x -= s.speed;
            if (s.x < 0) { s.x = 1; s.y = Math.random(); }
            ctx.save();
            ctx.globalAlpha = s.alpha;
            ctx.fillStyle = '#aabbff';
            ctx.beginPath();
            ctx.arc(s.x * w, s.y * h, s.size, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
    }
}

// ============================================================
// Circuit Visualizer
// ============================================================
class CircuitVisualizer {
    constructor(circuitCanvas, gridCanvas) {
        this.cCanvas = circuitCanvas;
        this.gCanvas = gridCanvas;
        this.cCtx = circuitCanvas.getContext('2d');
        this.gCtx = gridCanvas.getContext('2d');

        this.particles = [];
        this.starField = new StarField(60);
        this.gridStarField = new StarField(40);

        // Generation state
        this.genPartName = '';
        this.genPattern = [];        // target pattern for current part (16 values)
        this.genTime = 0;            // current continuous time in generation
        this.genStepDuration = 0.08; // seconds per step
        this.nextMeasureStep = 0;    // next step index to trigger measurement
        this.genOnComplete = null;

        // Measurement results for the current part's animation
        // Each entry: { result: 0|1, age: number, revealed: boolean }
        this.measureSlots = [];

        // History of all generated parts (for display during generation)
        this.genPartHistory = [];    // [{ part, color }]

        // Playback state
        this.patterns = {};        // { part: number[] } flat arrays
        this.playbackStep = -1;
        this.activeParts = [];     // ordered list of part names

        // Layout
        this.nQubits = 3;

        // Animation
        this._animFrame = null;
        this._lastTime = 0;
        this.mode = 'idle'; // 'idle', 'generating', 'ready', 'playing'

        // Background circuit animation phase
        this._circuitPhase = 0;

        this._resize();
        window.addEventListener('resize', () => this._resize());
        this._loop(0);
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

    // ---- Main animation loop ----
    _loop(timestamp) {
        const dt = Math.min((timestamp - this._lastTime) / 1000, 0.05);
        this._lastTime = timestamp;

        this._circuitPhase += dt * 0.5;

        this._drawCircuitCanvas(dt);
        this._drawGridCanvas(dt);

        // Update generating logic
        if (this.mode === 'generating') {
            this.genTime += dt;

            // Reveal measurement results one by one
            while (this.nextMeasureStep < this.genPattern.length) {
                const stepArrivalTime = this.nextMeasureStep * this.genStepDuration;
                if (this.genTime >= stepArrivalTime) {
                    this._triggerMeasurement(this.nextMeasureStep);
                    this.nextMeasureStep++;
                } else {
                    break;
                }
            }

            // Check if part generation is complete
            const endTime = this.genPattern.length * this.genStepDuration + 0.6;
            if (this.genTime >= endTime && this.genOnComplete) {
                const completeFn = this.genOnComplete;
                this.genOnComplete = null;
                completeFn();
            }
        }

        // Update particles
        this.particles = this.particles.filter(p => p.alive);
        this.particles.forEach(p => p.update(dt));

        // Age measurement slots
        for (const slot of this.measureSlots) {
            if (slot.revealed) {
                slot.age += dt;
            }
        }

        this._animFrame = requestAnimationFrame((t) => this._loop(t));
    }

    destroy() {
        if (this._animFrame) cancelAnimationFrame(this._animFrame);
    }

    // ============================================================
    // Circuit Canvas Drawing
    // ============================================================
    _drawCircuitCanvas(dt) {
        const ctx = this.cCtx;
        const w = this.cW;
        const h = this.cH;

        // Clear
        ctx.fillStyle = 'rgba(6, 6, 18, 0.92)';
        ctx.fillRect(0, 0, w, h);

        // Stars
        this.starField.draw(ctx, w, h);

        if (this.mode === 'idle') {
            this._drawIdleCircuit(ctx, w, h, dt);
            return;
        }

        if (this.mode === 'generating' || this.mode === 'ready') {
            this._drawMeasurementView(ctx, w, h, dt);
        }

        if (this.mode === 'playing') {
            this._drawPlaybackCircuit(ctx, w, h, dt);
        }

        // Draw particles
        for (const p of this.particles) {
            if (p.y < h) p.draw(ctx);
        }
    }

    _drawIdleCircuit(ctx, w, h, dt) {
        // Draw subtle background circuit
        this._drawBackgroundCircuit(ctx, w, h, 0.15);

        // Center text
        ctx.fillStyle = 'rgba(136, 136, 170, 0.6)';
        ctx.font = '14px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Generate をクリックして量子ドラムパターンを生成', w / 2, h / 2);
        ctx.textAlign = 'left';
    }

    // ---- Background circuit diagram (static, decorative) ----
    _drawBackgroundCircuit(ctx, w, h, opacity) {
        const nq = 3;
        const margin = 60;
        const wireSpacing = (h - 2 * margin) / (nq + 1);
        const phase = this._circuitPhase;

        ctx.save();
        ctx.globalAlpha = opacity;

        // Draw qubit wires
        for (let i = 0; i < nq; i++) {
            const y = margin + wireSpacing * (i + 1);
            const grad = ctx.createLinearGradient(margin, y, w - margin, y);
            grad.addColorStop(0, 'rgba(100, 120, 255, 0.03)');
            grad.addColorStop(0.5, 'rgba(100, 120, 255, 0.15)');
            grad.addColorStop(1, 'rgba(100, 120, 255, 0.03)');
            ctx.strokeStyle = grad;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(margin, y);
            ctx.lineTo(w - margin, y);
            ctx.stroke();

            // Qubit label
            ctx.fillStyle = 'rgba(100, 120, 255, 0.35)';
            ctx.font = '10px "JetBrains Mono", monospace';
            ctx.textAlign = 'left';
            ctx.fillText('q[' + i + ']', 16, y + 4);
        }

        // Draw a few sparse decorative gate blocks (only 5)
        const gates = [
            { type: 'RZ', qubit: 0, pos: 0.18, color: '#4488ff' },
            { type: 'RX', qubit: 1, pos: 0.35, color: '#aa44ff' },
            { type: 'CP', qubit: 0, target: 1, pos: 0.52, color: '#00cc88' },
            { type: 'RZ', qubit: 2, pos: 0.68, color: '#4488ff' },
            { type: 'RX', qubit: 0, pos: 0.82, color: '#aa44ff' },
        ];
        const usableW = w - 2 * margin;

        for (const gate of gates) {
            const gx = margin + usableW * gate.pos;
            const gy = margin + wireSpacing * (gate.qubit + 1);
            const color = gate.color;
            const pulse = 0.35 + 0.15 * Math.sin(phase * 1.5 + gate.pos * 8);

            // Gate box — larger for readability
            ctx.fillStyle = color + '12';
            ctx.strokeStyle = color + '33';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.roundRect(gx - 18, gy - 13, 36, 26, 5);
            ctx.fill();
            ctx.stroke();

            // Gate label
            ctx.fillStyle = color;
            ctx.globalAlpha = opacity * pulse;
            ctx.font = 'bold 11px "JetBrains Mono", monospace';
            ctx.textAlign = 'center';
            ctx.fillText(gate.type, gx, gy + 4);
            ctx.globalAlpha = opacity;

            // CP connection line
            if (gate.type === 'CP' && gate.target !== undefined) {
                const y2 = margin + wireSpacing * (gate.target + 1);
                ctx.strokeStyle = color + '22';
                ctx.lineWidth = 1;
                ctx.setLineDash([3, 3]);
                ctx.beginPath();
                ctx.moveTo(gx, gy + 13);
                ctx.lineTo(gx, y2 - 13);
                ctx.stroke();
                ctx.setLineDash([]);

                // Target dot
                ctx.fillStyle = color + '44';
                ctx.beginPath();
                ctx.arc(gx, y2, 4, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        // Measurement symbol at the right (only on q[0])
        const my = margin + wireSpacing;
        const mx = w - margin - 15;
        ctx.strokeStyle = 'rgba(0, 229, 255, 0.25)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(mx, my, 10, Math.PI, 0, false);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(mx, my);
        ctx.lineTo(mx + 5, my - 9);
        ctx.stroke();

        // "M" label
        ctx.fillStyle = 'rgba(0, 229, 255, 0.2)';
        ctx.font = '8px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText('M', mx, my + 16);

        ctx.restore();
    }

    // ---- Main generation view: 16 measurement slots ----
    _drawMeasurementView(ctx, w, h, dt) {
        // Draw background circuit at low opacity
        this._drawBackgroundCircuit(ctx, w, h, 0.1);

        const partColor = PART_COLORS[this.genPartName] || '#00e5ff';
        const partLabel = PART_LABELS[this.genPartName] || this.genPartName.toUpperCase();

        const N = 16;
        const margin = { left: 40, right: 40, top: 60, bottom: 80 };
        const gridW = w - margin.left - margin.right;
        const gridH = h - margin.top - margin.bottom;
        const cellW = gridW / N;
        const cellSize = Math.min(cellW * 0.75, gridH * 0.55, 50);

        // Title: which part is being generated
        ctx.save();
        ctx.fillStyle = partColor;
        ctx.font = 'bold 13px "JetBrains Mono", Inter, sans-serif';
        ctx.textAlign = 'center';
        const titleText = this.mode === 'generating'
            ? '⚡ ' + partLabel + ' を量子測定中...'
            : '✓ 量子測定完了';
        ctx.fillText(titleText, w / 2, margin.top - 25);
        ctx.restore();

        // Draw "QUANTUM MEASUREMENT" label
        ctx.fillStyle = 'rgba(136, 136, 170, 0.3)';
        ctx.font = '9px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText('QUANTUM MEASUREMENT RESULTS', w / 2, margin.top - 8);

        // Center of the slot row
        const centerY = margin.top + gridH * 0.4;

        // Draw 16 measurement slots
        for (let i = 0; i < N; i++) {
            const cx = margin.left + i * cellW + cellW / 2;
            const cy = centerY;

            const slot = this.measureSlots[i];
            const isRevealed = slot && slot.revealed;
            const result = slot ? slot.result : null;
            const age = slot ? slot.age : 0;

            // Step number at top
            ctx.fillStyle = 'rgba(136, 136, 170, 0.3)';
            ctx.font = '8px "JetBrains Mono", monospace';
            ctx.textAlign = 'center';
            ctx.fillText(String(i + 1), cx, cy - cellSize / 2 - 12);

            // Slot background
            ctx.save();
            if (isRevealed && result === 1) {
                // Glowing slot for result = 1
                const glowIntensity = Math.max(0.4, 1 - age * 0.6);
                ctx.shadowColor = partColor;
                ctx.shadowBlur = 25 * glowIntensity;
                ctx.fillStyle = partColor + (glowIntensity > 0.7 ? 'dd' : '88');
                ctx.beginPath();
                ctx.roundRect(cx - cellSize / 2, cy - cellSize / 2, cellSize, cellSize, 8);
                ctx.fill();

                // Inner glow ring
                ctx.strokeStyle = partColor;
                ctx.lineWidth = 2;
                ctx.globalAlpha = glowIntensity * 0.6;
                ctx.beginPath();
                ctx.roundRect(cx - cellSize / 2 - 3, cy - cellSize / 2 - 3, cellSize + 6, cellSize + 6, 10);
                ctx.stroke();
                ctx.globalAlpha = 1;
            } else if (isRevealed && result === 0) {
                // Dim slot for result = 0
                ctx.fillStyle = 'rgba(30, 30, 55, 0.7)';
                ctx.strokeStyle = 'rgba(80, 80, 120, 0.3)';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.roundRect(cx - cellSize / 2, cy - cellSize / 2, cellSize, cellSize, 8);
                ctx.fill();
                ctx.stroke();
            } else {
                // Unrevealed — waiting state
                const waitPulse = 0.03 + 0.02 * Math.sin(this._circuitPhase * 3 + i * 0.4);
                ctx.fillStyle = 'rgba(255, 255, 255,' + waitPulse + ')';
                ctx.strokeStyle = 'rgba(100, 120, 255, 0.1)';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.roundRect(cx - cellSize / 2, cy - cellSize / 2, cellSize, cellSize, 8);
                ctx.fill();
                ctx.stroke();

                // Question mark
                ctx.fillStyle = 'rgba(100, 120, 255, 0.15)';
                ctx.font = 'bold 16px "JetBrains Mono", monospace';
                ctx.textAlign = 'center';
                ctx.fillText('?', cx, cy + 6);
            }
            ctx.restore();

            // Draw the result number
            if (isRevealed) {
                ctx.save();
                const fadeIn = Math.min(1, age * 5); // quick fade-in
                ctx.globalAlpha = fadeIn;

                if (result === 1) {
                    ctx.fillStyle = '#ffffff';
                    ctx.shadowColor = partColor;
                    ctx.shadowBlur = 12;
                    ctx.font = 'bold 22px "JetBrains Mono", monospace';
                } else {
                    ctx.fillStyle = 'rgba(120, 120, 160, 0.6)';
                    ctx.font = '18px "JetBrains Mono", monospace';
                }
                ctx.textAlign = 'center';
                ctx.fillText(String(result), cx, cy + 7);
                ctx.restore();
            }
        }

        // Draw part legend at the bottom showing generated parts
        this._drawPartLegend(ctx, w, h, margin);

        // Draw a progress bar under the slots during generation
        if (this.mode === 'generating' && this.genPattern.length > 0) {
            const revealedCount = this.measureSlots.filter(s => s.revealed).length;
            const progress = revealedCount / this.genPattern.length;
            const barY = centerY + cellSize / 2 + 20;
            const barW = gridW * 0.6;
            const barH = 3;
            const barX = w / 2 - barW / 2;

            // Track
            ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
            ctx.beginPath();
            ctx.roundRect(barX, barY, barW, barH, 2);
            ctx.fill();

            // Progress
            ctx.save();
            ctx.shadowColor = partColor;
            ctx.shadowBlur = 8;
            ctx.fillStyle = partColor;
            ctx.beginPath();
            ctx.roundRect(barX, barY, barW * progress, barH, 2);
            ctx.fill();
            ctx.restore();
        }
    }

    _drawPartLegend(ctx, w, h, margin) {
        if (this.genPartHistory.length === 0) return;

        const legendY = h - margin.bottom + 30;
        const legendSpacing = 80;
        const startX = w / 2 - ((this.genPartHistory.length - 1) * legendSpacing) / 2;

        for (let i = 0; i < this.genPartHistory.length; i++) {
            const entry = this.genPartHistory[i];
            const x = startX + i * legendSpacing;
            const isCurrent = entry.part === this.genPartName && this.mode === 'generating';

            // Dot
            ctx.save();
            if (isCurrent) {
                ctx.shadowColor = entry.color;
                ctx.shadowBlur = 10;
            }
            ctx.fillStyle = isCurrent ? entry.color : entry.color + '88';
            ctx.beginPath();
            ctx.arc(x - 14, legendY, 4, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();

            // Label
            ctx.fillStyle = isCurrent ? entry.color : 'rgba(136, 136, 170, 0.5)';
            ctx.font = (isCurrent ? 'bold ' : '') + '10px "JetBrains Mono", monospace';
            ctx.textAlign = 'left';
            ctx.fillText(PART_LABELS[entry.part] || entry.part, x - 6, legendY + 3);
        }
    }

    _triggerMeasurement(step) {
        if (step >= this.genPattern.length) return;

        const result = this.genPattern[step];

        // Mark slot as revealed
        if (this.measureSlots[step]) {
            this.measureSlots[step].revealed = true;
            this.measureSlots[step].result = result;
            this.measureSlots[step].age = 0;
        }

        // Update the DAW grid in real-time
        this.patterns[this.genPartName][step] = result;

        // Spawn particles for result = 1
        if (result === 1) {
            const N = 16;
            const margin = { left: 40, right: 40, top: 60 };
            const gridW = this.cW - margin.left - margin.right;
            const cellW = gridW / N;
            const cx = margin.left + step * cellW + cellW / 2;
            const gridH = this.cH - margin.top - 80;
            const cy = margin.top + gridH * 0.4;
            const color = PART_COLORS[this.genPartName] || '#00e5ff';

            for (let p = 0; p < 12; p++) {
                const angle = Math.random() * Math.PI * 2;
                const speed = 30 + Math.random() * 80;
                this.particles.push(new Particle(
                    cx, cy, color,
                    1.5 + Math.random() * 2,
                    Math.cos(angle) * speed,
                    Math.sin(angle) * speed,
                    0.4 + Math.random() * 0.4
                ));
            }
        }
    }

    _drawPlaybackCircuit(ctx, w, h, dt) {
        // During playback, show all parts' measurement results in a compact grid
        const parts = this.activeParts;
        const nParts = parts.length;
        if (nParts === 0) return;

        // Background circuit at very low opacity
        this._drawBackgroundCircuit(ctx, w, h, 0.06);

        const N = 16;
        const margin = { left: 50, right: 30, top: 40, bottom: 30 };
        const gridW = w - margin.left - margin.right;
        const gridH = h - margin.top - margin.bottom;
        const cellW = gridW / N;
        const rowH = gridH / nParts;

        // Column headers
        ctx.fillStyle = 'rgba(136, 136, 170, 0.3)';
        ctx.font = '8px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        for (let i = 0; i < N; i++) {
            if (i % 4 === 0) {
                ctx.fillText(String(i + 1), margin.left + i * cellW + cellW / 2, margin.top - 6);
            }
        }

        for (let p = 0; p < nParts; p++) {
            const part = parts[p];
            const color = PART_COLORS[part] || '#888';
            const pattern = this.patterns[part];
            const rowY = margin.top + p * rowH;

            // Part label
            ctx.fillStyle = color;
            ctx.font = 'bold 10px "JetBrains Mono", monospace';
            ctx.textAlign = 'right';
            ctx.fillText(PART_LABELS[part] || part.toUpperCase(), margin.left - 8, rowY + rowH / 2 + 3);
            ctx.textAlign = 'left';

            // Draw measurement circles
            for (let i = 0; i < N; i++) {
                const totalSteps = pattern.length;
                const stepInPattern = this.playbackStep >= 0
                    ? (this.playbackStep % totalSteps)
                    : -1;
                const measureIdx = i % N;
                // Get the value for the current measure being played
                const measureOffset = this.playbackStep >= 0
                    ? Math.floor(this.playbackStep / N) * N
                    : 0;
                const actualIdx = measureOffset + measureIdx;
                const val = actualIdx < totalSteps ? pattern[actualIdx] : 0;
                const isActive = (measureIdx === stepInPattern % N);

                const cx = margin.left + i * cellW + cellW / 2;
                const cy = rowY + rowH / 2;
                const r = Math.min(cellW * 0.32, rowH * 0.32, 10);

                ctx.save();
                if (val === 1) {
                    ctx.shadowColor = color;
                    ctx.shadowBlur = isActive ? 20 : 6;
                    ctx.fillStyle = isActive ? color : color + 'aa';
                } else {
                    ctx.fillStyle = isActive ? 'rgba(60, 60, 100, 0.4)' : 'rgba(40, 40, 70, 0.25)';
                }
                ctx.beginPath();
                ctx.arc(cx, cy, isActive && val === 1 ? r * 1.3 : r, 0, Math.PI * 2);
                ctx.fill();

                // Result text
                if (val === 1) {
                    ctx.fillStyle = '#fff';
                    ctx.font = 'bold ' + (isActive ? '10' : '8') + 'px "JetBrains Mono", monospace';
                    ctx.textAlign = 'center';
                    ctx.fillText('1', cx, cy + (isActive ? 3 : 3));
                }
                ctx.restore();
            }
        }

        // Playback cursor
        if (this.playbackStep >= 0) {
            const cursorIdx = this.playbackStep % N;
            const cursorX = margin.left + cursorIdx * cellW + cellW / 2;
            ctx.save();
            ctx.strokeStyle = 'rgba(0, 229, 255, 0.5)';
            ctx.shadowColor = '#00e5ff';
            ctx.shadowBlur = 10;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(cursorX, margin.top - 2);
            ctx.lineTo(cursorX, margin.top + gridH + 2);
            ctx.stroke();
            ctx.restore();
        }
    }

    // ============================================================
    // Grid Canvas Drawing
    // ============================================================
    _drawGridCanvas(dt) {
        const ctx = this.gCtx;
        const w = this.gW;
        const h = this.gH;

        // Clear
        ctx.fillStyle = 'rgba(6, 6, 18, 0.95)';
        ctx.fillRect(0, 0, w, h);

        this.gridStarField.draw(ctx, w, h);

        if (this.activeParts.length === 0 || Object.keys(this.patterns).length === 0) {
            // Idle state
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

        // Beat separators (every 4 steps)
        for (let s = 0; s <= totalSteps; s += 4) {
            const x = margin.left + s * cellW;
            ctx.strokeStyle = 'rgba(100, 120, 255, 0.08)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x, margin.top);
            ctx.lineTo(x, margin.top + gridH);
            ctx.stroke();
        }

        // Measure separators (every 16 steps)
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

                // Check if this cell was just revealed during generation
                const isCurrentlyGenerating = this.mode === 'generating'
                    && part === this.genPartName;
                const justRevealed = isCurrentlyGenerating
                    && this.measureSlots[s % 16]
                    && this.measureSlots[s % 16].revealed
                    && this.measureSlots[s % 16].age < 0.3;

                if (isActive) {
                    ctx.save();
                    if (isCurrent) {
                        ctx.shadowColor = color;
                        ctx.shadowBlur = 20;
                        ctx.fillStyle = color;
                    } else if (justRevealed) {
                        // Briefly glow when just generated
                        const flashAlpha = 1 - this.measureSlots[s % 16].age / 0.3;
                        ctx.shadowColor = color;
                        ctx.shadowBlur = 16 * flashAlpha;
                        ctx.fillStyle = color;
                    } else {
                        ctx.shadowColor = color;
                        ctx.shadowBlur = 6;
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
            ctx.shadowBlur = 12;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(cursorX, margin.top - 4);
            ctx.lineTo(cursorX, margin.top + gridH + 4);
            ctx.stroke();

            // Cursor head
            ctx.fillStyle = '#00e5ff';
            ctx.beginPath();
            ctx.arc(cursorX, margin.top - 6, 4, 0, Math.PI * 2);
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
    }

    /**
     * Start generation animation for a single part.
     * Shows 16 measurement results appearing one at a time.
     * Resolves when animation for this part is complete.
     */
    animatePartGeneration(partName, events, pattern, delayPerStep = 0.08) {
        return new Promise(resolve => {
            this.mode = 'generating';
            this.genPartName = partName;
            this.genPattern = pattern;  // Only first 16 for one measure
            this.genStepDuration = delayPerStep;
            this.genTime = 0;
            this.nextMeasureStep = 0;
            this.genOnComplete = resolve;

            // Initialize 16 measurement slots for this measure
            this.measureSlots = [];
            for (let i = 0; i < 16; i++) {
                this.measureSlots.push({
                    result: null,
                    age: 0,
                    revealed: false
                });
            }

            // Clear the grid row for this part (fill dynamically)
            this.patterns[partName].fill(0);
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
    }

    /**
     * Called on each playback step.
     */
    onPlaybackStep(step) {
        this.playbackStep = step;

        // Spawn particles on active beats
        if (step >= 0) {
            const totalSteps = this.patterns[this.activeParts[0]]?.length || 0;
            if (totalSteps === 0) return;

            const labelWidth = 63;
            const margin = { left: labelWidth, top: 16, right: 16 };
            const gridW = this.gW - margin.left - margin.right;
            const cellW = gridW / totalSteps;
            const cellH = (this.gH - 32) / this.activeParts.length;

            for (let p = 0; p < this.activeParts.length; p++) {
                const part = this.activeParts[p];
                if (this.patterns[part][step % totalSteps] === 1) {
                    const x = margin.left + (step % totalSteps) * cellW + cellW / 2;
                    const y = margin.top + p * cellH + cellH / 2;
                    const color = PART_COLORS[part];
                    for (let i = 0; i < 4; i++) {
                        const angle = Math.random() * Math.PI * 2;
                        const speed = 20 + Math.random() * 40;
                        this.particles.push(new Particle(
                            x, y, color, 1 + Math.random() * 1.5,
                            Math.cos(angle) * speed, Math.sin(angle) * speed,
                            0.3 + Math.random() * 0.3
                        ));
                    }
                }
            }
        }
    }

    startPlayback() {
        this.mode = 'playing';
    }

    stopPlayback() {
        this.mode = 'ready';
        this.playbackStep = -1;
    }

    reset() {
        this.mode = 'idle';
        this.patterns = {};
        this.activeParts = [];
        this.playbackStep = -1;
        this.measureSlots = [];
        this.genPartHistory = [];
        this.genPattern = [];
        this.particles = [];
    }

    _delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Export
window.CircuitVisualizer = CircuitVisualizer;
