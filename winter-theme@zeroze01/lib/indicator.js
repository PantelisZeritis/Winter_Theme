// Quick Settings toggle: the tile switches everything on or off, its menu
// switches the individual effects.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {QuickMenuToggle, SystemIndicator} from 'resource:///org/gnome/shell/ui/quickSettings.js';

import {countdown, msUntilMidnight} from './countdown.js';

const ICON = 'weather-snow-symbolic';
const EFFECTS = [
    ['snow-enabled', 'Falling snow'],
    ['pile-enabled', 'Snow on windows'],
    ['cover-enabled', 'Snow on idle monitors'],
    ['scenery-enabled', 'Winter scenery'],
    ['countdown-enabled', 'Christmas countdown'],
    ['sleigh-bells-enabled', 'Sleigh-bell sounds'],
    ['aurora-enabled', 'Northern lights'],
    ['shooting-stars-enabled', 'Shooting stars'],
];

const WinterToggle = GObject.registerClass(
class WinterToggle extends QuickMenuToggle {
    _init(extension, settings) {
        super._init({
            title: 'Winter',
            iconName: ICON,
            toggleMode: true,
        });

        settings.bind('active', this, 'checked', Gio.SettingsBindFlags.DEFAULT);

        // The countdown shows under the tile's title and in the menu header.
        // It refreshes just after midnight and whenever Quick Settings opens
        // (which also covers waking from suspend).
        this._settings = settings;
        this._midnightId = 0;
        this.connect('destroy', () => this._stopMidnight());
        settings.connectObject('changed::countdown-enabled', () => this._syncCountdown(), this);
        Main.panel.statusArea.quickSettings.menu.connectObject('open-state-changed', (_menu, open) => {
            if (open)
                this._syncCountdown();
        }, this);
        this._syncCountdown();

        for (const [key, label] of EFFECTS) {
            const item = new PopupMenu.PopupSwitchMenuItem(label, settings.get_boolean(key));
            item.connect('toggled', (_item, state) => settings.set_boolean(key, state));
            settings.connectObject(`changed::${key}`,
                () => item.setToggleState(settings.get_boolean(key)), item);
            this.menu.addMenuItem(item);
        }

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.menu.addAction('Winter Theme Settings', () => {
            Main.overview.hide();
            Main.panel.closeQuickSettings();
            extension.openPreferences();
        });
    }

    _stopMidnight() {
        if (this._midnightId) {
            GLib.source_remove(this._midnightId);
            this._midnightId = 0;
        }
    }

    _syncCountdown() {
        this._stopMidnight();
        if (!this._settings.get_boolean('countdown-enabled')) {
            this.subtitle = null;
            this.menu.setHeader(ICON, 'Winter Theme');
            return;
        }

        const now = new Date();
        const text = countdown(now.getFullYear(), now.getMonth() + 1, now.getDate());
        this.subtitle = text.short;
        this.menu.setHeader(ICON, 'Winter Theme', text.long);
        this._midnightId = GLib.timeout_add(GLib.PRIORITY_LOW, msUntilMidnight(now), () => {
            this._midnightId = 0;
            this._syncCountdown();
            return GLib.SOURCE_REMOVE;
        });
    }
});

export const WinterIndicator = GObject.registerClass(
class WinterIndicator extends SystemIndicator {
    _init(extension, settings) {
        super._init();

        this.quickSettingsItems.push(new WinterToggle(extension, settings));
        Main.panel.statusArea.quickSettings.addExternalIndicator(this);
    }

    destroy() {
        for (const item of this.quickSettingsItems)
            item.destroy();
        this.quickSettingsItems = [];
        super.destroy();
    }
});
