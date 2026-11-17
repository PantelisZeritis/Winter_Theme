// The winter scene, covering a whole monitor: a sky with a low sun by day or a
// moon and stars by night, and at the bottom a landscape of snowy hills with
// pines, a cabin, a snowman and a decorated Christmas tree.
//
// layoutScene() decides where everything goes, paintScene() draws the static
// picture and paintTreeLights() draws only the blinking lights of the tree.
//
// The landscape is laid out in its own coordinates (origin at the top of the
// landscape strip, `scene.landTop` in monitor coordinates) and its sizes derive
// from `s`, the strip height divided by 300. Sky sizes derive from `u`, the
// monitor height divided by 1080.

import Cairo from 'cairo';

import {
    TAU, LIGHT_COLORS, rng, hex, mix, valueNoise, setColor, linearGradient, ellipse,
    roundedRect, isLit, paintBulb,
} from './draw.js';

export const PALETTES = {
    day: {
        far: ['#c6d7ea', '#b4c9e0'],
        farTree: '#8fa8bd',
        mid: ['#e0eaf5', '#cbdbec'],
        midTree: ['#4a7a70', '#33605a'],
        midSnow: '#f1f6fb',
        near: ['#fcfdff', '#dbe7f4'],
        nearTree: ['#2f7558', '#1c5341'],
        nearSnow: '#ffffff',
        xmasTree: ['#2f9160', '#1a6444'],
        trunk: '#5a4031',
        shade: [0.27, 0.39, 0.55, 0.2],
        wood: ['#8a5633', '#6a3f24'],
        roof: '#3b2518',
        glow: 0.22,
        snowman: ['#ffffff', '#c3d5e9'],
        // Sky stops from the zenith down to the horizon.
        sky: [[0, '#3c6aa8'], [0.55, '#7ea5d2'], [0.85, '#c9d5e3'], [1, '#f2d7bd']],
        // Mountains: sunlit snow, snow in shadow, exposed rock, and the haze
        // colour distant ranges fade towards. The sun is on the left.
        mountains: {lit: '#f7f9fc', shade: '#98acc9', rock: '#5f6e88', haze: '#d9e1ec', lightFromLeft: true},
        // Frozen lake: the ice over the reflection, polished streaks, snow
        // patches, and the light and dark edges of the cracks.
        ice: {tint: '#8fb3d1', tintAlpha: [0.38, 0.55], streak: [1, 1, 1, 0.32],
            snow: [1, 1, 1, 0.85], crackLight: [1, 1, 1, 0.8], crackDark: [0.3, 0.42, 0.56, 0.5]},
    },
    night: {
        far: ['#34486b', '#2b3c5c'],
        farTree: '#1f2d47',
        mid: ['#5a7199', '#465c85'],
        midTree: ['#1c3a3c', '#122b2f'],
        midSnow: '#b7c8e2',
        near: ['#dfe9f8', '#9fb5d6'],
        nearTree: ['#17443a', '#0d2e29'],
        nearSnow: '#eaf1fc',
        xmasTree: ['#1f7a50', '#0f4a33'],
        trunk: '#3a2a22',
        shade: [0.1, 0.16, 0.3, 0.3],
        wood: ['#5e3b25', '#432a1a'],
        roof: '#241710',
        glow: 0.6,
        night: true,
        snowman: ['#f4f8ff', '#9db2d3'],
        sky: [[0, '#04070f'], [0.45, '#0b1430'], [0.85, '#1c2b52'], [1, '#2e416a']],
        // Moonlit from the right.
        mountains: {lit: '#b8c7e3', shade: '#46557b', rock: '#1f2942', haze: '#26375c', lightFromLeft: false},
        ice: {tint: '#2b3f66', tintAlpha: [0.38, 0.6], streak: [0.62, 0.72, 0.9, 0.22],
            snow: [0.8, 0.85, 0.94, 0.62], crackLight: [0.7, 0.78, 0.92, 0.5], crackDark: [0.04, 0.07, 0.16, 0.55]},
    },
};

const BAUBLE_COLORS = ['#e63946', '#ffd166', '#4cc9f0', '#f77f00', '#ff6fb5'];

function pineTiers(x, base, h, count, spread) {
    const trunk = h * 0.1;
    const step = (h - trunk) / (count + 0.9);
    const th = step * 1.9;
    const tiers = [];
    for (let i = 0; i < count; i++) {
        const yb = base - trunk - i * step;
        tiers.push({yb, yt: yb - th, th, w: h * spread * (1 - i / (count + 0.35))});
    }
    return tiers;
}

function layoutLake(width, height, s, hills, start, ramp, rand) {
    // The ice is flat, so the far shore is a straight line just below the
    // lowest point of the far hills along the lake.
    let shore = 0;
    for (let x = start - ramp; x < width; x += 4)
        shore = Math.max(shore, hills[0](x));
    shore += 3 * s;
    // How far down the ice is visible before the near hill covers it.
    const visible = height * 0.8 - shore;
    const left = start - ramp * 1.35;
    const onIce = (x, y) => x > start - ramp * 0.2 && y > shore + 2 * s && y < shore + visible;

    // Cracks: wandering lines, flattened by perspective, with a few branches.
    const cracks = [];
    const walk = (x, y, angle, steps, depth) => {
        const points = [[x, y]];
        for (let i = 0; i < steps; i++) {
            angle += (rand() - 0.5) * 0.9;
            const length = (6 + rand() * 9) * s;
            x += Math.cos(angle) * length;
            y += Math.sin(angle) * length * 0.26;
            if (!onIce(x, y))
                break;
            points.push([x, y]);
            if (depth < 2 && rand() < 0.22)
                walk(x, y, angle + (rand() < 0.5 ? -1 : 1) * (0.6 + rand() * 0.6), 3 + Math.floor(rand() * 5), depth + 1);
        }
        if (points.length > 1)
            cracks.push(points);
    };
    const count = Math.round((width - start) / (110 * s));
    for (let i = 0; i < count; i++) {
        const x = start + rand() * (width - start);
        const y = shore + visible * (0.15 + rand() * 0.75);
        walk(x, y, rand() * TAU, 6 + Math.floor(rand() * 9), 0);
    }

    // Snow drifted onto the ice, as clusters of flat ellipses.
    const patches = [];
    for (let i = 0; i < count * 0.7; i++) {
        const x = start + rand() * (width - start);
        const y = shore + visible * (0.1 + rand() * 0.8);
        const size = (14 + rand() * 30) * s * (0.6 + (y - shore) / visible);
        const blobs = [];
        for (let k = 0; k < 4; k++) {
            blobs.push({dx: (rand() - 0.5) * size * 1.4, dy: (rand() - 0.5) * size * 0.12,
                rx: size * (0.4 + rand() * 0.5), ry: size * (0.06 + rand() * 0.05)});
        }
        patches.push({x, y, blobs});
    }

    // Long, faint, wind-polished streaks.
    const streaks = [];
    for (let i = 0; i < count; i++) {
        streaks.push({
            x: start + rand() * (width - start),
            y: shore + visible * (0.05 + rand() * 0.9),
            length: (60 + rand() * 180) * s,
            thick: (0.8 + rand() * 1.6) * s,
        });
    }

    return {start, ramp, left, shore, visible, cracks, patches, streaks};
}

