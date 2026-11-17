# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A GNOME Shell extension (`winter-theme@zeroze01`) for GNOME Shell 51 on Fedora 45 / Wayland: falling snow, snow that piles up on windows, a painted winter scene on the desktop, a Quick Settings toggle and a preferences window. Plain ES modules run by the shell's GJS; there is no build step, bundler or linter, and the only unit test covers the countdown dates.

## Commands

```sh
make check      # syntax-check every JS file (node --check)
make test       # countdown date checks under plain gjs (tools/test-countdown.js)
make schemas    # recompile the GSettings schema; required after editing the .gschema.xml
make install    # symlink the source dir into ~/.local/share/gnome-shell/extensions
make preview    # run in a throwaway headless shell and save screenshots to preview/
make scene      # render only the scenery to preview/scene-{day,night}.png (no shell needed)
make pack       # build the distributable zip
```

`gnome-extensions enable|disable winter-theme@zeroze01` toggles it, and `gnome-extensions prefs winter-theme@zeroze01` opens the settings.

## Development loop

On Wayland a running shell cannot reload extension code: edits only take effect after logging out and back in. Do not test in the live session; use `tools/preview.sh`, which starts `gnome-shell --headless` in its own D-Bus session with separate settings, data and runtime dirs, opens three test windows, waits, and takes a screenshot. It prints the extension state (`1` = active) and any errors from `shell.log`.

```sh
WAIT=20 SETTINGS="pile-rate=6 flake-count=300" STYLE=light tools/preview.sh out/
SIZE="1920x1080 1280x1024" tools/preview.sh out/     # two monitors
SCRIPT=steps.sh tools/preview.sh out/                # extra steps before exit
```

- A `SCRIPT` file is sourced inside the session and can call `shell_eval 'JS'` (runs in the shell, like Looking Glass) and `shot NAME`. The live extension object is `Main.extensionManager.lookup('winter-theme@zeroze01').stateObj`, so internals such as `._snow`, `._piles._piles` can be inspected or timed.
- Inside `shell_eval`, `Main`, `GLib` and `global` are in scope; get other libraries from `imports.gi`.
- `tools/preview-driver@winter-theme` exists only to switch that throwaway shell into unsafe mode so Eval and Screenshot work. Never install it for real.
- Set `WT_TMP` to a short path if `/tmp` is not usable: the Wayland socket path must stay under 108 bytes.
- The throwaway session uses the keyfile settings backend, and the shell can overwrite external `gsettings set` writes that arrive in quick succession. When a test changes several settings, set them from inside the shell (for example `stateObj._scenery._interface.set_string('color-scheme', 'default')` or `stateObj._settings.set_boolean(...)`).
- Pointer moves can be simulated with a virtual device: `imports.gi.Clutter`, then `global.stage.context.get_backend().get_default_seat().create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE).notify_absolute_motion(GLib.get_monotonic_time(), x, y)`. Avoid (0, 0): it triggers the hot corner and opens the overview. Set `stateObj._cover.speed = 40` to watch the idle cover build in seconds.
- Xwayland does not come up in this headless session, so X11 client windows cannot be tested there.

GNOME Shell 51 has no local API docs or GIR files installed. To check an API, extract the shell's own JS from `/usr/lib64/gnome-shell/libshell-51.so` (section `.gresource.shell_js_resources`, `objcopy -O binary --only-section=...`, then `Gio.Resource.load` in gjs) or introspect typelibs with `GI_TYPELIB_PATH=/usr/lib64/gnome-shell:/usr/lib64/mutter-51`.

## Architecture

`extension.js` only wires components together; each one in `lib/` reads the shared `Gio.Settings`, listens to `changed` itself, and has a `destroy()` that must leave nothing behind (the test for this is in the preview: after `disableExtension` no `winter-theme-*` actors remain and window actors are back to one child). The `active` key is a master switch that every component combines with its own `*-enabled` key.

Where each actor lives matters more than anything else in this codebase:

