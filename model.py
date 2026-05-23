from qiskit import QuantumCircuit, QuantumRegister, ClassicalRegister, transpile
from qiskit.circuit import ParameterVector
from qiskit_aer import AerSimulator
import numpy as np
import torch
import torch.nn as nn
from utils import numpy_to_gpu

class PQC:
    def __init__(
        self, n_layers, size, bs_dis, bs_gen, lr_gen, device,
        on_mps=False, v_mps=2
    ):
        self.L = n_layers
        self.N = size
        self.V = v_mps
        self.on_mps = on_mps
        self.bs_dis = bs_dis
        self.bs_gen = bs_gen
        self.lr_gen = lr_gen
        if self.on_mps:
            self.n_params = 5 * (self.V + 1) * self.L * self.N
        else:
            self.n_params = 5 * self.N * self.L
        self.theta_vec = ParameterVector("θ", self.n_params)

        # TODO: Replace with real quantum hardware
        # if device.type == "cuda":
        #     self.simulator = AerSimulator(method="statevector", device="GPU")
        # else:
        self.simulator = AerSimulator()
        pqc_template = self._build_parametrized_quantum_circuit(self.on_mps)
        self.tpqc_template = transpile(pqc_template, self.simulator)
        self.theta_val = np.random.uniform(-np.pi, np.pi, size=self.n_params)
        self.bce_logits = nn.BCEWithLogitsLoss()
        self.device = device
  
    def _build_parametrized_quantum_circuit(self, on_mps, add_barriers=False):
        if on_mps:
            q = QuantumRegister(self.V + 1, 'q')
            m = ClassicalRegister(self.N, 'm')
            qc = QuantumCircuit(q, m)
            idx = 0
            for i in range(self.N):
                for j in range(self.L):
                    for k in range(self.V + 1):
                        qc.rz(self.theta_vec[idx], q[k]); idx += 1
                        qc.rx(self.theta_vec[idx], q[k]); idx += 1
                        qc.rz(self.theta_vec[idx], q[k]); idx += 1
                    for k in range(self.V + 1):
                        tgt = (k + 1) % (self.V + 1)
                        qc.cp(self.theta_vec[idx], q[k], q[tgt]); idx += 1
                        qc.rx(self.theta_vec[idx], q[tgt]); idx += 1
                    if add_barriers:
                        qc.barrier(q)
                qc.measure(q[0], m[i])
                if i != self.N - 1:
                    with qc.if_test((m[i], 1)):
                        qc.x(q[0])
                    if add_barriers:
                        qc.barrier(q)
            return qc
  
        else:
            q = QuantumRegister(self.N, 'q')
            m = ClassicalRegister(self.N, 'm')
            qc = QuantumCircuit(q, m)
            idx = 0
            for i in range(self.L):
                for j in range(self.N):
                    qc.rz(self.theta_vec[idx], q[j]); idx += 1
                    qc.rx(self.theta_vec[idx], q[j]); idx += 1
                    qc.rz(self.theta_vec[idx], q[j]); idx += 1
                for j in range(self.N):
                    tgt = (j + 1) % self.N
                    qc.cp(self.theta_vec[idx], q[j], q[tgt]); idx += 1
                    qc.rx(self.theta_vec[idx], q[tgt]); idx += 1
                if add_barriers:
                    qc.barrier(q)
            qc.measure(q, m)
            return qc
  
    def draw_mpl(self):
        qc_show = self._build_parametrized_quantum_circuit(self.on_mps, add_barriers=True)
        return qc_show.draw("mpl")
  
    def run(self, params=None, mode="D"):
        if params is None:
            params = self.theta_val
  
        if mode == "D":
            batch_size = self.bs_dis
        elif mode == "G":
            batch_size = self.bs_gen
  
        tpqc = self.tpqc_template.assign_parameters(dict(zip(self.theta_vec, params)))
        result = self.simulator.run(tpqc, shots=batch_size, memory=True).result()
        memory = result.get_memory(tpqc)
        samples = np.array([[int(b) for b in s[::-1]] for s in memory], dtype=np.int8)
        return samples
  
    def step(self, discriminator):
        tmp_values = self.theta_val.copy()
        for i in range(len(tmp_values)):
            shifted_m = tmp_values.copy()
            shifted_m[i] -= np.pi / 2
            x_m = numpy_to_gpu(self.run(shifted_m, mode="G"))
            shifted_p = tmp_values.copy()
            shifted_p[i] += np.pi /2
            x_p = numpy_to_gpu(self.run(shifted_p, mode="G"))
            y_m = discriminator(x_m).detach()
            y_p = discriminator(x_p).detach()
            grad = self.bce_logits(y_p, torch.ones_like(y_p)) \
                   - self.bce_logits(y_m, torch.ones_like(y_m))
            self.theta_val[i] -= self.lr_gen * grad.item()

class Discriminator(nn.Module):
    def __init__(self, input_dim, hidden_dim, output_dim=1):
        super().__init__()
        self.fc1 = nn.Linear(input_dim, hidden_dim)
        self.fc2 = nn.Linear(hidden_dim, output_dim)
        self.relu = nn.ReLU()

    def forward(self, x):
        h = self.relu(self.fc1(x))
        y = self.fc2(h)
        return y
