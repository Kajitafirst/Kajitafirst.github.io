#!/usr/bin/env python3
"""
量子回路が生成するドラムパターンの可聴化スクリプト

全6パート（kick, snare, tom, hh, crash, ride）に対応し、
可聴化するパートを選択できます。

使い方:
    # 全パートを可聴化
    python audible.py --parts all

    # kick と snare のみ
    python audible.py --parts kick snare

    # kick, snare, hh を可聴化（デフォルト BPM=120, 8小節）
    python audible.py --parts kick snare hh

    # BPM と小節数を指定
    python audible.py --parts kick snare hh ride --bpm 100 --measures 4

    # 出力ファイル名を指定
    python audible.py --parts all --output my_drums

前提条件:
    - mido パッケージ（MIDIファイル生成）
    - fluidsynth コマンド（MIDI→WAV変換）
    - ffmpeg コマンド（WAV→MP3変換）
    - GM SoundFont（/usr/share/sounds/sf2/FluidR3_GM.sf2 など）
"""

import os
import sys
import argparse
import subprocess
import numpy as np
import yaml
import torch
import mido
from mido import MidiFile, MidiTrack, Message
from model import PQC

# ==============================================================
# 定数
# ==============================================================

# 利用可能なドラムパート一覧
AVAILABLE_PARTS = ["kick", "snare", "tom", "hh", "crash", "ride"]

# 各パートの実験ディレクトリ
EXPERIMENT_DIRS = {
    "kick":  "./experiment/KickN16_mps_L3_V2",
    "snare": "./experiment/SnareN16_mps_L3_V2",
    "tom":   "./experiment/TomN16_mps_L3_V2",
    "hh":    "./experiment/HHN16_mps_L3_V2",
    "crash": "./experiment/CrashN16_mps_L3_V2",
    "ride":  "./experiment/RideN16_mps_L3_V2",
}

# GM Drum Map (MIDI Channel 10 = channel index 9)
GM_DRUM_NOTES = {
    "kick":  36,  # Bass Drum 1
    "snare": 38,  # Acoustic Snare
    "tom":   45,  # Low Tom
    "hh":    42,  # Closed Hi-Hat
    "crash": 49,  # Crash Cymbal 1
    "ride":  51,  # Ride Cymbal 1
}

# パート表示名（日本語）
PART_NAMES_JA = {
    "kick":  "キック",
    "snare": "スネア",
    "tom":   "タム",
    "hh":    "ハイハット",
    "crash": "クラッシュ",
    "ride":  "ライド",
}

# MIDI設定
TICKS_PER_BEAT = 480   # 4分音符あたりのtick数
DRUM_CHANNEL = 9       # MIDIチャンネル10（0-indexed）
DEFAULT_VELOCITY = 100
OUTPUT_DIR = "./audible_output"

# SoundFont パス候補
SOUNDFONT_PATHS = [
    "/usr/share/sounds/sf2/FluidR3_GM.sf2",
    "/usr/share/soundfonts/FluidR3_GM.sf2",
    "/usr/share/sounds/sf2/default-GM.sf2",
]


# ==============================================================
# モデルのロードとパターン生成
# ==============================================================

def load_model_and_generate(exp_dir: str, num_measures: int, device: torch.device) -> np.ndarray:
    """指定の実験ディレクトリからパラメータを読み込み、PQCでnum_measures回生成する。

    1回のrunで16ステップ（=1小節）のパターンが1つ得られるので、
    num_measures回runして連結することで、num_measures小節分のパターンを構成する。

    Returns:
        np.ndarray: shape (num_measures, 16)
    """
    with open(f"{exp_dir}/param.yaml", "r") as f:
        p = yaml.safe_load(f)

    length = p["length"]
    size = length
    n_layers = p["n_layers"]
    bs_dis = p["bs_dis"]
    bs_gen = 1  # 1回のrunで1パターンずつ生成
    lr_gen = p["lr_gen"]
    on_mps = p.get("on_mps", False)
    v_mps = p.get("v_mps", 2)

    if on_mps:
        model = PQC(n_layers, size, bs_dis, bs_gen, lr_gen, device, on_mps, v_mps)
    else:
        model = PQC(n_layers, size, bs_dis, bs_gen, lr_gen, device)

    theta_val = np.load(f"{exp_dir}/theta_val.npy")

    # num_measures回runして各小節のパターンを収集
    patterns = []
    for _ in range(num_measures):
        sample = model.run(params=theta_val[-1], mode="G")  # shape: (1, 16)
        patterns.append(sample[0])  # shape: (16,)

    return np.array(patterns)  # shape: (num_measures, 16)


# ==============================================================
# MIDI生成
# ==============================================================