// `height` is the landscape strip's height; `s` sizes the things in it, so a
// taller strip gives more depth rather than bigger trees.
function layoutLand(width, height, seed, s) {
    const rand = rng(seed);

    const hill = (base, amp) => {
        const k1 = TAU / ((900 + rand() * 700) * s);
        const k2 = TAU / ((330 + rand() * 240) * s);
        const p1 = rand() * TAU;
        const p2 = rand() * TAU;
        return x => height * (base + amp *
            (0.65 * Math.sin(x * k1 + p1) + 0.35 * Math.sin(x * k2 + p2)));
    };
    const hills = [hill(0.4, 0.04), hill(0.6, 0.035), hill(0.82, 0.028)];

    const cabinX = width * 0.56;
    const snowmanX = width * 0.27;
    const xmasX = width * 0.77;

    // A frozen lake fills the valley from just right of the cabin to the right
    // edge. The middle hill dips out of the way there, and the far hills form
    // the far shore.
    const ramp = 70 * s;
    const lakeStart = Math.max(width * 0.64, cabinX + 80 * s + ramp);
    const midHill = hills[1];
    hills[1] = x => {
        const t = Math.max(0, Math.min(1, (x - (lakeStart - ramp)) / ramp));
        const dip = t * t * (3 - 2 * t);
        return midHill(x) + (height * 1.05 - midHill(x)) * dip;
    };
    const lake = layoutLake(width, height, s, hills, lakeStart, ramp, rand);

    const farTrees = [];
    for (let x = rand() * 30 * s; x < width; x += (14 + rand() * 50) * s)
        farTrees.push({x, base: hills[0](x) + 3 * s, h: (24 + rand() * 34) * s});

    const midTrees = [];
    // Scattered down the slope between the middle and near hills; trees lower
    // on the slope are nearer, so a little larger.
    for (let x = rand() * 60 * s; x < width; x += (28 + rand() * 90) * s) {
        const drop = rand() * 46 * s;
        if (Math.abs(x - cabinX) < 105 * s || x > lakeStart - ramp * 0.8)
            continue;
        midTrees.push({x, base: hills[1](x) + 4 * s + drop, h: (52 + rand() * 44) * s * (1 + drop / (120 * s)), tiers: 4});
    }
    midTrees.sort((a, b) => a.base - b.base);

    const keepOut = [[snowmanX, 85], [xmasX, 130], [cabinX, 100]];
    const blocked = x => keepOut.some(([centre, radius]) => Math.abs(x - centre) < radius * s);
    const nearTrees = [];
    for (let x = (20 + rand() * 60) * s; x < width; x += (110 + rand() * 220) * s) {
        const h = (120 + rand() * 75) * s;
        const companion = rand() < 0.45;
        const gap = (38 + rand() * 30) * s;
        const lift = [rand() * 14 * s, rand() * 14 * s];
        const shrink = 0.5 + rand() * 0.25;
        if (!blocked(x))
            nearTrees.push({x, base: hills[2](x) + 8 * s + lift[0], h, tiers: 5});
        if (companion && !blocked(x + gap)) {
            nearTrees.push({
                x: x + gap,
                base: hills[2](x + gap) + 8 * s + lift[1],
                h: h * shrink,
                tiers: 4,
            });
        }
    }
    nearTrees.sort((a, b) => a.base - b.base);

    const drifts = [];
    for (let x = rand() * 200 * s; x < width; x += (180 + rand() * 320) * s) {
        const y = hills[2](x) + (22 + rand() * 22) * s;
        drifts.push({x, y, length: (90 + rand() * 150) * s, bend: (4 + rand() * 6) * s});
    }

    // Christmas tree, its ornaments and its string of lights.
    const xmasBase = hills[2](xmasX) + 14 * s;
    const xmasHeight = 185 * s;
    const tiers = pineTiers(xmasX, xmasBase, xmasHeight, 5, 0.33);
    const baubles = [];
    const lights = [];
    const garlands = [];
    tiers.forEach((tier, i) => {
        const {yt, yb, th, w} = tier;

        for (let n = 0; n < 3; n++) {
            const y = yt + th * (0.5 + rand() * 0.36);
            const reach = w * ((y - yt) / th) * 0.55;
            baubles.push({
                x: xmasX + (rand() * 2 - 1) * reach,
                y,
                color: BAUBLE_COLORS[Math.floor(rand() * BAUBLE_COLORS.length)],
            });
        }

        if (i === tiers.length - 1)
            return;
        const count = 7 - i;
        const slant = i % 2 ? 1 : -1;
        const garland = [];
        for (let k = 0; k < count; k++) {
            const t = (k + 0.5) / count;
            garland.push({
                x: xmasX + (2 * t - 1) * w * 0.52,
                y: yb - th * 0.4 + th * 0.13 * Math.sin(Math.PI * t) + (t - 0.5) * th * 0.2 * slant,
            });
        }
        garlands.push(garland);
        for (const point of garland)
            lights.push({...point, color: LIGHT_COLORS[lights.length % LIGHT_COLORS.length]});
    });

    const xmas = {
        x: xmasX, base: xmasBase, h: xmasHeight, geometry: tiers,
        baubles, lights, garlands,
        star: {x: xmasX, y: xmasBase - xmasHeight - 3 * s, r: 11 * s},
        gifts: [
            {x: xmasX - 62 * s, w: 30 * s, h: 25 * s, y: xmasBase + 8 * s, color: '#d7263d', ribbon: '#ffd166'},
            {x: xmasX + 28 * s, w: 40 * s, h: 22 * s, y: xmasBase + 9 * s, color: '#2a9d8f', ribbon: '#f4f1de'},
            {x: xmasX - 26 * s, w: 24 * s, h: 18 * s, y: xmasBase + 13 * s, color: '#3a86ff', ribbon: '#ffd166'},
        ],
    };

    const margin = 16 * s;
    const lightsBox = {
        x: Math.floor(xmasX - tiers[0].w - margin),
        y: Math.floor(xmas.star.y - xmas.star.r - 2 * margin),
        width: Math.ceil(2 * (tiers[0].w + margin)),
        height: Math.ceil(xmasHeight + 3 * margin),
    };

    return {
        width, height, s, hills, farTrees, midTrees, nearTrees, drifts, xmas, lightsBox, lake,
        cabin: {x: cabinX, base: hills[1](cabinX) + 7 * s},
        snowman: {x: snowmanX, base: hills[2](snowmanX) + 18 * s, h: 92 * s},
    };
}

const MAX_LAND_ASPECT = 0.3;    // the landscape strip is never taller than this share of the width

