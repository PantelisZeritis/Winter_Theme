#!/usr/bin/env bash
# Runs the extension inside a throwaway, headless GNOME Shell (its own D-Bus
# session, settings and runtime dir, so the real desktop is never touched),
# opens a few test windows, waits for snow to build up and saves screenshots.
#
#   tools/preview.sh [OUTPUT_DIR]
#
# Environment:
#   SIZE=1920x1080     virtual monitor size; several sizes give several monitors
#   X11=1              also start Xwayland, for testing X11 windows
#   WAIT=25            seconds of snowfall before the screenshots
#   STYLE=dark|light   system colour style (the scenery follows it)
#   SETTINGS="pile-rate=6 flake-count=300"   extension settings to override
#   SCRIPT=file.sh     extra commands to run before the screenshots; may use
#                      the functions `shell_eval JS` and `shot NAME`
#   WT_TMP=/tmp        where the session's scratch dir goes; must be a short
#                      path, Wayland socket paths are limited to 108 bytes
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
UUID=winter-theme@zeroze01
DRIVER=preview-driver@winter-theme
SCHEMA=org.gnome.shell.extensions.winter-theme
OUT=$(mkdir -p "${1:-$ROOT/preview}" && cd "${1:-$ROOT/preview}" && pwd)

if [[ -z ${WT_INNER:-} ]]; then
    work=$(mktemp -d "${WT_TMP:-/tmp}/wt.XXXXXX")
    # Session services (the document portal's FUSE mount) take a moment to go away.
    # and may still write while they do, so removal is retried.
    cleanup() {
        for _ in 1 2 3 4 5 6 7 8; do
            fusermount3 -uz "$work/run/doc" 2>/dev/null || true
            rm -rf "$work" 2>/dev/null || true
            sleep 1
            [[ -e $work ]] || break
        done
    }
    trap cleanup EXIT
    mkdir -p "$work"/{run,config,data/gnome-shell/extensions,cache}
    chmod 700 "$work/run"
    ln -s "$ROOT/$UUID" "$work/data/gnome-shell/extensions/$UUID"
    ln -s "$ROOT/tools/$DRIVER" "$work/data/gnome-shell/extensions/$DRIVER"
    glib-compile-schemas "$ROOT/$UUID/schemas"

    env -u WAYLAND_DISPLAY -u DISPLAY \
        WT_INNER=1 WT_WORK="$work" \
        XDG_RUNTIME_DIR="$work/run" XDG_CONFIG_HOME="$work/config" \
        XDG_DATA_HOME="$work/data" XDG_CACHE_HOME="$work/cache" \
        GSETTINGS_BACKEND=keyfile GTK_A11Y=none \
        dbus-run-session -- "$0" "$OUT"
    exit
fi

# ---- inside the throwaway session ----

gsettings set org.gnome.shell enabled-extensions "['$UUID', '$DRIVER']"
gsettings set org.gnome.shell welcome-dialog-last-shown-version '999'
gsettings set org.gnome.desktop.interface color-scheme \
    "$([[ ${STYLE:-dark} == dark ]] && echo prefer-dark || echo default)"
gsettings set org.gnome.desktop.interface enable-animations true
for pair in ${SETTINGS:-}; do
    GSETTINGS_SCHEMA_DIR="$ROOT/$UUID/schemas" gsettings set $SCHEMA "${pair%%=*}" "${pair#*=}"
done

monitors=()
for size in ${SIZE:-1920x1080}; do
    monitors+=(--virtual-monitor "$size")
done
gnome-shell --headless "${monitors[@]}" ${X11:+--wayland} ${X11:---no-x11} \
    > "$OUT/shell.log" 2>&1 &
shell_pid=$!
trap 'kill $(jobs -p) 2>/dev/null || true' EXIT

shell_eval() {
    gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
        --method org.gnome.Shell.Eval "$1"
}

shot() {
    gdbus call --session --dest org.gnome.Shell.Screenshot \
        --object-path /org/gnome/Shell/Screenshot \
        --method org.gnome.Shell.Screenshot.Screenshot false false "$OUT/$1.png" > /dev/null
    echo "saved $OUT/$1.png"
}

for _ in $(seq 60); do
    [[ $(shell_eval 'Main.layoutManager._startingUp' 2>/dev/null) == "(true, 'false')" ]] && break
    sleep 0.5
done
shell_eval 'Main.overview.hide()' > /dev/null

export WAYLAND_DISPLAY=wayland-0
gjs -m "$ROOT/tools/preview-window.js" 'Light window' 760 460 light &
sleep 1.2
gjs -m "$ROOT/tools/preview-window.js" 'Dark window' 620 380 dark &
sleep 1.2
gjs -m "$ROOT/tools/preview-window.js" 'Front window' 520 300 light &
sleep 2
# Stacking order, bottom to top, is the order the windows were opened in.
shell_eval '
    const place = {"Light window": [180, 190], "Dark window": [1080, 330], "Front window": [760, 470]};
    for (const actor of global.get_window_actors()) {
        const spot = place[actor.meta_window.title];
        if (spot)
            actor.meta_window.move_frame(true, ...spot);
    }
' > /dev/null

sleep "${WAIT:-25}"
shot desktop

if [[ -n ${SCRIPT:-} ]]; then
    # shellcheck disable=SC1090
    source "$SCRIPT"
fi

shell_eval "Main.extensionManager.lookup('$UUID').state" | sed 's/^/extension state: /'
grep -iE "$UUID|winter|JS ERROR|TypeError|ReferenceError|SyntaxError|Clutter-(WARNING|CRITICAL)" "$OUT/shell.log" ||
    echo "no extension errors in shell.log"