def create_combined_midi(
    patterns: dict[str, np.ndarray],
    output_path: str,
    bpm: int = 120,
    velocity: int = DEFAULT_VELOCITY,
) -> str:
    """複数パートのドラムパターンを1つのMIDIファイルに統合する。

    Args:
        patterns: パート名 -> パターン配列 (num_measures, 16) の辞書
        output_path: 出力MIDIファイルパス
        bpm: テンポ (BPM)
        velocity: ノートのベロシティ

    Returns:
        出力パス
    """
    ticks_per_step = TICKS_PER_BEAT // 4  # 16分音符 = 1ステップ
    note_duration = ticks_per_step // 2   # ノートの長さ

    mid = MidiFile(ticks_per_beat=TICKS_PER_BEAT)

    # テンポトラック
    tempo_track = MidiTrack()
    mid.tracks.append(tempo_track)
    tempo = mido.bpm2tempo(bpm)
    tempo_track.append(mido.MetaMessage("set_tempo", tempo=tempo, time=0))
    tempo_track.append(mido.MetaMessage("track_name", name="Tempo", time=0))

    # ドラムトラック
    drum_track = MidiTrack()
    mid.tracks.append(drum_track)
    drum_track.append(mido.MetaMessage("track_name", name="Drums", time=0))

    # パターンのフラット化と総ステップ数の算出
    first_part = next(iter(patterns.values()))
    num_measures = len(first_part)
    steps_per_measure = len(first_part[0])
    total_steps = num_measures * steps_per_measure

    flat_patterns = {part: pat.flatten() for part, pat in patterns.items()}

    # イベントリストを作成 (absolute_time, type, note, velocity)
    events = []
    for step in range(total_steps):
        abs_time = step * ticks_per_step
        for part, flat in flat_patterns.items():
            if flat[step] == 1:
                midi_note = GM_DRUM_NOTES[part]
                events.append((abs_time, "note_on", midi_note, velocity))
                events.append((abs_time + note_duration, "note_off", midi_note, 0))

    # 絶対時間でソート
    events.sort(key=lambda x: (x[0], x[1] == "note_off"))

    # デルタタイムに変換してトラックに追加
    current_time = 0
    for abs_time, msg_type, note, vel in events:
        delta = abs_time - current_time
        drum_track.append(
            Message(msg_type, channel=DRUM_CHANNEL, note=note, velocity=vel, time=delta)
        )
        current_time = abs_time

    # End of track
    drum_track.append(mido.MetaMessage("end_of_track", time=ticks_per_step))
    tempo_track.append(
        mido.MetaMessage("end_of_track", time=total_steps * ticks_per_step + ticks_per_step)
    )

    # 保存
    mid.save(output_path)
    return output_path


# ==============================================================
# MIDI → MP3 変換
# ==============================================================

def find_soundfont() -> str | None:
    """利用可能なSoundFontファイルを探す"""
    for sf in SOUNDFONT_PATHS:
        if os.path.exists(sf):
            return sf
    return None


def midi_to_mp3(midi_path: str, mp3_path: str) -> bool:
    """MIDIファイルをMP3に変換する（fluidsynth + ffmpeg）

    Returns:
        変換成功なら True
    """
    soundfont = find_soundfont()
    if soundfont is None:
        print("⚠ SoundFont が見つかりません。以下のコマンドでインストールしてください:")
        print("  sudo apt-get install -y fluidsynth fluid-soundfont-gm")
        return False

    wav_path = midi_path.replace(".mid", ".wav")

    print(f"SoundFont: {soundfont}")

    # MIDI → WAV
    print("MIDI → WAV 変換中...")
    try:
        subprocess.run(
            ["fluidsynth", "-ni", soundfont, midi_path, "-F", wav_path, "-r", "44100"],
            check=True,
            capture_output=True,
        )
    except FileNotFoundError:
        print("⚠ fluidsynth が見つかりません。インストールしてください:")
        print("  sudo apt-get install -y fluidsynth")
        return False
    except subprocess.CalledProcessError as e:
        print(f"⚠ fluidsynth 変換エラー: {e.stderr.decode()}")
        return False

    # WAV → MP3
    print("WAV → MP3 変換中...")
    try:
        subprocess.run(
            ["ffmpeg", "-y", "-i", wav_path, "-q:a", "2", mp3_path],
            check=True,
            capture_output=True,
        )
    except FileNotFoundError:
        print("⚠ ffmpeg が見つかりません。インストールしてください:")
        print("  sudo apt-get install -y ffmpeg")
        return False
    except subprocess.CalledProcessError as e:
        print(f"⚠ ffmpeg 変換エラー: {e.stderr.decode()}")
        return False

    # WAV中間ファイルを削除
    if os.path.exists(wav_path):
        os.remove(wav_path)

    return True


# ==============================================================
# メイン処理
# ==============================================================

