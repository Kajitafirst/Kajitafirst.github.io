#!/usr/bin/env python3
"""
学習済みパラメータ (theta_val.npy) をJSON形式に変換するスクリプト。
WebUI用に docs/data/params.json を生成する。
"""

import json
import os
import numpy as np
import yaml

PARTS = ["kick", "snare", "tom", "hh", "crash", "ride"]

EXPERIMENT_DIRS = {
    "kick":  "./experiment/KickN16_mps_L3_V2",
    "snare": "./experiment/SnareN16_mps_L3_V2",
    "tom":   "./experiment/TomN16_mps_L3_V2",
    "hh":    "./experiment/HHN16_mps_L3_V2",
    "crash": "./experiment/CrashN16_mps_L3_V2",
    "ride":  "./experiment/RideN16_mps_L3_V2",
}

def main():
    output = {}

    for part in PARTS:
        exp_dir = EXPERIMENT_DIRS[part]
        param_path = os.path.join(exp_dir, "param.yaml")
        theta_path = os.path.join(exp_dir, "theta_val.npy")

        if not os.path.exists(param_path):
            print(f"⚠ Skipping {part}: {param_path} not found")
            continue
        if not os.path.exists(theta_path):
            print(f"⚠ Skipping {part}: {theta_path} not found")
            continue

        with open(param_path) as f:
            params = yaml.safe_load(f)

        theta_val = np.load(theta_path)
        # 最終エポックのパラメータのみ使用
        theta_last = theta_val[-1].tolist()

        output[part] = {
            "N": params["length"],
            "L": params["n_layers"],
            "V": params.get("v_mps", 0),
            "on_mps": params.get("on_mps", False),
            "theta": theta_last,
        }

        n_params_expected = 5 * (params.get("v_mps", 0) + 1) * params["n_layers"] * params["length"] if params.get("on_mps", False) else 5 * params["length"] * params["n_layers"]
        print(f"✅ {part}: N={params['length']}, L={params['n_layers']}, V={params.get('v_mps', 0)}, "
              f"on_mps={params.get('on_mps', False)}, params={len(theta_last)} (expected {n_params_expected})")

    if not output:
        print("❌ No parts found. Check experiment directories.")
        return

    os.makedirs("docs/data", exist_ok=True)
    out_path = "docs/data/params.json"
    with open(out_path, "w") as f:
        json.dump(output, f)

    file_size = os.path.getsize(out_path)
    print(f"\n✅ Saved to {out_path} ({len(output)} parts, {file_size:,} bytes)")


if __name__ == "__main__":
    main()
