"""The CS in Schools classroom API, ported from the Skulpt fork's csinsc.py.

Two kinds of change from the original, and nothing else:

1. Every `csinscTools.foo(...)` followed by `while csinscTools.fooWaiting:
   continue` collapses to one `block(_host.foo(...))`. Those busy-waits only
   ever terminated because Skulpt injected a suspension point into every
   `while` loop; under CPython they would hang the tab forever. JSPI lets the
   call simply block instead, which is what it always meant.

2. Web-service calls return a dict {status, response} from one fetch, rather
   than setting module-level `...Waiting` / `...Response` / `...Status` flags
   that Python then polled.

Everything else - the colour tables, slowPrint's escape handling, the input
helper family, the error messages - is carried across unchanged, because the
curriculum depends on the exact text.
"""

import re
from random import choice, randint
from time import sleep

import _host
from prelude import block


class Colour:
    reset = "\u001b[ 0;2;0;0;0 m"
    black = "\u001b[ 38;2;0;0;0 m"
    white = "\u001b[ 38;2;255;255;255 m"
    grey = "\u001b[ 38;2;128;128;128 m"
    darkGrey = "\u001b[ 38;2;64;64;64 m"
    lightGrey = "\u001b[ 38;2;192;192;192 m"
    red = "\u001b[ 38;2;255;0;0 m"
    green = "\u001b[ 38;2;0;255;0 m"
    blue = "\u001b[ 38;2;0;0;255 m"
    cyan = "\u001b[ 38;2;0;255;255 m"
    yellow = "\u001b[ 38;2;255;255;0 m"
    magenta = "\u001b[ 38;2;255;0;255 m"
    orange = "\u001b[ 38;2;255;165;0 m"
    purple = "\u001b[ 38;2;127;0;255 m"
    pink = "\u001b[ 38;2;255;192;203 m"
    brown = "\u001b[ 38;2;150;75;0 m"
    violet = "\u001b[ 38;2;128;0;255 m"
    indigo = "\u001b[ 38;2;75;0;130 m"
    crimson = "\u001b[ 38;2;220;20;60 m"
    coral = "\u001b[ 38;2;255;127;80 m"
    gold = "\u001b[ 38;2;255;215;0 m"
    khaki = "\u001b[ 38;2;240;230;140 m"
    olive = "\u001b[ 38;2;128;128;0 m"
    darkGreen = "\u001b[ 38;2;0;100;0 m"
    darkBlue = "\u001b[ 38;2;0;0;100 m"
    darkRed = "\u001b[ 38;2;100;0;0 m"
    lightGreen = "\u001b[ 38;2;144;238;144 m"
    lightBlue = "\u001b[ 38;2;173;216;230 m"
    lightRed = "\u001b[ 38;2;255;160;122 m"


class Highlight:
    reset = "\u001b[ 48;2;0;0;0 m"
    black = "\u001b[ 48;2;0;0;0 m"
    white = "\u001b[ 48;2;255;255;255 m"
    grey = "\u001b[ 48;2;128;128;128 m"
    darkGrey = "\u001b[ 48;2;64;64;64 m"
    lightGrey = "\u001b[ 48;2;192;192;192 m"
    red = "\u001b[ 48;2;255;0;0 m"
    green = "\u001b[ 48;2;0;255;0 m"
    blue = "\u001b[ 48;2;0;0;255 m"
    cyan = "\u001b[ 48;2;0;255;255 m"
    yellow = "\u001b[ 48;2;255;255;0 m"
    magenta = "\u001b[ 48;2;255;0;255 m"
    orange = "\u001b[ 48;2;255;165;0 m"
    purple = "\u001b[ 48;2;127;0;255 m"
    pink = "\u001b[ 48;2;255;192;203 m"
    brown = "\u001b[ 48;2;150;75;0 m"
    violet = "\u001b[ 48;2;128;0;255 m"
    indigo = "\u001b[ 48;2;75;0;130 m"
    crimson = "\u001b[ 48;2;220;20;60 m"
    coral = "\u001b[ 48;2;255;127;80 m"
    gold = "\u001b[ 48;2;255;215;0 m"
    khaki = "\u001b[ 48;2;240;230;140 m"
    olive = "\u001b[ 48;2;128;128;0 m"
    darkGreen = "\u001b[ 48;2;0;100;0 m"
    darkBlue = "\u001b[ 48;2;0;0;100 m"
    darkRed = "\u001b[ 48;2;100;0;0 m"
    lightGreen = "\u001b[ 48;2;144;238;144 m"
    lightBlue = "\u001b[ 48;2;173;216;230 m"
    lightRed = "\u001b[ 48;2;255;160;122 m"


