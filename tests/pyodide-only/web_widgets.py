# The classroom web services and console widgets cross the JavaScript bridge in
# both directions, and both directions had a shape bug that no gate could see -
# every curriculum file that uses them carries the blocking `network` or
# `widgets` tag:
#
#   * JavaScript -> Python: replies arrived as JsProxy objects, so
#     result["status"] raised "TypeError: 'pyodide.ffi.JsProxy' object is not
#     subscriptable". That broke every web service - weather, ChatGPT, images,
#     translation, cloud variables.
#   * Python -> JavaScript: None arrives as undefined, and console.js tests
#     optional arguments with `!== null`. printImage(url) therefore set
#     img.width = undefined - a zero-size image, with no error - and a button
#     without coordinates was positioned absolutely in the corner.
#
# fetch is intercepted, so nothing here reaches the live service or spends a
# school's API quota.
import js
from goodies import *

js.eval("""
window.__realFetch = window.fetch;
window.fetch = function (url) {
  url = String(url);
  var body = {status: 200, response: ''};
  if (url.indexOf('/weather') > -1) body = {status: 200, response: {current: {temp_c: 12.5}, location: {name: 'Melbourne'}}};
  if (url.indexOf('openai/completion') > -1) body = {status: 200, response: 'Reykjavik'};
  if (url.indexOf('openai/image') > -1) body = {status: 200, response: 'https://example.invalid/castle.png'};
  if (url.indexOf('/translate') > -1) body = {status: 200, response: 'ni hao ma'};
  if (url.indexOf('cloudvars/get') > -1) body = {status: 200, response: {value: '42', type: 'int'}};
  if (url.indexOf('cloudvars/del') > -1) body = {status: 418, response: ''};
  if (url.indexOf('test/testapi') > -1) body = {status: 403, response: ''};
  return Promise.resolve({ json: function () { return Promise.resolve(body); } });
};
""")

try:
    setSchool("test_school")
    print("weather temp:", getWeatherTemp("Melbourne, Australia"))
    print("weather location:", getWeather("Melbourne")["location"]["name"])
    print("completion:", getOpenAICompletion("What is the capital of Iceland?", False))
    print("openai image:", getOpenAIImage("castle ruins"))
    print("translation:", getTranslation("How are you?", "chinese"))
    print("cloud get plus one:", getCloudVariable("score") + 1)
    delCloudVariable("gone")
    print("cloud delete of a missing variable: no error")
    try:
        getTestAPI("x")
        print("403 did not raise")
    except Exception as exc:
        print("403 raises the school-ID message:", str(exc).startswith("School ID not authenticated"))
finally:
    js.eval("window.fetch = window.__realFetch;")

PIXEL = ("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42"
         "mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==")


def last(selector):
    found = js.document.querySelectorAll(selector)
    return found.item(found.length - 1)


printImage(PIXEL)
img = last("#console img")
print("unsized image has no width attribute:", not img.hasAttribute("width"))
print("unsized image is not absolutely positioned:", img.style.position != "absolute")

printImage(PIXEL, 40, 30)
img = last("#console img")
print("sized image:", img.width, img.height)

printButton("Go")
button = last("#console button")
print("button without coordinates is not absolute:", button.style.position != "absolute")
button.remove()     # its label would otherwise join the console text compared here
