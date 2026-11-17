// Puts the painted winter scene on the desktop, behind every window. It covers
// each monitor completely, so the wallpaper is hidden while it is on.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {
    layoutScene, paintSkyLayer, paintForeground, paintAurora, paintMeteor, paintTreeLights, PALETTES,
} from './scenePainter.js';

const TWINKLE_INTERVAL = 700;   // ms between steps of the tree lights
const AURORA_INTERVAL = 150;    // ms between aurora frames; it moves a few px per second at most
const AURORA_SCALE = 4;         // the aurora is drawn at 1/4 resolution and scaled up
const METEOR_DELAY = [6, 18];   // s between shooting stars, picked at random
const REBUILD_KEYS = new Set(['active', 'scenery-enabled', 'scenery-height', 'lights-twinkle', 'aurora-enabled', 'shooting-stars-enabled']);

export class Scenery {
    constructor(settings) {
        this._settings = settings;
        this._interface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        this._lights = [];
        this._phase = 0;
        this._timerId = 0;
        this._auroras = [];
        this._auroraTimerId = 0;
        this._meteorSkies = [];
        this._meteorTimerId = 0;

        // Children of the background group stay below all windows; a new
        // wallpaper actor is always inserted at the bottom, beneath this one.
        this.actor = new Clutter.Actor({name: 'winter-theme-scenery', reactive: false});
        Main.layoutManager._backgroundGroup.add_child(this.actor);

        this._settingsId = settings.connect('changed', (_settings, key) => {
            if (REBUILD_KEYS.has(key))
                this._rebuild();
        });
        this._schemeId = this._interface.connect('changed::color-scheme', () => this._rebuild());
        this._monitorsId = Main.layoutManager.connect('monitors-changed', () => this._rebuild());

        this._rebuild();
    }

    destroy() {
        this._settings.disconnect(this._settingsId);
        this._interface.disconnect(this._schemeId);
        Main.layoutManager.disconnect(this._monitorsId);
        this._stopTimer();
        this._lights = [];
        this._auroras = [];
        this._meteorSkies = [];
        this.actor.destroy();
        this.actor = null;
    }

    _stopTimer() {
        if (this._timerId) {
            GLib.source_remove(this._timerId);
            this._timerId = 0;
        }
        if (this._auroraTimerId) {
            GLib.source_remove(this._auroraTimerId);
            this._auroraTimerId = 0;
        }
        if (this._meteorTimerId) {
            GLib.source_remove(this._meteorTimerId);
            this._meteorTimerId = 0;
        }
    }

    _scheduleMeteor() {
        const [lo, hi] = METEOR_DELAY;
        const delay = Math.round((lo + Math.random() * (hi - lo)) * 1000);
        this._meteorTimerId = GLib.timeout_add(GLib.PRIORITY_LOW, delay, () => {
            this._meteorTimerId = 0;
            const skies = this._meteorSkies.filter(sky =>
                sky.actor.mapped && !this._skyHidden(sky.monitor));
            if (skies.length > 0)
                this.launchMeteor(skies[Math.floor(Math.random() * skies.length)]);
            this._scheduleMeteor();
            return GLib.SOURCE_REMOVE;
        });
    }

    // One shooting star across the upper sky of a monitor. It is drawn once;
    // Clutter then only moves and fades the finished image, for under a second.
    launchMeteor(sky, {x, y, angle} = {}) {
        const {actor, u} = sky;
        const width = Math.round((170 + Math.random() * 200) * u);
        const height = Math.round(14 * u);
        // Downwards at 15-37°, to the left or the right.
        const dip = 15 + Math.random() * 22;
        angle ??= Math.random() < 0.5 ? 180 - dip : dip;
        x ??= actor.width * (0.15 + Math.random() * 0.7);
        y ??= actor.height * (0.05 + Math.random() * 0.4);

        const meteor = new St.DrawingArea({width, height, reactive: false, opacity: 0});
        meteor.connect('repaint', area => {
            const cr = area.get_context();
            paintMeteor(cr, width, height, u);
            cr.$dispose();
        });
        // The head is the right end; rotate about it so it starts at (x, y).
        meteor.set_pivot_point(1 - height / 2 / width, 0.5);
        meteor.set_position(x - width + height / 2, y - height / 2);
        meteor.rotation_angle_z = angle;
        actor.add_child(meteor);

        const travel = (260 + Math.random() * 380) * u;
        const rad = angle * Math.PI / 180;
        const duration = Math.round(travel / (850 * u) * 1000);
        meteor.ease({
            translation_x: Math.cos(rad) * travel,
            translation_y: Math.sin(rad) * travel,
            duration,
            mode: Clutter.AnimationMode.LINEAR,
            onComplete: () => meteor.destroy(),
        });
        meteor.ease({
            opacity: 255,
            duration: Math.round(duration * 0.2),
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => meteor.ease({
                opacity: 0,
                delay: Math.round(duration * 0.3),
                duration: Math.round(duration * 0.45),
                mode: Clutter.AnimationMode.EASE_IN_QUAD,
            }),
        });
        return meteor;
    }

