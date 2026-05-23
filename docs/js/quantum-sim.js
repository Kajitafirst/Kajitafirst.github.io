/**
 * quantum-sim.js — Quantum State Vector Simulator
 *
 * Faithful JavaScript port of the PQC (Parametrized Quantum Circuit)
 * from model.py, supporting the MPS (Matrix Product State) circuit
 * structure used for drum pattern generation.
 *
 * Circuit structure (MPS, V=2):
 *   3 qubits (q[0], q[1], q[2]), 16 output bits, 3 layers per bit
 *   For each output bit i:
 *     For each layer j:
 *       RZ-RX-RZ on each qubit, then CP-RX entanglement between neighbors
 *     Measure q[0] → result
 *     If result=1 and not last bit: X(q[0])  (conditional reset)
 */

// ============================================================
// Complex Number Class
// ============================================================
class Complex {
    constructor(re = 0, im = 0) {
        this.re = re;
        this.im = im;
    }

    add(other) {
        return new Complex(this.re + other.re, this.im + other.im);
    }

    sub(other) {
        return new Complex(this.re - other.re, this.im - other.im);
    }

    mul(other) {
        return new Complex(
            this.re * other.re - this.im * other.im,
            this.re * other.im + this.im * other.re
        );
    }

    scale(s) {
        return new Complex(this.re * s, this.im * s);
    }

    abs2() {
        return this.re * this.re + this.im * this.im;
    }

    static fromPolar(r, theta) {
        return new Complex(r * Math.cos(theta), r * Math.sin(theta));
    }
}

const ZERO = new Complex(0, 0);
const ONE = new Complex(1, 0);

// ============================================================
// Quantum State (state vector for n qubits)
// ============================================================
class QuantumState {
    constructor(nQubits) {
        this.n = nQubits;
        this.dim = 1 << nQubits;
        this.amps = new Array(this.dim);
        this.reset();
    }

    reset() {
        for (let i = 0; i < this.dim; i++) {
            this.amps[i] = i === 0 ? new Complex(1, 0) : new Complex(0, 0);
        }
    }

    /**
     * Apply a single-qubit gate (2×2 unitary) to the specified qubit.
     * matrix = [[a, b], [c, d]] where each element is a Complex.
     */
    applySingleQubitGate(qubit, matrix) {
        const bit = 1 << qubit;
        for (let i = 0; i < this.dim; i++) {
            if (i & bit) continue; // Process pairs: i has qubit=0, j has qubit=1
            const j = i | bit;
            const a0 = this.amps[i];
            const a1 = this.amps[j];
            this.amps[i] = matrix[0][0].mul(a0).add(matrix[0][1].mul(a1));
            this.amps[j] = matrix[1][0].mul(a0).add(matrix[1][1].mul(a1));
        }
    }

    /**
     * Apply Controlled-Phase gate: adds phase e^(iθ) to |11⟩.
     */
    applyCP(control, target, theta) {
        const cBit = 1 << control;
        const tBit = 1 << target;
        const phase = Complex.fromPolar(1, theta);
        for (let i = 0; i < this.dim; i++) {
            if ((i & cBit) && (i & tBit)) {
                this.amps[i] = this.amps[i].mul(phase);
            }
        }
    }

    /**
     * Measure a single qubit. Returns 0 or 1.
     * Collapses the state accordingly.
     */
    measure(qubit) {
        const bit = 1 << qubit;
        let prob0 = 0;
        for (let i = 0; i < this.dim; i++) {
            if (!(i & bit)) {
                prob0 += this.amps[i].abs2();
            }
        }
        // Clamp for numerical stability
        prob0 = Math.max(0, Math.min(1, prob0));

        const result = Math.random() < prob0 ? 0 : 1;

        // Collapse and renormalize
        const probKeep = result === 0 ? prob0 : (1 - prob0);
        const norm = probKeep > 1e-15 ? 1.0 / Math.sqrt(probKeep) : 0;

        for (let i = 0; i < this.dim; i++) {
            const hasBit = (i & bit) ? 1 : 0;
            if (hasBit !== result) {
                this.amps[i] = ZERO;
            } else {
                this.amps[i] = this.amps[i].scale(norm);
            }
        }

        return result;
    }
}

// ============================================================
// Gate Matrix Constructors
// ============================================================
function rzMatrix(theta) {
    return [
        [Complex.fromPolar(1, -theta / 2), ZERO],
        [ZERO, Complex.fromPolar(1, theta / 2)]
    ];
}

function rxMatrix(theta) {
    const c = Math.cos(theta / 2);
    const s = Math.sin(theta / 2);
    return [
        [new Complex(c, 0), new Complex(0, -s)],
        [new Complex(0, -s), new Complex(c, 0)]
    ];
}

function xGate() {
    return [
        [ZERO, ONE],
        [ONE, ZERO]
    ];
}

