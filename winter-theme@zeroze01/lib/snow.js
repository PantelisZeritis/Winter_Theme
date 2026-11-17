// Falling snow: a pool of small textured actors moved by one frame-clock tick.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const REFERENCE_AREA = 1920 * 1080;
const MIN_STEP = 1 / 63;       // simulate at most ~60 times a second
const MAX_STEP = 1 / 20;       // never jump further than this after a stall
const CRYSTAL_SHARE = 0.12;    // share of flakes drawn as six-armed crystals
const LANDING_SHARE = 0.65;    // share of flakes that can settle on a window
const SPRITE_SIZE = 64;
const STEADY_WIND = 110;       // px/s at wind = 1
const GUST_WIND = 14;          // px/s of slow wandering even with no wind
const FADE_TIME = 1200;        // ms for the snow to clear when switched off

export class SnowLayer {
    constructor(extension, settings, piles) {
        this._settings = settings;
        this._piles = piles;
        this._monitors = [];
        this._sprites = {};
        this._loaders = [];
        this._time = Math.random() * 1000;
        this._lastTick = 0;
        this._snowing = false;
        this._timeline = null;

        this.actor = new Clutter.Actor({
            name: 'winter-theme-snow',
            reactive: false,
            visible: false,
        });

        this._readSettings();
        this._reparent();

        this._loadSprite(extension, 'soft', 'flake-soft.svg');
        this._loadSprite(extension, 'crystal', 'flake-crystal.svg');

        this._settingsId = settings.connect('changed',
            (_settings, key) => this._onSettingChanged(key));
        this._monitorsId = Main.layoutManager.connect('monitors-changed',
            () => this._rebuild(false));
        this._fullscreenId = global.display.connect('in-fullscreen-changed',
            () => this._syncBlocked());

        this._rebuild(false);
        this._syncSnowing();
    }

    destroy() {
        this._settings.disconnect(this._settingsId);
        Main.layoutManager.disconnect(this._monitorsId);
        global.display.disconnect(this._fullscreenId);

        this._timeline?.stop();
        this._timeline = null;

        for (const {actor, id} of this._loaders) {
            if (id)
                actor.disconnect(id);
            actor.destroy();
        }
        this._loaders = [];
        this._sprites = {};
        this._monitors = [];
        this.actor.destroy();
        this.actor = null;
    }

    // Used by the pile manager: drop a flake of loose snow at a stage position.
    emitDebris(stageX, stageY) {
        if (!this._snowing || !this._timeline?.is_playing())
            return;

        const mon = this._monitors.find(m => !m.blocked &&
            stageX >= m.x && stageX < m.x + m.width &&
            stageY >= m.y && stageY < m.y + m.height);
        if (!mon || mon.flakes.length === 0)
            return;

        let flake = null;
        for (let i = 0; i < 4 && !flake; i++) {
            const candidate = mon.flakes[Math.floor(Math.random() * mon.flakes.length)];
            if (!candidate.crystal)
                flake = candidate;
        }
        if (!flake)
            return;

        flake.x = stageX - mon.x - flake.size / 2;
        flake.y = stageY - mon.y;
        flake.immune = 1.5;
    }

    _readSettings() {
        const s = this._settings;
        this._count = s.get_int('flake-count');
        this._sizeFactor = s.get_double('flake-size');
        this._speed = s.get_double('fall-speed');
        this._wind = s.get_double('wind');
        this._pauseOnFullscreen = s.get_boolean('pause-on-fullscreen');
        this._wantSnow = s.get_boolean('active') && s.get_boolean('snow-enabled');
    }

    _onSettingChanged(key) {
        this._readSettings();

        switch (key) {
        case 'flake-count':
        case 'flake-size':
            this._rebuild(true);
            break;
        case 'snow-in-front':
            this._reparent();
            break;
        case 'pause-on-fullscreen':
            this._syncBlocked();
            break;
        case 'active':
        case 'snow-enabled':
            this._syncSnowing();
            break;
        }
    }

