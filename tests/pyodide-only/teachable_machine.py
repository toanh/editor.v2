# Webcam and Teachable Machine, with the camera, the models and the microphone
# faked in JavaScript - so what is checked is the port: arguments passed, return
# shapes, defaults and the fork's error messages. Whether the real tf.js models
# and a real camera behave is a manual check.
#
# Before this, all twelve functions raised "not available on the Pyodide runtime".
import js
from goodies import *

js.eval("""
window.__realTm = {
  tmImage: window.tmImage, tmPose: window.tmPose, speechCommands: window.speechCommands,
  createWebCam: window.createWebCam, getWebCamCanvas: window.getWebCamCanvas
};
window.__loaded = [];
var fakeCanvas = document.createElement("canvas");
window.createWebCam = function () { window.__webcamOpen = true; return Promise.resolve(); };
window.getWebCamCanvas = function () { return window.__webcamOpen ? fakeCanvas : null; };
window.tmImage = { load: function (model, meta) {
  window.__loaded.push(model, meta);
  return Promise.resolve({
    getTotalClasses: function () { return 3; },
    predictTopK: function (src, k) {
      return Promise.resolve([{className: "clean", probability: 0.912},
                              {className: "messy", probability: 0.07},
                              {className: "other", probability: 0.018}].slice(0, k));
    }
  });
} };
window.tmPose = {
  load: function (model, meta) {
    window.__loaded.push(model, meta);
    return Promise.resolve({
      getTotalClasses: function () { return 2; },
      estimatePose: function () {
        return Promise.resolve({pose: {keypoints: [{part: "nose", score: 0.9}]}, posenetOutput: 1});
      },
      predict: function () {
        return Promise.resolve([{className: "arms up", probability: 0.3},
                                {className: "arms down", probability: 0.7}]);
      }
    });
  },
  drawKeypoints: function () {}, drawSkeleton: function () {}
};
window.speechCommands = { create: function (fft, vocab, model, meta) {
  window.__loaded.push(model, meta);
  return {
    ensureModelLoaded: function () { return Promise.resolve(); },
    wordLabels: function () { return ["Background Noise", "clap"]; },
    listen: function (cb) {
      setTimeout(function () { cb({scores: [0.9, 0.1]}); }, 10);    // noise: keep listening
      setTimeout(function () { cb({scores: [0.2, 0.8]}); }, 40);
      return Promise.resolve();
    },
    stopListening: function () {}, isListening: function () { return false; }
  };
} };
""")

PIXEL = ("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42"
         "mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==")

try:
    try:
        predictFromWebCam()
    except Exception as exc:
        print("predict before the webcam:", exc)

    loadImageModel("https://teachablemachine.withgoogle.com/models/abc")
    print("image model files:", list(js.window.__loaded))
    print("predictFromImage:", predictFromImage(PIXEL))
    print("predictFromImage top 2:", predictFromImage(PIXEL, 2))

    showWebCam()
    print("predictFromWebCam:", predictFromWebCam())
    print("getWebCamImage without a real webcam:", repr(getWebCamImage()))

    loadPoseModel("https://teachablemachine.withgoogle.com/models/pose/")
    print("predictPoseFromWebCam:", predictPoseFromWebCam())
    print("predictPoseFromWebCam showAll:", predictPoseFromWebCam(True))
    print("getSkeletonFromWebCam:", getSkeletonFromWebCam())

    try:
        loadPoseModel()
    except Exception as exc:
        print("loadPoseModel without a URL:", exc)

    loadAudioModel("https://teachablemachine.withgoogle.com/models/audio")
    print("predictFromAudio:", predictFromAudio())
finally:
    js.eval("""
      Object.keys(window.__realTm).forEach(function (k) { window[k] = window.__realTm[k]; });
      window.__webcamOpen = false;
    """)