class Style:
    bold = "\u001b[ 1;2;0;0;0 m"
    italics = "\u001b[ 3;2;0;0;0 m"
    underline = "\u001b[ 4;2;0;0;0 m"
    default = "\u001b[ 5;2;0;0;0 m"
    reset = "\u001b[ 5;2;0;0;0 m"


# ------------------------------------------------------------------ school id

# A default rather than "" so the web service can be reached for the shared
# demo content; setSchool() replaces it.
schoolID = "school_default"


def setSchool(id):
    global schoolID
    schoolID = id


def _require_school():
    if len(schoolID) == 0:
        raise Exception("School ID not set. Please set it using the function setSchool().")


def _service(result, what):
    """Turn the host's {status, response} into a value or the fork's exception.

    The status handling is the same in every web-service function in the
    original, so it lives in one place here.
    """
    status = result["status"]
    body = result["response"]
    if status == 403:
        raise Exception(
            "School ID not authenticated, please check the ID and try again, "
            "or contact CS in Schools to obtain an ID for your school.")
    if status == 429:
        raise Exception(
            "Accessing this " + what + " too quickly. Please slow down your "
            "code using sleep() between API calls.")
    if status != 200:
        raise Exception(
            "There was an error running the API on the server, please try "
            "again later or contact CS in Schools support. Details:" + str(body))
    return body


# ------------------------------------------------------------------- Tone.js

class Tone:
    def Begin():
        _host.toneStart()

    def Play(note, duration, time=-1):
        try:
            _host.tonePlay(note, duration, time)
        except Exception as e:
            raise Exception(str(e))

    def Sleep(duration):
        try:
            t = _host.toneSleep(duration)
            sleep(t)
        except Exception as e:
            raise Exception(str(e))


def tonePlay(note, duration, time=-1):
    Tone.Play(note, duration, time)


def toneBegin():
    Tone.Begin()


def toneSleep(duration):
    Tone.Sleep(duration)


# -------------------------------------------------------------------- speech

firstUtterance = True


def say(text, voice=0, language="english"):
    """Speaks the text. Returns immediately - the browser queues the speech.

    Not blocking is the fork's behaviour: csinsc.py there has a
    `while csinscTools.isSpeaking(): continue` loop that is commented out. An
    earlier version of this port waited for the utterance to finish, which
    changed when the *next* line of a lesson ran.

    The profanity filter and the language table live in the host bridge, where
    the fork keeps them - see runtime-pyodide.js. An unknown language raises.
    """
    global firstUtterance
    # a delay on the first utterance lets the speech engine load lazily
    if firstUtterance:
        _host.saySomething("", voice, language)
        sleep(1)
        firstUtterance = False
    _host.saySomething(str(text), voice, language)


def listen(t):
    """Overloaded on type: a string prompts and waits, a number listens for t seconds."""
    if isinstance(t, str):
        print(t, end="", flush=True)
        response = block(_host.listenUntilDone())
        print(response)
    else:
        _host.startListen()
        sleep(t)
        response = _host.stopListen()
    return response


def listenWithText(text=""):
    print(text, end="")
    response = block(_host.listenUntilDone())
    print(response)
    return response


def speak(text, languageTarget="english"):
    _require_school()
    if len(text) > 1024:
        raise Exception("The text is too long, please use less than 1024 characters.")
    return _service(block(_host.getTTS(text, languageTarget, schoolID)), "speak()")