    _loadSprite(extension, name, filename) {
        const file = extension.dir.get_child('assets').get_child(filename);
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        // The texture cache hands back an actor whose content is filled in
        // once the image is decoded; every flake then shares that content.
        const actor = St.TextureCache.get_default()
            .load_file_async(file, -1, SPRITE_SIZE, scale, 1);
        const loader = {actor, id: 0};
        const adopt = () => {
            if (!actor.content)
                return false;
            this._sprites[name] = actor.content;
            if (loader.id) {
                actor.disconnect(loader.id);
                loader.id = 0;
                this._rebuild(false);
            }
            return true;
        };
        this._loaders.push(loader);
        if (!adopt())
            loader.id = actor.connect('notify::content', adopt);
    }

    _reparent() {
        // A timeline must not keep running while its actor is off the stage.
        this._timeline?.stop();
        this.actor.get_parent()?.remove_child(this.actor);

        if (this._settings.get_boolean('snow-in-front')) {
            // Above every window, below the panel, overview and popups.
            const uiGroup = Main.layoutManager.uiGroup;
            uiGroup.insert_child_above(this.actor, global.window_group);
            // Flakes fall in front of the idle-monitor cover, if there is one.
            const cover = uiGroup.get_children().find(c => c.name === 'winter-theme-cover');
            if (cover)
                uiGroup.set_child_above_sibling(this.actor, cover);
        } else {
            // On the desktop only. Anything placed directly in window_group
            // floats above the windows on the next restack, so use the
            // background group, which mutter keeps at the bottom.
            Main.layoutManager._backgroundGroup.add_child(this.actor);
        }

        this._syncTimeline();
    }

    _rebuild(onScreen) {
        for (const mon of this._monitors)
            mon.container.destroy();
        this._monitors = [];

        if (!this._sprites.soft || !this._sprites.crystal)
            return;

        this._scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;

        for (const geometry of Main.layoutManager.monitors) {
            const {x, y, width, height, index} = geometry;
            const container = new Clutter.Actor({
                x, y, width, height,
                clip_to_allocation: true,
                reactive: false,
            });
            this.actor.add_child(container);

            const mon = {index, x, y, width, height, container, flakes: [], blocked: false};
            const count = Math.max(8, Math.min(1500,
                Math.round(this._count * width * height / REFERENCE_AREA)));
            for (let i = 0; i < count; i++) {
                const flake = this._createFlake(mon);
                this._place(mon, flake, onScreen ? 'screen' : 'above');
                mon.flakes.push(flake);
            }
            this._monitors.push(mon);
        }

        this._syncBlocked();
    }

    _createFlake(mon) {
        const crystal = Math.random() < CRYSTAL_SHARE;
        const depth = Math.random();    // 0 = far and small, 1 = near and large
        const scale = this._scale;
        const size = (crystal ? 9 + depth * 9 : 2.4 + depth * 4.6) * this._sizeFactor * scale;

        const actor = new Clutter.Actor({
            content: crystal ? this._sprites.crystal : this._sprites.soft,
            width: size,
            height: size,
            opacity: Math.round(crystal ? 150 + depth * 90 : 120 + depth * 135),
        });
        actor.set_content_scaling_filters(
            Clutter.ScalingFilter.TRILINEAR, Clutter.ScalingFilter.LINEAR);
        if (crystal)
            actor.set_pivot_point(0.5, 0.5);
        mon.container.add_child(actor);

        return {
            actor,
            crystal,
            size,
            x: 0,
            y: 0,
            speed: (26 + depth * 52 + (crystal ? 8 : 0)) * (0.85 + Math.random() * 0.3) * scale,
            drift: 0.45 + depth * 0.55,
            phase: Math.random() * Math.PI * 2,
            freq: 0.6 + Math.random() * 1.1,
            amp: (7 + Math.random() * 15) * scale,
            rot: Math.random() * 360,
            spin: (Math.random() - 0.5) * 70,
            // Near, large flakes pass in front of windows; the rest can settle.
            lands: !crystal && Math.random() < LANDING_SHARE,
            immune: 0,
        };
    }

