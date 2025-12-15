import GObject from 'gi://GObject';
import St from 'gi://St';
import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

//Class for Panel menu
const QrIndicator =  GObject.registerClass(
    class Qrindicator extends PanelMenu.Button {
        _init() {
            // Call parent constructor; 0.0-> menu align, _(QR Drop)-> menu title
            super._init(0.0, _('QR Drop'));

            // Create icon
            const icon = new St.Icon({
                icon_name: 'smartphone-symbolic',
                style_class: 'system-status-icon',
            });

            // Add icon to panel
            this.add_child(icon);
        }
    }
);
// Main extension class
export default class QrDropExtension extends Extension {
    enable(){
        // If extension is enabled;
        this._indicator = new QrIndicator();

        // Add button to panel
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }
    disable(){
        this._indicator.destroy();
        this._indicator = null;
    }
}