# --------------------------------------------------------------------- print

def write(text):
    print(text, end="")


def slowPrint(*args, delay=0.1, newline=True, sep=''):
    text = ''.join([str(arg) for arg in args])
    escPattern = r"\[ (\d+);2;(\d+);(\d+);(\d+) m"
    i = 0
    colour = ""
    while i < len(text):
        if text[i] == "\u001b":
            m = re.search(escPattern, text[i + 1:])
            if m:
                colour = text[i] + m.group()
                print(text[i] + m.group(), end="")
                # +1 counts the \u001b at the start
                i += len(m.group()) + 1
                # no pause for a style change
                continue
            else:
                print(colour + text[i], end="")
                i += 1
        else:
            print(colour + text[i], end="")
            i += 1
        sleep(delay)
    if newline:
        print()


def slowWrite(args, delay=0.1):
    slowPrint(args, delay, newline=False)


def printWithNumbers(*args):
    print(*args, sep='')


def slowPrintWithNumbers(*args):
    text = ''.join([str(arg) for arg in args])
    slowPrint(text)


# ---------------------------------------------------------------- randomness

def choose(*options):
    return choice(options)


def rollDice(sides=6):
    return randint(1, sides)


# -------------------------------------------------------------- input helpers

def intInput(*args):
    result = None
    while result is None:
        try:
            result = int(input(*args))
        except ValueError:
            print("Incorrect format: expected an integer. Please try again.")
    return result


def floatInput(*args):
    result = None
    while result is None:
        try:
            result = float(input(*args))
        except ValueError:
            print("Incorrect format: expected a float. Please try again.")
    return result


def numInput(*args):
    result = None
    while result is None:
        result = input(*args)
        try:
            result = int(result)
        except ValueError:
            try:
                result = float(result)
            except ValueError:
                print("Incorrect format: expected a number. Please try again.")
                result = None
    return result


def strInput(*args):
    return input(*args)


def inputInteger(*args):
    return intInput(*args)


def inputInt(*args):
    return intInput(*args)


def input_integer(*args):
    return intInput(*args)


def input_float(*args):
    return floatInput(*args)


def inputFloat(*args):
    return floatInput(*args)


def input_number(*args):
    return numInput(*args)


def input_num(*args):
    return numInput(*args)


def inputNumber(*args):
    return numInput(*args)


def inputNum(*args):
    return numInput(*args)


def input_string(*args):
    return input(*args)


# --------------------------------------------------------------------- sound

master_volume = 50


def setVolume(volume):
    global master_volume
    master_volume = volume
    _host.setVolume(volume / 100)


def extract_drive_id(url):
    pattern = r"https://drive\.google\.com/file/d/([a-zA-Z0-9_-]+)"
    match = re.search(pattern, url)
    if match:
        return match.group(1)
    return None


def playSound(url, loop=False):
    googleDriveId = extract_drive_id(url)
    if googleDriveId is not None:
        url = _host.webServiceURL() + "gdrive?id=" + googleDriveId
    block(_host.playSound(url, loop))
    setVolume(master_volume)


def getSoundCurrentTime():
    return _host.getSoundCurrentTime()


def playFreeSoundOrg(id):
    block(_host.playFreeSoundOrg(id))
    setVolume(master_volume)


def stopSound():
    _host.stopSound()


# ----------------------------------------------------------- images and video

def printImage(url, width=None, height=None, x=None, y=None):
    googleDriveId = extract_drive_id(url)
    if googleDriveId is not None:
        url = _host.webServiceURL() + "gdrive?id=" + googleDriveId
    block(_host.addImage(url, width, height, x, y))


def printYoutube(id, width=None, height=None, x=None, y=None):
    block(_host.addYoutube(id, width, height, x, y))


# ------------------------------------------------------------------- buttons

class Button:
    id = 0
    allButtons = {}
    buttonsByText = {}
    buttonsClicked = []

    def __init__(self, text, x=None, y=None, width=None, height=None, callback=None):
        self.text = text
        self.x = x
        self.y = y
        self.width = width
        self.height = height
        self.callback = callback
        self.clicked = False
        self.id = Button.id
        Button.id += 1
        Button.allButtons[self.id] = self
        Button.buttonsByText[text] = self


