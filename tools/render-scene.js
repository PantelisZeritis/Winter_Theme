// Renders the winter scene to a PNG without a running shell, for quick visual checks.
//   gjs -m tools/render-scene.js OUT.png [day|night] [WIDTH] [HEIGHT] [SEED]
import Cairo from 'cairo';

import {layoutScene, paintScene, paintTreeLights, PALETTES} from '../winter-theme@zeroze01/lib/scenePainter.js';

const [out = 'scene.png', mode = 'day', w = '1920', h = '302', seed = '2024'] = ARGV;
const width = Number(w);
const height = Number(h);
const sky = Math.round(height * 0.6);

const surface = new Cairo.ImageSurface(Cairo.Format.ARGB32, width, height + sky);
const cr = new Cairo.Context(surface);

// Stand-in wallpaper so the scene is judged against something.
const backdrop = new Cairo.LinearGradient(0, 0, 0, height + sky);
if (mode === 'night') {
    backdrop.addColorStopRGB(0, 0.05, 0.07, 0.16);
    backdrop.addColorStopRGB(1, 0.16, 0.2, 0.36);
} else {
    backdrop.addColorStopRGB(0, 0.36, 0.55, 0.8);
    backdrop.addColorStopRGB(1, 0.75, 0.84, 0.93);
}
cr.setSource(backdrop);
cr.paint();

const scene = layoutScene(width, height, Number(seed));
cr.translate(0, sky);
cr.save();
paintScene(cr, scene, PALETTES[mode]);
cr.restore();
cr.translate(scene.lightsBox.x, scene.lightsBox.y);
paintTreeLights(cr, scene, 3, true);

surface.writeToPNG(out);
