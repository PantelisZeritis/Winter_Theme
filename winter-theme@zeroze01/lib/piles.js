// Snow that settles on the top edge of windows.
//
// Each window that catches snow gets a Pile: a height map along its top edge
// plus a small drawing area that is a child of the window actor, so the pile
// moves, stacks, animates and shows up in the overview together with its window.

import Cairo from 'cairo';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const COLUMN = 3;               // px per height-map column
const CORNER = 7;               // px kept clear at each end (rounded window corners)
const OVERLAP = 1;              // px the pile reaches down onto the window
const HEADROOM = 3;             // px of spare room above the tallest pile
const MAX_SLOPE = 1.1;          // steepest height difference between two columns
const SETTLE = 0.2;             // how strongly a pile evens itself out on each redraw
const LEDGE_INTERVAL = 0.1;     // s between refreshes of window geometry
const FLUSH_INTERVAL = 0.12;    // s between redraws of changed piles
const MIN_WIDTH = 90;           // narrower windows do not collect snow
const DEPOSIT = 10;             // px of column height added by a mid-sized flake
const KERNEL = [0.1, 0.22, 0.36, 0.22, 0.1];
const MELT_TIME = 2500;         // ms

const LANDABLE_TYPES = new Set([
    Meta.WindowType.NORMAL,
    Meta.WindowType.DIALOG,
    Meta.WindowType.MODAL_DIALOG,
    Meta.WindowType.UTILITY,
]);

// X11 window actors report a paint volume that covers only their surface and
// shadow, so a child drawn above the frame would be skipped whenever just that
// strip is redrawn. This effect adds the pile's box to the volume. (Wayland
// window actors already include their children.)
const PileVolumeEffect = GObject.registerClass(
class WinterThemePileVolumeEffect extends Clutter.Effect {
    vfunc_modify_paint_volume(volume) {
        if (this.box)
            volume.union_box(this.box);
        return true;
    }
});

class Pile {
    constructor(manager, win, windowActor) {
        this._manager = manager;
        this.win = win;
        this.windowActor = windowActor;
        this.heights = new Float32Array(0);
        this._caps = new Float32Array(0);
        this._dirty = false;
        this._peak = 0;
        // Per-pile lumpiness so no two windows look alike.
        this._bumps = [Math.random() * 6.28, Math.random() * 6.28, 0.06 + Math.random() * 0.05];

        this.area = new St.DrawingArea({reactive: false, visible: false});
        this.area.connect('repaint', () => this._draw());
        windowActor.add_child(this.area);

        this._volumeEffect = null;
        if (win.get_client_type() === Meta.WindowClientType.X11) {
            this._volumeEffect = new PileVolumeEffect();
            windowActor.add_effect(this._volumeEffect);
        }

        const frame = win.get_frame_rect();
        this._lastX = frame.x;
        this._lastY = frame.y;

        this._winIds = [
            win.connect('size-changed', () => this.sync()),
            win.connect('position-changed', () => this._onMoved()),
        ];
        this._destroyId = windowActor.connect('destroy', () => {
            this._destroyId = 0;
            manager.forget(this);
        });

        this.sync();
    }

    _release() {
        for (const id of this._winIds)
            this.win.disconnect(id);
        this._winIds = [];
        if (this._destroyId) {
            this.windowActor.disconnect(this._destroyId);
            this._destroyId = 0;
        }
    }

    destroy() {
        this._release();
        if (this._volumeEffect) {
            this.windowActor.remove_effect(this._volumeEffect);
            this._volumeEffect = null;
        }
        this.area?.destroy();
        this.area = null;
    }

    // Fade away without blocking a fresh pile from forming on the same window.
    melt(onDone) {
        this._release();
        const area = this.area;
        this._destroyId = this.windowActor.connect('destroy', () => {
            this._destroyId = 0;
            this.area = null;
            this._volumeEffect = null;
            onDone();
        });
        area.ease({
            opacity: 0,
            duration: MELT_TIME,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onComplete: () => {
                this.destroy();
                onDone();
            },
        });
    }

    sync() {
        const maxHeight = this._manager.maxHeight;
        const frame = this.win.get_frame_rect();
        const buffer = this.win.get_buffer_rect();
        const columns = Math.max(1, Math.ceil(frame.width / COLUMN));

        if (columns !== this.heights.length || maxHeight !== this._maxHeight) {
            const heights = new Float32Array(columns);
            heights.set(this.heights.subarray(0, Math.min(columns, this.heights.length)));
            this.heights = heights;
            this._maxHeight = maxHeight;

            const [p1, p2, k] = this._bumps;
            this._caps = new Float32Array(columns);
            for (let i = 0; i < columns; i++) {
                const edge = Math.max(0, (Math.min(i, columns - 1 - i) + 0.5) * COLUMN - CORNER);
                const shoulder = Math.min(1, Math.sqrt(edge / (maxHeight * 1.8)));
                const lumps = 0.74 + 0.15 * Math.sin(i * k + p1) + 0.11 * Math.sin(i * k * 2.3 + p2);
                this._caps[i] = maxHeight * shoulder * lumps;
                if (heights[i] > this._caps[i])
                    heights[i] = this._caps[i];
            }
        }

        const areaHeight = maxHeight + HEADROOM + OVERLAP;
        this.area.set_size(frame.width, areaHeight);
        // The window actor sits at the buffer rect, which includes shadows.
        const x = frame.x - buffer.x;
        const y = frame.y - buffer.y - areaHeight + OVERLAP;
        this.area.set_position(x, y);
        if (this._volumeEffect) {
            this._volumeEffect.box = new Clutter.ActorBox({
                x1: x, y1: y, x2: x + frame.width, y2: y + areaHeight,
            });
        }
        this._dirty = true;
    }