def createButton(text, x=None, y=None, width=None, height=None, callback=None):
    return Button(text, x, y, width, height, callback)


def printButton(button, x=None, y=None, width=None, height=None):
    if isinstance(button, str):
        button = Button(button, x, y, width, height)
    if x is not None:
        button.x = x
    if y is not None:
        button.y = y
    if width is not None:
        button.width = width
    if height is not None:
        button.height = height
    # Bug-compatible with csinscTools.js: the JS host's addButton signature is
    # (id, text, width, height, x, y, ...) and the original passed width/height
    # where x/y were expected. Teachers have tuned their coordinates against
    # whatever that actually renders, so it is reproduced rather than fixed.
    _host.addButton(button.id, button.text, button.width, button.height,
                    button.x, button.y)
    return button


def waitForButtonClick():
    Button.buttonsClicked = []
    for b in Button.allButtons.values():
        b.clicked = False
    clicked = block(_host.waitForButtonClick())
    ids = list(clicked) if clicked is not None else []
    for i in ids:
        b = Button.allButtons.get(int(i))
        if b is not None:
            b.clicked = True
            Button.buttonsClicked.append(b)
    return Button.buttonsClicked


def waitForButtonClicked():
    return waitForButtonClick()


def waitForButton():
    return waitForButtonClick()


def isButtonClicked(button):
    if isinstance(button, str):
        button = Button.buttonsByText.get(button)
    if button is None:
        raise Exception("That button does not exist.")
    return button.clicked


def isButtonClick(button):
    return isButtonClicked(button)


def isButton(button):
    return isButtonClicked(button)


def getButtonsClicked():
    return Button.buttonsClicked


# ------------------------------------------------------------------ textboxes

class Textbox:
    id = 0
    allTextboxes = {}
    textboxesByText = {}

    def __init__(self, text, x=None, y=None, width=None, height=None, callback=None):
        self.text = text
        self.x = x
        self.y = y
        self.width = width
        self.height = height
        self.callback = callback
        self.id = Textbox.id
        Textbox.id += 1
        Textbox.allTextboxes[self.id] = self
        Textbox.textboxesByText[text] = self

    @property
    def Text(self):
        return _host.getTextboxContents(self.id)

    @Text.setter
    def Text(self, value):
        _host.setTextboxContents(self.id, value)


def createTextbox(text, x=None, y=None, width=None, height=None, callback=None):
    return Textbox(text, x, y, width, height, callback)


def printTextbox(textbox, x=None, y=None, width=None, height=None):
    if isinstance(textbox, str):
        textbox = Textbox(textbox, x, y, width, height)
    if x is not None:
        textbox.x = x
    if y is not None:
        textbox.y = y
    if width is not None:
        textbox.width = width
    if height is not None:
        textbox.height = height
    _host.addTextbox(textbox.id, textbox.text, textbox.width, textbox.height,
                     textbox.x, textbox.y)
    return textbox


def getTextboxContents(textbox):
    if isinstance(textbox, str):
        textbox = Textbox.textboxesByText.get(textbox)
    if textbox is None:
        raise Exception("That textbox does not exist.")
    return textbox.Text


# --------------------------------------------------------------- web services

def logToServer(school, sessionID, data):
    # deliberately fire-and-forget, as in the original
    _host.logToServer(school, sessionID, data)


def getOpenAICompletion(prompt, addTruncateText=True):
    _require_school()
    response = _service(block(_host.getOpenAICompletion(prompt, schoolID)),
                        "getOpenAICompletion()")
    if addTruncateText:
        response = str(response) + Colour.blue + \
            " (Note: this response may be truncated)" + Colour.reset
    return str(response)


def getChatGPTAnswer(prompt, addTruncateText=True):
    return getOpenAICompletion(prompt, addTruncateText)


