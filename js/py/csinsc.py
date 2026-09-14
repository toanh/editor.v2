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


def _py(value):
    """A reply from the host, as Python values.

    The host resolves plain JavaScript objects and arrays, which arrive here as
    JsProxy objects. Those allow attribute access but not ["key"], slicing or
    negative indexing - so every `result["status"]` raised "TypeError:
    'pyodide.ffi.JsProxy' object is not subscriptable", which broke every web
    service (weather, ChatGPT, images, translation, cloud variables). No gate
    could see it: every curriculum file that uses them carries the blocking
    `network` tag. to_py() converts the whole structure - nested objects to
    dicts, arrays to lists; strings and numbers pass through untouched.
    """
    return value.to_py() if hasattr(value, "to_py") else value


def _service(result, what):
    """Turn the host's {status, response} into a value or the fork's exception.

    The status handling is the same in every web-service function in the
    original, so it lives in one place here.
    """
    result = _py(result)
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
        result = _py(block(_host.getCloudVariable(name, schoolID)))
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
        result = _py(block(_host.delCloudVariable(name, schoolID)))
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
#
# The fork started each of these in csinscTools.js, busy-waited on a
# ...Waiting flag, then read ...Status and ...Response. The host resolves that
# same pair once (runtime-pyodide.js), so both kinds of failure message are the
# fork's, word for word: "Error attempting to ..." for a call that failed
# outright, and the status message - "WebCam not set up." and the like -
# otherwise.

def _teachable(promise, failure):
    _host.showSpinner()
    try:
        result = _py(block(promise))
    except KeyboardInterrupt:
        raise
    except Exception:
        raise Exception(failure)
    finally:
        _host.hideSpinner()
    if result["status"] != 0:
        raise Exception(str(result["response"]))
    return result["response"]


def showWebCam():
    _teachable(_host.showWebCam(), "Error attempting to show webcam")


def printWebCam():
    _teachable(_host.printWebCam(), "Error attempting to show webcam")


def getWebCamImage():
    """The current webcam frame as a data URL.

    Without a webcam the fork returned the string "None" - str() of JavaScript's
    null - and that is kept, as a program may compare with it.
    """
    try:
        data = _host.webCamImage()
    except Exception:
        raise Exception("Error attempting to retrieve image from the webcam")
    if data is None or type(data).__name__ == "JsNull":
        return "None"
    return str(data)


def pauseWebCam():
    _teachable(_host.pauseWebCam(), "Error attempting to show webcam")


def resumeWebCam():
    _teachable(_host.resumeWebCam(), "Error attempting to show webcam")


def loadPoseModel(url=None):
    # "audio model" is in the fork's message too, where this function was
    # copied from loadAudioModel. Kept word for word, like every other message.
    _teachable(_host.loadPoseModel(url), "Error attempting to load the audio model")


def predictPoseFromWebCam(showAll=False, topK=-1):
    response = _teachable(_host.predictPoseFromWebCam(topK),
                          "Error attempting to predict pose from webcam stream")
    if showAll:
        return response
    # The last entry is the skeleton, not a class. The fork's loop included it,
    # so asking for the best class raised IndexError every time.
    maxProb = 0
    maxClass = ""
    for r in response[:-1]:
        if r[1] > maxProb:
            maxClass = r[0]
            maxProb = r[1]
    return maxClass


def getSkeletonFromWebCam():
    response = _teachable(_host.predictPoseFromWebCam(-1),
                          "Error attempting to predict pose from webcam stream")
    return response[-1]


def loadAudioModel(url=None):
    _teachable(_host.loadAudioModel(url), "Error attempting to load the audio model")


def predictFromAudio(showAll=False):
    # showAll is accepted and ignored: the fork commented out everything except
    # returning the whole response.
    return _teachable(_host.predictFromAudio(), "Error attempting to predict from audio stream")


def loadImageModel(url=None):
    _teachable(_host.loadImageModel(url), "Error attempting to load the Image model")


def predictFromImage(param, topK=1):
    response = _teachable(_host.predictFromImage(param, topK),
                          "Error attempting to predict from an image URL using the Image model")
    return response[0] if topK == 1 else response


def predictFromWebCam(topK=1):
    response = _teachable(_host.predictFromWebCam(topK),
                          "Error attempting to predict from webcam using the Image model")
    return response[0] if topK == 1 else response