    heightAt(localX) {
        const i = Math.floor(localX / COLUMN);
        return i >= 0 && i < this.heights.length ? this.heights[i] : 0;
    }

    deposit(localX, flakeSize) {
        const h = this.heights;
        const caps = this._caps;
        const n = h.length;
        const centre = Math.max(0, Math.min(n - 1, Math.floor(localX / COLUMN)));
        const amount = DEPOSIT * this._manager.rate * (0.5 + flakeSize / 8);

        for (let k = 0; k < KERNEL.length; k++) {
            const i = centre + k - 2;
            if (i >= 0 && i < n)
                h[i] += amount * KERNEL[k];
        }

        // Let fresh snow slump sideways until no slope is too steep.
        const lo = Math.max(0, centre - 30);
        const hi = Math.min(n - 1, centre + 30);
        for (let pass = 0; pass < 3; pass++) {
            for (let i = lo; i < hi; i++) {
                const diff = h[i] - h[i + 1];
                if (diff > MAX_SLOPE) {
                    const move = (diff - MAX_SLOPE) / 2;
                    h[i] -= move;
                    h[i + 1] += move;
                } else if (diff < -MAX_SLOPE) {
                    const move = (-diff - MAX_SLOPE) / 2;
                    h[i] += move;
                    h[i + 1] -= move;
                }
            }
        }
        for (let i = lo; i <= hi; i++) {
            if (h[i] > caps[i])
                h[i] = caps[i];
        }

        this._dirty = true;
    }

    _onMoved() {
        const frame = this.win.get_frame_rect();
        const distance = Math.hypot(frame.x - this._lastX, frame.y - this._lastY);
        this._lastX = frame.x;
        this._lastY = frame.y;

        // Gentle drags keep the snow; quick jerks shake some of it loose.
        const loss = Math.min(0.22, (distance - 10) * 0.004);
        if (loss <= 0 || this._peak < 1)
            return;

        const h = this.heights;
        for (let i = 0; i < h.length; i++)
            h[i] *= 1 - loss;
        this._dirty = true;

        const puffs = Math.min(6, Math.ceil(loss * 40));
        for (let n = 0; n < puffs; n++) {
            const i = Math.floor(Math.random() * h.length);
            if (h[i] > 1) {
                this._manager.emitDebris(
                    frame.x + (i + 0.5) * COLUMN,
                    frame.y - Math.random() * h[i]);
            }
        }
    }

    flush() {
        if (!this._dirty || !this.area)
            return;
        this._dirty = false;

        // Snow keeps settling: dips fill in and sharp peaks round off.
        const h = this.heights;
        const caps = this._caps;
        let peak = 0;
        let left = h[0];
        for (let i = 1; i < h.length - 1; i++) {
            const here = h[i];
            const settled = Math.min(caps[i], here + SETTLE * (left + h[i + 1] - 2 * here));
            left = here;
            h[i] = settled;
            if (settled > peak)
                peak = settled;
        }
        this._peak = peak;
        this.area.visible = peak > 0.4;
        if (this.area.visible)
            this.area.queue_repaint();
    }

    _draw() {
        const area = this.area;
        const cr = area.get_context();
        const [width, height] = area.get_surface_size();
        const h = this.heights;
        const n = h.length;
        const base = height - OVERLAP;

        const at = i => h[i < 0 ? 0 : i >= n ? n - 1 : i];

        // Bare stretches collapse onto the bottom edge so nothing is drawn there.
        const trace = () => {
            cr.moveTo(0, height);
            for (let i = 0; i < n; i++) {
                const smooth = (at(i - 2) + 4 * at(i - 1) + 6 * h[i] + 4 * at(i + 1) + at(i + 2)) / 16;
                cr.lineTo(Math.min(width, (i + 0.5) * COLUMN), smooth < 0.3 ? height : base - smooth);
            }
            cr.lineTo(width, height);
            cr.closePath();
        };

        // A soft blue rim keeps the snow readable on light windows.
        cr.save();
        cr.rectangle(0, 0, width, base - 0.5);
        cr.clip();
        trace();
        cr.setLineWidth(2.4);
        cr.setSourceRGBA(0.42, 0.55, 0.72, 0.5);
        cr.stroke();
        cr.restore();

        trace();
        const top = base - this._maxHeight;
        const gradient = new Cairo.LinearGradient(0, top, 0, height);
        gradient.addColorStopRGBA(0, 1, 1, 1, 1);
        gradient.addColorStopRGBA(0.6, 0.97, 0.985, 1, 1);
        gradient.addColorStopRGBA(1, 0.84, 0.9, 0.97, 1);
        cr.setSource(gradient);
        cr.fill();

        cr.$dispose();
    }
}

