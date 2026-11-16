// The winter scene: three ranks of snowy hills with pines, a cabin, a snowman
// and a decorated Christmas tree. layoutScene() decides where everything goes,
// paintScene() draws the static picture and paintTreeLights() draws only the
// blinking lights of the Christmas tree.
//
// All sizes derive from `s`, the scene height divided by 300.

import Cairo from 'cairo';

import {
    TAU, LIGHT_COLORS, rng, hex, setColor, linearGradient, ellipse, roundedRect,
    isLit, paintBulb,
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
        snowman: ['#f4f8ff', '#9db2d3'],
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

export function layoutScene(width, height, seed) {
    const rand = rng(seed);
    const s = height / 300;

    const hill = (base, amp) => {
        const k1 = TAU / ((900 + rand() * 700) * s);
        const k2 = TAU / ((330 + rand() * 240) * s);
        const p1 = rand() * TAU;
        const p2 = rand() * TAU;
        return x => height * (base + amp *
            (0.65 * Math.sin(x * k1 + p1) + 0.35 * Math.sin(x * k2 + p2)));
    };
    const hills = [hill(0.52, 0.05), hill(0.68, 0.04), hill(0.84, 0.03)];

    const cabinX = width * 0.56;
    const snowmanX = width * 0.27;
    const xmasX = width * 0.77;

    const farTrees = [];
    for (let x = rand() * 30 * s; x < width; x += (14 + rand() * 50) * s)
        farTrees.push({x, base: hills[0](x) + 3 * s, h: (24 + rand() * 34) * s});

    const midTrees = [];
    for (let x = rand() * 80 * s; x < width; x += (45 + rand() * 150) * s) {
        if (Math.abs(x - cabinX) < 105 * s)
            continue;
        midTrees.push({x, base: hills[1](x) + 4 * s, h: (58 + rand() * 46) * s, tiers: 4});
    }
    midTrees.sort((a, b) => a.base - b.base);

    const keepOut = [[snowmanX, 85], [xmasX, 130], [cabinX, 100]];
    const blocked = x => keepOut.some(([centre, radius]) => Math.abs(x - centre) < radius * s);
    const nearTrees = [];
    for (let x = (20 + rand() * 60) * s; x < width; x += (150 + rand() * 300) * s) {
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
        width, height, s, hills, farTrees, midTrees, nearTrees, drifts, xmas, lightsBox,
        cabin: {x: cabinX, base: hills[1](cabinX) + 7 * s},
        snowman: {x: snowmanX, base: hills[2](snowmanX) + 18 * s, h: 92 * s},
    };
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

export function paintScene(cr, scene, pal) {
    const {hills, s} = scene;

    paintHill(cr, scene, hills[0], pal.far);
    for (const tree of scene.farTrees)
        paintFarPine(cr, tree, pal.farTree);

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
    const {xmas, lightsBox, s} = scene;
    cr.translate(-lightsBox.x, -lightsBox.y);

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
