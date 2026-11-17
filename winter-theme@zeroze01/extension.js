import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {SleighBells} from './lib/bells.js';
import {IdleCover} from './lib/cover.js';
import {WinterIndicator} from './lib/indicator.js';
import {PileManager} from './lib/piles.js';
import {Scenery} from './lib/scenery.js';
import {SnowLayer} from './lib/snow.js';
import {SceneWallpaper} from './lib/wallpaper.js';

export default class WinterThemeExtension extends Extension {
    enable() {
        this._settings = this.getSettings();

        // Scenery first: when snow is drawn on the desktop only, it shares the
        // background group with the scene and has to sit above it.
        this._scenery = new Scenery(this._settings);
        this._wallpaper = new SceneWallpaper(this, this._settings);
        // Before the snow, which places itself above the cover.
        this._cover = new IdleCover(this._settings);
        this._piles = new PileManager(this._settings);
        this._snow = new SnowLayer(this, this._settings, this._piles);
        this._piles.setSnow(this._snow);
        this._bells = new SleighBells(this, this._settings);
        this._indicator = new WinterIndicator(this, this._settings);
    }

    disable() {
        this._indicator.destroy();
        this._bells.destroy();
        this._snow.destroy();
        this._piles.destroy();
        this._cover.destroy();
        this._wallpaper.destroy();
        this._scenery.destroy();

        this._indicator = null;
        this._bells = null;
        this._snow = null;
        this._piles = null;
        this._cover = null;
        this._wallpaper = null;
        this._scenery = null;
        this._settings = null;
    }
}