function layoutSky(width, height, horizon, seed) {
    const rand = rng(seed ^ 0x5a17);
    const u = height / 1080;

    const sun = {x: width * 0.2, y: horizon - 70 * u, r: 24 * u};
    const moon = {x: width * 0.8, y: height * 0.17, r: 30 * u, maria: []};
    for (let i = 0; i < 7; i++) {
        const a = rand() * TAU;
        const d = Math.sqrt(rand()) * 0.62;
        moon.maria.push({
            dx: Math.cos(a) * d, dy: Math.sin(a) * d,
            rx: 0.12 + rand() * 0.22, ry: 0.1 + rand() * 0.16, alpha: 0.05 + rand() * 0.07,
        });
    }

    // Stars thin out towards the horizon and keep clear of the moon.
    const tints = [[1, 1, 1], [0.82, 0.88, 1], [1, 0.93, 0.82], [0.9, 0.95, 1]];
    const nearMoon = (x, y) => Math.hypot(x - moon.x, y - moon.y) < moon.r * 3.2;
    const stars = [];
    const count = Math.round(width * height / 5200);
    for (let i = 0; i < count; i++) {
        const x = rand() * width;
        const y = Math.pow(rand(), 1.45) * horizon;
        const big = Math.pow(rand(), 7);
        const tint = tints[Math.floor(rand() * tints.length)];
        const alpha = (0.35 + 0.65 * rand()) * (1 - 0.65 * y / horizon);
        if (!nearMoon(x, y))
            stars.push({x, y, r: (0.45 + big * 1.4) * Math.max(1, u), alpha, tint, glint: big > 0.45});
    }

    // A faint Milky Way: a soft band of tiny stars rising from the lower left.
    const band = {x0: width * 0.04, y0: horizon * 0.95, x1: width * 0.66, y1: -height * 0.05};
    const dust = [];
    const glow = [];
    const length = Math.hypot(band.x1 - band.x0, band.y1 - band.y0);
    const nx = -(band.y1 - band.y0) / length;
    const ny = (band.x1 - band.x0) / length;
    const along = (t, off) => [
        band.x0 + (band.x1 - band.x0) * t + nx * off,
        band.y0 + (band.y1 - band.y0) * t + ny * off,
    ];
    const spread = 70 * u;
    for (let i = 0; i < count * 1.6; i++) {
        const t = rand();
        const off = (rand() + rand() + rand() - 1.5) * spread * (0.8 + 0.5 * Math.sin(t * 9));
        const [x, y] = along(t, off);
        if (y < horizon * 0.97 && y > 0 && !nearMoon(x, y))
            dust.push({x, y, r: (0.35 + rand() * 0.4) * Math.max(1, u), alpha: 0.12 + rand() * 0.3});
    }
    for (let i = 0; i <= 14; i++) {
        const t = i / 14;
        const [x, y] = along(t, (rand() - 0.5) * spread * 0.6);
        glow.push({x, y, r: spread * (1.2 + rand() * 0.8)});
    }

    return {horizon, u, sun, moon, stars, milkyWay: {dust, glow}};
}

// Three ranges, far to near. Distant ranges are taller but fade into the haze.
const RANGES = [
    {haze: 0.66, spacing: 420, minH: 0.2, maxH: 0.36, detail: 0.012},
    {haze: 0.42, spacing: 320, minH: 0.14, maxH: 0.27, detail: 0.014},
    {haze: 0.18, spacing: 250, minH: 0.08, maxH: 0.18, detail: 0.016},
];

// A range is the upper envelope of a row of peaks, each a steep-sided
// triangle, roughened with noise. `saddleX` gets a low pass for the sun.
function layoutRange(width, height, base, saddleX, def, rand) {
    const u = height / 1080;
    const spacing = def.spacing * u;
    const peaks = [];
    for (let x = -spacing * rand(); x < width + spacing; x += spacing * (0.6 + rand() * 0.8)) {
        const saddle = 1 - 0.72 * Math.exp(-(((x - saddleX) / (width * 0.11)) ** 2));
        peaks.push({
            x,
            h: height * (def.minH + rand() * (def.maxH - def.minH)) * saddle,
            left: 0.5 + rand() * 0.5,
            right: 0.5 + rand() * 0.5,
        });
    }

    const coarse = valueNoise(rand, width, 46 * u);
    const fine = valueNoise(rand, width, 13 * u);
    const step = Math.max(2, 3 * u);
    const points = [];
    for (let x = 0; x <= width + step; x += step) {
        let top = 0;
        let owner = 0;
        peaks.forEach((p, i) => {
            const d = x - p.x;
            const h = p.h - Math.abs(d) * (d < 0 ? p.left : p.right);
            if (h > top) {
                top = h;
                owner = i;
            }
        });
        const rough = height * def.detail * (0.6 * coarse(x) + 0.4 * fine(x)) * Math.min(1, top / (height * 0.06));
        points.push({x, y: base - Math.max(height * 0.02, top + rough), owner});
    }

    // Each summit gets a jagged line down its shadowed face, used for shading.
    const faces = peaks.map((p, i) => {
        const own = points.filter(pt => pt.owner === i);
        if (own.length < 3)
            return null;
        const summit = own.reduce((a, b) => (b.y < a.y ? b : a));
        const crest = [];
        const drop = base - summit.y;
        for (let k = 1; k <= 5; k++) {
            crest.push({
                dx: (rand() - 0.5) * drop * 0.14 + (k / 5) * drop * (0.05 + rand() * 0.12),
                y: summit.y + drop * (k / 5),
            });
        }
        // Gullies: thin streaks of exposed rock running down the shadowed face.
        const gullies = [];
        const count = 3 + Math.floor(rand() * 4);
        for (let k = 0; k < count; k++) {
            const start = 0.05 + rand() * 0.4;
            gullies.push({
                start,
                length: 0.12 + rand() * 0.3,
                spread: 0.15 + rand() * 0.55,
                width: 0.008 + rand() * 0.014,
                wobble: (rand() - 0.5) * 0.06,
            });
        }
        const first = own[0];
        const last = own[own.length - 1];
        return {summit, crest, gullies, first, last};
    }).filter(Boolean);

    return {points, faces, base};
}

function layoutMountains(width, height, base, saddleX, seed) {
    const rand = rng(seed ^ 0x3c1f);
    return RANGES.map(def => ({def, ...layoutRange(width, height, base, saddleX, def, rand)}));
}

function ridgeY(range, x) {
    const pts = range.points;
    const i = Math.max(0, Math.min(pts.length - 1, Math.round(x / (pts[1].x - pts[0].x))));
    return pts[i].y;
}

const AURORA_COLORS = [
    [[0.25, 1, 0.6], [0.55, 0.3, 0.95]],
    [[0.2, 0.95, 0.78], [0.3, 0.8, 0.55]],
    [[0.35, 1, 0.55], [0.95, 0.35, 0.7]],
];

function layoutAurora(width, height, bottom, seed) {
    const rand = rng(seed ^ 0xa0e0);
    const u = height / 1080;
    const sign = () => (rand() < 0.5 ? -1 : 1);
    const curtains = AURORA_COLORS.map(([low, high], i) => {
        const x0 = -0.1 * width + rand() * 0.3 * width;
        return {
            low, high,
            x0, x1: x0 + width * (0.7 + rand() * 0.5),
            base: height * (0.34 + i * 0.07 + rand() * 0.06),
            tall: height * (0.16 + rand() * 0.14),
            strength: 0.42 + rand() * 0.18,
            amp1: (35 + rand() * 55) * u, k1: TAU / ((650 + rand() * 600) * u), w1: sign() * (0.04 + rand() * 0.05),
            amp2: (10 + rand() * 22) * u, k2: TAU / ((210 + rand() * 160) * u), w2: sign() * (0.07 + rand() * 0.06),
            k3: TAU / ((380 + rand() * 300) * u), w3: sign() * (0.05 + rand() * 0.05),
            kr: TAU / ((26 + rand() * 20) * u), wr: sign() * (0.12 + rand() * 0.13),
            k4: TAU / ((500 + rand() * 400) * u), w4: sign() * (0.04 + rand() * 0.04),
            p1: rand() * TAU, p2: rand() * TAU, p3: rand() * TAU, p4: rand() * TAU, pr: rand() * TAU,
        };
    });
    return {u, bottom, curtains};
}