// ============================================================
// PQC Simulator
// ============================================================
class PQCSimulator {
    /**
     * @param {Object} config - { N, L, V, on_mps, theta }
     */
    constructor(config) {
        this.N = config.N;         // Output bits (16)
        this.L = config.L;         // Layers (3)
        this.V = config.V;         // MPS bond dimension (2)
        this.onMPS = config.on_mps !== false;
        this.nQubits = this.onMPS ? this.V + 1 : this.N;
        this.theta = config.theta; // Array of floats
    }

    /**
     * Run the circuit once, producing a drum pattern of N bits.
     *
     * @param {number} noiseLevel - Amount of random perturbation (0 = none)
     * @returns {{ pattern: number[], events: Object[] }}
     *   pattern: array of 0/1 values (length N)
     *   events: array of gate/measurement events for visualization
     */
    run(noiseLevel = 0) {
        // Optionally perturb parameters
        let params;
        if (noiseLevel > 0) {
            params = this.theta.map(t => t + (Math.random() - 0.5) * 2 * noiseLevel);
        } else {
            params = this.theta;
        }

        if (this.onMPS) {
            return this._runMPS(params);
        } else {
            return this._runFull(params);
        }
    }

    /**
     * MPS circuit: reuses V+1 qubits, measuring q[0] for each output bit.
     */
    _runMPS(params) {
        const state = new QuantumState(this.nQubits);
        const pattern = [];
        const events = [];
        let idx = 0;

        for (let i = 0; i < this.N; i++) {
            // Apply L layers of gates
            for (let j = 0; j < this.L; j++) {
                // Single-qubit rotations: RZ-RX-RZ on each qubit
                for (let k = 0; k < this.nQubits; k++) {
                    const rz1 = params[idx++];
                    state.applySingleQubitGate(k, rzMatrix(rz1));
                    events.push({ type: 'rz', qubit: k, param: rz1, step: i, layer: j });

                    const rx1 = params[idx++];
                    state.applySingleQubitGate(k, rxMatrix(rx1));
                    events.push({ type: 'rx', qubit: k, param: rx1, step: i, layer: j });

                    const rz2 = params[idx++];
                    state.applySingleQubitGate(k, rzMatrix(rz2));
                    events.push({ type: 'rz', qubit: k, param: rz2, step: i, layer: j });
                }

                // Entanglement: CP + RX between neighbors
                for (let k = 0; k < this.nQubits; k++) {
                    const tgt = (k + 1) % this.nQubits;
                    const cpTheta = params[idx++];
                    state.applyCP(k, tgt, cpTheta);
                    events.push({ type: 'cp', qubit: k, target: tgt, param: cpTheta, step: i, layer: j });

                    const rxTheta = params[idx++];
                    state.applySingleQubitGate(tgt, rxMatrix(rxTheta));
                    events.push({ type: 'rx', qubit: tgt, param: rxTheta, step: i, layer: j });
                }
            }

            // Measure q[0]
            const result = state.measure(0);
            pattern.push(result);
            events.push({ type: 'measure', qubit: 0, step: i, result });

            // Conditional reset: if result=1, apply X to q[0]
            if (i < this.N - 1 && result === 1) {
                state.applySingleQubitGate(0, xGate());
                events.push({ type: 'x', qubit: 0, step: i });
            }
        }

        return { pattern, events };
    }

    /**
     * Full circuit: uses N qubits, measures all at the end.
     */
    _runFull(params) {
        const state = new QuantumState(this.nQubits);
        const events = [];
        let idx = 0;

        for (let i = 0; i < this.L; i++) {
            for (let j = 0; j < this.N; j++) {
                const rz1 = params[idx++];
                state.applySingleQubitGate(j, rzMatrix(rz1));
                events.push({ type: 'rz', qubit: j, param: rz1, step: -1, layer: i });

                const rx1 = params[idx++];
                state.applySingleQubitGate(j, rxMatrix(rx1));
                events.push({ type: 'rx', qubit: j, param: rx1, step: -1, layer: i });

                const rz2 = params[idx++];
                state.applySingleQubitGate(j, rzMatrix(rz2));
                events.push({ type: 'rz', qubit: j, param: rz2, step: -1, layer: i });
            }
            for (let j = 0; j < this.N; j++) {
                const tgt = (j + 1) % this.N;
                const cpTheta = params[idx++];
                state.applyCP(j, tgt, cpTheta);
                events.push({ type: 'cp', qubit: j, target: tgt, param: cpTheta, step: -1, layer: i });

                const rxTheta = params[idx++];
                state.applySingleQubitGate(tgt, rxMatrix(rxTheta));
                events.push({ type: 'rx', qubit: tgt, param: rxTheta, step: -1, layer: i });
            }
        }

        const pattern = [];
        for (let j = 0; j < this.N; j++) {
            const result = state.measure(j);
            pattern.push(result);
            events.push({ type: 'measure', qubit: j, step: j, result });
        }

        return { pattern, events };
    }
}

// Export for use by other modules
window.PQCSimulator = PQCSimulator;
