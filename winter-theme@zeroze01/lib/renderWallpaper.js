// Renders a still of the winter scene to a PNG, for the overview and the
// workspace-switch animation (see wallpaper.js). It is run in a separate gjs
// process, so the shell never blocks on drawing a full-screen image:
//
//   gjs -m renderWallpaper.js OUT.png day|night WIDTH HEIGHT SCALE SEED LAND_SHARE AURORA(0|1)
//
// WIDTH and HEIGHT are logical pixels; SCALE is the monitor's scale factor.
import Cairo from 'cairo';
import GLib from 'gi://GLib';

import {
    layoutScene, paintSkyLayer, paintForeground, paintAurora, paintTreeLights, PALETTES,
} from './scenePainter.js';

const [out, mode, w, h, scaleArg, seed, share, auroraArg] = ARGV;
const width = Number(w);
const height = Number(h);
const scale = Number(scaleArg);
const pal = PALETTES[mode];
const scene = layoutScene(width, height, Number(seed), Number(share));

const surface = new Cairo.ImageSurface(Cairo.Format.RGB24,
    Math.round(width * scale), Math.round(height * scale));
const cr = new Cairo.Context(surface);
cr.scale(scale, scale);

cr.save();
paintSkyLayer(cr, scene, pal);
cr.restore();
if (pal.night && auroraArg === '1') {
    cr.save();
    paintAurora(cr, scene, 160);
    cr.restore();
}
cr.save();
paintForeground(cr, scene, pal);
cr.restore();
cr.translate(scene.lightsBox.x, scene.lightsBox.y);
paintTreeLights(cr, scene, 0, false);

// Write to a temporary name and rename, so a half-written file is never loaded.
const tmp = `${out}.tmp`;
surface.writeToPNG(tmp);
GLib.rename(tmp, out);
