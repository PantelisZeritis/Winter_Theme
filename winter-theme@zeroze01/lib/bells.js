// Soft sleigh bells in place of the notification sound.
//
// The shell plays a notification's sound from Notification.playSound() when
// its banner appears, so Do Not Disturb (no banners) and each app's "sound
// alerts" switch (source.policy.enableSound) already apply. While the setting
// is on, that method plays the bundled bells instead of the app's own sound,
// so the two never play together. The override is installed only while the
// setting is on and removed with InjectionManager.clear().

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {InjectionManager} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';

const MIN_GAP = 2;   // s; a burst of notifications rings once, not once per notification
const KEYS = new Set(['active', 'sleigh-bells-enabled']);

export class SleighBells {
    constructor(extension, settings) {
        this._settings = settings;
        this._file = extension.dir.get_child('assets').get_child('sleigh-bells.oga');
        this._sound = new Gio.Settings({schema_id: 'org.gnome.desktop.sound'});
        this._injection = new InjectionManager();
        this._installed = false;
        this._lastPlayed = 0;

        this._settingsId = settings.connect('changed', (_settings, key) => {
            if (KEYS.has(key))
                this._sync();
        });
        this._sync();
    }

    destroy() {
        this._settings.disconnect(this._settingsId);
        this._injection.clear();
        this._installed = false;
    }

    _sync() {
        const s = this._settings;
        const on = s.get_boolean('active') && s.get_boolean('sleigh-bells-enabled');
        if (on && !this._installed) {
            const bells = this;
            this._injection.overrideMethod(MessageTray.Notification.prototype, 'playSound',
                () => function () {
                    if (this.source.policy.enableSound)
                        bells.play();
                });
            this._installed = true;
        } else if (!on && this._installed) {
            this._injection.clear();
            this._installed = false;
        }
    }

    play() {
        // The system-wide "Alert sounds" switch silences these too.
        if (!this._sound.get_boolean('event-sounds'))
            return false;
        const now = GLib.get_monotonic_time() / 1e6;
        if (now - this._lastPlayed < MIN_GAP)
            return false;
        this._lastPlayed = now;
        global.display.get_sound_player().play_from_file(this._file, 'Sleigh bells', null);
        return true;
    }
}
