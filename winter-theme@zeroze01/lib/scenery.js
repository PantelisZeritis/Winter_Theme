// Puts the painted winter scene on the desktop, behind every window.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {layoutScene, paintScene, paintTreeLights, PALETTES} from './scenePainter.js';

const TWINKLE_INTERVAL = 700;   // ms between steps of the tree lights
const MAX_ASPECT = 0.3;         // scene height never exceeds this share of the monitor width
const REBUILD_KEYS = new Set(['active', 'scenery-enabled', 'scenery-height', 'lights-twinkle']);

export class Scenery {
    constructor(settings) {
        this._settings = settings;
        this._interface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        this._lights = [];
        this._phase = 0;
        this._timerId = 0;

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
        this.actor.destroy();
        this.actor = null;
    }

    _stopTimer() {
        if (this._timerId) {
            GLib.source_remove(this._timerId);
            this._timerId = 0;
        }
    }

    _rebuild() {
        this._stopTimer();
        this._lights = [];
        this.actor.destroy_all_children();

        const s = this._settings;
        if (!s.get_boolean('active') || !s.get_boolean('scenery-enabled'))
            return;

        // Follow the system style: a moonlit scene when the dark style is on.
        const night = this._interface.get_string('color-scheme') === 'prefer-dark';
        const palette = PALETTES[night ? 'night' : 'day'];
        const twinkle = s.get_boolean('lights-twinkle');
        const share = s.get_int('scenery-height') / 100;

        for (const monitor of Main.layoutManager.monitors) {
            const height = Math.round(Math.min(monitor.height * share, monitor.width * MAX_ASPECT));
            const top = monitor.y + monitor.height - height;
            const scene = layoutScene(monitor.width, height, 2024 + monitor.index * 7919);

            const picture = new St.DrawingArea({
                x: monitor.x, y: top, width: monitor.width, height, reactive: false,
            });
            picture.connect('repaint', area => {
                const cr = area.get_context();
                paintScene(cr, scene, palette);
                cr.$dispose();
            });
            this.actor.add_child(picture);

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