export function layoutScene(width, height, seed, landShare = 0.38) {
    const landHeight = Math.round(Math.min(height * landShare, width * MAX_LAND_ASPECT));
    const landTop = height - landHeight;
    // Sized for a 1080 px monitor, shrinking only when the strip is too short to hold it.
    const s = Math.min(height / 1080, landHeight / 260);
    const land = layoutLand(width, landHeight, seed, s);
    // The sky's gradient ends a little above the middle of the landscape strip,
    // roughly where the far hills meet it.
    const sky = layoutSky(width, height, landTop + landHeight * 0.4, seed);
    // Mountains stand on a line hidden behind the far hills.
    const mountains = layoutMountains(width, height, landTop + landHeight * 0.48, sky.sun.x, seed);
    // The low sun sits in the saddle, just clear of the highest ridge there.
    const ridge = Math.min(...mountains.map(range => ridgeY(range, sky.sun.x)));
    sky.sun.y = Math.min(sky.sun.y, ridge - sky.sun.r * 1.5);
    const aurora = layoutAurora(width, height, mountains[0].base, seed);
    const box = land.lightsBox;
    return {
        width, height, landTop, land, sky, mountains, aurora,
        lightsBox: {...box, y: box.y + landTop},
    };
}

function paintSky(cr, scene, pal) {
    const {width, sky} = scene;
    const {horizon, u} = sky;

    const gradient = new Cairo.LinearGradient(0, 0, 0, horizon);
    for (const [offset, color] of pal.sky)
        gradient.addColorStopRGBA(offset, ...hex(color), 1);
    cr.setSource(gradient);
    cr.rectangle(0, 0, width, scene.height);
    cr.fill();

    if (pal.night)
        paintNightSky(cr, sky);
    else
        paintSun(cr, sky.sun, width);
}

function tracePoints(cr, points, base) {
    cr.moveTo(points[0].x, base + 2);
    for (const {x, y} of points)
        cr.lineTo(x, y);
    cr.lineTo(points[points.length - 1].x, base + 2);
    cr.closePath();
}

function paintMountains(cr, scene, pal) {
    const colors = pal.mountains;
    const {height} = scene;

    for (const range of scene.mountains) {
        const {points, faces, base, def} = range;
        const top = Math.min(...points.map(p => p.y));
        const lit = mix(colors.lit, colors.haze, def.haze);
        const litLow = mix(colors.shade, colors.haze, Math.min(1, def.haze + 0.35));
        const shade = mix(colors.shade, colors.haze, def.haze);
        const rock = mix(colors.rock, colors.haze, def.haze);

        cr.save();
        tracePoints(cr, points, base);
        cr.clip();

        // Snow in full light, a touch bluer towards the foot.
        const body = new Cairo.LinearGradient(0, top, 0, base);
        body.addColorStopRGBA(0, ...lit, 1);
        body.addColorStopRGBA(1, ...litLow, 1);
        cr.setSource(body);
        cr.paint();

        // The face turned away from the light, from each summit down to the valley.
        cr.setSourceRGBA(...shade, 1);
        for (const face of faces) {
            const {summit, crest} = face;
            const dir = colors.lightFromLeft ? 1 : -1;
            const valley = colors.lightFromLeft ? face.last : face.first;
            cr.moveTo(summit.x, summit.y);
            for (const p of points) {
                if ((p.x - summit.x) * dir > 0 && (valley.x - p.x) * dir >= 0)
                    cr.lineTo(p.x, p.y);
            }
            // Down from the valley, slanting back under the summit so the
            // shadow never spills onto the neighbouring peak's lit face.
            cr.lineTo(valley.x - dir * (base - valley.y) * 0.35, base + 2);
            for (let k = crest.length - 1; k >= 0; k--)
                cr.lineTo(summit.x + crest[k].dx * dir, crest[k].y);
            cr.closePath();
            cr.fill();

            // Rock gullies fanning down the shadowed face from near the summit.
            const drop = base - summit.y;
            cr.setSourceRGBA(...rock, 0.42);
            for (const g of face.gullies) {
                const x0 = summit.x + dir * drop * g.start * g.spread;
                const y0 = summit.y + drop * g.start;
                const x1 = x0 + dir * drop * g.length * (0.25 + g.spread * 0.6);
                const y1 = y0 + drop * g.length;
                const w = drop * g.width;
                const mx = (x0 + x1) / 2 + drop * g.wobble;
                const my = (y0 + y1) / 2;
                cr.moveTo(x0, y0);
                cr.curveTo(mx + w, my, mx + w * 0.6, my, x1, y1);
                cr.curveTo(mx - w * 0.6, my, mx - w, my, x0, y0);
                cr.closePath();
                cr.fill();
            }
        }

        // Haze collecting at the foot of the range.
        const mist = new Cairo.LinearGradient(0, base, 0, base - height * 0.16);
        mist.addColorStopRGBA(0, ...hex(colors.haze), 0.9);
        mist.addColorStopRGBA(1, ...hex(colors.haze), 0);
        cr.setSource(mist);
        cr.paint();
        cr.restore();
    }

    // The low sun's light spills over the nearest ridges.
    if (!pal.night)
        paintSunGlow(cr, scene.sky.sun, [[scene.width * 0.3, 0.16], [scene.sky.sun.r * 5, 0.3]]);
}

function paintSunGlow(cr, sun, glows) {
    const {x, y} = sun;
    for (const [radius, alpha] of glows) {
        const glow = new Cairo.RadialGradient(x, y, 0, x, y, radius);
        glow.addColorStopRGBA(0, 1, 0.86, 0.62, alpha);
        glow.addColorStopRGBA(0.35, 1, 0.8, 0.58, alpha * 0.35);
        glow.addColorStopRGBA(1, 1, 0.8, 0.58, 0);
        cr.setSource(glow);
        cr.newSubPath();
        cr.arc(x, y, radius, 0, TAU);
        cr.fill();
    }
}

function paintSun(cr, sun, width) {
    const {x, y, r} = sun;

    // A wide warm glow that tints the lower sky, then a tighter bloom.
    paintSunGlow(cr, sun, [[width * 0.45, 0.32], [r * 7, 0.45]]);

    const disc = new Cairo.RadialGradient(x, y, 0, x, y, r);
    disc.addColorStopRGBA(0, 1, 1, 0.97, 1);
    disc.addColorStopRGBA(0.7, 1, 0.97, 0.86, 1);
    disc.addColorStopRGBA(1, 1, 0.9, 0.7, 0.9);
    cr.setSource(disc);
    cr.newSubPath();
    cr.arc(x, y, r, 0, TAU);
    cr.fill();
}

