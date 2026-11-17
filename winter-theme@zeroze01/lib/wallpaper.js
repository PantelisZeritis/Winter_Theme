// Shows the winter scene where the shell draws the wallpaper itself: the
// overview's workspace cards and the workspace-switch animation. Those do not
// show the desktop's actors, so they would otherwise show the old wallpaper.
//
// The scene is rendered to one PNG per monitor and style (day/night) by
// renderWallpaper.js in a separate process, cached in ~/.cache/winter-theme.
// While scenery is on, BackgroundSource.getBackground() is overridden to hand
// the shell those images for the desktop-background schema. The shell's own
// background code then draws them, so rounded corners, dimming and fades keep
// working. Turning scenery off removes the override and every background
// reloads the normal wallpaper. The lock screen is unaffected: extensions are
// disabled while the screen is locked.

import GDesktopEnums from 'gi://GDesktopEnums';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {InjectionManager} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

Gio._promisify(Gio.Subprocess.prototype, 'wait_check_async');

// Bump when the drawing changes, so cached images are rendered again.
const RENDER_VERSION = 1;
const SCHEMA = 'org.gnome.desktop.background';
const KEYS = new Set(['active', 'scenery-enabled', 'scenery-height', 'aurora-enabled']);

export class SceneWallpaper {
    constructor(extension, settings) {
        this._settings = settings;
        this._script = extension.dir.get_child('lib').get_child('renderWallpaper.js').get_path();
        this._cacheDir = GLib.build_filenamev([GLib.get_user_cache_dir(), 'winter-theme']);
        this._interface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        this._injection = new InjectionManager();
        this._installed = false;
        this._images = new Map();       // "monitor-mode" -> Gio.File
        this._cancellable = null;
        this._retryId = 0;

        this._settingsId = settings.connect('changed', (_settings, key) => {
            if (KEYS.has(key))
                this._sync();
        });
        this._monitorsId = Main.layoutManager.connect('monitors-changed', () => this._sync());
        this._sync();
    }

    destroy() {
        this._settings.disconnect(this._settingsId);
        Main.layoutManager.disconnect(this._monitorsId);
        this._cancellable?.cancel();
        this._cancellable = null;
        if (this._retryId)
            GLib.source_remove(this._retryId);
        this._retryId = 0;
        this._uninstall();
    }

    _source() {
        return Main.layoutManager._bgManagers?.[0]?._backgroundSource ?? null;
    }

    _sync() {
        this._cancellable?.cancel();
        this._cancellable = null;

        const s = this._settings;
        if (!s.get_boolean('active') || !s.get_boolean('scenery-enabled')) {
            this._uninstall();
            return;
        }

        const cancellable = new Gio.Cancellable();
        this._cancellable = cancellable;
        this._prepare(cancellable).catch(e => {
            if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                logError(e, 'Winter Theme: could not render the overview background');
        });
    }

    // Renders whatever images are missing, then points the shell at them.
    async _prepare(cancellable) {
        GLib.mkdir_with_parents(this._cacheDir, 0o755);
        const share = this._settings.get_int('scenery-height') / 100;
        const aurora = this._settings.get_boolean('aurora-enabled') ? 1 : 0;
        const images = new Map();
        const wanted = new Set();

        for (const monitor of Main.layoutManager.monitors) {
            const scale = monitor.geometry_scale ?? 1;
            const seed = 2024 + monitor.index * 7919;
            for (const mode of ['day', 'night']) {
                const glow = mode === 'night' ? aurora : 0;
                const name = `scene-v${RENDER_VERSION}-${monitor.width}x${monitor.height}@${scale}` +
                    `-land${Math.round(share * 100)}-seed${seed}-aurora${glow}-${mode}.png`;
                const path = GLib.build_filenamev([this._cacheDir, name]);
                wanted.add(name);
                if (!GLib.file_test(path, GLib.FileTest.EXISTS)) {
                    const proc = Gio.Subprocess.new(['gjs', '-m', this._script, path, mode,
                        `${monitor.width}`, `${monitor.height}`, `${scale}`, `${seed}`,
                        `${share}`, `${glow}`], Gio.SubprocessFlags.STDERR_PIPE);
                    await proc.wait_check_async(cancellable);
                }
                images.set(`${monitor.index}-${mode}`, Gio.File.new_for_path(path));
            }
        }

        if (cancellable.is_cancelled())
            return;
        this._images = images;
        this._removeStale(wanted);
        this._install();
    }

    // Old renders (other sizes, settings or versions) are deleted.
    _removeStale(wanted) {
        const dir = Gio.File.new_for_path(this._cacheDir);
        const children = dir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
        for (let info; (info = children.next_file(null));) {
            const name = info.get_name();
            if (name.startsWith('scene-') && name.endsWith('.png') && !wanted.has(name))
                dir.get_child(name).delete(null);
        }
        children.close(null);
    }

    _imageFor(monitorIndex) {
        const night = this._interface.get_string('color-scheme') === 'prefer-dark';
        return this._images.get(`${monitorIndex}-${night ? 'night' : 'day'}`) ?? null;
    }

    _install() {
        const source = this._source();
        if (!source) {
            // Early in startup the shell may not have created its backgrounds yet.
            if (!this._retryId) {
                this._retryId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 1, () => {
                    this._retryId = 0;
                    this._install();
                    return GLib.SOURCE_REMOVE;
                });
            }
            return;
        }

        if (!this._installed) {
            // Neither class is exported; reach them through the live source.
            const Background = (source._backgrounds[0] ?? source.getBackground(0)).constructor;
            const wallpaper = this;
            this._injection.overrideMethod(Object.getPrototypeOf(source), 'getBackground',
                original => function (monitorIndex) {
                    const file = this._settings.schema_id === SCHEMA ? wallpaper._imageFor(monitorIndex) : null;
                    if (!file)
                        return original.call(this, monitorIndex);

                    // Keyed apart from the shell's own entries, which are numbers.
                    const key = `winter-${monitorIndex}-${file.get_basename()}`;
                    if (!(key in this._backgrounds)) {
                        const background = new Background({
                            monitorIndex,
                            layoutManager: this._layoutManager,
                            settings: this._settings,
                            file,
                            style: GDesktopEnums.BackgroundStyle.ZOOM,
                        });
                        background._changedId = background.connect('bg-changed', () => {
                            background.disconnect(background._changedId);
                            background.destroy();
                            delete this._backgrounds[key];
                        });
                        this._backgrounds[key] = background;
                    }
                    return this._backgrounds[key];
                });
            this._installed = true;
        }
        this._refresh(source);
    }

    _uninstall() {
        if (!this._installed)
            return;
        this._injection.clear();
        this._installed = false;
        const source = this._source();
        if (source)
            this._refresh(source);
    }

    // Every background manager listens for 'bg-changed' on its background and
    // then asks the source again, so this swaps all of them over.
    _refresh(source) {
        for (const background of Object.values(source._backgrounds))
            background.emit('bg-changed');
    }
}
