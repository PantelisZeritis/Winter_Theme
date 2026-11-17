import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class WinterThemePreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const page = new Adw.PreferencesPage({
            title: 'Winter Theme',
            icon_name: 'weather-snow-symbolic',
        });
        window.add(page);

        const group = (title, description = null) => {
            const g = new Adw.PreferencesGroup({title, description});
            page.add(g);
            return g;
        };

        const toggle = (parent, key, title, subtitle = null) => {
            const row = new Adw.SwitchRow({title, subtitle});
            settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
            parent.add(row);
            return row;
        };

        // Rows below a feature's own switch are greyed out while it is off.
        const number = (parent, dependsOn, key, title, subtitle, lower, upper, step, digits = 0) => {
            const row = new Adw.SpinRow({
                title,
                subtitle,
                digits,
                adjustment: new Gtk.Adjustment({
                    lower, upper, step_increment: step, page_increment: step * 5,
                }),
            });
            settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
            if (dependsOn)
                settings.bind(dependsOn, row, 'sensitive', Gio.SettingsBindFlags.GET);
            parent.add(row);
            return row;
        };

        const general = group('General');
        toggle(general, 'active', 'Winter theme',
            'Master switch, also available in Quick Settings');
        toggle(general, 'countdown-enabled', 'Christmas countdown',
            'Days until Christmas, under the Winter tile in Quick Settings');

        const snow = group('Snow');
        toggle(snow, 'snow-enabled', 'Falling snow');
        number(snow, 'snow-enabled', 'flake-count', 'Amount',
            'Snowflakes on a 1920×1080 monitor', 20, 600, 10);
        number(snow, 'snow-enabled', 'flake-size', 'Flake size', null, 0.5, 2.5, 0.1, 1);
        number(snow, 'snow-enabled', 'fall-speed', 'Fall speed', null, 0.3, 3, 0.1, 1);
        number(snow, 'snow-enabled', 'wind', 'Wind',
            'Negative blows left, positive blows right', -1, 1, 0.05, 2);
        toggle(snow, 'snow-in-front', 'Snow in front of windows',
            'Turn off to keep the snow on the desktop only');
        toggle(snow, 'pause-on-fullscreen', 'Hide in fullscreen',
            'No snow over fullscreen videos and games');

        const piles = group('Snow on windows',
            'Snow settles on the top edge of windows. Shake a window to knock it off.');
        toggle(piles, 'pile-enabled', 'Pile up on windows');
        number(piles, 'pile-enabled', 'pile-max-height', 'Maximum height',
            'Pixels', 6, 60, 1);
        number(piles, 'pile-enabled', 'pile-rate', 'Build-up speed', null, 0.1, 10, 0.1, 1);

        const sounds = group('Sounds');
        toggle(sounds, 'sleigh-bells-enabled', 'Sleigh bells for notifications',
            'Soft bells instead of the notification sound. Silent in Do Not Disturb, for apps with sound alerts off, and when system alert sounds are off.');

        const cover = group('Snow on idle monitors',
            'With more than one monitor, a monitor you are not using (pointer elsewhere and no focused window on it) slowly fills with snow. Move the pointer onto it to melt the snow away.');
        toggle(cover, 'cover-enabled', 'Cover idle monitors');
        number(cover, 'cover-enabled', 'cover-max-opacity', 'Maximum cover',
            'Percent opacity, so the screen stays readable', 20, 90, 5);

        const scenery = group('Scenery',
            'A full-screen winter scene in place of the wallpaper: sky, snowy hills, pines, a cabin, a snowman and a Christmas tree. Day or night follows the light and dark style.');
        toggle(scenery, 'scenery-enabled', 'Winter scenery');
        number(scenery, 'scenery-enabled', 'scenery-height', 'Landscape height',
            'Percent of the screen; the sky fills the rest', 12, 45, 1);
        const aurora = toggle(scenery, 'aurora-enabled', 'Northern lights',
            'Animated, in the night scene (dark style) only');
        settings.bind('scenery-enabled', aurora, 'sensitive', Gio.SettingsBindFlags.GET);
        const meteors = toggle(scenery, 'shooting-stars-enabled', 'Shooting stars',
            'Now and then, in the night scene (dark style) only');
        settings.bind('scenery-enabled', meteors, 'sensitive', Gio.SettingsBindFlags.GET);
        const twinkle = toggle(scenery, 'lights-twinkle', 'Twinkling tree lights');
        settings.bind('scenery-enabled', twinkle, 'sensitive', Gio.SettingsBindFlags.GET);
    }
}