- **Snow** (`lib/snow.js`): one root actor inserted in `uiGroup` directly above `global.window_group`, so it is over windows but under the panel, overview and popups. With `snow-in-front` off it moves into the background group instead. One clipped container per monitor; each flake is a bare `Clutter.Actor` sharing a texture-cache `content`, moved by translation from a single `Clutter.Timeline` tick capped at ~60 Hz. The timeline must be stopped whenever the root is off-stage or hidden.
- **Piles** (`lib/piles.js`): `PileManager.update()` is driven by the snow tick. It keeps a list of window rectangles in stacking order ("ledges", refreshed every 100 ms) and `tryLand()` decides whether a flake crossing a window's top edge settles there, skipping edges covered by a window above. A `Pile` is a height map plus an `St.DrawingArea` added as a **child of the window actor**, which is what makes it follow moves, stacking, animations and overview clones for free. Piles are created lazily on first landing, redrawn at most every 120 ms, and dropped on the window actor's `destroy`.
- **Scenery** (`lib/scenery.js`, `lib/scenePainter.js`): drawing areas inside `Main.layoutManager._backgroundGroup`, one covering each whole monitor (it hides the wallpaper). The scene is painted back to front: sky, three mountain ranges (far ones hazier; shadowed faces depend on whether the light comes from the left, the sun, or the right, the moon), then a landscape strip at the bottom with a frozen lake on its right (the middle hill dips away there). The lake's reflection is made by calling the same `backdrop` painter (sky, mountains, far shore) a second time, mirrored about the shore line and clipped to the lake, so anything added behind the lake should go into `backdrop` to be reflected (`scenery-height` sets the strip's share); the landscape is laid out in its own coordinates offset by `scene.landTop`. Positions in the strip (hill levels, lake extent) are fractions of the strip height, but object sizes use `s` = monitor height / 1080 (shrunk only if the strip is too short), so a taller strip adds depth rather than bigger objects. `scenePainter.js` and `lib/draw.js` are pure Cairo with no shell imports, so `tools/render-scene.js` can render them under plain gjs. `layoutScene()` (seeded, deterministic) decides positions. Per monitor there are four actors, back to front: the sky (`paintSkyLayer()`, static), the aurora (night only, `aurora-enabled`), the foreground (`paintForeground()`: mountains, lake and land, static and transparent above the ridges) and the tree-lights box (`paintTreeLights()`). `paintScene()` paints sky plus foreground in one go for tools. The aurora (`paintAurora(cr, scene, t)`) is the only continuously animated part: drawn at 1/4 resolution into an actor scaled ×4, repainted from a `GLib.timeout_add` every 150 ms, and skipped while the monitor's sky is hidden (`_skyHidden()`: fullscreen or a maximised window). Each curtain chunk's gradient is tilted perpendicular to its lower edge, so the bright edge follows the wave without steps. Measured cost: about 7% of one core for two visible monitors, under 1% when covered or off. Shooting stars (`shooting-stars-enabled`, night only) fly in a clipped actor between the aurora and the foreground, so they pass behind the mountains. Each meteor is painted once (`paintMeteor()`), then moved and faded with Clutter `ease()` for under a second. One `GLib` timer launches one every 6–18 s on a monitor whose sky is visible, so nothing runs between meteors. `tools/render-scene.js … night … bench` times one aurora frame. Day or night palette follows the system `color-scheme`. The `lights-twinkle` key belongs to the tree lights in the scene; there are no other lights.
- **Overview wallpaper** (`lib/wallpaper.js`, `lib/renderWallpaper.js`): the overview's workspace cards and the workspace-switch animation draw the wallpaper with their own `BackgroundManager`s, not the desktop's actors, so they would show the old wallpaper. While scenery is on, `renderWallpaper.js` renders a still of the scene per monitor and style in a separate `gjs` process, into `~/.cache/winter-theme`, keyed by size, scale, seed, landscape height and aurora, and stale files are deleted. An `InjectionManager` override of `BackgroundSource.prototype.getBackground` (desktop-background schema only) then hands the shell those images. Emitting `bg-changed` on every live background makes all managers reload. Neither class is exported, so both are reached through `Main.layoutManager._bgManagers[0]._backgroundSource`. Bump `RENDER_VERSION` whenever the drawing changes. The lock screen is not covered: extensions are disabled while locked.
- **Idle cover** (`lib/cover.js`): one root actor in `uiGroup` directly above `global.window_group`; the snow root raises itself above it, so the stacking is window_group < cover < snow < panel. A monitor is idle while the pointer is on another monitor and the focused window is not on it (and, with `pause-on-fullscreen`, it shows no fullscreen window). Coverage lives in a `Float32Array` grid with one cell per 16 px. Each update writes it into a tiny RGBA image via `St.ImageContent.set_bytes()`, and an actor stretches that over the monitor with linear filtering. Idle cells grow at per-cell rates (faster near the bottom and edges, patchy), capped at `cover-max-opacity`. When a monitor stops being idle, a melt front spreads from where the pointer entered (or the focused window's centre). One `GLib` timer polls at 250 ms, 50 ms while melting. The cover is hidden in the overview and is non-reactive, so clicks reach whatever is under it.
- **Countdown** (`lib/countdown.js`): pure date logic (`countdown(y, m, d)` → short text for the Winter tile's subtitle, long text for its menu header). It covers Christmas Eve, Christmas, the days to New Year and New Year's Day, then counts to the next Christmas. The indicator refreshes it from a timer set for just after local midnight, and whenever Quick Settings opens.
- **Sleigh bells** (`lib/bells.js`, off by default): while `sleigh-bells-enabled` is on, an `InjectionManager` override of `MessageTray.Notification.prototype.playSound` plays `assets/sleigh-bells.oga` instead of the app's sound. It keeps the shell's own checks: no banner in Do Not Disturb, the per-app `policy.enableSound`, plus the system `event-sounds` key, and rings at most once per 2 s. The override is removed as soon as the setting goes off. The sound is synthesised by `tools/make-sleigh-bells.py` (seeded; needs ffmpeg with libvorbis), so there is no third-party audio. Rerun it to change the sound.
- **Indicator** (`lib/indicator.js`) and `prefs.js` are thin views over the same settings keys; add a new key to the schema, then to whichever of these should expose it.

## Things that are easy to get wrong

- Never add an actor directly to `global.window_group`: mutter's restack lowers every window actor and the background, so foreign children end up above all windows. Use the background group (kept at the bottom) for anything that belongs behind windows.
- Nothing may be drawn over the top bar or the area just below it: the former panel lights were removed because they covered the tabs of maximised windows. Keep new effects out of that strip.
- The layout manager owns the visibility of chrome added with `addChrome()`, so such an actor is switched off by removing and destroying it, not by hiding it.
- X11 window actors compute a paint volume from their surface and shadow only, which would cull a pile drawn above the frame. `PileVolumeEffect` extends the volume for X11 clients. The mechanism was verified on a Wayland window; it has not been exercised against a real X11 client.
- Blinking is done with low-frequency `GLib.timeout_add` repaints rather than Clutter transitions, so idle cost stays near zero when the snow is off.
- The snow tick costs roughly 4–5 µs per flake per frame, almost all of it Clutter's redraw queueing, not JS. Per-flake work in `_onFrame()` and `tryLand()` should stay allocation-free.
- `metadata.json` lists only shell version 51; a GNOME upgrade disables the extension until the new version is added and checked.
- `schemas/gschemas.compiled` is git-ignored but must exist next to the XML at runtime, because the install is a symlink to the source tree.
