#!/usr/bin/env python3
"""用代码合成游戏音效（不依赖任何外部素材），输出 16bit 单声道 wav。
用法：python3 tools/make_sfx.py build/minigame/audio"""
import sys, wave
from pathlib import Path
import numpy as np

SR = 22050

def tone(freq, dur, vol=0.5, shape='sine', attack=0.005, decay=None):
    t = np.arange(int(SR * dur)) / SR
    if shape == 'sine':
        w = np.sin(2 * np.pi * freq * t)
    elif shape == 'tri':
        w = 2 * np.abs(2 * ((freq * t) % 1) - 1) - 1
    else:  # 'bell'：基音加两个泛音
        w = np.sin(2*np.pi*freq*t) + 0.4*np.sin(2*np.pi*freq*2.76*t) + 0.2*np.sin(2*np.pi*freq*5.4*t)
        w /= 1.6
    env = np.minimum(1, t / attack) * np.exp(-t / (decay or dur / 4))
    return w * env * vol

def glide(f0, f1, dur, vol=0.5):
    t = np.arange(int(SR * dur)) / SR
    f = f0 * (f1 / f0) ** (t / dur)
    ph = 2 * np.pi * np.cumsum(f) / SR
    env = np.minimum(1, t / 0.004) * np.exp(-t / (dur / 3))
    return np.sin(ph) * env * vol

def seq(parts, total=None):
    """parts: [(开始秒, 波形)]"""
    end = max(s + len(w) / SR for s, w in parts)
    out = np.zeros(int(SR * (total or end)) + 1)
    for s, w in parts:
        i = int(s * SR); out[i:i + len(w)] += w[:len(out) - i]
    return out

N = {'C5': 523.25, 'D5': 587.33, 'E5': 659.25, 'G5': 783.99, 'A5': 880.0, 'C6': 1046.5, 'E6': 1318.5, 'G6': 1568.0,
     'C4': 261.63, 'E4': 329.63, 'G4': 392.0, 'A4': 440.0, 'F4': 349.23, 'D4': 293.66, 'B4': 493.88}

SFX = {
    'tap': tone(1200, 0.05, 0.25, 'tri', decay=0.015),
    'place': glide(380, 900, 0.14, 0.45),
    'coin': seq([(0, tone(N['E6'], 0.18, 0.3, 'bell', decay=0.06)), (0.06, tone(N['G6'], 0.25, 0.3, 'bell', decay=0.08))]),
    'night': seq([(i * 0.09, tone(f, 0.6, 0.22, 'bell', decay=0.2)) for i, f in enumerate([N['C5'], N['E5'], N['G5'], N['C6']])]),
    'pay': seq([(i * 0.05, tone(f, 0.2, 0.22, 'bell', decay=0.06)) for i, f in enumerate([N['G5'], N['C6'], N['E6'], N['G6'], N['E6'], N['G6']])]),
    'recruit': seq([(i * 0.11, tone(f, 0.5, 0.3, 'sine', decay=0.18)) for i, f in enumerate([N['G4'], N['C5'], N['E5'], N['G5']])]),
    'fail': seq([(i * 0.18, tone(f, 0.45, 0.32, 'tri', decay=0.2)) for i, f in enumerate([N['A4'], N['F4'], N['D4']])]),
    'win': seq([(i * 0.12, tone(f, 0.7, 0.28, 'bell', decay=0.25)) for i, f in enumerate([N['C5'], N['E5'], N['G5'], N['C6'], N['E6']])]
               + [(0.62, tone(N['C5'], 1.0, 0.18, 'sine', decay=0.4)), (0.62, tone(N['G5'], 1.0, 0.14, 'sine', decay=0.4))]),
}

out = Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
for k, w in SFX.items():
    w = w / max(1e-6, np.abs(w).max()) * 0.8 if np.abs(w).max() > 0.8 else w
    w = np.concatenate([w, np.zeros(int(SR * 0.02))])
    with wave.open(str(out / f'{k}.wav'), 'wb') as f:
        f.setnchannels(1); f.setsampwidth(2); f.setframerate(SR)
        f.writeframes((w * 32767).astype('<i2').tobytes())
print('sfx ->', out, sum((out / f'{k}.wav').stat().st_size for k in SFX) // 1024, 'KB')