export class PileManager {
    constructor(settings) {
        this._settings = settings;
        this._piles = new Map();
        this._melting = new Set();
        this._ledges = [];
        this._ledgeTimer = 0;
        this._flushTimer = 0;
        this._snow = null;

        this._readSettings();
        this._settingsId = settings.connect('changed',
            (_settings, key) => this._onSettingChanged(key));
    }

    destroy() {
        this._settings.disconnect(this._settingsId);
        for (const pile of [...this._piles.values(), ...this._melting])
            pile.destroy();
        this._piles.clear();
        this._melting.clear();
        this._ledges = [];
        this._snow = null;
    }

    setSnow(snow) {
        this._snow = snow;
    }

    emitDebris(stageX, stageY) {
        this._snow?.emitDebris(stageX, stageY);
    }

    forget(pile) {
        this._piles.delete(pile.win);
        this._melting.delete(pile);
        pile.destroy();
        this._ledgeTimer = 0;
    }

    melt() {
        for (const pile of this._piles.values()) {
            this._melting.add(pile);
            pile.melt(() => this._melting.delete(pile));
        }
        this._piles.clear();
        this._ledges = [];
        this._ledgeTimer = 0;
    }

    _readSettings() {
        const s = this._settings;
        this._enabled = s.get_boolean('active') && s.get_boolean('pile-enabled');
        this.maxHeight = s.get_int('pile-max-height');
        this.rate = s.get_double('pile-rate');
    }

    _onSettingChanged(key) {
        this._readSettings();

        if (key === 'pile-max-height') {
            for (const pile of this._piles.values())
                pile.sync();
        } else if ((key === 'active' || key === 'pile-enabled') && !this._enabled) {
            this.melt();
        }
    }

    // Called once per simulation step; returns whether flakes can land.
    update(dt) {
        if (!this._enabled)
            return false;

        this._ledgeTimer -= dt;
        if (this._ledgeTimer <= 0) {
            this._ledgeTimer = LEDGE_INTERVAL;
            this._refreshLedges();
        }

        this._flushTimer -= dt;
        if (this._flushTimer <= 0) {
            this._flushTimer = FLUSH_INTERVAL;
            for (const pile of this._piles.values())
                pile.flush();
        }

        return this._ledges.length > 0;
    }

    // Window rectangles in stacking order, bottom to top.
    _refreshLedges() {
        const ledges = [];

        if (!Main.overview.visible) {
            const workspace = global.workspace_manager.get_active_workspace();
            for (const actor of global.get_window_actors()) {
                const win = actor.meta_window;
                if (!win || !actor.visible || !win.showing_on_its_workspace() ||
                    !win.located_on_workspace(workspace))
                    continue;

                const frame = win.get_frame_rect();
                let landable = LANDABLE_TYPES.has(win.get_window_type()) &&
                    frame.width >= MIN_WIDTH &&
                    !win.is_fullscreen() &&
                    !win.is_attached_dialog();
                if (landable) {
                    // A top edge tucked under the panel has nowhere to show snow.
                    const workArea = Main.layoutManager.getWorkAreaForMonitor(win.get_monitor());
                    landable = frame.y > workArea.y + 2;
                }

                ledges.push({
                    win,
                    actor,
                    x: frame.x,
                    y: frame.y,
                    w: frame.width,
                    h: frame.height,
                    landable,
                    pile: this._piles.get(win) ?? null,
                });
            }
        }

        this._ledges = ledges;
    }

    // A flake whose bottom moved from prevBottom to bottom at stage x = cx.
    tryLand(cx, prevBottom, bottom, size) {
        const ledges = this._ledges;

        for (let i = ledges.length - 1; i >= 0; i--) {
            const ledge = ledges[i];
            if (!ledge.landable || cx < ledge.x + CORNER || cx >= ledge.x + ledge.w - CORNER)
                continue;

            const local = cx - ledge.x;
            const surface = ledge.y - (ledge.pile ? ledge.pile.heightAt(local) : 0);
            if (bottom < surface || prevBottom > surface + 3)
                continue;

            // Is this stretch of the top edge covered by a window above it?
            let covered = false;
            for (let j = i + 1; j < ledges.length; j++) {
                const above = ledges[j];
                if (cx >= above.x && cx < above.x + above.w &&
                    ledge.y > above.y && ledge.y <= above.y + above.h) {
                    covered = true;
                    break;
                }
            }
            if (covered)
                continue;

            if (!ledge.pile) {
                ledge.pile = new Pile(this, ledge.win, ledge.actor);
                this._piles.set(ledge.win, ledge.pile);
            }
            ledge.pile.deposit(local, size);
            return true;
        }

        return false;
    }
}