function paintNightSky(cr, sky) {
    const {stars, moon, milkyWay} = sky;

    for (const {x, y, r} of milkyWay.glow) {
        const glow = new Cairo.RadialGradient(x, y, 0, x, y, r);
        glow.addColorStopRGBA(0, 0.7, 0.76, 0.95, 0.045);
        glow.addColorStopRGBA(1, 0.7, 0.76, 0.95, 0);
        cr.setSource(glow);
        cr.newSubPath();
        cr.arc(x, y, r, 0, TAU);
        cr.fill();
    }
    for (const {x, y, r, alpha} of milkyWay.dust) {
        cr.setSourceRGBA(0.92, 0.94, 1, alpha);
        cr.newSubPath();
        cr.arc(x, y, r, 0, TAU);
        cr.fill();
    }

    for (const {x, y, r, alpha, tint, glint} of stars) {
        cr.setSourceRGBA(...tint, alpha);
        cr.newSubPath();
        cr.arc(x, y, r, 0, TAU);
        cr.fill();
        if (glint) {
            cr.setSourceRGBA(...tint, alpha * 0.35);
            cr.setLineWidth(r * 0.45);
            cr.moveTo(x - r * 4, y);
            cr.lineTo(x + r * 4, y);
            cr.moveTo(x, y - r * 4);
            cr.lineTo(x, y + r * 4);
            cr.stroke();
        }
    }

    const {x, y, r} = moon;
    const halo = new Cairo.RadialGradient(x, y, r * 0.9, x, y, r * 7);
    halo.addColorStopRGBA(0, 0.78, 0.85, 1, 0.22);
    halo.addColorStopRGBA(0.3, 0.78, 0.85, 1, 0.06);
    halo.addColorStopRGBA(1, 0.78, 0.85, 1, 0);
    cr.setSource(halo);
    cr.newSubPath();
    cr.arc(x, y, r * 7, 0, TAU);
    cr.fill();

    const disc = new Cairo.RadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
    disc.addColorStopRGBA(0, 0.99, 0.98, 0.94, 1);
    disc.addColorStopRGBA(1, 0.86, 0.86, 0.82, 1);
    cr.setSource(disc);
    cr.newSubPath();
    cr.arc(x, y, r, 0, TAU);
    cr.fillPreserve();

    cr.save();
    cr.clip();
    for (const m of moon.maria) {
        cr.setSourceRGBA(0.42, 0.45, 0.52, m.alpha);
        ellipse(cr, x + m.dx * r, y + m.dy * r, m.rx * r, m.ry * r);
        cr.fill();
    }
    cr.restore();
}

function paintHill(cr, scene, hill, colors) {
    const {width, height} = scene;
    const step = 6;
    let top = height;

    cr.moveTo(0, height);
    for (let x = 0; x <= width + step; x += step) {
        const y = hill(x);
        if (y < top)
            top = y;
        cr.lineTo(x, y);
    }
    cr.lineTo(width + step, height);
    cr.closePath();
    cr.setSource(linearGradient(0, top, 0, height, colors[0], colors[1]));
    cr.fill();
}

function paintFarPine(cr, tree, color) {
    const {x, base, h} = tree;
    setColor(cr, color);
    for (let i = 0; i < 3; i++) {
        const yb = base - h * 0.08 - i * h * 0.26;
        const hw = h * 0.3 * (1 - i * 0.26);
        cr.moveTo(x, yb - h * 0.42);
        cr.lineTo(x - hw, yb);
        cr.lineTo(x + hw, yb);
        cr.closePath();
    }
    cr.rectangle(x - h * 0.03, base - h * 0.1, h * 0.06, h * 0.1);
    cr.fill();
}

function paintPine(cr, tree, greens, snow, trunk, snowiness) {
    const {x, base, h} = tree;
    const tiers = tree.geometry ?? pineTiers(x, base, h, tree.tiers, 0.3);

    setColor(cr, trunk);
    cr.rectangle(x - h * 0.035, base - h * 0.13, h * 0.07, h * 0.13);
    cr.fill();

    for (const {yt, yb, th, w} of tiers) {
        cr.moveTo(x, yt);
        cr.curveTo(x - w * 0.22, yt + th * 0.45, x - w * 0.62, yb - th * 0.22, x - w, yb);
        cr.curveTo(x - w * 0.5, yb - th * 0.13, x + w * 0.5, yb - th * 0.13, x + w, yb);
        cr.curveTo(x + w * 0.62, yb - th * 0.22, x + w * 0.22, yt + th * 0.45, x, yt);
        cr.setSource(linearGradient(x - w, 0, x + w, 0, greens[0], greens[1]));
        cr.fill();

        // Snow resting on the upper part of the tier, with a dripping lower edge.
        const f = 0.56 * snowiness;
        const sy = yt + th * f;
        const sw = w * Math.pow(f, 1.25) * 1.04;
        const d = th * 0.1;
        cr.moveTo(x, yt - th * 0.02);
        cr.curveTo(x - w * 0.16, yt + th * f * 0.5, x - sw * 0.75, sy - th * 0.14, x - sw, sy);
        cr.curveTo(x - sw * 0.82, sy + d, x - sw * 0.52, sy + d, x - sw * 0.4, sy - d * 0.5);
        cr.curveTo(x - sw * 0.25, sy - d * 1.4, x - sw * 0.1, sy + d * 1.2, x + sw * 0.08, sy + d * 0.3);
        cr.curveTo(x + sw * 0.3, sy - d * 1.2, x + sw * 0.55, sy + d * 1.3, x + sw * 0.7, sy + d * 0.2);
        cr.curveTo(x + sw * 0.85, sy - d * 0.6, x + sw * 0.95, sy - d * 0.2, x + sw, sy);
        cr.curveTo(x + sw * 0.75, sy - th * 0.14, x + w * 0.16, yt + th * f * 0.5, x, yt - th * 0.02);
        setColor(cr, snow);
        cr.fill();
    }
}