def parse_args():
    parser = argparse.ArgumentParser(
        description="量子回路が生成するドラムパターンの可聴化",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
使用例:
  python audible.py --parts all                          # 全パート
  python audible.py --parts kick snare hh                # 3パートを選択
  python audible.py --parts kick snare --bpm 100         # BPM指定
  python audible.py --parts all --measures 4             # 4小節
  python audible.py --parts all --output my_drums        # 出力名指定
  python audible.py --parts all --midi-only              # MIDIのみ（MP3変換なし）
        """,
    )
    parser.add_argument(
        "--parts",
        nargs="+",
        required=True,
        help=f"可聴化するパートを指定。'all' で全パート。選択肢: {', '.join(AVAILABLE_PARTS)}",
    )
    parser.add_argument(
        "--bpm",
        type=int,
        default=120,
        help="テンポ（BPM）（デフォルト: 120）",
    )
    parser.add_argument(
        "--measures",
        type=int,
        default=8,
        help="生成する小節数（デフォルト: 8）",
    )
    parser.add_argument(
        "--output",
        type=str,
        default="quantum_drums",
        help="出力ファイル名（拡張子なし）（デフォルト: quantum_drums）",
    )
    parser.add_argument(
        "--midi-only",
        action="store_true",
        help="MIDIファイルのみ生成（MP3変換しない）",
    )
    return parser.parse_args()


def validate_parts(parts: list[str]) -> list[str]:
    """パート指定をバリデーションし、正規化したリストを返す"""
    if "all" in parts:
        return AVAILABLE_PARTS.copy()

    invalid = [p for p in parts if p not in AVAILABLE_PARTS]
    if invalid:
        print(f"❌ 不明なパート: {', '.join(invalid)}")
        print(f"   選択肢: {', '.join(AVAILABLE_PARTS)}")
        sys.exit(1)

    # 重複排除して順序を保持
    seen = set()
    result = []
    for p in parts:
        if p not in seen:
            seen.add(p)
            result.append(p)
    return result


def main():
    args = parse_args()

    # パートのバリデーション
    selected_parts = validate_parts(args.parts)

    print("=" * 60)
    print("  量子ドラムパターン 可聴化スクリプト")
    print("=" * 60)
    print()
    print(f"  選択パート: {', '.join(PART_NAMES_JA[p] for p in selected_parts)}")
    print(f"  BPM:       {args.bpm}")
    print(f"  小節数:     {args.measures}")
    print(f"  出力名:     {args.output}")
    print()

    # デバイス設定
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"  Device: {device}")
    print()

    # 各パートのパターン生成
    print(f"各パートのパターンを生成中（{args.measures}小節 × {len(selected_parts)}パート）...")
    print()

    patterns: dict[str, np.ndarray] = {}
    for part in selected_parts:
        exp_dir = EXPERIMENT_DIRS[part]
        if not os.path.exists(exp_dir):
            print(f"  ⚠ {PART_NAMES_JA[part]} の実験ディレクトリが見つかりません: {exp_dir}")
            print(f"    このパートをスキップします。")
            continue

        theta_path = os.path.join(exp_dir, "theta_val.npy")
        if not os.path.exists(theta_path):
            print(f"  ⚠ {PART_NAMES_JA[part]} の学習済みパラメータが見つかりません: {theta_path}")
            print(f"    このパートをスキップします。")
            continue

        print(f"  {PART_NAMES_JA[part]} を生成中...")
        samples = load_model_and_generate(exp_dir, args.measures, device)
        patterns[part] = samples
        print(f"    → shape: {samples.shape}")

    if not patterns:
        print("❌ 生成可能なパートがありません。終了します。")
        sys.exit(1)

    print()

    # パターンの表示
    print("-" * 60)
    print("生成されたパターン:")
    print("-" * 60)
    for i in range(args.measures):
        print(f"--- 小節 {i + 1} ---")
        for part in patterns:
            label = f"{PART_NAMES_JA[part]:>6}"
            print(f"  {label}: {patterns[part][i]}")
    print()

    # 出力ディレクトリの作成
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    # MIDI生成
    midi_path = os.path.join(OUTPUT_DIR, f"{args.output}.mid")
    print(f"MIDI ファイルを生成中...")
    create_combined_midi(patterns, midi_path, bpm=args.bpm)
    print(f"  ✅ MIDI 保存: {midi_path}")
    print(f"     {args.measures}小節, BPM={args.bpm}, 16分音符ステップ")
    print(f"     パート: {', '.join(PART_NAMES_JA[p] for p in patterns)}")
    print()

    # MP3変換
    if not args.midi_only:
        mp3_path = os.path.join(OUTPUT_DIR, f"{args.output}.mp3")
        print("MP3 に変換中...")
        success = midi_to_mp3(midi_path, mp3_path)
        if success:
            print(f"  ✅ MP3 保存: {mp3_path}")
        else:
            print("  ⚠ MP3 変換に失敗しました。MIDI ファイルは保存済みです。")
    print()
    print("完了!")


if __name__ == "__main__":
    main()
