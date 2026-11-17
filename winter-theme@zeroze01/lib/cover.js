// Snow that slowly covers monitors you are not using, and melts when you come back.
//
// A monitor is idle while the pointer is on another monitor and the focused
// window is not on it. Each monitor keeps its coverage in a coarse grid (one
// value per CELL px). The grid is turned into a tiny RGBA image, which an actor
// stretches over the monitor with linear filtering, so the cover is soft and
// each update costs a few thousand numbers, not any drawing.

import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {rng} from './draw.js';

const CELL = 16;               // px per grid cell
const GROW_TIME = 240;         // s for an average patch to fill completely
const MELT_SPEED = 260;        // px/s the melt front spreads from where you came back
const MELT_TIME = 1.8;         // s for a patch to clear once the front reaches it
const SLOW_TICK = 250;         // ms between updates while only growing or waiting
const FAST_TICK = 50;          // ms between updates while melting
const KEYS = new Set(['active', 'cover-enabled', 'cover-max-opacity', 'pause-on-fullscreen']);

function smooth(t) {
    return t * t * (3 - 2 * t);
}

// Per-cell growth rates, averaging 1 / GROW_TIME: faster near the bottom and
// the edges, and patchy, so the snow creeps in rather than fading in evenly.
function growthRates(cols, rows, seed) {
    const rand = rng(seed);
    const size = 6;
    const lw = Math.ceil(cols / size) + 2;
    const lattice = Array.from({length: lw * (Math.ceil(rows / size) + 2)}, () => rand());
    const noise = (x, y) => {
        const fx = x / size;
        const fy = y / size;
        const ix = Math.floor(fx);
        const iy = Math.floor(fy);
        const tx = smooth(fx - ix);
        const ty = smooth(fy - iy);
        const at = (i, j) => lattice[j * lw + i];
        const top = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * tx;
        const bottom = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * tx;
        return top + (bottom - top) * ty;
    };

    const rates = new Float32Array(cols * rows);
    const shades = new Float32Array(cols * rows);
    const half = Math.min(cols, rows) / 2;
    let sum = 0;
    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            const i = y * cols + x;
            const bottom = Math.pow(y / Math.max(1, rows - 1), 1.5);
            const edge = 1 - Math.min(1, Math.min(x, cols - 1 - x, y, rows - 1 - y) / half);
            const n = 0.75 * noise(x, y) + 0.25 * rand();
            rates[i] = (0.45 + 0.55 * bottom + 0.35 * edge) * (0.35 + 1.3 * n);
            shades[i] = 0.9 + 0.1 * rand();
            sum += rates[i];
        }
    }
    const scale = rates.length / sum / GROW_TIME;
    for (let i = 0; i < rates.length; i++)
        rates[i] *= scale;
    return {rates, shades};
}

export class IdleCover {
    constructor(settings) {
        this._settings = settings;
        this._monitors = [];
        this._timerId = 0;
        this._interval = 0;
        this._lastTick = 0;
        // Tests raise this to watch a cover build in seconds instead of minutes.
        this.speed = 1;

        this.actor = new Clutter.Actor({name: 'winter-theme-cover', reactive: false});
        // Over the windows, under the panel, overview and popups; the falling
        // snow raises itself above this.
        Main.layoutManager.uiGroup.insert_child_above(this.actor, global.window_group);

        this._settingsId = settings.connect('changed', (_settings, key) => {
            if (KEYS.has(key))
                this._sync(key === 'cover-max-opacity');
        });
        this._monitorsId = Main.layoutManager.connect('monitors-changed', () => {
            this._clear();
            this._sync(false);
        });
        this._overviewIds = [
            Main.overview.connect('showing', () => this.actor.hide()),
            Main.overview.connect('hidden', () => this.actor.show()),
        ];
        this.actor.visible = !Main.overview.visible;

        this._sync(false);
    }

    destroy() {
        this._settings.disconnect(this._settingsId);
        Main.layoutManager.disconnect(this._monitorsId);
        for (const id of this._overviewIds)
            Main.overview.disconnect(id);
        this._stopTimer();
        this._monitors = [];
        this.actor.destroy();
        this.actor = null;
    }

    _stopTimer() {
        if (this._timerId) {
            GLib.source_remove(this._timerId);
            this._timerId = 0;
            this._interval = 0;
        }
    }