function paintCabin(cr, cabin, s, pal) {
    const {x, base} = cabin;
    const W = 118 * s;
    const H = 58 * s;
    const R = 46 * s;
    const eave = 13 * s;
    const left = x - W / 2;
    const top = base - H;

    // Chimney and its smoke go first so the roof overlaps them.
    const chimneyX = x + W * 0.2;
    const chimneyTop = top - R * 0.98;
    for (let i = 0; i < 4; i++) {
        cr.setSourceRGBA(1, 1, 1, 0.3 - i * 0.06);
        ellipse(cr, chimneyX + (7 + i * 10) * s, chimneyTop - (10 + i * 13) * s,
            (6 + i * 3.4) * s, (5 + i * 2.6) * s);
        cr.fill();
    }
    setColor(cr, '#8a4636');
    cr.rectangle(chimneyX, chimneyTop, 15 * s, 36 * s);
    cr.fill();
    setColor(cr, pal.nearSnow);
    ellipse(cr, chimneyX + 7.5 * s, chimneyTop, 10 * s, 4 * s);
    cr.fill();

    // Walls and gable.
    cr.rectangle(left, top, W, H + 8 * s);
    cr.moveTo(left, top + 1);
    cr.lineTo(x, top - R + 4 * s);
    cr.lineTo(left + W, top + 1);
    cr.closePath();
    cr.setSource(linearGradient(left, 0, left + W, 0, pal.wood[0], pal.wood[1]));
    cr.fill();

    setColor(cr, pal.roof, 0.3);
    cr.setLineWidth(Math.max(1, s));
    for (let y = top + 9 * s; y < base; y += 9.5 * s) {
        cr.moveTo(left, y);
        cr.lineTo(left + W, y);
    }
    cr.stroke();

    // Roof beams, then a thick blanket of snow on top of them.
    const roofPath = lift => {
        cr.moveTo(left - eave, top + 5 * s - lift);
        cr.lineTo(x, top - R - lift);
        cr.lineTo(left + W + eave, top + 5 * s - lift);
    };
    cr.setLineJoin(Cairo.LineJoin.ROUND);
    cr.setLineCap(Cairo.LineCap.ROUND);
    setColor(cr, pal.roof);
    cr.setLineWidth(7 * s);
    roofPath(0);
    cr.stroke();
    setColor(cr, pal.nearSnow);
    cr.setLineWidth(10 * s);
    roofPath(6.5 * s);
    cr.stroke();
    ellipse(cr, left - eave + 2 * s, top + 2 * s, 8 * s, 6.5 * s);
    ellipse(cr, left + W + eave - 2 * s, top + 2 * s, 8 * s, 6.5 * s);
    cr.fill();

    // Door.
    setColor(cr, '#3d2617');
    roundedRect(cr, x - W * 0.37, base - 37 * s, 23 * s, 40 * s, 2 * s);
    cr.fill();
    setColor(cr, '#e0b04a');
    cr.arc(x - W * 0.37 + 18 * s, base - 16 * s, 1.6 * s, 0, TAU);
    cr.fill();

    // Lit window with a warm glow spilling out.
    const wx = x + W * 0.08;
    const wy = base - 45 * s;
    const ww = 31 * s;
    const wh = 26 * s;
    const glow = new Cairo.RadialGradient(wx + ww / 2, wy + wh / 2, 4 * s,
        wx + ww / 2, wy + wh / 2, 62 * s);
    glow.addColorStopRGBA(0, 1, 0.82, 0.45, pal.glow);
    glow.addColorStopRGBA(1, 1, 0.82, 0.45, 0);
    cr.setSource(glow);
    cr.arc(wx + ww / 2, wy + wh / 2, 62 * s, 0, TAU);
    cr.fill();

    cr.setSource(linearGradient(0, wy, 0, wy + wh, '#ffe89a', '#ffb44a'));
    cr.rectangle(wx, wy, ww, wh);
    cr.fill();
    setColor(cr, pal.roof);
    cr.setLineWidth(2.6 * s);
    cr.rectangle(wx, wy, ww, wh);
    cr.stroke();
    cr.setLineWidth(1.6 * s);
    cr.moveTo(wx + ww / 2, wy);
    cr.lineTo(wx + ww / 2, wy + wh);
    cr.moveTo(wx, wy + wh / 2);
    cr.lineTo(wx + ww, wy + wh / 2);
    cr.stroke();
    setColor(cr, pal.nearSnow);
    roundedRect(cr, wx - 3 * s, wy + wh - 1.5 * s, ww + 6 * s, 4.5 * s, 2 * s);
    cr.fill();

    // Little round attic window.
    setColor(cr, '#ffd27a');
    cr.arc(x, top - R * 0.36, 6.5 * s, 0, TAU);
    cr.fill();
    setColor(cr, pal.roof);
    cr.setLineWidth(2 * s);
    cr.arc(x, top - R * 0.36, 6.5 * s, 0, TAU);
    cr.stroke();

    // Snow banked up against the walls.
    setColor(cr, pal.mid[0]);
    ellipse(cr, x, base + 6 * s, W * 0.68, 8 * s);
    cr.fill();
}

function paintSnowman(cr, man, s, pal) {
    const {x, base, h} = man;
    const r1 = h * 0.27;
    const r2 = h * 0.2;
    const r3 = h * 0.145;
    const y1 = base - r1 * 0.92;
    const y2 = y1 - r1 - r2 * 0.55;
    const y3 = y2 - r2 - r3 * 0.6;

    cr.setSourceRGBA(...pal.shade);
    ellipse(cr, x + r1 * 0.3, base - r1 * 0.02, r1 * 1.3, r1 * 0.2);
    cr.fill();

    // Twig arms.
    setColor(cr, '#5b3a22');
    cr.setLineWidth(2.2 * s);
    cr.setLineCap(Cairo.LineCap.ROUND);
    cr.moveTo(x - r2 * 0.8, y2 - r2 * 0.1);
    cr.lineTo(x - r2 * 2.15, y2 - r2 * 1.0);
    cr.moveTo(x - r2 * 1.6, y2 - r2 * 0.63);
    cr.lineTo(x - r2 * 1.75, y2 - r2 * 1.2);
    cr.moveTo(x - r2 * 1.75, y2 - r2 * 0.73);
    cr.lineTo(x - r2 * 2.3, y2 - r2 * 0.6);
    cr.moveTo(x + r2 * 0.8, y2 - r2 * 0.1);
    cr.lineTo(x + r2 * 2.2, y2 - r2 * 0.75);
    cr.moveTo(x + r2 * 1.65, y2 - r2 * 0.5);
    cr.lineTo(x + r2 * 1.95, y2 - r2 * 1.1);
    cr.moveTo(x + r2 * 1.8, y2 - r2 * 0.57);
    cr.lineTo(x + r2 * 2.3, y2 - r2 * 0.35);
    cr.stroke();

    for (const [cy, r] of [[y1, r1], [y2, r2], [y3, r3]]) {
        const shading = new Cairo.RadialGradient(
            x - r * 0.35, cy - r * 0.4, r * 0.1, x, cy, r * 1.05);
        shading.addColorStopRGBA(0, ...hex(pal.snowman[0]), 1);
        shading.addColorStopRGBA(0.55, ...hex(pal.snowman[0]), 1);
        shading.addColorStopRGBA(1, ...hex(pal.snowman[1]), 1);
        cr.setSource(shading);
        cr.newSubPath();
        cr.arc(x, cy, r, 0, TAU);
        cr.fill();
    }

    // Coal: buttons, eyes and a smile.
    setColor(cr, '#20242b');
    for (const dy of [-0.45, 0.05, 0.55]) {
        cr.newSubPath();
        cr.arc(x + r2 * 0.05, y2 + r2 * dy, r2 * 0.1, 0, TAU);
    }
    for (const dx of [-0.38, 0.4]) {
        cr.newSubPath();
        cr.arc(x + r3 * dx, y3 - r3 * 0.22, r3 * 0.12, 0, TAU);
    }
    for (let i = 0; i < 5; i++) {
        const a = Math.PI * (0.22 + i * 0.14);
        cr.newSubPath();
        cr.arc(x + r3 * 0.05 + Math.cos(a) * r3 * 0.5, y3 + r3 * 0.12 + Math.sin(a) * r3 * 0.42,
            r3 * 0.065, 0, TAU);
    }
    cr.fill();

    // Carrot nose.
    setColor(cr, '#f08a24');
    cr.moveTo(x + r3 * 0.02, y3 - r3 * 0.06);
    cr.lineTo(x + r3 * 1.0, y3 + r3 * 0.16);
    cr.lineTo(x + r3 * 0.02, y3 + r3 * 0.2);
    cr.closePath();
    cr.fill();

    // Scarf with a tail hanging on the right.
    const neck = y3 + r3 * 0.86;
    setColor(cr, '#c8232c');
    cr.setLineWidth(r3 * 0.46);
    cr.moveTo(x - r3 * 0.9, neck - r3 * 0.1);
    cr.curveTo(x - r3 * 0.4, neck + r3 * 0.22, x + r3 * 0.4, neck + r3 * 0.22, x + r3 * 0.9, neck - r3 * 0.1);
    cr.stroke();
    cr.setLineWidth(r3 * 0.4);
    cr.moveTo(x + r3 * 0.55, neck + r3 * 0.1);
    cr.lineTo(x + r3 * 0.85, neck + r3 * 1.25);
    cr.stroke();

    // Top hat, tipped slightly.
    cr.save();
    cr.translate(x, y3 - r3 * 0.74);
    cr.rotate(-0.13);
    setColor(cr, '#23272f');
    roundedRect(cr, -r3 * 1.1, -r3 * 0.14, r3 * 2.2, r3 * 0.24, r3 * 0.1);
    cr.rectangle(-r3 * 0.7, -r3 * 1.22, r3 * 1.4, r3 * 1.12);
    cr.fill();
    setColor(cr, '#c8232c');
    cr.rectangle(-r3 * 0.7, -r3 * 0.44, r3 * 1.4, r3 * 0.28);
    cr.fill();
    cr.restore();
}

