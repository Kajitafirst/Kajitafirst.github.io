# Quantum Drum Machine 🥁⚛

量子回路（PQC: Parametrized Quantum Circuit）が生成するドラムパターンを、ブラウザ上でリアルタイムに可視化・可聴化するWebアプリケーションです。

## 🌐 Demo

GitHub Pages: `https://kajitafirst.github.io/`

## ✨ Features

- **直感的なパラメータUI** — BPM、小節数、パート選択、Quantumノイズをスライダーで調整
- **ワンクリック生成** — Generateボタンひとつで量子回路がドラムパターンを生成
- **音ゲー風ビジュアライゼーション** — 量子ゲート（RZ, RX, CP）が流れ、測定時に {0, 1} の結果がグロー表示
- **Web Audio合成** — 外部サウンドファイル不要、ブラウザ内でドラム音を合成再生
- **6パート対応** — Kick, Snare, Tom, Hi-Hat, Crash, Ride

## 🏗 Architecture

```
docs/                     ← GitHub Pages公開ディレクトリ
├── index.html            ← メインページ
├── index.css             ← デザインシステム（ダークモード）
├── data/
│   └── params.json       ← 学習済み量子回路パラメータ
└── js/
    ├── quantum-sim.js    ← 量子回路シミュレータ（JS移植版）
    ├── audio-engine.js   ← Web Audio ドラム合成エンジン
    ├── visualizer.js     ← Canvas ビジュアライザ
    └── app.js            ← アプリケーションロジック
```

### 量子回路の構造 (MPS版)

- **量子ビット**: 3 (V+1, V=2)
- **レイヤー**: 3
- **出力ビット**: 16（1小節 = 16ステップ）
- **ゲート構成**: RZ → RX → RZ → CP → RX（各レイヤー）
- **測定**: q[0]を逐次測定、条件付きリセット

## 🚀 GitHub Pages デプロイ

1. このリポジトリをGitHubにプッシュ
2. Settings → Pages → Source を `Deploy from a branch` に設定
3. Branch を `main`、フォルダを `/docs` に設定
4. Save をクリック

## 🛠 開発

### パラメータ変換（初回のみ）

学習済みパラメータを更新した場合:

```bash
python convert_params.py
```

### ローカル確認

```bash
cd docs
python -m http.server 8080
# → http://localhost:8080
```

## 📁 元のPythonプロジェクト

- `audible.py` — MIDI/MP3生成（CLI版）
- `model.py` — PQC + Discriminator（Qiskit + PyTorch）
- `main.py` — QGAN学習スクリプト
- `experiment/` — 各パートの学習済みパラメータ
