// Renders the full-screen winter scene to a PNG without a running shell.
//   gjs -m tools/render-scene.js OUT.png [day|night] [WIDTH] [HEIGHT] [SEED] [LAND_PERCENT] [AURORA_TIME]
// At night the aurora is drawn the way the shell draws it: at 1/4 resolution,
// scaled up. With AURORA_TIME=bench it instead times 50 aurora frames.
import Cairo from 'cairo';
import GLib from 'gi://GLib';

import {
    layoutScene, paintSkyLayer, paintForeground, paintAurora, paintTreeLights, PALETTES,
} from '../winter-theme@zeroze01/lib/scenePainter.js';

const AURORA_SCALE = 4;
const [out = 'scene.png', mode = 'day', w = '1920', h = '1080', seed = '2024', land = '38', time = '120'] = ARGV;
const width = Number(w);
const height = Number(h);
const pal = PALETTES[mode];
const scene = layoutScene(width, height, Number(seed), Number(land) / 100);

const auroraFrame = t => {
    const small = new Cairo.ImageSurface(Cairo.Format.ARGB32,
        Math.ceil(width / AURORA_SCALE), Math.ceil(scene.aurora.bottom / AURORA_SCALE));
    const sc = new Cairo.Context(small);
    sc.scale(1 / AURORA_SCALE, 1 / AURORA_SCALE);
    paintAurora(sc, scene, t);
    sc.$dispose();
    return small;
};

if (time === 'bench') {
    const start = GLib.get_monotonic_time();
    for (let i = 0; i < 50; i++)
        auroraFrame(i * 0.1).finish();
    print(`aurora frame: ${((GLib.get_monotonic_time() - start) / 50 / 1000).toFixed(2)} ms`);
} else {
    const surface = new Cairo.ImageSurface(Cairo.Format.ARGB32, width, height);
    const cr = new Cairo.Context(surface);
    cr.save();
    paintSkyLayer(cr, scene, pal);
    cr.restore();
    if (pal.night) {
        cr.save();
        cr.scale(AURORA_SCALE, AURORA_SCALE);
        cr.setSourceSurface(auroraFrame(Number(time)), 0, 0);
        cr.paint();
        cr.restore();
    }
    cr.save();
    paintForeground(cr, scene, pal);
    cr.restore();
    cr.translate(scene.lightsBox.x, scene.lightsBox.y);
    paintTreeLights(cr, scene, 3, true);
    surface.writeToPNG(out);
}
