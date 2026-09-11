// Web Bluetooth backend for `from microbit import Microbit`.
//
// Ported from the Skulpt fork's src/lib/microBit.js. That file is 828 lines,
// but the first 448 of them contain no `Sk.` at all - the BLE constants, the
// uBit state class and the notification decoding are plain JavaScript and are
// carried across essentially verbatim. Only the Skulpt class wrapper at the end
// is replaced, by the small Controller below.
//
// The board must be flashed with the CS in Schools hex, and Web Bluetooth
// needs a secure context (https, or localhost) and a Chromium browser.
//
// Everything here is asynchronous and event-driven: GATT notifications arrive
// whenever they arrive and update fields on the uBit instance. The Python side
// polls those fields, yielding a frame between reads - see js/py/microbit.py.

var MicrobitHost = (function () {

    var ACCEL_SRV = "e95d0753-251d-470a-a062-fa1922dfa9a8";
    var ACCEL_DATA = "e95dca4b-251d-470a-a062-fa1922dfa9a8";
    var MAGNETO_SRV = "e95df2d8-251d-470a-a062-fa1922dfa9a8";
    var MAGNETO_DATA = "e95dfb11-251d-470a-a062-fa1922dfa9a8";
    var MAGNETO_BEARING = "e95d9715-251d-470a-a062-fa1922dfa9a8";
    var MAGNETO_CALIBRATE = "e95db358-251d-470a-a062-fa1922dfa9a8";
    var BTN_SRV = "e95d9882-251d-470a-a062-fa1922dfa9a8";
    var BTN_A_STATE = "e95dda90-251d-470a-a062-fa1922dfa9a8";
    var BTN_B_STATE = "e95dda91-251d-470a-a062-fa1922dfa9a8";
    var IO_PIN_SRV = "e95d127b-251d-470a-a062-fa1922dfa9a8";
    var IO_PIN_DATA = "e95d8d00-251d-470a-a062-fa1922dfa9a8";
    var IO_AD_CONFIG = "e95d5899-251d-470a-a062-fa1922dfa9a8";
    var IO_PIN_CONFIG = "e95db9fe-251d-470a-a062-fa1922dfa9a8";
    var IO_PIN_PWM = "e95dd822-251d-470a-a062-fa1922dfa9a8";
    var LED_SRV = "e95dd91d-251d-470a-a062-fa1922dfa9a8";
    var LED_STATE = "e95d7b77-251d-470a-a062-fa1922dfa9a8";
    var LED_TEXT = "e95d93ee-251d-470a-a062-fa1922dfa9a8";
    var LED_SCROLL = "e95d0d2d-251d-470a-a062-fa1922dfa9a8";
    // Note the fork's BLE_LOOKUP disagrees with its own constant here
    // (…9d2e vs …0d2e). The constant is what the notification handler compares
    // against, so it is the one that matters; the table was display only.
    var LED_LIGHT = "e95d0d2e-251d-470a-a062-fa1922dfa9a8";
    var TEMP_SRV = "e95d6100-251d-470a-a062-fa1922dfa9a8";
    var TEMP_DATA = "e95d9250-251d-470a-a062-fa1922dfa9a8";

    // Shown to the student as each service is discovered, so the wait has
    // something moving in it.
    var SRV_LOOKUP = {};
    SRV_LOOKUP[ACCEL_SRV] = "accelerometer";
    SRV_LOOKUP[MAGNETO_SRV] = "magnetometer";
    SRV_LOOKUP[BTN_SRV] = "buttons";
    SRV_LOOKUP[IO_PIN_SRV] = "IO pins";
    SRV_LOOKUP[LED_SRV] = "LED";
    SRV_LOOKUP[TEMP_SRV] = "thermometer";

    function toUTF8Array(str) {
        var utf8 = [];
        for (var i = 0; i < str.length; i++) {
            var c = str.charCodeAt(i);
            if (c < 0x80) {
                utf8.push(c);
            } else if (c < 0x800) {
                utf8.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
            } else if (c < 0xd800 || c >= 0xe000) {
                utf8.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
            } else {
                i++;
                c = 0x10000 + (((c & 0x3ff) << 10) | (str.charCodeAt(i) & 0x3ff));
                utf8.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f),
                          0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
            }
        }
        return utf8;
    }

    function supportedProperties(characteristic) {
        var out = [];
        for (var p in characteristic.properties) {
            if (characteristic.properties[p] === true) { out.push(p.toUpperCase()); }
        }
        return out;
    }

    // --- the board's state, updated by GATT notifications --------------------

    function UBit(controller) {
        this.controller = controller;
        this.accelerometer = { x: 0, y: 0, z: 0 };
        this.magnetometer_raw = { x: 0, y: 0, z: 0 };
        this.magnetometer_bearing = 0;
        this.temperature = 0;
        this.light_sensor = 0;
        this.buttonA = 0;
        this.buttonAPressed = false;
        this.buttonB = 0;
        this.buttonBPressed = false;
        this.connected = false;
        this.writeInProgress = false;
        this.isCalibrating = false;
        this.characteristic = {};
        this.ledMatrix = blankMatrix();
    }

    function blankMatrix() {
        var m = [];
        for (var i = 0; i < 5; i++) { m.push(["0", "0", "0", "0", "0"]); }
        return m;
    }

    function filledMatrix() {
        var m = [];
        for (var i = 0; i < 5; i++) { m.push(["1", "1", "1", "1", "1"]); }
        return m;
    }

    // A GATT write that fails takes the program down, because carrying on
    // would silently drop everything the student drew. The fork did this too,
    // and left a comment calling the coupling evil; it is kept because the
    // alternative is a program that appears to work and does nothing.
    UBit.prototype._write = function (characteristic, buffer, what) {
        var self = this;
        if (!this.connected || !characteristic || !characteristic.writeValue) { return; }
        this.writeInProgress = true;
        characteristic.writeValue(buffer)
            .then(function () { self.writeInProgress = false; })
            .catch(function (error) {
                self.writeInProgress = false;
                if (typeof logError === "function") {
                    logError("There was an error attempting to " + what + ": " + error);
                }
                if (typeof stopEditor === "function") { try { stopEditor(); } catch (e) {} }
            });
    };

    // The LED characteristic wants five bytes, one per row, bit 4 = leftmost.
    UBit.prototype.writeMatrixIcon = function (icon) {
        var rows = new Int8Array(5);
        for (var i = 0; i < 5; i++) {
            var bits = "";
            // Three leading zeros: the byte is right-aligned in the protocol.
            for (var j = 0; j < 8; j++) { bits += (j < 3 ? "0" : icon[i][j - 3]); }
            rows[i] = parseInt(bits, 2);
        }
        this._write(this.characteristic.LED_STATE, rows, "write to the LED screen");
    };

    UBit.prototype.writeMatrixText = function (str) {
        this._write(this.characteristic.LED_TEXT, new Uint8Array(toUTF8Array(str)),
                    "write text to the LED screen");
    };

    UBit.prototype.writeMatrixTextSpeed = function (speed) {
        var b = new Uint8Array(1);
        b[0] = speed;
        this._write(this.characteristic.LED_SCROLL, b, "set the text speed");
    };

    UBit.prototype.writePin = function (pin, value) {
        var b = new Uint8Array(2);
        b[0] = pin;
        b[1] = value;
        this._write(this.characteristic.IO_PIN_DATA, b, "write to a pin");
    };

    UBit.prototype.runCalibration = function () {
        if (!this.connected) { return; }
        this.isCalibrating = true;
        var b = new Uint8Array(1);
        b[0] = 0x01;
        this._write(this.characteristic.MAGNETO_CALIBRATE, b, "calibrate the magnetometer");
    };

    UBit.prototype.characteristicUpdated = function (event) {
        var v = event.target.value;
        var uuid = event.target.uuid;

        if (uuid === BTN_A_STATE) {
            var a = v.getInt8();
            // "Pressed" means it was released and is now held - a transition,
            // not a level, which is why it latches until something reads it.
            this.buttonAPressed = (this.buttonA === 0 && a !== 0);
            this.buttonA = a;
        } else if (uuid === BTN_B_STATE) {
            var b = v.getInt8();
            this.buttonBPressed = (this.buttonB === 0 && b !== 0);
            this.buttonB = b;
        } else if (uuid === ACCEL_DATA) {
            this.accelerometer.x = v.getInt16(0, true);
            this.accelerometer.y = v.getInt16(2, true);
            this.accelerometer.z = v.getInt16(4, true);
        } else if (uuid === MAGNETO_DATA) {
            this.magnetometer_raw.x = v.getInt16(0, true);
            this.magnetometer_raw.y = v.getInt16(2, true);
            this.magnetometer_raw.z = v.getInt16(4, true);
        } else if (uuid === MAGNETO_BEARING) {
            this.magnetometer_bearing = v.getInt16(0, true);
        } else if (uuid === TEMP_DATA) {
            this.temperature = v.getInt8();
        } else if (uuid === LED_LIGHT) {
            this.light_sensor = v.getUint8();
        } else if (uuid === MAGNETO_CALIBRATE) {
            this.isCalibrating = false;
            this.controller.status(v.getInt8() !== 0
                ? "Error in calibrating the magnetometer."
                : "Calibration successful!");
        }
    };

    // --- one connected board -------------------------------------------------

    function Controller() {
        this.microBit = new UBit(this);
        this.device = null;
        this.statusMessages = [];
        this.failed = false;
    }

    Controller.prototype.status = function (msg) { this.statusMessages.push(msg); };

    Controller.prototype.connect = function () {
        var self = this;
        if (!navigator.bluetooth) {
            this.status("Error: this browser has no Web Bluetooth. Use Chrome or Edge.");
            this.failed = true;
            return;
        }
        navigator.bluetooth.requestDevice({
            acceptAllDevices: true,
            optionalServices: [ACCEL_SRV, MAGNETO_SRV, BTN_SRV, IO_PIN_SRV, LED_SRV, TEMP_SRV]
        }).then(function (device) {
            self.device = device;
            return device.gatt.connect();
        }).then(function (server) {
            return server.getPrimaryServices();
        }).then(function (services) {
            var queue = Promise.resolve();
            services.forEach(function (service) {
                if (SRV_LOOKUP[service.uuid]) {
                    self.status("Detected the " + SRV_LOOKUP[service.uuid] + ".");
                }
                queue = queue.then(function () {
                    return service.getCharacteristics().then(function (chars) {
                        chars.forEach(function (c) { self._bind(c); });
                    });
                });
            });
            return queue;
        }).catch(function (error) {
            self.failed = true;
            self.status("Error: " + error);
            self.status("Error: Try re-running the program and pairing the microbit again.");
        });
    };

    Controller.prototype._bind = function (c) {
        var m = this.microBit;
        switch (c.uuid) {
        case IO_PIN_DATA: m.characteristic.IO_PIN_DATA = c; break;
        case IO_AD_CONFIG: m.characteristic.IO_AD_CONFIG = c; break;
        case IO_PIN_CONFIG: m.characteristic.IO_PIN_CONFIG = c; break;
        case IO_PIN_PWM: m.characteristic.IO_PIN_PWM = c; break;
        case LED_TEXT: m.characteristic.LED_TEXT = c; break;
        case LED_SCROLL: m.characteristic.LED_SCROLL = c; break;
        case MAGNETO_CALIBRATE: m.characteristic.MAGNETO_CALIBRATE = c; break;
        case LED_STATE:
            m.characteristic.LED_STATE = c;
            // The fork treats the LED characteristic arriving as "connected",
            // because it is the one every drawing call needs.
            m.connected = true;
            break;
        default: break;
        }
        if (supportedProperties(c).indexOf("NOTIFY") !== -1) {
            c.startNotifications().catch(function (e) { console.log("startNotifications", e); });
            c.addEventListener("characteristicvaluechanged",
                               m.characteristicUpdated.bind(m));
        }
    };

    Controller.prototype.disconnect = function () {
        try {
            if (this.device && this.device.gatt && this.device.gatt.connected) {
                this.device.gatt.disconnect();
            }
        } catch (e) { /* already gone */ }
        this.microBit.connected = false;
    };

    // --- the surface js/py/microbit.py talks to ------------------------------

    var live = [];

    return {
        // Kicks off pairing. Returns immediately; Python waits by polling
        // isConnected() and draining status messages, as the fork did.
        create: function () {
            var c = new Controller();
            live.push(c);
            c.connect();
            return {
                isConnected: function () { return c.microBit.connected; },
                failed: function () { return c.failed; },
                getName: function () { return (c.device && c.device.name) || ""; },
                dequeueStatusMessage: function () {
                    return c.statusMessages.length ? c.statusMessages.shift() : "";
                },
                clearStatusMessage: function () { c.statusMessages = []; },

                isGATTWriting: function () { return c.microBit.writeInProgress; },
                isCalibrating: function () { return c.microBit.isCalibrating; },
                runCalibration: function () { c.microBit.runCalibration(); },

                // row/col are already flipped by the Python side, matching the
                // fork's updatePixel(4 - row, col, value).
                updatePixel: function (x, y, on) {
                    if (x < 0 || x > 4 || y < 0 || y > 4) { return; }
                    c.microBit.ledMatrix[x][y] = on ? "1" : "0";
                    c.microBit.writeMatrixIcon(c.microBit.ledMatrix);
                },
                setLEDs: function (flat) {
                    var m = blankMatrix();
                    for (var i = 0; i < 25; i++) {
                        m[Math.floor(i / 5)][i % 5] = flat[i] ? "1" : "0";
                    }
                    c.microBit.ledMatrix = m;
                    c.microBit.writeMatrixIcon(m);
                },
                clearLED: function () {
                    c.microBit.ledMatrix = blankMatrix();
                    c.microBit.writeMatrixIcon(c.microBit.ledMatrix);
                },
                fillLED: function () {
                    c.microBit.ledMatrix = filledMatrix();
                    c.microBit.writeMatrixIcon(c.microBit.ledMatrix);
                },
                setText: function (t) { c.microBit.writeMatrixText(String(t)); },
                setScrollSpeed: function (s) { c.microBit.writeMatrixTextSpeed(s); },
                writePin: function (p, v) { c.microBit.writePin(p, v); },

                getButtonA: function () { return c.microBit.buttonA > 0 ? 1 : 0; },
                getButtonB: function () { return c.microBit.buttonB > 0 ? 1 : 0; },
                // These latch: reading one clears it, so a press is delivered
                // exactly once however often the program asks.
                isButtonAPressed: function () {
                    var r = c.microBit.buttonAPressed;
                    c.microBit.buttonAPressed = false;
                    return r;
                },
                isButtonBPressed: function () {
                    var r = c.microBit.buttonBPressed;
                    c.microBit.buttonBPressed = false;
                    return r;
                },

                getTemperature: function () { return c.microBit.temperature; },
                getLightSensor: function () { return c.microBit.light_sensor; },
                getBearing: function () { return c.microBit.magnetometer_bearing; },
                getMagnetometerX: function () { return c.microBit.magnetometer_raw.x; },
                getMagnetometerY: function () { return c.microBit.magnetometer_raw.y; },
                getMagnetometerZ: function () { return c.microBit.magnetometer_raw.z; },
                // The fork converts milli-g to m/s^2 and rounds to 1dp.
                getAccelerometerX: function () {
                    return +(c.microBit.accelerometer.x / 1000 * 9.8).toFixed(1);
                },
                getAccelerometerY: function () {
                    return +(c.microBit.accelerometer.y / 1000 * 9.8).toFixed(1);
                },
                getAccelerometerZ: function () {
                    return +(c.microBit.accelerometer.z / 1000 * 9.8).toFixed(1);
                }
            };
        },

        // Called from Runtime.teardown(). A board left paired across runs keeps
        // notifying into a dead interpreter.
        stopAll: function () {
            live.forEach(function (c) { c.disconnect(); });
            live = [];
        },

        available: function () { return !!navigator.bluetooth; }
    };
})();
