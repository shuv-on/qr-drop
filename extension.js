import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Cairo from 'gi://cairo';
import GLib from 'gi://GLib';
import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

import QRCode from './qrcode.js';

// Class for Panel menu
const QrIndicator = GObject.registerClass(
    class QrIndicator extends PanelMenu.Button {
        _init() {
            // Call parent constructor; 0.0-> menu align, _(QR Drop)-> menu title
            super._init(0.0, _('QR Drop'));

            // Initialize Clipboard here (Fixing Global Variable Issue)
            this._clipboard = St.Clipboard.get_default();
            this._clipboardType = St.ClipboardType.CLIPBOARD;

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

            // Drawing Area
            this._drawingArea = new St.DrawingArea({
                style_class: 'qr-image',
                width: 320,
                height: 320,
                x_align: Clutter.ActorAlign.CENTER
            });

            this._drawingArea.connect('repaint', (area) => {
                this._drawQR(area);
            });
            box.add_child(this._drawingArea);

            // Create label
            this._qrLabel = new St.Label({
                text: 'Waiting for clipboard boss...',
                y_align: Clutter.ActorAlign.CENTER
            });
            box.add_child(this._qrLabel);

            // save btn created
            let saveBtn = new St.Button({
                style_class: 'qr-save-button',
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
                can_focus: true,
                reactive: true,
                track_hover: true
            });

            let btnContent = new St.BoxLayout({
                style_class: 'qr-btn-box',
                vertical: false
            });

            let btnIcon = new St.Icon({
                icon_name: 'document-save-symbolic',
                icon_size: 16,
                style: 'color: white;'
            });

            let btnLabel = new St.Label({
                text: 'Save QR Code',
                y_align: Clutter.ActorAlign.CENTER
            });

            btnContent.add_child(btnIcon);
            btnContent.add_child(btnLabel);

            saveBtn.set_child(btnContent);

            saveBtn.connect('clicked', () => {
                this._saveImage();
            });

            box.add_child(saveBtn);

            this.menu.box.add_child(box);

            // Event listener for clipboard
            this.menu.connect('open-state-changed', (menu, isOpen) => {
                if (isOpen) {
                    this._clipboard.get_text(this._clipboardType, (clipboard, text) => {
                        if (text) {
                            //  update label
                            // Text slice
                            let displayText = text.length > 50 ? text.substring(0, 50) + '...' : text;
                            this._qrLabel.set_text(displayText);

                            this._qrText = text;

                            // Queue
                            this._drawingArea.queue_repaint();
                        } else {
                            this._qrLabel.set_text('Clipboard is empty(');
                            this._qrText = null;
                            this._drawingArea.queue_repaint();
                        }
                    });
                }
            });
        }

        _drawQR(area) {
            let cr = area.get_context();
            let [width, height] = area.get_surface_size();

            //Sharpness
            cr.setAntialias(Cairo.Antialias.NONE);

            // White bg
            cr.setSourceRGB(1.0, 1.0, 1.0);
            cr.rectangle(0, 0, width, height);
            cr.fill();

            if (!this._qrText) {
                cr.$dispose();
                return;
            }

            let qr = null;

            //Word check 
            for (let type = 1; type <= 40; type++) {
                try {
                    let tempQR = new QRCode(type, 1); // Low Error Correction (Max Capacity)
                    tempQR.addData(this._qrText);
                    tempQR.make();

                    qr = tempQR;
                    break;
                } catch (e) {
                    continue;
                }
            }

            // if limit exceeded
            if (!qr) {
                cr.setSourceRGB(1, 0, 0);


                cr.selectFontFace("Sans", Cairo.FontSlant.NORMAL, Cairo.FontWeight.BOLD);
                cr.setFontSize(13);

                // Show limits
                let message = "Max Limit Exceeded! (Reduce Text)";
                let extents = cr.textExtents(message);
                cr.moveTo((width - extents.width) / 2, height / 2);
                cr.showText(message);

                // Show char count
                let countMsg = "(" + this._qrText.length + " chars)";
                let extents2 = cr.textExtents(countMsg);
                cr.moveTo((width - extents2.width) / 2, (height / 2) + 20);
                cr.showText(countMsg);

                cr.$dispose();
                return;
            }

            try {
                let count = qr.getModuleCount();

                // W, H and padding 
                let padding = 8;
                let availableSize = Math.min(width, height) - (padding * 2);

                // High
                let scale = availableSize / count;

                let contentSize = scale * count;
                let startX = (width - contentSize) / 2;
                let startY = (height - contentSize) / 2;

                cr.translate(startX, startY);
                cr.setSourceRGB(0.0, 0.0, 0.0);

                // sub pixels
                for (let r = 0; r < count; r++) {
                    for (let c = 0; c < count; c++) {
                        if (qr.isDark(r, c)) {
                            let x = c * scale;
                            let y = r * scale;

                            cr.rectangle(x, y, scale + 0.06, scale + 0.06);
                        }
                    }
                }
                cr.fill();

            } catch (e) {
                console.error('QR Render error:', e);
            }
            cr.$dispose();
        }

        _saveImage() {
            if (!this._qrText) {
                Main.notify("Error", "No QR Code to save!");
                return;
            }

            try {
                // Save loaction
                let picturesDir = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_PICTURES);
                if (!picturesDir) picturesDir = GLib.get_home_dir();

                let filename = `qr_code_by_QRDrop${GLib.get_real_time()}.png`;
                let path = `${picturesDir}/${filename}`;


                let imgSize = 500;
                let surface = new Cairo.ImageSurface(Cairo.Format.ARGB32, imgSize, imgSize);
                let cr = new Cairo.Context(surface);


                cr.setAntialias(Cairo.Antialias.NONE);
                cr.setSourceRGB(1.0, 1.0, 1.0);
                cr.rectangle(0, 0, imgSize, imgSize);
                cr.fill();

                let qr = null;

                for (let type = 1; type <= 40; type++) {
                    try {
                        let tempQR = new QRCode(type, 1);
                        tempQR.addData(this._qrText);
                        tempQR.make();
                        qr = tempQR;
                        break;
                    } catch (e) { continue; }
                }

                if (qr) {
                    let count = qr.getModuleCount();
                    let padding = 20;
                    let availableSize = imgSize - (padding * 2);
                    let scale = availableSize / count;

                    let contentSize = scale * count;
                    let startX = (imgSize - contentSize) / 2;
                    let startY = (imgSize - contentSize) / 2;

                    cr.translate(startX, startY);
                    cr.setSourceRGB(0.0, 0.0, 0.0);

                    for (let r = 0; r < count; r++) {
                        for (let c = 0; c < count; c++) {
                            if (qr.isDark(r, c)) {
                                let x = c * scale;
                                let y = r * scale;
                                cr.rectangle(x, y, scale + 0.06, scale + 0.06);
                            }
                        }
                    }
                    cr.fill();
                }

                // File write
                surface.writeToPNG(path);

                // Memory clean
                cr.$dispose();
                surface.$dispose();

                //Notify users
                Main.notify("QR Saved", `Saved to Pictures/${filename}`);

            } catch (e) {
                global.logError(e);
                Main.notify("Error", "Failed to save QR Code");
            }
        }
    }
);

// Main extension class
export default class QrDropExtension extends Extension {
    enable() {
        // If extension is enabled;
        this._indicator = new QrIndicator();

        // Add button to panel
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }
    disable() {
        this._indicator.destroy();
        this._indicator = null;
    }
}