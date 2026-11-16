// Quick Settings toggle: the tile switches everything on or off, its menu
// switches the individual effects.

import Gio from 'gi://Gio';
import GObject from 'gi://GObject';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {QuickMenuToggle, SystemIndicator} from 'resource:///org/gnome/shell/ui/quickSettings.js';

const ICON = 'weather-snow-symbolic';
const EFFECTS = [
    ['snow-enabled', 'Falling snow'],
    ['pile-enabled', 'Snow on windows'],
    ['scenery-enabled', 'Winter scenery'],
    ['lights-enabled', 'Christmas lights'],
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

        this.menu.setHeader(ICON, 'Winter Theme');

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
