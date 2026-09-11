"""`from microbit import Microbit` - a BBC micro:bit over Web Bluetooth.

The fork's src/lib/microbit.py, with one systematic change: every
`while <something>: continue` busy-wait becomes a loop that yields a frame.

Skulpt could get away with spinning because its compiler injected a suspension
into every `while` when `killableWhile` was set, so the browser got a turn
between iterations and the BLE promises could make progress. CPython has no
such thing - a bare `while self.uBit.isGATTWriting(): continue` here would hold
the main thread forever and the GATT write it is waiting for could never
complete. Every one of those loops now calls `_tick()`.

The board must be flashed with the CS in Schools hex. Web Bluetooth needs a
secure context and a Chromium browser; `Microbit()` says so rather than hanging
if it is unavailable.
"""

import js

import _host
from prelude import block
from pyodide.ffi import to_js
from time import time

from csinsc import Colour

_host_bit = js.MicrobitHost


def _tick():
    """Give the browser a frame, and let Stop through.

    Every wait in this module goes through here. One animation frame is the
    right granularity: BLE notifications arrive on the event loop, so there is
    nothing to gain from spinning faster, and a lot to lose.
    """
    block(_host.frameYield())


class Microbit:
    def __init__(self, blockUntilConnect=True, showProgress=False, timeout=20):
        if not _host_bit.available():
            raise RuntimeError(
                "This browser cannot talk to a micro:bit. Web Bluetooth needs "
                "Chrome or Edge, and a page served over https or localhost.")

        self.uBit = _host_bit.create()
        self.showProgress = showProgress
        self.buttonStates = {}
        self.name = ""
        print("Connecting...please wait")

        success = True
        services = 0
        now = time()
        if blockUntilConnect:
            # Two phases, as in the fork: wait for the LED characteristic to
            # arrive (which is what "connected" means), then wait for the
            # remaining services to be discovered.
            #
            # No timeout on this first loop, deliberately - the browser's
            # device-picker is open through it, and a child choosing their board
            # from a list of thirty in a classroom takes longer than the 20s the
            # second phase allows. A cancelled or failed pairing still ends it,
            # because that arrives as an error status message.
            while not self.uBit.isConnected():
                got = self._drain()
                if got is False:
                    success = False
                    break
                # Services discovered during this phase count towards the five
                # the next phase waits for; dropping them made it wait twice.
                services += got
                _tick()

            while success and services < 5:
                if time() - now > timeout:
                    success = False
                    print(Colour.red + "Connection has taken too long." + Colour.reset)
                    break
                got = self._drain()
                if got is False:
                    success = False
                    break
                services += got
                _tick()

            self.name = str(self.uBit.getName())

        if success:
            print(Colour.green + "Houston, I'm ready to run code on " + Colour.reset + self.name)
        else:
            print(Colour.blue + "There was a problem connecting to the microbit, "
                  "please try again." + Colour.reset)

    def _drain(self):
        """Print any queued status messages. False if one of them was an error.

        Returns the number of non-error messages seen, so the caller can count
        services the way the fork did.
        """
        seen = 0
        while True:
            msg = str(self.uBit.dequeueStatusMessage())
            if not msg:
                return seen
            if msg[:5].lower() == "error":
                print(Colour.red + msg + Colour.reset)
                return False
            if self.showProgress:
                print(msg)
            seen += 1

    def _wait_for_write(self):
        # The LED characteristic accepts one write at a time. Queueing a second
        # while the first is in flight loses it.
        while self.uBit.isGATTWriting():
            _tick()

    def getName(self):
        return str(self.uBit.getName())

    # --- LED screen ---------------------------------------------------------

    def setScrollSpeed(self, speed):
        """0 is fastest, 255 slowest."""
        self._wait_for_write()
        try:
            self.uBit.setScrollSpeed(speed)
        except Exception:
            raise Exception("Error encountered setting scroll speed")

    def setText(self, text):
        """Scrolls the text across the screen."""
        self._wait_for_write()
        if len(text) > 20:
            raise Exception("Microbit text limit is 20 characters")
        try:
            self.uBit.setText(text)
        except Exception:
            raise Exception("Error encountered writing text to Microbit LED screen")

    def print(self, text):
        self.setText(text)

    def setLED(self, col, row, value):
        """True turns the LED on, False off. Row 0 is the bottom of the screen."""
        self._wait_for_write()
        try:
            self.uBit.updatePixel(4 - row, col, bool(value))
        except Exception:
            raise Exception("Error encountered writing to Microbit LED screen")

    # `set` is the same call under an older name.
    def set(self, col, row, value):
        self.setLED(col, row, value)

    def setLEDs(self, *argv):
        """25 values, row by row from the top:

            setLEDs(1, 0, 0, 0, 0,
                    0, 1, 0, 0, 0,
                    ...)
        """
        self._wait_for_write()
        values = list(argv)
        if len(values) < 25:
            # The fork pads by appending 25 zeros and slicing, so a short call
            # lights what was given and blanks the rest.
            values += [0] * 25
        try:
            # to_js, not the bare list: a Python list arrives in JavaScript as a
            # PyProxy, which does not answer to flat[i].
            self.uBit.setLEDs(to_js([1 if v else 0 for v in values[:25]]))
        except Exception:
            raise Exception("Error encountered writing to Microbit LED screen")

    def clear(self):
        """Turns all the LEDs off."""
        self._wait_for_write()
        try:
            self.uBit.clearLED()
        except Exception:
            raise Exception("Error encountered writing to Microbit LED screen")

    def fill(self):
        """Turns all the LEDs on."""
        self._wait_for_write()
        try:
            self.uBit.fillLED()
        except Exception:
            raise Exception("Error encountered writing to Microbit LED screen")

    # --- buttons -------------------------------------------------------------

    def isButtonAPressed(self):
        return bool(self.uBit.isButtonAPressed())

    def isButtonBPressed(self):
        return bool(self.uBit.isButtonBPressed())

    def getButtonA(self):
        """0 if not held down, 1 if held down."""
        return int(self.uBit.getButtonA())

    def getButtonB(self):
        return int(self.uBit.getButtonB())

    def getButtons(self):
        return int(self.uBit.getButtonA()), int(self.uBit.getButtonB())

    def waitForButtonA(self):
        """Waits for button A to be released, then pressed."""
        while self.uBit.getButtonA() != 0:
            _tick()
        while self.uBit.getButtonA() == 0:
            _tick()

    def waitForButtonB(self):
        while self.uBit.getButtonB() != 0:
            _tick()
        while self.uBit.getButtonB() == 0:
            _tick()

    # Aliases kept for consistency with the buttons in the goodies module.
    def isButton(self, button):
        return self.isButtonClicked(button)

    def isButtonClick(self, button):
        return self.isButtonClicked(button)

    def isButtonClicked(self, button):
        result = self.buttonStates[button.lower()] == 1
        self.buttonStates[button.lower()] = 0
        return result

    def waitForButton(self):
        return self.waitForButtonClicked()

    def waitForButtonClick(self):
        return self.waitForButtonClicked()

    def waitForButtonClicked(self):
        """Waits for every button to be released, then for one to be pressed."""
        a = int(self.uBit.getButtonA())
        b = int(self.uBit.getButtonB())
        while a != 0 or b != 0:
            _tick()
            a = int(self.uBit.getButtonA())
            b = int(self.uBit.getButtonB())
        while a == 0 and b == 0:
            _tick()
            a = int(self.uBit.getButtonA())
            b = int(self.uBit.getButtonB())
        self.buttonStates = {"a": a, "b": b}
        return a, b

    def waitForButtonPress(self):
        """Waits for a button to be pressed. Does not wait for a release first."""
        a = int(self.uBit.getButtonA())
        b = int(self.uBit.getButtonB())
        while a == 0 and b == 0:
            _tick()
            a = int(self.uBit.getButtonA())
            b = int(self.uBit.getButtonB())
        self.buttonStates = {"a": a, "b": b}
        return a, b

    # --- sensors -------------------------------------------------------------

    def getTemperature(self):
        return int(self.uBit.getTemperature())

    def getLightSensor(self):
        return int(self.uBit.getLightSensor())

    def getBearing(self):
        """0 to 360."""
        return int(self.uBit.getBearing())

    def getMagnetometer(self):
        return (int(self.uBit.getMagnetometerX()),
                int(self.uBit.getMagnetometerY()),
                int(self.uBit.getMagnetometerZ()))

    def getAccelerometer(self):
        return [float(self.uBit.getAccelerometerX()),
                float(self.uBit.getAccelerometerY()),
                float(self.uBit.getAccelerometerZ())]

    def getAccelerometerX(self):
        return float(self.uBit.getAccelerometerX())

    def getAccelerometerY(self):
        return float(self.uBit.getAccelerometerY())

    def getAccelerometerZ(self):
        return float(self.uBit.getAccelerometerZ())

    def getCompass(self, bearing):
        """Turns a bearing in degrees into a compass point."""
        if 22 < bearing <= 67:
            return "NE"
        if 67 < bearing <= 112:
            return "E"
        if 112 < bearing <= 157:
            return "SE"
        if 157 < bearing <= 202:
            return "S"
        if 202 < bearing <= 247:
            return "SW"
        if 247 < bearing <= 292:
            return "W"
        if 292 < bearing <= 337:
            return "NW"
        if 337 < bearing <= 359 or 0 <= bearing <= 22:
            # The fork returns "NW" here, which is simply wrong - this is the
            # arc either side of zero. Fixed: nothing can depend on a compass
            # that cannot say north.
            return "N"
        return "Number out of range 0 to 359"

    def runCalibration(self):
        self.uBit.clearStatusMessage()
        self.uBit.runCalibration()
        result = True
        while self.uBit.isCalibrating():
            if self._drain() is False:
                result = False
            _tick()
        self._drain()
        return result

    def writePin(self, pin, value):
        self.uBit.writePin(pin, value)

    # --- data recording ------------------------------------------------------
    # The fork drove this from a modal in the page plus showSaveFilePicker().
    # No curriculum file calls it, and the modal it looked for is not in this
    # editor's HTML - it would have thrown on the first line.
    def startRecordData(self, interval):
        raise NotImplementedError(
            "startRecordData() is not available on this runtime yet. "
            "Add &runtime=skulpt to the URL to use it.")

    def stopRecordData(self):
        raise NotImplementedError(
            "stopRecordData() is not available on this runtime yet. "
            "Add &runtime=skulpt to the URL to use it.")