    _schedule(interval) {
        if (this._interval === interval)
            return;
        this._stopTimer();
        this._interval = interval;
        this._timerId = GLib.timeout_add(GLib.PRIORITY_LOW, interval, () => {
            this._tick();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _clear() {
        this._stopTimer();
        this.actor.destroy_all_children();
        this._monitors = [];
    }

    _sync(redraw) {
        const s = this._settings;
        this._cap = s.get_int('cover-max-opacity') / 100;
        this._pauseOnFullscreen = s.get_boolean('pause-on-fullscreen');

        if (!s.get_boolean('active') || !s.get_boolean('cover-enabled')) {
            this._clear();
            return;
        }

        if (this._monitors.length === 0)
            this._build();
        if (redraw) {
            for (const mon of this._monitors)
                this._upload(mon);
        }
        this._lastTick = GLib.get_monotonic_time();
        this._schedule(SLOW_TICK);
    }

    _build() {
        const coglContext = global.stage.context.get_backend().get_cogl_context();
        for (const geometry of Main.layoutManager.monitors) {
            const {x, y, width, height, index} = geometry;
            const cols = Math.ceil(width / CELL);
            const rows = Math.ceil(height / CELL);
            const content = St.ImageContent.new_with_preferred_size(cols, rows);
            const actor = new Clutter.Actor({
                x, y, width, height, content, reactive: false, visible: false,
            });
            actor.set_content_scaling_filters(Clutter.ScalingFilter.LINEAR, Clutter.ScalingFilter.LINEAR);
            this.actor.add_child(actor);

            this._monitors.push({
                index, x, y, width, height, cols, rows, actor, content, coglContext,
                ...growthRates(cols, rows, 4093 + index * 977),
                coverage: new Float32Array(cols * rows),
                pixels: new Uint8Array(cols * rows * 4),
                covered: 0,          // largest coverage value, to know when to stop
                full: false,
                melt: null,          // {x, y, r} while melting
            });
        }
    }

    _pointerMonitor() {
        const [px, py] = global.get_pointer();
        return {
            x: px, y: py,
            index: Main.layoutManager.monitors.findIndex(m =>
                px >= m.x && px < m.x + m.width && py >= m.y && py < m.y + m.height),
        };
    }

    // Where the melt starts on a monitor that just stopped being idle.
    _meltOrigin(mon, pointer, focus) {
        if (pointer.index === mon.index)
            return [pointer.x - mon.x, pointer.y - mon.y];
        if (focus && focus.get_monitor() === mon.index) {
            const r = focus.get_frame_rect();
            return [r.x + r.width / 2 - mon.x, r.y + r.height / 2 - mon.y];
        }
        return [mon.width / 2, mon.height / 2];
    }

    _tick() {
        const now = GLib.get_monotonic_time();
        const dt = Math.min(1, (now - this._lastTick) / 1e6);
        this._lastTick = now;

        const pointer = this._pointerMonitor();
        const focus = global.display.focus_window;
        const focusMonitor = focus ? focus.get_monitor() : -1;
        let melting = false;

        for (const mon of this._monitors) {
            const idle = pointer.index !== mon.index && focusMonitor !== mon.index &&
                !(this._pauseOnFullscreen && global.display.get_monitor_in_fullscreen(mon.index));

            if (idle) {
                mon.melt = null;
                if (!mon.full)
                    this._grow(mon, dt * this.speed);
            } else if (mon.covered > 0) {
                if (!mon.melt) {
                    const [x, y] = this._meltOrigin(mon, pointer, focus);
                    mon.melt = {x, y, r: 0};
                }
                this._melt(mon, dt);
                melting = true;
            }
        }

        this._schedule(melting ? FAST_TICK : SLOW_TICK);
    }

    _grow(mon, dt) {
        const {coverage, rates} = mon;
        let full = true;
        for (let i = 0; i < coverage.length; i++) {
            const c = coverage[i] + rates[i] * dt;
            if (c < 1)
                full = false;
            coverage[i] = c < 1 ? c : 1;
        }
        mon.full = full;
        mon.covered = 1;
        this._upload(mon);
    }

    _melt(mon, dt) {
        const {coverage, cols, rows, melt} = mon;
        melt.r += MELT_SPEED * dt;
        const step = dt / MELT_TIME;
        const r2 = melt.r * melt.r;
        let left = 0;

        for (let y = 0; y < rows; y++) {
            const dy = (y + 0.5) * CELL - melt.y;
            for (let x = 0; x < cols; x++) {
                const i = y * cols + x;
                let c = coverage[i];
                if (c > 0) {
                    const dx = (x + 0.5) * CELL - melt.x;
                    if (dx * dx + dy * dy < r2) {
                        c -= step;
                        coverage[i] = c > 0 ? c : 0;
                    }
                    if (c > left)
                        left = c;
                }
            }
        }

        mon.full = false;
        mon.covered = left;
        if (left <= 0)
            mon.melt = null;
        this._upload(mon);
    }

    // Writes the coverage grid into the monitor's image as premultiplied,
    // faintly blue-white snow, capped at the maximum opacity.
    _upload(mon) {
        const {coverage, shades, pixels, cols, rows} = mon;
        const cap = this._cap;
        let visible = false;
        for (let i = 0, p = 0; i < coverage.length; i++, p += 4) {
            const a = cap * smooth(coverage[i]);
            if (a > 0.004)
                visible = true;
            const v = 255 * a * shades[i];
            pixels[p] = v * 0.94;
            pixels[p + 1] = v * 0.97;
            pixels[p + 2] = v;
            pixels[p + 3] = 255 * a;
        }

        mon.actor.visible = visible;
        if (!visible)
            return;
        mon.content.set_bytes(mon.coglContext, new GLib.Bytes(pixels),
            Cogl.PixelFormat.RGBA_8888_PRE, cols, rows, cols * 4);
    }
}
