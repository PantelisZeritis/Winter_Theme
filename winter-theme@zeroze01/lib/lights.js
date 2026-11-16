// A string of Christmas lights hanging from the bottom edge of the top bar.

import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {LIGHT_COLORS, isLit, paintBulb, setColor} from './draw.js';

const HEIGHT = 40;              // px, before HiDPI scaling
const TWINKLE_INTERVAL = 600;   // ms between steps
const SYNC_KEYS = new Set(['active', 'lights-enabled', 'lights-twinkle']);

export class PanelLights {
    constructor(settings) {
        this._settings = settings;
        this._area = null;
        this._phase = 0;
        this._timerId = 0;
        this._twinkle = true;

        this._settingsId = settings.connect('changed', (_settings, key) => {
            if (SYNC_KEYS.has(key))
                this._sync();
        });
        this._allocationId = Main.layoutManager.panelBox.connect('notify::allocation',
            () => this._syncGeometry());

        this._sync();
    }

    destroy() {
        this._settings.disconnect(this._settingsId);
        Main.layoutManager.panelBox.disconnect(this._allocationId);
        this._remove();
    }

    _remove() {
        if (this._timerId) {
            GLib.source_remove(this._timerId);
            this._timerId = 0;
        }
        if (this._area) {
            Main.layoutManager.removeChrome(this._area);
            this._area.destroy();
            this._area = null;
        }
    }

    _sync() {
        const s = this._settings;
        this._twinkle = s.get_boolean('lights-twinkle');
        this._remove();

        if (!s.get_boolean('active') || !s.get_boolean('lights-enabled'))
            return;

        // The layout manager owns the visibility of chrome it tracks (it hides
        // this while a window is fullscreen), so the lights are switched off
        // by removing the actor rather than hiding it.
        this._area = new St.DrawingArea({name: 'winter-theme-lights', reactive: false});
        this._area.connect('repaint', () => this._draw());
        Main.layoutManager.addChrome(this._area, {trackFullscreen: true});
        // Directly above the top bar, so notifications and menus cover the lights.
        Main.layoutManager.uiGroup.set_child_above_sibling(this._area, Main.layoutManager.panelBox);
        this._syncGeometry();

        if (this._twinkle) {
            this._timerId = GLib.timeout_add(GLib.PRIORITY_LOW, TWINKLE_INTERVAL, () => {
                this._phase++;
                this._area.queue_repaint();
                return GLib.SOURCE_CONTINUE;
            });
        }
    }

    _syncGeometry() {
        if (!this._area)
            return;

        const box = Main.layoutManager.panelBox;
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const x = box.x;
        const y = box.y + box.height - 2 * scale;
        const width = box.width;
        const height = HEIGHT * scale;

        if (this._area.x !== x || this._area.y !== y)
            this._area.set_position(x, y);
        if (this._area.width !== width || this._area.height !== height)
            this._area.set_size(width, height);
    }

    _draw() {
        const cr = this._area.get_context();
        const [width, height] = this._area.get_surface_size();
        const u = height / HEIGHT;
        const span = 118 * u;
        const sag = 7 * u;
        const wireY = x => 3 * u + sag * Math.sin(Math.PI * ((x % span) / span));

        setColor(cr, '#14291b');
        cr.setLineWidth(1.6 * u);
        cr.moveTo(0, wireY(0));
        for (let x = 4; x <= width + 4; x += 4)
            cr.lineTo(x, wireY(x));
        cr.stroke();

        const spacing = span / 4;
        let index = 0;
        for (let x = spacing / 2; x < width; x += spacing, index++) {
            const y = wireY(x);

            setColor(cr, '#262b28');
            cr.rectangle(x - 2.2 * u, y - 0.5 * u, 4.4 * u, 4.8 * u);
            cr.fill();

            cr.save();
            cr.translate(x, y + 9.4 * u);
            cr.scale(1, 1.4);
            paintBulb(cr, 0, 0, 3.8 * u, LIGHT_COLORS[index % LIGHT_COLORS.length],
                !this._twinkle || isLit(index, this._phase));
            cr.restore();
        }

        cr.$dispose();
    }
}