    _place(mon, flake, where) {
        flake.x = Math.random() * (mon.width + flake.size) - flake.size;
        if (where === 'screen')
            flake.y = Math.random() * (mon.height + flake.size) - flake.size;
        else if (where === 'above')
            flake.y = -flake.size - Math.random() * mon.height;
        else
            flake.y = -flake.size - Math.random() * 30 * this._scale;
        flake.immune = 0;
        flake.actor.set_translation(flake.x, flake.y, 0);
    }

    _syncSnowing() {
        if (this._wantSnow === this._snowing)
            return;

        this._snowing = this._wantSnow;
        this.actor.remove_all_transitions();

        if (this._snowing) {
            // Start with an empty sky and let the snow drift in from the top.
            for (const mon of this._monitors) {
                for (const flake of mon.flakes)
                    this._place(mon, flake, 'above');
            }
            this.actor.opacity = 255;
            this.actor.show();
            this._syncTimeline();
        } else {
            this.actor.ease({
                opacity: 0,
                duration: FADE_TIME,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => {
                    this.actor.hide();
                    this._syncTimeline();
                    this._piles.melt();
                },
            });
        }
    }

    _syncBlocked() {
        for (const mon of this._monitors) {
            mon.blocked = this._pauseOnFullscreen &&
                global.display.get_monitor_in_fullscreen(mon.index);
            mon.container.visible = !mon.blocked;
        }
        this._syncTimeline();
    }

    _syncTimeline() {
        const shouldRun = this.actor.visible && this.actor.get_stage() !== null &&
            this._monitors.some(m => !m.blocked);

        if (shouldRun && !this._timeline) {
            this._timeline = new Clutter.Timeline({
                actor: this.actor,
                duration: 1000,
                repeat_count: -1,
            });
            this._timeline.connect('new-frame', () => this._onFrame());
        }

        if (shouldRun && !this._timeline.is_playing()) {
            this._lastTick = GLib.get_monotonic_time();
            this._timeline.start();
        } else if (!shouldRun && this._timeline?.is_playing()) {
            this._timeline.stop();
        }
    }

    _onFrame() {
        const now = GLib.get_monotonic_time();
        let dt = (now - this._lastTick) / 1e6;
        if (dt < MIN_STEP)
            return;
        this._lastTick = now;
        if (dt > MAX_STEP)
            dt = MAX_STEP;

        this._time += dt;
        const t = this._time;
        const wind = (this._wind * STEADY_WIND +
            (Math.sin(t * 0.23) + Math.sin(t * 0.071 + 1.7)) * GUST_WIND) * this._scale;
        const fall = this._speed * dt;
        const piles = this._piles;
        const landing = this._snowing && piles.update(dt);

        for (const mon of this._monitors) {
            if (mon.blocked)
                continue;

            const {x: originX, y: originY, width, height} = mon;
            for (const f of mon.flakes) {
                const prevBottom = f.y + f.size;
                f.y += f.speed * fall;
                f.phase += f.freq * dt;
                f.x += (wind * f.drift + Math.cos(f.phase) * f.amp) * dt;

                if (f.x < -f.size)
                    f.x += width + f.size;
                else if (f.x > width)
                    f.x -= width + f.size;

                if (f.immune > 0) {
                    f.immune -= dt;
                } else if (landing && f.lands && piles.tryLand(
                    originX + f.x + f.size / 2,
                    originY + prevBottom,
                    originY + f.y + f.size,
                    f.size)) {
                    this._place(mon, f, 'top');
                    continue;
                }

                if (f.y > height) {
                    this._place(mon, f, 'top');
                    continue;
                }

                // Two property writes are measurably cheaper than set_translation().
                f.actor.translation_x = f.x;
                f.actor.translation_y = f.y;
                if (f.crystal) {
                    f.rot += f.spin * dt;
                    f.actor.rotation_angle_z = f.rot;
                }
            }
        }
    }
}
