// Small Cairo helpers for the scenery.
// Nothing in here touches the shell, so it also runs under plain gjs
// (see tools/render-scene.js).

import Cairo from 'cairo';

export const TAU = Math.PI * 2;

export const LIGHT_COLORS = ['#ff3b30', '#ffcc00', '#34c759', '#3a9bff', '#ff6fd0'];

// Deterministic random numbers (mulberry32) so a scene looks the same on every redraw.
export function rng(seed) {
    let a = seed | 0;
    return () => {
        a = a + 0x6D2B79F5 | 0;
        let t = Math.imul(a ^ a >>> 15, 1 | a);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

export function hex(color) {
    const v = parseInt(color.slice(1), 16);
    return [(v >> 16 & 255) / 255, (v >> 8 & 255) / 255, (v & 255) / 255];
}

// Blend two colours: t = 0 gives a, t = 1 gives b. Returns [r, g, b] in 0..1.
export function mix(a, b, t) {
    const ca = hex(a);
    const cb = hex(b);
    return ca.map((v, i) => v + (cb[i] - v) * t);
}

// Smooth 1-D value noise in -1..1 with the given feature size in px.
export function valueNoise(rand, length, size) {
    const n = Math.ceil(length / size) + 2;
    const lattice = Array.from({length: n}, () => rand() * 2 - 1);
    return x => {
        const f = x / size;
        const i = Math.max(0, Math.min(n - 2, Math.floor(f)));
        const t = f - i;
        const w = (1 - Math.cos(t * Math.PI)) / 2;
        return lattice[i] * (1 - w) + lattice[i + 1] * w;
    };
}

export function setColor(cr, color, alpha = 1) {
    const [r, g, b] = hex(color);
    cr.setSourceRGBA(r, g, b, alpha);
}

export function linearGradient(x0, y0, x1, y1, from, to) {
    const gradient = new Cairo.LinearGradient(x0, y0, x1, y1);
    gradient.addColorStopRGBA(0, ...hex(from), 1);
    gradient.addColorStopRGBA(1, ...hex(to), 1);
    return gradient;
}

export function ellipse(cr, x, y, rx, ry) {
    cr.save();
    cr.translate(x, y);
    cr.scale(rx, ry);
    cr.newSubPath();
    cr.arc(0, 0, 1, 0, TAU);
    cr.restore();
}

export function roundedRect(cr, x, y, w, h, r) {
    cr.newSubPath();
    cr.arc(x + w - r, y + r, r, -Math.PI / 2, 0);
    cr.arc(x + w - r, y + h - r, r, 0, Math.PI / 2);
    cr.arc(x + r, y + h - r, r, Math.PI / 2, Math.PI);
    cr.arc(x + r, y + r, r, Math.PI, Math.PI * 1.5);
    cr.closePath();
}

// Which bulbs of a string are on at a given step. The pattern changes every
// few steps: alternating, chasing, then random sparkle.
export function isLit(index, phase) {
    const mode = Math.floor(phase / 14) % 3;
    if (mode === 0)
        return (index + phase) % 2 === 0;
    if (mode === 1)
        return (index + phase) % 4 < 2;

    let v = Math.imul(index * 374761393 + phase * 668265263, 1274126177);
    v ^= v >>> 13;
    return (v >>> 0) % 100 < 68;
}

// A round bulb with a soft halo when lit.
export function paintBulb(cr, x, y, radius, color, lit) {
    const [r, g, b] = hex(color);

    if (lit) {
        const halo = new Cairo.RadialGradient(x, y, 0, x, y, radius * 3.6);
        halo.addColorStopRGBA(0, r, g, b, 0.7);
        halo.addColorStopRGBA(0.35, r, g, b, 0.26);
        halo.addColorStopRGBA(1, r, g, b, 0);
        cr.setSource(halo);
        cr.newSubPath();
        cr.arc(x, y, radius * 3.6, 0, TAU);
        cr.fill();
    }

    const dim = lit ? 1 : 0.4;
    cr.setSourceRGBA(r * dim, g * dim, b * dim, 1);
    cr.newSubPath();
    cr.arc(x, y, radius, 0, TAU);
    cr.fill();

    if (lit) {
        cr.setSourceRGBA(1, 1, 1, 0.7);
        cr.newSubPath();
        cr.arc(x - radius * 0.3, y - radius * 0.35, radius * 0.32, 0, TAU);
        cr.fill();
    }
}
