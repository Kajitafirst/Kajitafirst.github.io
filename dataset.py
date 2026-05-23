import numpy as np
import random

def get_real_batch_bas(n, batch_size):
    data = get_bars_and_stripes(n)
    indices = np.random.randint(0, len(data), batch_size)
    return data[indices]

def get_bars_and_stripes(n):
    bitstrings = [list(np.binary_repr(i, n))[::-1] for i in range(2**n)]
    bitstrings = np.array(bitstrings, dtype=int)

    stripes = bitstrings.copy()
    stripes = np.repeat(stripes, n, 0)
    stripes = stripes.reshape(2**n, n * n)

    bars = bitstrings.copy()
    bars = bars.reshape(2**n * n, 1)
    bars = np.repeat(bars, n, 1)
    bars = bars.reshape(2**n, n * n)
    return np.vstack((stripes[0 : stripes.shape[0] - 1], bars[1 : bars.shape[0]]))

def get_real_batch_mc(n, batch_size, P_matrix, init_state):
    batch = []
    for _ in range(batch_size):
        chain = get_marcov_chain(n, P_matrix, init_state)
        batch.append(chain)
    return np.array(batch)

def get_marcov_chain(n, P_matrix, init_state):
    chain = [init_state]
    for _ in range(n - 1):
        current_state = chain[-1]
        r = random.random()
        if current_state == 0:
            if r < P_matrix[0][0]:
                next_state = 0
            else:
                next_state = 1
        else:
            if r < P_matrix[1][0]:
                next_state = 0
            else:
                next_state = 1
        chain.append(next_state)
    return chain

import os
import glob

_groove_data_cache = {}

DRUM_INDEX = {
    "kick": 0,
    "snare": 1,
    "tom": 2,
    "hh": 3,
    "crash": 4,
    "ride": 5,
}

def load_groove_data(data_dir, seq_length, drums=None):
    """kickが鳴っているインデックスを先頭として、drumsで指定されたパートを
    seq_length分切り出してセグメントを作成する。
    """
    global _groove_data_cache
    if drums in _groove_data_cache:
        return _groove_data_cache[drums]

    if drums is None:
        raise ValueError("Drum type must be specified.")
    if drums not in DRUM_INDEX:
        raise ValueError(f"Unknown drum type: {drums}. Choose from {list(DRUM_INDEX.keys())}")

    drum_idx = DRUM_INDEX[drums]

    files = glob.glob(os.path.join(data_dir, '*.npy'))
    segments = []

    for f in files:
        data = np.load(f)  # shape: (T, 6)
        if len(data) < seq_length:
            continue

        # kickが鳴っている全てのインデックスを取得
        kick_indices = np.where(data[:, 0] == 1)[0]

        for ki in kick_indices:
            # kickの位置を先頭として seq_length 分取れるか確認
            if ki + seq_length <= len(data):
                segments.append(data[ki:ki + seq_length, drum_idx])

    if len(segments) == 0:
        raise ValueError(
            f"No valid segments found for drums='{drums}', seq_length={seq_length}. "
            f"Check that the data files in '{data_dir}' contain kick hits."
        )

    _groove_data_cache[drums] = np.array(segments)
    return _groove_data_cache[drums]

def get_real_batch_groove(batch_size, data_dir, seq_length=16, drums=None):
    data = load_groove_data(data_dir, seq_length, drums=drums)
    indices = np.random.randint(0, len(data), batch_size)
    return data[indices]