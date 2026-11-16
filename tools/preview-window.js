// A plain test window for tools/preview.sh:  gjs -m preview-window.js TITLE WIDTH HEIGHT [dark]
import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';

const [title = 'Window', width = '640', height = '420', style = 'light'] = ARGV;

const app = new Adw.Application({application_id: null});
app.connect('activate', () => {
    Adw.StyleManager.get_default().color_scheme =
        style === 'dark' ? Adw.ColorScheme.FORCE_DARK : Adw.ColorScheme.FORCE_LIGHT;
    const view = new Adw.ToolbarView();
    view.add_top_bar(new Adw.HeaderBar());
    view.set_content(new Gtk.Label({label: title, css_classes: ['title-1']}));
    new Adw.ApplicationWindow({
        application: app,
        title,
        default_width: Number(width),
        default_height: Number(height),
        content: view,
    }).present();
});
app.run([]);