function paintStar(cr, star, s) {
    const {x, y, r} = star;
    cr.newSubPath();
    for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + i * Math.PI / 5;
        const radius = i % 2 ? r * 0.45 : r;
        cr.lineTo(x + Math.cos(a) * radius, y + Math.sin(a) * radius);
    }
    cr.closePath();
    setColor(cr, '#ffd23f');
    cr.fillPreserve();
    setColor(cr, '#f0a500');
    cr.setLineWidth(s);
    cr.stroke();
}

function paintGift(cr, gift, s, snow) {
    const {x, y, w, h, color, ribbon} = gift;
    const top = y - h;

    setColor(cr, color);
    cr.rectangle(x, top, w, h);
    cr.fill();
    cr.setSourceRGBA(0, 0, 0, 0.16);
    cr.rectangle(x + w * 0.62, top, w * 0.38, h);
    cr.fill();

    setColor(cr, ribbon);
    cr.rectangle(x + w * 0.42, top, w * 0.16, h);
    cr.rectangle(x, top + h * 0.42, w, h * 0.16);
    cr.fill();
    ellipse(cr, x + w * 0.38, top - 3 * s, 5 * s, 3.4 * s);
    ellipse(cr, x + w * 0.62, top - 3 * s, 5 * s, 3.4 * s);
    cr.fill();

    setColor(cr, snow);
    roundedRect(cr, x - 1.5 * s, top - 1.5 * s, w * 0.34, 3.4 * s, 1.6 * s);
    roundedRect(cr, x + w * 0.7, top - 1.5 * s, w * 0.3 + 1.5 * s, 3.4 * s, 1.6 * s);
    cr.fill();
}

function paintXmasTree(cr, xmas, s, pal) {
    cr.setSourceRGBA(...pal.shade);
    ellipse(cr, xmas.x + 8 * s, xmas.base + 2 * s, xmas.geometry[0].w * 1.05, 9 * s);
    cr.fill();

    paintPine(cr, xmas, pal.xmasTree, pal.nearSnow, pal.trunk, 0.5);

    // The wire the lights hang on.
    setColor(cr, '#d9b44a', 0.75);
    cr.setLineWidth(1.1 * s);
    for (const garland of xmas.garlands) {
        garland.forEach(({x, y}, i) => (i ? cr.lineTo(x, y) : cr.moveTo(x, y)));
        cr.stroke();
    }

    for (const {x, y, color} of xmas.baubles) {
        setColor(cr, color);
        cr.newSubPath();
        cr.arc(x, y, 3.6 * s, 0, TAU);
        cr.fill();
        cr.setSourceRGBA(1, 1, 1, 0.65);
        cr.newSubPath();
        cr.arc(x - 1.1 * s, y - 1.3 * s, 1.1 * s, 0, TAU);
        cr.fill();
    }

    paintStar(cr, xmas.star, s);

    for (const gift of xmas.gifts)
        paintGift(cr, gift, s, pal.nearSnow);
}

// The scene is painted in two static layers so the animated aurora can sit
// between them: paintSkyLayer() at the back, paintForeground() in front (it is
// transparent above the mountains). paintScene() paints both, for tools.
export function paintScene(cr, scene, pal) {
    paintSkyLayer(cr, scene, pal);
    paintForeground(cr, scene, pal);
}

export function paintSkyLayer(cr, scene, pal) {
    paintSky(cr, scene, pal);
}

export function paintForeground(cr, scene, pal) {
    // Everything behind the lake, mirrored in the ice. The aurora is not
    // reflected: it is redrawn on its own layer and the lake is static.
    const backdrop = () => {
        paintSky(cr, scene, pal);
        paintMountains(cr, scene, pal);
        cr.save();
        cr.translate(0, scene.landTop);
        paintFarShore(cr, scene.land, pal);
        cr.restore();
    };

    paintMountains(cr, scene, pal);
    cr.save();
    cr.translate(0, scene.landTop);
    paintFarShore(cr, scene.land, pal);
    paintLake(cr, scene.land, pal, scene.landTop, backdrop);
    paintLand(cr, scene.land, pal);
    cr.restore();
}

// A shooting star pointing right, head at the right end, vertically centred.
// The caller rotates and moves it; `u` is the monitor height / 1080.
export function paintMeteor(cr, width, height, u) {
    const cy = height / 2;
    const head = width - height / 2;

    const tail = new Cairo.LinearGradient(0, 0, head, 0);
    tail.addColorStopRGBA(0, 0.7, 0.8, 1, 0);
    tail.addColorStopRGBA(0.75, 0.85, 0.9, 1, 0.3);
    tail.addColorStopRGBA(1, 1, 1, 1, 0.95);
    cr.setSource(tail);
    cr.moveTo(0, cy);
    cr.lineTo(head, cy - 1.3 * u);
    cr.lineTo(head, cy + 1.3 * u);
    cr.closePath();
    cr.fill();

    const glow = new Cairo.RadialGradient(head, cy, 0, head, cy, height / 2);
    glow.addColorStopRGBA(0, 1, 1, 1, 1);
    glow.addColorStopRGBA(0.25, 0.9, 0.95, 1, 0.7);
    glow.addColorStopRGBA(1, 0.7, 0.8, 1, 0);
    cr.setSource(glow);
    cr.arc(head, cy, height / 2, 0, TAU);
    cr.fill();
}