def getOpenAIImage(prompt):
    _require_school()
    return str(_service(block(_host.getOpenAIImage(prompt, schoolID)),
                        "getOpenAIImage()"))


def getTranslation(text, languageTarget="english"):
    _require_school()
    return str(_service(block(_host.getTranslation(text, languageTarget, schoolID)),
                        "getTranslation()"))


def getWeather(location):
    return _service(block(_host.getWeather(location, schoolID)), "getWeather()")


def getWeatherTemp(location):
    return float(getWeather(location)["current"]["temp_c"])


def getTestAPI(param):
    _require_school()
    return _service(block(_host.getTestAPI(param, schoolID)), "getTestAPI()")


# ----------------------------------------------------------- cloud variables

def getCloudVariable(name):
    _require_school()
    name = schoolID + "_" + name
    _host.showSpinner()
    try:
        result = block(_host.getCloudVariable(name, schoolID))
    finally:
        _host.hideSpinner()
    if result["status"] == 418:
        raise Exception("Variable: " + name + " doesn't exist as a cloud variable.")
    body = _service(result, "getCloudVariable()")
    value = body["value"]
    kind = body["type"]
    # a const is stored as "const <type>"; constness does not affect reading
    if kind[:6] == "const ":
        kind = kind[6:]
    if kind == "int":
        return int(value)
    if kind == "float":
        return float(value)
    return str(value)


def setCloudVariable(name, value):
    _require_school()
    const_type = 0
    if isinstance(value, (list, tuple)) and len(value) == 2 and value[0] in (1, 2):
        const_type = value[0]
        value = value[1]
    typestring = str(type(value)).split("'")[1::2][0]
    name = schoolID + "_" + name
    _host.showSpinner()
    try:
        result = block(_host.setCloudVariable(name, value, typestring, schoolID, const_type))
    finally:
        _host.hideSpinner()
    _service(result, "setCloudVariable()")


def delCloudVariable(name):
    _require_school()
    name = schoolID + "_" + name
    _host.showSpinner()
    try:
        result = block(_host.delCloudVariable(name, schoolID))
    finally:
        _host.hideSpinner()
    # 418 means "no such variable", which delete treats as success. The
    # original hung forever on any non-200 because its XHR handler had no else
    # branch; that cannot happen here, and a hang is never the intended lesson.
    if result["status"] not in (200, 418):
        _service(result, "delCloudVariable()")


def cloudconst(value):
    return [1, value]


def cloudfree(value):
    return [2, value]


def clouddel(variable):
    delCloudVariable(variable)


# ------------------------------------------------- webcam / Teachable Machine

def _webcam_unavailable(name):
    raise NotImplementedError(
        name + "() is not available on the Pyodide runtime yet. "
        "Add ?runtime=skulpt to the URL to use it.")


def showWebCam():
    return block(_host.showWebCam())


def printWebCam():
    return block(_host.printWebCam())


def getWebCamImage():
    return _host.getWebCamImage()


def pauseWebCam():
    return block(_host.pauseWebCam())


def resumeWebCam():
    return block(_host.resumeWebCam())


def loadPoseModel(url=None):
    return block(_host.loadPoseModel(url))


def predictPoseFromWebCam(showAll=False, topK=-1):
    result = block(_host.predictPoseFromWebCam(topK))
    if showAll:
        return result
    best = None
    for entry in result[:-1]:
        if best is None or entry[1] > best[1]:
            best = entry
    return best[0] if best else None


def getSkeletonFromWebCam():
    result = block(_host.predictPoseFromWebCam(-1))
    return result[-1]


def loadAudioModel(url=None):
    return block(_host.loadAudioModel(url))


def predictFromAudio(showAll=False):
    return block(_host.predictFromAudio())


def loadImageModel(url=None):
    return block(_host.loadImageModel(url))


def predictFromImage(param, topK=1):
    result = block(_host.predictFromImage(param, topK))
    return result[0] if topK == 1 else result


def predictFromWebCam(topK=1):
    result = block(_host.predictFromWebCam(topK))
    return result[0] if topK == 1 else result
