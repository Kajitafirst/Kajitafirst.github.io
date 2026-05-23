/**
 * visualizer.js — Quantum Circuit & Drum Grid Visualizer
 *
 * Two Canvas views:
 *   1. Circuit canvas:  音ゲー風 — gates flow toward measurement line,
 *      results flash with glow/particle effects
 *   2. Grid canvas: drum pattern grid with scrolling playback cursor
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

const GATE_COLORS = {
    rz: '#4488ff',
    rx: '#aa44ff',
    cp: '#00cc88',
    measure: '#00e5ff',
    x:  '#ff4466',
};

// ============================================================
// Particle system
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
        this.vx *= 0.97;
        this.vy *= 0.97;
    }

    draw(ctx) {
        const alpha = Math.max(0, this.life / this.maxLife);
        const s = this.size * (0.5 + 0.5 * alpha);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.shadowColor = this.color;
        ctx.shadowBlur = 12;
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
        this.genEvents = [];       // all events from simulation
        this.genPartName = '';
        this.genCurrentStep = -1;  // which output-bit step we're animating
        this.genResults = [];      // measurement results so far

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

        // Measurement flash effects
        this.flashes = []; // { x, y, result, age, color }

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

        this._drawCircuitCanvas(dt);
        this._drawGridCanvas(dt);

        // Update particles
        this.particles = this.particles.filter(p => p.alive);
        this.particles.forEach(p => p.update(dt));

        // Update flashes
        this.flashes = this.flashes.filter(f => f.age < 1.2);
        this.flashes.forEach(f => f.age += dt * 2.5);

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
            this._drawGenerationView(ctx, w, h, dt);
        }

        if (this.mode === 'playing') {
            this._drawPlaybackCircuit(ctx, w, h, dt);
        }

        // Draw particles on circuit canvas
        for (const p of this.particles) {
            if (p.y < h) p.draw(ctx);
        }
    }

    _drawIdleCircuit(ctx, w, h, dt) {
        // Show idle qubit wires with subtle animation
        const nq = 3;
        const margin = 40;
        const wireSpacing = (h - 2 * margin) / (nq + 1);

        for (let i = 0; i < nq; i++) {
            const y = margin + wireSpacing * (i + 1);
            const grad = ctx.createLinearGradient(margin, y, w - margin, y);
            grad.addColorStop(0, 'rgba(100, 120, 255, 0.05)');
            grad.addColorStop(0.5, 'rgba(100, 120, 255, 0.2)');
            grad.addColorStop(1, 'rgba(100, 120, 255, 0.05)');
            ctx.strokeStyle = grad;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(margin, y);
            ctx.lineTo(w - margin, y);
            ctx.stroke();

            // Qubit label
            ctx.fillStyle = 'rgba(100, 120, 255, 0.5)';
            ctx.font = '11px "JetBrains Mono", monospace';
            ctx.fillText(`q[${i}]`, 10, y + 4);
        }

        // Center text
        ctx.fillStyle = 'rgba(136, 136, 170, 0.6)';
        ctx.font = '14px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Generate をクリックして量子ドラムパターンを生成', w / 2, h / 2);
        ctx.textAlign = 'left';
    }

    _drawGenerationView(ctx, w, h, dt) {
        const nq = this.nQubits;
        const margin = 40;
        const wireSpacing = (h * 0.65 - 2 * margin) / (nq + 1);
        const measureLineX = margin + 50;

        // Draw qubit wires
        for (let i = 0; i < nq; i++) {
            const y = margin + wireSpacing * (i + 1);
            const grad = ctx.createLinearGradient(measureLineX, y, w - 30, y);
            grad.addColorStop(0, 'rgba(0, 229, 255, 0.3)');
            grad.addColorStop(1, 'rgba(100, 120, 255, 0.06)');
            ctx.strokeStyle = grad;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(measureLineX, y);
            ctx.lineTo(w - 30, y);
            ctx.stroke();

            ctx.fillStyle = 'rgba(100, 180, 255, 0.5)';
            ctx.font = '10px "JetBrains Mono", monospace';
            ctx.fillText(`q[${i}]`, 8, y + 4);
        }

        // Measurement line
        ctx.save();
        ctx.strokeStyle = 'rgba(0, 229, 255, 0.4)';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(measureLineX, margin);
        ctx.lineTo(measureLineX, h * 0.65);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();

        ctx.fillStyle = 'rgba(0, 229, 255, 0.5)';
        ctx.font = '9px "JetBrains Mono", monospace';
        ctx.fillText('MEASURE', measureLineX - 22, margin - 8);

        // Draw gate events flowing for current step
        if (this.genCurrentStep >= 0 && this.genEvents.length > 0) {
            const stepEvents = this.genEvents.filter(e => e.step === this.genCurrentStep && e.type !== 'measure' && e.type !== 'x');
            const totalGates = stepEvents.length;
            const gateWidth = 32;
            const startX = measureLineX + 40;
            const endX = w - 50;
            const availableWidth = endX - startX;

            for (let g = 0; g < totalGates; g++) {
                const evt = stepEvents[g];
                const t = totalGates > 1 ? g / (totalGates - 1) : 0.5;
                const x = startX + t * availableWidth;
                const y = margin + wireSpacing * (evt.qubit + 1);
                const color = GATE_COLORS[evt.type] || '#ffffff';

                // Gate box
                ctx.save();
                ctx.shadowColor = color;
                ctx.shadowBlur = 8;
                ctx.fillStyle = color + '33';
                ctx.strokeStyle = color + '88';
                ctx.lineWidth = 1;
                const bw = gateWidth;
                const bh = 20;
                ctx.beginPath();
                ctx.roundRect(x - bw / 2, y - bh / 2, bw, bh, 4);
                ctx.fill();
                ctx.stroke();

                // Gate label
                ctx.shadowBlur = 0;
                ctx.fillStyle = color;
                ctx.font = 'bold 9px "JetBrains Mono", monospace';
                ctx.textAlign = 'center';
                ctx.fillText(evt.type.toUpperCase(), x, y + 3);
                ctx.textAlign = 'left';
                ctx.restore();

                // CP connecting line
                if (evt.type === 'cp' && evt.target !== undefined) {
                    const y2 = margin + wireSpacing * (evt.target + 1);
                    ctx.save();
                    ctx.strokeStyle = color + '66';
                    ctx.lineWidth = 1;
                    ctx.beginPath();
                    ctx.moveTo(x, y + bh / 2);
                    ctx.lineTo(x, y2 - bh / 2);
                    ctx.stroke();
                    ctx.restore();
                }
            }
        }

        // Draw current step indicator
        if (this.genCurrentStep >= 0) {
            ctx.fillStyle = 'rgba(0, 229, 255, 0.8)';
            ctx.font = 'bold 13px "JetBrains Mono", monospace';
            ctx.textAlign = 'center';
            ctx.fillText(`Step ${this.genCurrentStep + 1}/16`, w / 2, h * 0.65 + 20);
            ctx.textAlign = 'left';

            // Part label
            ctx.fillStyle = PART_COLORS[this.genPartName] || '#ffffff';
            ctx.font = 'bold 12px Inter, sans-serif';
            ctx.fillText(this.genPartName.toUpperCase(), w - 80, margin - 8);
        }

        // Draw accumulated results at bottom of circuit area
        this._drawResultRow(ctx, w, h);

        // Draw flash effects
        for (const flash of this.flashes) {
            this._drawFlash(ctx, flash);
        }
    }

    _drawResultRow(ctx, w, h) {
        const N = 16;
        const rowY = h * 0.72;
        const cellW = Math.min(30, (w - 120) / N);
        const startX = (w - cellW * N) / 2;

        ctx.fillStyle = 'rgba(136, 136, 170, 0.35)';
        ctx.font = '9px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';

        for (let i = 0; i < N; i++) {
            const x = startX + i * cellW + cellW / 2;
            const y = rowY;

            if (i < this.genResults.length) {
                const result = this.genResults[i];
                if (result === 1) {
                    // Bright glow
                    ctx.save();
                    ctx.shadowColor = '#00e5ff';
                    ctx.shadowBlur = 16;
                    ctx.fillStyle = '#00e5ff';
                    ctx.font = 'bold 16px "JetBrains Mono", monospace';
                    ctx.fillText('1', x, y + 6);
                    ctx.restore();
                } else {
                    ctx.fillStyle = 'rgba(80, 80, 120, 0.5)';
                    ctx.font = '14px "JetBrains Mono", monospace';
                    ctx.fillText('0', x, y + 6);
                }
            } else {
                // Pending
                ctx.fillStyle = 'rgba(60, 60, 90, 0.3)';
                ctx.fillRect(x - cellW * 0.35, y - 8, cellW * 0.7, 18);
                ctx.strokeStyle = 'rgba(80, 80, 120, 0.2)';
                ctx.lineWidth = 0.5;
                ctx.strokeRect(x - cellW * 0.35, y - 8, cellW * 0.7, 18);
            }
        }
        ctx.textAlign = 'left';
    }

    _drawFlash(ctx, flash) {
        const alpha = Math.max(0, 1 - flash.age);
        const scale = 1 + flash.age * 2;
        ctx.save();
        ctx.globalAlpha = alpha * 0.6;
        ctx.shadowColor = flash.color;
        ctx.shadowBlur = 40 * alpha;
        ctx.strokeStyle = flash.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(flash.x, flash.y, 15 * scale, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
    }

    _drawPlaybackCircuit(ctx, w, h, dt) {
        // During playback, show a simpler circuit view with the current step highlighted
        const nq = this.nQubits;
        const margin = 30;
        const wireSpacing = (h - 2 * margin) / (nq + 1);

        // Draw wires
        for (let i = 0; i < nq; i++) {
            const y = margin + wireSpacing * (i + 1);
            const grad = ctx.createLinearGradient(30, y, w - 30, y);
            grad.addColorStop(0, 'rgba(100, 120, 255, 0.06)');
            grad.addColorStop(0.5, 'rgba(0, 229, 255, 0.15)');
            grad.addColorStop(1, 'rgba(100, 120, 255, 0.06)');
            ctx.strokeStyle = grad;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(30, y);
            ctx.lineTo(w - 30, y);
            ctx.stroke();

            ctx.fillStyle = 'rgba(100, 180, 255, 0.4)';
            ctx.font = '10px "JetBrains Mono", monospace';
            ctx.fillText(`q[${i}]`, 8, y + 4);
        }

        // Show 16 measurement columns
        const N = 16;
        const colW = (w - 80) / N;
        const startX = 50;

        for (let i = 0; i < N; i++) {
            const x = startX + i * colW + colW / 2;
            const isActive = (i === this.playbackStep % 16);

            // Vertical line
            if (isActive) {
                ctx.save();
                ctx.strokeStyle = 'rgba(0, 229, 255, 0.25)';
                ctx.lineWidth = colW * 0.8;
                ctx.beginPath();
                ctx.moveTo(x, margin);
                ctx.lineTo(x, h - margin);
                ctx.stroke();
                ctx.restore();
            }

            // Measurement circles on q[0] wire
            const y = margin + wireSpacing;
            const measureEvt = this.genEvents.find(e => e.type === 'measure' && e.step === i);
            if (measureEvt) {
                const result = measureEvt.result;
                ctx.save();
                if (result === 1) {
                    ctx.shadowColor = '#00e5ff';
                    ctx.shadowBlur = isActive ? 20 : 8;
                    ctx.fillStyle = isActive ? '#00e5ff' : 'rgba(0, 229, 255, 0.6)';
                } else {
                    ctx.fillStyle = isActive ? 'rgba(80, 80, 120, 0.6)' : 'rgba(50, 50, 80, 0.3)';
                }
                ctx.beginPath();
                ctx.arc(x, y, isActive ? 10 : 7, 0, Math.PI * 2);
                ctx.fill();

                ctx.fillStyle = result === 1 ? '#fff' : 'rgba(150, 150, 180, 0.5)';
                ctx.font = `bold ${isActive ? 11 : 9}px "JetBrains Mono", monospace`;
                ctx.textAlign = 'center';
                ctx.fillText(String(result), x, y + (isActive ? 4 : 3));
                ctx.textAlign = 'left';
                ctx.restore();
            }
        }

        // Draw particles
        for (const p of this.particles) {
            if (p.y < h) p.draw(ctx);
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

                if (isActive) {
                    ctx.save();
                    if (isCurrent) {
                        ctx.shadowColor = color;
                        ctx.shadowBlur = 20;
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
     * Start generation animation for a single part.
     * Resolves when animation for this part is complete.
     */
    async animatePartGeneration(partName, events, pattern, delayPerStep = 80) {
        this.mode = 'generating';
        this.genPartName = partName;
        this.genEvents = events;
        this.genCurrentStep = -1;
        this.genResults = [];
        this.nQubits = 3; // MPS uses 3 qubits

        for (let step = 0; step < pattern.length; step++) {
            this.genCurrentStep = step;
            this.genResults.push(pattern[step]);

            // Flash + particles on measurement
            const measureLineX = 90;
            const wireY = 40 + ((this.cH * 0.65 - 80) / 4);
            if (pattern[step] === 1) {
                const color = '#00e5ff';
                this.flashes.push({ x: measureLineX, y: wireY, result: 1, age: 0, color });
                for (let p = 0; p < 12; p++) {
                    const angle = Math.random() * Math.PI * 2;
                    const speed = 40 + Math.random() * 80;
                    this.particles.push(new Particle(
                        measureLineX, wireY, color,
                        1.5 + Math.random() * 2,
                        Math.cos(angle) * speed,
                        Math.sin(angle) * speed,
                        0.6 + Math.random() * 0.5
                    ));
                }
            } else {
                this.flashes.push({ x: measureLineX, y: wireY, result: 0, age: 0, color: '#334' });
            }

            await this._delay(delayPerStep);
        }

        this.genCurrentStep = -1;
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
        this.genResults = [];
        this.genEvents = [];
        this.particles = [];
        this.flashes = [];
    }

    _delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Export
window.CircuitVisualizer = CircuitVisualizer;