    // True while a fullscreen or maximised window covers the monitor.
    _skyHidden(monitor) {
        if (Main.overview.visible)
            return false;
        if (global.display.get_monitor_in_fullscreen(monitor))
            return true;
        const workspace = global.workspace_manager.get_active_workspace();
        return workspace.list_windows().some(win =>
            win.get_monitor() === monitor &&
            win.get_maximize_flags() === Meta.MaximizeFlags.BOTH &&
            win.showing_on_its_workspace());
    }

    _rebuild() {
        this._stopTimer();
        this._lights = [];
        this._auroras = [];
        this._meteorSkies = [];
        this.actor.destroy_all_children();

        const s = this._settings;
        if (!s.get_boolean('active') || !s.get_boolean('scenery-enabled'))
            return;

        // Follow the system style: a moonlit scene when the dark style is on.
        const night = this._interface.get_string('color-scheme') === 'prefer-dark';
        const palette = PALETTES[night ? 'night' : 'day'];
        const twinkle = s.get_boolean('lights-twinkle');
        const share = s.get_int('scenery-height') / 100;
        const aurora = night && s.get_boolean('aurora-enabled');
        const meteors = night && s.get_boolean('shooting-stars-enabled');

        for (const monitor of Main.layoutManager.monitors) {
            const top = monitor.y;
            const scene = layoutScene(monitor.width, monitor.height,
                2024 + monitor.index * 7919, share);

            // The scene covers the whole monitor, wallpaper included, in
            // static layers: sky, then (at night) the aurora, then the
            // foreground, which is transparent above the mountains.
            const layer = paint => {
                const area = new St.DrawingArea({
                    x: monitor.x, y: top, width: monitor.width, height: monitor.height,
                    reactive: false,
                });
                area.connect('repaint', a => {
                    const cr = a.get_context();
                    paint(cr, scene, palette);
                    cr.$dispose();
                });
                this.actor.add_child(area);
            };

            layer(paintSkyLayer);
            if (aurora) {
                const area = new St.DrawingArea({
                    x: monitor.x, y: top,
                    width: Math.ceil(monitor.width / AURORA_SCALE),
                    height: Math.ceil(scene.aurora.bottom / AURORA_SCALE),
                    scale_x: AURORA_SCALE, scale_y: AURORA_SCALE,
                    reactive: false,
                });
                area.connect('repaint', a => {
                    const cr = a.get_context();
                    cr.scale(1 / AURORA_SCALE, 1 / AURORA_SCALE);
                    paintAurora(cr, scene, GLib.get_monotonic_time() / 1e6);
                    cr.$dispose();
                });
                this.actor.add_child(area);
                this._auroras.push({area, monitor: monitor.index});
            }
            // Shooting stars fly above the aurora and behind the mountains.
            if (meteors) {
                const sky = new Clutter.Actor({
                    x: monitor.x, y: top, width: monitor.width, height: scene.aurora.bottom,
                    clip_to_allocation: true, reactive: false,
                });
                this.actor.add_child(sky);
                this._meteorSkies.push({actor: sky, monitor: monitor.index, u: monitor.height / 1080});
            }
            layer(paintForeground);

            // Only this small area is redrawn when the tree lights blink.
            const box = scene.lightsBox;
            const lights = new St.DrawingArea({
                x: monitor.x + box.x, y: top + box.y, width: box.width, height: box.height,
                reactive: false,
            });
            lights.connect('repaint', area => {
                const cr = area.get_context();
                paintTreeLights(cr, scene, this._phase, twinkle);
                cr.$dispose();
            });
            this.actor.add_child(lights);
            this._lights.push(lights);
        }

        if (this._meteorSkies.length > 0)
            this._scheduleMeteor();

        if (this._auroras.length > 0) {
            this._auroraTimerId = GLib.timeout_add(GLib.PRIORITY_LOW, AURORA_INTERVAL, () => {
                // Nothing is drawn while the sky cannot be seen.
                for (const {area, monitor} of this._auroras) {
                    if (area.mapped && !this._skyHidden(monitor))
                        area.queue_repaint();
                }
                return GLib.SOURCE_CONTINUE;
            });
        }

        if (twinkle) {
            this._timerId = GLib.timeout_add(GLib.PRIORITY_LOW, TWINKLE_INTERVAL, () => {
                this._phase++;
                for (const lights of this._lights)
                    lights.queue_repaint();
                return GLib.SOURCE_CONTINUE;
            });
        }
    }
}
