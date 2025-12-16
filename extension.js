import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Cairo from 'gi://cairo';
import GLib from 'gi://GLib';
import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

// Clipboard setup
const Clipboard = St.Clipboard.get_default();
const CLIPBOARD_TYPE = St.ClipboardType.CLIPBOARD;

// QR Code Engine (No changes needed here)
var QRCode;
(function () {
    function QR8bitByte(data) {
        this.mode = 4;
        this.data = data;
    }
    QR8bitByte.prototype = {
        getLength: function (buffer) { return this.data.length; },
        write: function (buffer) {
            for (var i = 0; i < this.data.length; i++) buffer.put(this.data.charCodeAt(i), 8);
        }
    };

    function QRCodeModel(typeNumber, errorCorrectLevel) {
        this.typeNumber = typeNumber;
        this.errorCorrectLevel = errorCorrectLevel;
        this.modules = null;
        this.moduleCount = 0;
        this.dataCache = null;
        this.dataList = [];
    }
    QRCodeModel.prototype = {
        addData: function (data) {
            var newData = new QR8bitByte(data);
            this.dataList.push(newData);
            this.dataCache = null;
        },
        isDark: function (row, col) {
            if (row < 0 || this.moduleCount <= row || col < 0 || this.moduleCount <= col) throw new Error(row + "," + col);
            return this.modules[row][col];
        },
        getModuleCount: function () { return this.moduleCount; },
        make: function () { this.makeImpl(false, this.getBestMaskPattern()); },
        makeImpl: function (test, maskPattern) {
            this.moduleCount = this.typeNumber * 4 + 17;
            this.modules = new Array(this.moduleCount);
            for (var row = 0; row < this.moduleCount; row++) {
                this.modules[row] = new Array(this.moduleCount);
                for (var col = 0; col < this.moduleCount; col++) this.modules[row][col] = null;
            }
            this.setupPositionProbePattern(0, 0);
            this.setupPositionProbePattern(this.moduleCount - 7, 0);
            this.setupPositionProbePattern(0, this.moduleCount - 7);
            this.setupPositionAdjustPattern();
            this.setupTimingPattern();
            this.setupTypeInfo(test, maskPattern);
            if (this.typeNumber >= 7) this.setupTypeNumber(test);
            if (this.dataCache == null) this.dataCache = QRCodeModel.createData(this.typeNumber, this.errorCorrectLevel, this.dataList);
            this.mapData(this.dataCache, maskPattern);
        },
        setupPositionProbePattern: function (row, col) {
            for (var r = -1; r <= 7; r++) {
                if (row + r <= -1 || this.moduleCount <= row + r) continue;
                for (var c = -1; c <= 7; c++) {
                    if (col + c <= -1 || this.moduleCount <= col + c) continue;
                    if ((0 <= r && r <= 6 && (c == 0 || c == 6)) || (0 <= c && c <= 6 && (r == 0 || r == 6)) || (2 <= r && r <= 4 && 2 <= c && c <= 4))
                        this.modules[row + r][col + c] = true;
                    else
                        this.modules[row + r][col + c] = false;
                }
            }
        },
        getBestMaskPattern: function () {
            var minLostPoint = 0, pattern = 0;
            for (var i = 0; i < 8; i++) {
                this.makeImpl(true, i);
                var lostPoint = QRUtil.getLostPoint(this);
                if (i == 0 || minLostPoint > lostPoint) {
                    minLostPoint = lostPoint;
                    pattern = i;
                }
            }
            return pattern;
        },
        setupTimingPattern: function () {
            for (var r = 8; r < this.moduleCount - 8; r++) {
                if (this.modules[r][6] != null) continue;
                this.modules[r][6] = (r % 2 == 0);
            }
            for (var c = 8; c < this.moduleCount - 8; c++) {
                if (this.modules[6][c] != null) continue;
                this.modules[6][c] = (c % 2 == 0);
            }
        },
        setupPositionAdjustPattern: function () {
            var pos = QRUtil.getPatternPosition(this.typeNumber);
            for (var i = 0; i < pos.length; i++) {
                for (var j = 0; j < pos.length; j++) {
                    var row = pos[i], col = pos[j];
                    if (this.modules[row][col] != null) continue;
                    for (var r = -2; r <= 2; r++)
                        for (var c = -2; c <= 2; c++)
                            this.modules[row + r][col + c] = r == -2 || r == 2 || c == -2 || c == 2 || (r == 0 && c == 0);
                }
            }
        },
        setupTypeNumber: function (test) {
            var bits = QRUtil.getBCHTypeNumber(this.typeNumber);
            for (var i = 0; i < 18; i++) {
                var mod = (!test && ((bits >> i) & 1) == 1);
                this.modules[Math.floor(i / 3)][i % 3 + this.moduleCount - 8 - 3] = mod;
                this.modules[i % 3 + this.moduleCount - 8 - 3][Math.floor(i / 3)] = mod;
            }
        },
        setupTypeInfo: function (test, maskPattern) {
            var data = (this.errorCorrectLevel << 3) | maskPattern;
            var bits = QRUtil.getBCHTypeInfo(data);
            for (var i = 0; i < 15; i++) {
                var mod = (!test && ((bits >> i) & 1) == 1);
                if (i < 6) this.modules[i][8] = mod;
                else if (i < 8) this.modules[i + 1][8] = mod;
                else this.modules[this.moduleCount - 15 + i][8] = mod;
                var mod = (!test && ((bits >> i) & 1) == 1);
                if (i < 8) this.modules[8][this.moduleCount - i - 1] = mod;
                else if (i < 9) this.modules[8][15 - i - 1 + 1] = mod;
                else this.modules[8][15 - i - 1] = mod;
            }
            this.modules[this.moduleCount - 8][8] = (!test);
            this.modules[8][this.moduleCount - 8] = false;
        },
        mapData: function (data, maskPattern) {
            var inc = -1, row = this.moduleCount - 1, bitIndex = 7, byteIndex = 0;
            for (var col = this.moduleCount - 1; col > 0; col -= 2) {
                if (col == 6) col--;
                while (true) {
                    for (var c = 0; c < 2; c++) {
                        if (this.modules[row][col - c] == null) {
                            var dark = false;
                            if (byteIndex < data.length) dark = (((data[byteIndex] >>> bitIndex) & 1) == 1);
                            var mask = QRUtil.getMask(maskPattern, row, col - c);
                            if (mask) dark = !dark;
                            this.modules[row][col - c] = dark;
                            bitIndex--;
                            if (bitIndex == -1) { byteIndex++; bitIndex = 7; }
                        }
                    }
                    row += inc;
                    if (row < 0 || this.moduleCount <= row) { row -= inc; inc = -inc; break; }
                }
            }
        }
    };
    QRCodeModel.createData = function (typeNumber, errorCorrectLevel, dataList) {
        var rsBlocks = QRRSBlock.getRSBlocks(typeNumber, errorCorrectLevel);
        var buffer = new QRBitBuffer();
        for (var i = 0; i < dataList.length; i++) {
            var data = dataList[i];
            buffer.put(data.mode, 4);
            buffer.put(data.getLength(), QRUtil.getLengthInBits(data.mode, typeNumber));
            data.write(buffer);
        }
        var totalDataCount = 0;
        for (var i = 0; i < rsBlocks.length; i++) totalDataCount += rsBlocks[i].dataCount;
        if (buffer.getLengthInBits() > totalDataCount * 8) throw new Error("code length overflow. (" + buffer.getLengthInBits() + ">" + totalDataCount * 8 + ")");
        if (buffer.getLengthInBits() + 4 <= totalDataCount * 8) buffer.put(0, 4);
        while (buffer.getLengthInBits() % 8 != 0) buffer.putBit(false);
        while (true) {
            if (buffer.getLengthInBits() >= totalDataCount * 8) break;
            buffer.put(236, 8);
            if (buffer.getLengthInBits() >= totalDataCount * 8) break;
            buffer.put(17, 8);
        }
        return QRCodeModel.createBytes(buffer, rsBlocks);
    };
    QRCodeModel.createBytes = function (buffer, rsBlocks) {
        var offset = 0, maxDcCount = 0, maxEcCount = 0, dcdata = new Array(rsBlocks.length), ecdata = new Array(rsBlocks.length);
        for (var r = 0; r < rsBlocks.length; r++) {
            var dcCount = rsBlocks[r].dataCount, ecCount = rsBlocks[r].totalCount - dcCount;
            maxDcCount = Math.max(maxDcCount, dcCount);
            maxEcCount = Math.max(maxEcCount, ecCount);
            dcdata[r] = new Array(dcCount);
            for (var i = 0; i < dcdata[r].length; i++) dcdata[r][i] = 0xff & buffer.buffer[i + offset];
            offset += dcCount;
            var rsPoly = QRUtil.getErrorCorrectPolynomial(ecCount), rawPoly = new QRPolynomial(dcdata[r], rsPoly.getLength() - 1), modPoly = rawPoly.mod(rsPoly);
            ecdata[r] = new Array(rsPoly.getLength() - 1);
            for (var i = 0; i < ecdata[r].length; i++) {
                var modIndex = i + modPoly.getLength() - ecdata[r].length;
                ecdata[r][i] = (modIndex >= 0) ? modPoly.get(modIndex) : 0;
            }
        }
        var totalCodeCount = 0;
        for (var i = 0; i < rsBlocks.length; i++) totalCodeCount += rsBlocks[i].totalCount;
        var data = new Array(totalCodeCount), index = 0;
        for (var i = 0; i < maxDcCount; i++) for (var r = 0; r < rsBlocks.length; r++) if (i < dcdata[r].length) data[index++] = dcdata[r][i];
        for (var i = 0; i < maxEcCount; i++) for (var r = 0; r < rsBlocks.length; r++) if (i < ecdata[r].length) data[index++] = ecdata[r][i];
        return data;
    };
    var QRUtil = {
        PATTERN_POSITION_TABLE: [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50], [6, 30, 54], [6, 32, 58], [6, 34, 62], [6, 26, 46, 66], [6, 26, 48, 70], [6, 26, 50, 74], [6, 30, 54, 78], [6, 30, 56, 82], [6, 30, 58, 86], [6, 34, 62, 90], [6, 28, 50, 72, 94], [6, 26, 50, 74, 98], [6, 30, 54, 78, 102], [6, 28, 54, 80, 106], [6, 32, 58, 84, 110], [6, 30, 58, 86, 114], [6, 34, 62, 90, 118], [6, 26, 50, 74, 98, 122], [6, 30, 54, 78, 102, 126], [6, 26, 52, 78, 104, 130], [6, 30, 56, 82, 108, 134], [6, 34, 60, 86, 112, 138], [6, 30, 58, 86, 114, 142], [6, 34, 62, 90, 118, 146], [6, 30, 54, 78, 102, 126, 150], [6, 24, 50, 76, 102, 128, 154], [6, 28, 54, 80, 106, 132, 158], [6, 32, 58, 84, 110, 136, 162], [6, 26, 54, 82, 110, 138, 166], [6, 30, 58, 86, 114, 142, 170]],
        G15: (1 << 10) | (1 << 8) | (1 << 5) | (1 << 4) | (1 << 2) | (1 << 1) | (1 << 0),
        G18: (1 << 12) | (1 << 11) | (1 << 10) | (1 << 9) | (1 << 8) | (1 << 5) | (1 << 2) | (1 << 0),
        G15_MASK: (1 << 14) | (1 << 12) | (1 << 10) | (1 << 4) | (1 << 1),
        getBCHTypeInfo: function (data) { var d = data << 10; while (QRUtil.getBCHDigit(d) - QRUtil.getBCHDigit(QRUtil.G15) >= 0) d ^= (QRUtil.G15 << (QRUtil.getBCHDigit(d) - QRUtil.getBCHDigit(QRUtil.G15))); return ((data << 10) | d) ^ QRUtil.G15_MASK; },
        getBCHTypeNumber: function (data) { var d = data << 12; while (QRUtil.getBCHDigit(d) - QRUtil.getBCHDigit(QRUtil.G18) >= 0) d ^= (QRUtil.G18 << (QRUtil.getBCHDigit(d) - QRUtil.getBCHDigit(QRUtil.G18))); return (data << 12) | d; },
        getBCHDigit: function (data) { var digit = 0; while (data != 0) { digit++; data >>>= 1; } return digit; },
        getPatternPosition: function (typeNumber) { return QRUtil.PATTERN_POSITION_TABLE[typeNumber - 1]; },
        getMask: function (maskPattern, i, j) {
            switch (maskPattern) {
                case 0: return (i + j) % 2 == 0; case 1: return i % 2 == 0; case 2: return j % 3 == 0; case 3: return (i + j) % 3 == 0; case 4: return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 == 0; case 5: return (i * j) % 2 + (i * j) % 3 == 0; case 6: return ((i * j) % 2 + (i * j) % 3) % 2 == 0; case 7: return ((i * j) % 3 + (i + j) % 2) % 2 == 0;
                default: throw new Error("bad maskPattern:" + maskPattern);
            }
        },
        getErrorCorrectPolynomial: function (errorCorrectLength) { var a = new QRPolynomial([1], 0); for (var i = 0; i < errorCorrectLength; i++) a = a.multiply(new QRPolynomial([1, QRUtil.gexp(i)], 0)); return a; },
        getLengthInBits: function (mode, type) { if (1 <= type && type < 10) { switch (mode) { case 1: return 10; case 2: return 9; case 4: return 8; case 8: return 8; } } else if (type < 27) { switch (mode) { case 1: return 12; case 2: return 11; case 4: return 16; case 8: return 10; } } else if (type < 41) { switch (mode) { case 1: return 14; case 2: return 13; case 4: return 16; case 8: return 12; } } throw new Error("mode:" + mode); },
        getLostPoint: function (qrCode) {
            var moduleCount = qrCode.getModuleCount(), lostPoint = 0;
            for (var row = 0; row < moduleCount; row++) for (var col = 0; col < moduleCount; col++) {
                var sameCount = 0, dark = qrCode.isDark(row, col);
                for (var r = -1; r <= 1; r++) { if (row + r < 0 || moduleCount <= row + r) continue; for (var c = -1; c <= 1; c++) { if (col + c < 0 || moduleCount <= col + c) continue; if (r == 0 && c == 0) continue; if (dark == qrCode.isDark(row + r, col + c)) sameCount++; } }
                if (sameCount > 5) lostPoint += (3 + sameCount - 5);
            }
            for (var row = 0; row < moduleCount - 1; row++) for (var col = 0; col < moduleCount - 1; col++) { var count = 0; if (qrCode.isDark(row, col)) count++; if (qrCode.isDark(row + 1, col)) count++; if (qrCode.isDark(row, col + 1)) count++; if (qrCode.isDark(row + 1, col + 1)) count++; if (count == 0 || count == 4) lostPoint += 3; }
            for (var row = 0; row < moduleCount; row++) for (var col = 0; col < moduleCount - 6; col++) if (qrCode.isDark(row, col) && !qrCode.isDark(row, col + 1) && qrCode.isDark(row, col + 2) && qrCode.isDark(row, col + 3) && qrCode.isDark(row, col + 4) && !qrCode.isDark(row, col + 5) && qrCode.isDark(row, col + 6)) lostPoint += 40;
            for (var col = 0; col < moduleCount; col++) for (var row = 0; row < moduleCount - 6; row++) if (qrCode.isDark(row, col) && !qrCode.isDark(row + 1, col) && qrCode.isDark(row + 2, col) && qrCode.isDark(row + 3, col) && qrCode.isDark(row + 4, col) && !qrCode.isDark(row + 5, col) && qrCode.isDark(row + 6, col)) lostPoint += 40;
            var darkCount = 0; for (var col = 0; col < moduleCount; col++) for (var row = 0; row < moduleCount; row++) if (qrCode.isDark(row, col)) darkCount++;
            var ratio = Math.abs(100 * darkCount / moduleCount / moduleCount - 50) / 5; lostPoint += ratio * 10; return lostPoint;
        },
        glog: function (n) { if (n < 1) throw new Error("glog(" + n + ")"); return QRUtil.LOG_TABLE[n]; },
        gexp: function (n) { while (n < 0) n += 255; while (n >= 256) n -= 255; return QRUtil.EXP_TABLE[n]; },
        EXP_TABLE: new Array(256), LOG_TABLE: new Array(256)
    };
    for (var i = 0; i < 8; i++) QRUtil.EXP_TABLE[i] = 1 << i;
    for (var i = 8; i < 256; i++) QRUtil.EXP_TABLE[i] = QRUtil.EXP_TABLE[i - 4] ^ QRUtil.EXP_TABLE[i - 5] ^ QRUtil.EXP_TABLE[i - 6] ^ QRUtil.EXP_TABLE[i - 8];
    for (var i = 0; i < 255; i++) QRUtil.LOG_TABLE[QRUtil.EXP_TABLE[i]] = i;
    function QRPolynomial(num, shift) {
        if (num.length == undefined) throw new Error(num.length + "/" + shift);
        var offset = 0; while (offset < num.length && num[offset] == 0) offset++;
        this.num = new Array(num.length - offset + shift);
        for (var i = 0; i < num.length - offset; i++) this.num[i] = num[i + offset];
    }
    QRPolynomial.prototype = {
        get: function (index) { return this.num[index]; },
        getLength: function () { return this.num.length; },
        multiply: function (e) { var num = new Array(this.getLength() + e.getLength() - 1); for (var i = 0; i < this.getLength(); i++) for (var j = 0; j < e.getLength(); j++) num[i + j] ^= QRUtil.gexp(QRUtil.glog(this.get(i)) + QRUtil.glog(e.get(j))); return new QRPolynomial(num, 0); },
        mod: function (e) { if (this.getLength() - e.getLength() < 0) return this; var ratio = QRUtil.glog(this.get(0)) - QRUtil.glog(e.get(0)); var num = new Array(this.getLength()); for (var i = 0; i < this.getLength(); i++) num[i] = this.get(i); for (var i = 0; i < e.getLength(); i++) num[i] ^= QRUtil.gexp(QRUtil.glog(e.get(i)) + ratio); return new QRPolynomial(num, 0).mod(e); }
    };
    function QRRSBlock(totalCount, dataCount) { this.totalCount = totalCount; this.dataCount = dataCount; }
    QRRSBlock.RS_BLOCK_TABLE = [[1, 26, 19], [1, 26, 16], [1, 26, 13], [1, 26, 9], [1, 44, 34], [1, 44, 28], [1, 44, 22], [1, 44, 16], [1, 70, 55], [1, 70, 44], [2, 35, 17], [2, 35, 13], [1, 100, 80], [2, 50, 32], [2, 50, 24], [4, 25, 9], [1, 134, 108], [2, 67, 41], [2, 50 + 17, 15 + 17], [2, 33 + 17, 11 + 17], [2, 86, 68], [4, 43, 26], [4, 43, 22], [4, 43, 16], [2, 98, 78], [4, 49, 28], [2, 32 + 17, 14 + 17], [4, 39 + 10, 14 + 10], [2, 121, 97], [2, 60 + 13, 36 + 13], [4, 40 + 20, 18 + 20], [4, 30 + 30, 12 + 30], [2, 146, 116], [3, 58 + 15, 36 + 15], [4, 36 + 37, 16 + 37], [4, 36 + 37, 12 + 37], [2, 86, 68, 2, 87, 69], [4, 69 + 4, 43 + 4, 1, 70 + 4, 44 + 4], [6, 43 + 29, 26 + 29, 2, 44 + 29, 27 + 29], [6, 43 + 24, 22 + 24, 2, 44 + 24, 23 + 24]];
    QRRSBlock.getRSBlocks = function (typeNumber, errorCorrectLevel) { var rsBlock = QRRSBlock.getRsBlockTable(typeNumber, errorCorrectLevel); if (rsBlock == undefined) throw new Error("bad rs block @ typeNumber:" + typeNumber + "/errorCorrectLevel:" + errorCorrectLevel); var length = rsBlock.length / 3, list = []; for (var i = 0; i < length; i++) { var count = rsBlock[i * 3 + 0], totalCount = rsBlock[i * 3 + 1], dataCount = rsBlock[i * 3 + 2]; for (var j = 0; j < count; j++) list.push(new QRRSBlock(totalCount, dataCount)); } return list; };
    QRRSBlock.getRsBlockTable = function (typeNumber, errorCorrectLevel) { switch (errorCorrectLevel) { case 1: return QRRSBlock.RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 0]; case 0: return QRRSBlock.RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 1]; case 3: return QRRSBlock.RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 2]; case 2: return QRRSBlock.RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 3]; } return undefined; };
    function QRBitBuffer() { this.buffer = []; this.length = 0; }
    QRBitBuffer.prototype = {
        get: function (index) { var bufIndex = Math.floor(index / 8); return ((this.buffer[bufIndex] >>> (7 - index % 8)) & 1) == 1; },
        put: function (num, length) { for (var i = 0; i < length; i++) this.putBit(((num >>> (length - i - 1)) & 1) == 1); },
        getLengthInBits: function () { return this.length; },
        putBit: function (bit) { var bufIndex = Math.floor(this.length / 8); if (this.buffer.length <= bufIndex) this.buffer.push(0); if (bit) this.buffer[bufIndex] |= (0x80 >>> (this.length % 8)); this.length++; }
    };
    QRCode = QRCodeModel;
})();


// Class for Panel menu
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
            this.menu.connect('open-state-changed', (menu, isOpen) =>{
                if (isOpen){
                    Clipboard.get_text(CLIPBOARD_TYPE, (Clipboard, text) =>{
                        if (text){
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
        
        _drawQR(area){
            let cr = area.get_context();
            let [width, height] = area.get_surface_size();
            
            //Sharpness
            cr.setAntialias(Cairo.Antialias.NONE);

            // White bg
            cr.setSourceRGB(1.0, 1.0, 1.0); 
            cr.rectangle(0, 0, width, height);
            cr.fill();
            
            if (!this._qrText){
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
                cr.moveTo((width - extents.width)/2, height/2);
                cr.showText(message);
                
                // Show char count
                let countMsg = "(" + this._qrText.length + " chars)";
                let extents2 = cr.textExtents(countMsg);
                cr.moveTo((width - extents2.width)/2, (height/2) + 20);
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
                for (let r = 0; r < count; r++){
                    for (let c = 0; c < count; c++){
                        if (qr.isDark(r, c)){
                            let x = c * scale;
                            let y = r * scale;
                           
                            cr.rectangle(x, y, scale + 0.06, scale + 0.06);
                        }
                    }
                }
                cr.fill(); 

            } catch (e){
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