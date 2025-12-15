import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

const Clipboard = St.Clipboard.get_default();
const CLIPBOARD_TYPE = St.ClipboardType.CLIPBOARD;

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

            // Create box
            let box = new St.BoxLayout({
                vertical: true,
                style_class: 'qr-content-box',
                x_expand: true,
                y_expand: true
            });

            // Create label
            this._qrLabel = new St.Label({
                text: 'Waiting for clipboard boss...',
                y_align: Clutter.ActorAlign.CENTER
            });
            box.add_child(this._qrLabel);

            this.menu.box.add_child(box);

            // Event listener for clipboard
            this.menu.connect('open-state-changed', (menu, isOpen) =>{
                if (isOpen){
                    Clipboard.get_text(CLIPBOARD_TYPE, (Clipboard, text) =>{
                        if (text){
                            //  update label
                            // Text slice
                            let displayText = text.length > 50 ? text.substring(0, 50) + '...' : text;
                            this._qrLabel.set_text(displayText);
                        } else {
                            this._qrLabel.set_text('Clipboard is empty(');
                        }
                    });
                }
            });
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