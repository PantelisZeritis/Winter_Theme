# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A GNOME Shell extension (`winter-theme@zeroze01`) for GNOME Shell 51 on Fedora 45 / Wayland: falling snow, snow that piles up on windows, a painted winter scene on the desktop, Christmas lights under the top bar, a Quick Settings toggle and a preferences window. Plain ES modules run by the shell's GJS; there is no build step, bundler, linter or unit-test suite.

## Commands

```sh
make check      # syntax-check every JS file (node --check)
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
- Xwayland does not come up in this headless session, so X11 client windows cannot be tested there.

GNOME Shell 51 has no local API docs or GIR files installed. To check an API, extract the shell's own JS from `/usr/lib64/gnome-shell/libshell-51.so` (section `.gresource.shell_js_resources`, `objcopy -O binary --only-section=...`, then `Gio.Resource.load` in gjs) or introspect typelibs with `GI_TYPELIB_PATH=/usr/lib64/gnome-shell:/usr/lib64/mutter-51`.

## Architecture

`extension.js` only wires components together; each one in `lib/` reads the shared `Gio.Settings`, listens to `changed` itself, and has a `destroy()` that must leave nothing behind (the test for this is in the preview: after `disableExtension` no `winter-theme-*` actors remain and window actors are back to one child). The `active` key is a master switch that every component combines with its own `*-enabled` key.

Where each actor lives matters more than anything else in this codebase:

- **Snow** (`lib/snow.js`): one root actor inserted in `uiGroup` directly above `global.window_group`, so it is over windows but under the panel, overview and popups. With `snow-in-front` off it moves into the background group instead. One clipped container per monitor; each flake is a bare `Clutter.Actor` sharing a texture-cache `content`, moved by translation from a single `Clutter.Timeline` tick capped at ~60 Hz. The timeline must be stopped whenever the root is off-stage or hidden.
- **Piles** (`lib/piles.js`): `PileManager.update()` is driven by the snow tick. It keeps a list of window rectangles in stacking order ("ledges", refreshed every 100 ms) and `tryLand()` decides whether a flake crossing a window's top edge settles there, skipping edges covered by a window above. A `Pile` is a height map plus an `St.DrawingArea` added as a **child of the window actor**, which is what makes it follow moves, stacking, animations and overview clones for free. Piles are created lazily on first landing, redrawn at most every 120 ms, and dropped on the window actor's `destroy`.
- **Scenery** (`lib/scenery.js`, `lib/scenePainter.js`): drawing areas inside `Main.layoutManager._backgroundGroup`. `scenePainter.js` and `lib/draw.js` are pure Cairo with no shell imports, so `tools/render-scene.js` can render them under plain gjs. `layoutScene()` (seeded, deterministic) decides positions; `paintScene()` draws the static picture once; `paintTreeLights()` redraws only a small box when the tree lights blink. Day or night palette follows the system `color-scheme`.
- **Lights** (`lib/lights.js`): a drawing area registered with `layoutManager.addChrome(..., {trackFullscreen: true})` and placed just above `panelBox`.
- **Indicator** (`lib/indicator.js`) and `prefs.js` are thin views over the same settings keys; add a new key to the schema, then to whichever of these should expose it.

## Things that are easy to get wrong

- Never add an actor directly to `global.window_group`: mutter's restack lowers every window actor and the background, so foreign children end up above all windows. Use the background group (kept at the bottom) for anything that belongs behind windows.
- The layout manager owns the visibility of tracked chrome, so the lights are switched off by removing and destroying the actor, not by hiding it.
- X11 window actors compute a paint volume from their surface and shadow only, which would cull a pile drawn above the frame. `PileVolumeEffect` extends the volume for X11 clients. The mechanism was verified on a Wayland window; it has not been exercised against a real X11 client.
- Blinking is done with low-frequency `GLib.timeout_add` repaints rather than Clutter transitions, so idle cost stays near zero when the snow is off.
- The snow tick costs roughly 4–5 µs per flake per frame, almost all of it Clutter's redraw queueing, not JS. Per-flake work in `_onFrame()` and `tryLand()` should stay allocation-free.
- `metadata.json` lists only shell version 51; a GNOME upgrade disables the extension until the new version is added and checked.
- `schemas/gschemas.compiled` is git-ignored but must exist next to the XML at runtime, because the install is a symlink to the source tree.
