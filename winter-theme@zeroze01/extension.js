import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {WinterIndicator} from './lib/indicator.js';
import {PanelLights} from './lib/lights.js';
import {PileManager} from './lib/piles.js';
import {Scenery} from './lib/scenery.js';
import {SnowLayer} from './lib/snow.js';

export default class WinterThemeExtension extends Extension {
    enable() {
        this._settings = this.getSettings();

        // Scenery first: when snow is drawn on the desktop only, it shares the
        // background group with the scene and has to sit above it.
        this._scenery = new Scenery(this._settings);
        this._piles = new PileManager(this._settings);
        this._snow = new SnowLayer(this, this._settings, this._piles);
        this._piles.setSnow(this._snow);
        this._lights = new PanelLights(this._settings);
        this._indicator = new WinterIndicator(this, this._settings);
    }

    disable() {
        this._indicator.destroy();
        this._lights.destroy();
        this._snow.destroy();
        this._piles.destroy();
        this._scenery.destroy();

        this._indicator = null;
        this._lights = null;
        this._snow = null;
        this._piles = null;
        this._scenery = null;
        this._settings = null;
    }
}