// Draws the aurora at time `t` (seconds) in monitor coordinates, into its own
// transparent layer. The caller may scale the context down; it is soft enough
// to be drawn at low resolution and scaled up.
export function paintAurora(cr, scene, t) {
    const {curtains, u} = scene.aurora;
    const chunk = 20 * u;

    for (const c of curtains) {
        const base = x => c.base +
            c.amp1 * Math.sin(c.k1 * x + c.p1 + c.w1 * t) +
            c.amp2 * Math.sin(c.k2 * x + c.p2 + c.w2 * t);
        const tall = x => c.tall * (0.65 + 0.35 * Math.sin(c.k4 * x + c.p4 + c.w4 * t));

        // The curtain is drawn in chunks. Each chunk's lower edge is a
        // straight segment of the wavy base line, and its gradient is tilted
        // perpendicular to that segment, so the bright lower edge follows the
        // wave smoothly from chunk to chunk. Clipping to the curtain's reach
        // keeps the offscreen group, and so the per-frame pixel work, small.
        cr.save();
        const reach = c.amp1 + c.amp2;
        cr.rectangle(c.x0, c.base - reach - c.tall, c.x1 - c.x0, c.tall + 2 * reach + 12 * u);
        cr.clip();
        cr.pushGroup();
        const [lr, lg, lb] = c.low;
        const [hr, hg, hb] = c.high;
        const drop = 10 * u;
        for (let x0 = c.x0; x0 < c.x1; x0 += chunk) {
            const x1 = Math.min(c.x1, x0 + chunk);
            const b0 = base(x0) + drop;
            const b1 = base(x1) + drop;
            const t0 = tall(x0);
            const t1 = tall(x1);
            const h = (t0 + t1) / 2;

            cr.moveTo(x0, b0);
            cr.lineTo(x1, b1);
            cr.lineTo(x1, b1 - t1 - drop);
            cr.lineTo(x0, b0 - t0 - drop);
            cr.closePath();

            // Unit normal of the lower edge, pointing up into the curtain.
            const len = Math.hypot(x1 - x0, b1 - b0);
            const nx = (b1 - b0) / len;
            const ny = -(x1 - x0) / len;
            const mx = (x0 + x1) / 2;
            const my = (b0 + b1) / 2;
            const g = new Cairo.LinearGradient(mx, my, mx + nx * (h + drop), my + ny * (h + drop));
            g.addColorStopRGBA(0, lr, lg, lb, 0);
            g.addColorStopRGBA(0.07, lr, lg, lb, 1);
            g.addColorStopRGBA(0.3, lr, lg, lb, 0.5);
            g.addColorStopRGBA(0.7, hr, hg, hb, 0.22);
            g.addColorStopRGBA(1, hr, hg, hb, 0);
            cr.setSource(g);
            cr.fill();
        }
        const shape = cr.popGroup();

        // Brightness along the curtain: broad drifting glow times fine rays,
        // faded out at both ends.
        const mask = new Cairo.LinearGradient(c.x0, 0, c.x1, 0);
        const stops = 220;
        for (let i = 0; i <= stops; i++) {
            const f = i / stops;
            const x = c.x0 + (c.x1 - c.x0) * f;
            const ends = Math.sin(Math.PI * f) ** 1.5;
            const glow = 0.65 + 0.35 * Math.sin(c.k3 * x + c.p3 + c.w3 * t);
            const rays = 0.62 + 0.38 * Math.sin(c.kr * x + c.pr + c.wr * t);
            mask.addColorStopRGBA(f, 0, 0, 0, ends * glow * rays * c.strength);
        }
        cr.setOperator(Cairo.Operator.ADD);
        cr.setSource(shape);
        cr.mask(mask);
        cr.restore();
    }
}

function paintFarShore(cr, scene, pal) {
    paintHill(cr, scene, scene.hills[0], pal.far);
    for (const tree of scene.farTrees)
        paintFarPine(cr, tree, pal.farTree);
}

function traceLake(cr, scene) {
    const {lake, hills, width, height} = scene;
    const {left, start, ramp, shore} = lake;
    // The left end curves down under the middle hill, where it is hidden.
    cr.moveTo(left, Math.max(hills[1](left), shore) + 6 * scene.s);
    cr.curveTo(left + ramp * 0.35, shore + (hills[1](left) - shore) * 0.25,
        start - ramp * 0.6, shore, start - ramp * 0.1, shore);
    cr.lineTo(width + 2, shore);
    cr.lineTo(width + 2, height);
    cr.lineTo(left, height);
    cr.closePath();
}

function paintLake(cr, scene, pal, landTop, backdrop) {
    const {lake, s, width} = scene;
    const ice = pal.ice;
    const {shore, visible} = lake;

    cr.save();
    traceLake(cr, scene);
    cr.clip();

    // The reflection: everything behind the lake, mirrored about the shore line.
    cr.save();
    cr.translate(0, 2 * shore);
    cr.scale(1, -1);
    cr.translate(0, -landTop);
    backdrop();
    cr.restore();

    // Ice over it, more opaque nearer the viewer.
    const tint = new Cairo.LinearGradient(0, shore, 0, shore + visible);
    tint.addColorStopRGBA(0, ...hex(ice.tint), ice.tintAlpha[0]);
    tint.addColorStopRGBA(1, ...hex(ice.tint), ice.tintAlpha[1]);
    cr.setSource(tint);
    cr.paint();

    // A thin bright rim of snow along the far shore.
    cr.setSourceRGBA(...ice.snow);
    cr.rectangle(0, shore, width, 1.5 * s);
    cr.fill();

    cr.setSourceRGBA(...ice.streak);
    for (const {x, y, length, thick} of lake.streaks) {
        ellipse(cr, x, y, length / 2, thick / 2);
        cr.fill();
    }

    cr.setSourceRGBA(...ice.snow);
    for (const {x, y, blobs} of lake.patches) {
        for (const b of blobs)
            ellipse(cr, x + b.dx, y + b.dy, b.rx, b.ry);
        cr.fill();
    }

    // Cracks: a dark line with a bright edge just above it, thicker up close.
    cr.setLineCap(Cairo.LineCap.ROUND);
    cr.setLineJoin(Cairo.LineJoin.ROUND);
    for (const [colour, offset] of [[ice.crackDark, 0.7], [ice.crackLight, 0]]) {
        cr.setSourceRGBA(...colour);
        for (const crack of lake.cracks) {
            const near = 0.6 + 0.8 * (crack[0][1] - shore) / visible;
            cr.setLineWidth(0.9 * s * near);
            crack.forEach(([x, y], i) => (i ? cr.lineTo(x, y + offset * s) : cr.moveTo(x, y + offset * s)));
            cr.stroke();
        }
    }
    cr.restore();
}

function paintLand(cr, scene, pal) {
    const {hills, s} = scene;

    paintHill(cr, scene, hills[1], pal.mid);
    paintCabin(cr, scene.cabin, s, pal);
    for (const tree of scene.midTrees)
        paintPine(cr, tree, pal.midTree, pal.midSnow, pal.trunk, 1);

    paintHill(cr, scene, hills[2], pal.near);

    cr.setSourceRGBA(...pal.shade);
    cr.setLineWidth(2 * s);
    cr.setLineCap(Cairo.LineCap.ROUND);
    for (const {x, y, length, bend} of scene.drifts) {
        cr.moveTo(x, y);
        cr.curveTo(x + length * 0.3, y - bend, x + length * 0.7, y - bend, x + length, y + bend * 0.4);
    }
    cr.stroke();

    for (const tree of scene.nearTrees) {
        cr.setSourceRGBA(...pal.shade);
        ellipse(cr, tree.x + tree.h * 0.05, tree.base + s, tree.h * 0.3, tree.h * 0.045);
        cr.fill();
        paintPine(cr, tree, pal.nearTree, pal.nearSnow, pal.trunk, 1);
    }

    paintSnowman(cr, scene.snowman, s, pal);
    paintXmasTree(cr, scene.xmas, s, pal);
}

// Draws only the Christmas tree's lights, in the coordinates of scene.lightsBox.
export function paintTreeLights(cr, scene, phase, twinkle) {
    const {lightsBox, landTop} = scene;
    const {xmas, s} = scene.land;
    cr.translate(-lightsBox.x, landTop - lightsBox.y);

    const {x, y, r} = xmas.star;
    const strength = !twinkle || phase % 2 === 0 ? 0.6 : 0.32;
    const halo = new Cairo.RadialGradient(x, y, 0, x, y, r * 2.6);
    halo.addColorStopRGBA(0, 1, 0.86, 0.35, strength);
    halo.addColorStopRGBA(1, 1, 0.86, 0.35, 0);
    cr.setSource(halo);
    cr.arc(x, y, r * 2.6, 0, TAU);
    cr.fill();

    xmas.lights.forEach((light, i) =>
        paintBulb(cr, light.x, light.y, 2.5 * s, light.color, !twinkle || isLit(i, phase)));
}
