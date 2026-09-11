"""`from speech import say, listen` - speech synthesis and recognition.

Two functions, and they are deliberately *not* aliases of the csinsc ones:

  * `csinsc.say()` sends a silent first utterance and sleeps a second before
    the real one, to give the browser's speech engine time to load lazily.
    `speech.say()` in the fork calls the host directly with no such delay, and
    takes no `language` argument.
  * `csinsc.listen()` is overloaded on the type of its argument; this one only
    ever listens for a fixed number of seconds.

Keeping them separate matters because the two are used by different lessons and
a student who switches modules should not get different timing.

Speech recognition needs microphone permission and a Chromium browser. Neither
runtime can do anything useful without them, so there is nothing here the
conformance corpus can check - see tests/pyodide-only/.
"""

from time import sleep   # the prelude replaces this with a yielding version

import _host

# All 11 curriculum files say `from speech import *`, so keep that to the two
# names the lessons actually teach. Without this, `block` - an internal - lands
# in the student's namespace.
__all__ = ["say", "listen"]


def say(text, voice=0):
    """Speaks the text. Returns immediately, as the fork does."""
    # No firstUtterance warm-up and no language argument: this is the fork's
    # raw call. The profanity filter and language table are in the host bridge.
    _host.saySomething(str(text), voice, "english")


def listen(t):
    """Listens for t seconds and returns whatever was recognised."""
    _host.startListen()
    sleep(t)
    return str(_host.stopListen())
