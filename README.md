# Winter Theme

A Christmas-themed GNOME Shell extension: falling snow that piles up on the top edge of windows, a painted winter scene along the bottom of the desktop, and twinkling lights under the top bar. Includes a Quick Settings toggle and a preferences window.

Built for GNOME Shell 51 (Fedora 45, Wayland).

![Night](docs/night.png)
![Day](docs/day.png)

## Install

```sh
git clone <this repo> && cd Winter_Theme
make install
```

Log out and back in, then `make enable` (or `gnome-extensions enable winter-theme@zeroze01`). Settings: `gnome-extensions prefs winter-theme@zeroze01`.

## Development

See `CLAUDE.md` for architecture and the headless preview workflow (`make preview`).
