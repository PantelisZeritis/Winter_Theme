#!/usr/bin/env python3
"""Synthesises the bundled sleigh-bell sound, so no third-party audio is needed.

    python3 tools/make-sleigh-bells.py winter-theme@zeroze01/assets/sleigh-bells.oga

A sleigh bell is a small metal sphere: a bright, inharmonic ring that dies away
in a fraction of a second. A strap of them shaken a few times gives a cluster of
such rings per shake. Everything is seeded, so the output is reproducible. It
writes a WAV next to the target and encodes it to Ogg Vorbis with ffmpeg.
"""
import math
import random
import struct
import subprocess
import sys
import wave
from pathlib import Path

RATE = 44100
LENGTH = 1.5            # seconds
PEAK = 10 ** (-14 / 20)  # normalise to -14 dBFS: soft, under typical alert sounds

# Partials of a small jingle bell, relative to its fundamental: (ratio, gain, decay factor).
PARTIALS = [(1.0, 1.0, 1.0), (2.32, 0.55, 0.7), (4.25, 0.3, 0.5), (6.63, 0.16, 0.35)]
# Shakes of the strap: (time in s, strength). Two quick double shakes, then a fading one.
SHAKES = [(0.0, 1.0), (0.11, 0.75), (0.34, 0.85), (0.45, 0.6), (0.72, 0.45), (0.95, 0.25)]


def main(target):
    rand = random.Random(1225)
    samples = [0.0] * int(RATE * LENGTH)

    # The same handful of bells sound on every shake, a little out of step.
    bells = [{'freq': rand.uniform(2300, 4300), 'decay': rand.uniform(0.05, 0.12)} for _ in range(6)]

    for start, strength in SHAKES:
        for bell in bells:
            if rand.random() < 0.25:
                continue
            onset = start + rand.uniform(0, 0.025)
            gain = strength * rand.uniform(0.5, 1.0)
            # Partials above 16 kHz are dropped: near the 22 kHz limit they
            # would fold back as harsh, unrelated tones.
            partials = [p for p in PARTIALS if bell['freq'] * p[0] < 16000]
            phase = [rand.uniform(0, math.tau) for _ in partials]
            first = int(onset * RATE)
            span = int(bell['decay'] * 6 * RATE)
            for n in range(span):
                i = first + n
                if i >= len(samples):
                    break
                t = n / RATE
                # 2 ms attack avoids a click; each partial decays at its own rate.
                attack = min(1.0, t / 0.002)
                value = 0.0
                for (ratio, pgain, dfac), ph in zip(partials, phase):
                    value += pgain * math.exp(-t / (bell['decay'] * dfac)) * \
                        math.sin(math.tau * bell['freq'] * ratio * t + ph)
                samples[i] += gain * attack * value

            # The rattle of the pellet inside: a very short burst of noise.
            for n in range(int(0.006 * RATE)):
                i = first + n
                if i < len(samples):
                    samples[i] += gain * 0.25 * rand.uniform(-1, 1) * (1 - n / (0.006 * RATE))

    # Gentle one-pole low-pass to take the edge off the highest partials, then
    # fade the tail and normalise.
    out = []
    prev = 0.0
    for i, s in enumerate(samples):
        prev += 0.55 * (s - prev)
        fade = min(1.0, (len(samples) - i) / (0.15 * RATE))
        out.append(prev * fade)
    peak = max(abs(s) for s in out) or 1.0
    pcm = b''.join(struct.pack('<h', int(s / peak * PEAK * 32767)) for s in out)

    target = Path(target)
    wav = target.with_suffix('.wav')
    with wave.open(str(wav), 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(pcm)
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', str(wav),
                    '-c:a', 'libvorbis', '-q:a', '4', str(target)], check=True)
    wav.unlink()
    print(f'wrote {target}')


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'sleigh-bells.oga')
