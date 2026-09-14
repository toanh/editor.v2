// Pyodide backend for the Runtime facade.
//
// Real CPython 3.14 on WebAssembly. The hard part is that CPython has a real C
// stack and cannot yield, whereas the curriculum is full of blocking calls -
// input() appears in 173 of 345 files. The answer is JSPI: pyodide.ffi.run_sync
// suspends the WebAssembly stack while a JavaScript promise settles, so a
// *synchronous* Python function can block without freezing the page.
//
// That requires the program to be entered through a "promising" call
// (PyProxy.callPromising), which is why run() does not use runPythonAsync.
//
// Measured in tests/spike-pyodide.html before any of this was written:
//   - run_sync blocks a sync Python function on the main thread            yes
//   - can_run_sync() is false at top level, true inside a promising call
//     -> it answers "can I block right now", so it cannot be the probe
//   - CPython 3.14 permits frame.f_lineno jumps into if/elif/else bodies,
//     refuses for/with -> the goto design holds
//   - stdout block-buffers at 8 KB unless explicitly unbuffered

var PyodideRuntime = (function () {
    var PY_LIB = "/pyeditor";   // where js/py/*.py is mounted inside Pyodide
    var PY_LIB_VERSION = 29;     // bump when any js/py/*.py changes

    var py = null;              // the Pyodide API object
    var prelude = null;         // the imported prelude module
    var booting = null;         // in-flight boot promise
    var stopped = false;
    var decoder = new TextDecoder("utf-8");
    var webServiceURL = "";
    var hostEntries = [];       // queued until the interpreter exists
    var pendingRejects = [];    // in-flight blocking calls, so stop() can cut them

    // Callbacks for the current run, set by run().
    var onOutput = function () {};
    var onError = function () {};
    var onInput = function () { return Promise.resolve(""); };
    var onStep = function () { return Promise.resolve("step"); };

    // A promise that stop() can reject. Every blocking call goes through this,
    // so pressing Stop surfaces as an exception at the Python call site rather
    // than waiting for whatever the program was waiting on.
    function cancellable(promise) {
        return new Promise(function (resolve, reject) {
            var entry = { reject: reject, done: false };
            pendingRejects.push(entry);
            promise.then(
                function (v) { entry.done = true; resolve(v); },
                function (e) { entry.done = true; reject(e); }
            );
        });
    }

    function cancelPending() {
        var list = pendingRejects;
        pendingRejects = [];
        list.forEach(function (e) {
            if (!e.done) { try { e.reject(new Error("Stopped!")); } catch (x) {} }
        });
    }

    // Python's None reaches JavaScript as undefined, not null. console.js was
    // written against Skulpt, whose remapToJs turns None into null, so it tests
    // every optional width, height, x and y with `!== null` - and undefined sails
    // straight through that test. printImage(url) set img.width = undefined, a
    // zero-size image with no error anywhere, and every printButton without
    // coordinates became position: absolute in the corner. Normalised here,
    // once, for every call that reaches those helpers.
    function nul(v) { return v === undefined ? null : v; }

    // Wraps console.js's callback-style DOM helpers, which take (…, onload,
    // onerror), into a promise. These are the same functions the Skulpt path
    // uses - there is one implementation of "put an image in the console".
    function fromCallbacks(fn) {
        return function () {
            var args = Array.prototype.slice.call(arguments).map(nul);
            return cancellable(new Promise(function (resolve) {
                // Both paths resolve: the original cleared its loading flag on
                // error too, so the program continued rather than hanging.
                fn.apply(null, args.concat([
                    function () { resolve(true); },
                    function () { resolve(false); }
                ]));
            }));
        };
    }

    // One GET against the classroom web service, resolving to the shape
    // csinsc.py expects. Replaces csinscTools.js's XHR-plus-polling-flag.
    function service(path, params, timeoutMs) {
        var qs = Object.keys(params)
            .filter(function (k) { return params[k] !== undefined && params[k] !== null; })
            .map(function (k) { return k + "=" + encodeURIComponent(params[k]); })
            .join("&");
        var ctrl = new AbortController();
        var timer = setTimeout(function () { ctrl.abort(); }, timeoutMs || 20000);
        return cancellable(
            fetch(webServiceURL + path + (qs ? "?" + qs : ""), { signal: ctrl.signal })
                .then(function (r) { return r.json(); })
                .then(function (j) {
                    return { status: parseInt(j.status, 10) || 200, response: j.response };
                })
                .catch(function (e) {
                    // 408 is what the original reported for a timeout or a
                    // transport error, and csinsc.py's messages assume it.
                    return { status: 408, response: String(e && e.message || e) };
                })
                .finally(function () { clearTimeout(timer); })
        );
    }

    // Speech synthesis, ported from the fork's src/lib/csinscTools.js.
    //
    // Two things here are NOT decoration and were missing from the first version of
    // this bridge, which is a regression that reached 11+ curriculum files:
    //
    //   1. A profanity filter. This is a product for primary schools and the
    //      computer will say whatever a child types. Matching text is replaced with
    //      a jokey refusal rather than being spoken. The list stays base64-encoded,
    //      as in the fork - the point is that the source file is not itself full of
    //      slurs.
    //   2. A language table. say(text, language="french") must actually speak
    //      French, and an unknown language must raise rather than silently speak
    //      English.
    //
    // Also faithful to the fork: the utterance is fire-and-forget. csinsc.py has a
    // commented-out "block until finished speaking" loop, so the Python call
    // returns immediately and the browser queues the speech.
    var SPEECH_BAD_WORDS = [
        "YXJzZQ==", "YXJzZWhvbGU=", "YmFsbHM=", "YmFzdGFyZA==",
        "YmVlZg==", "Y3VydGFpbnM=", "Y3Vt", "YmVsbGVuZA==",
        "Yml0Y2g=", "YnVra2FrZQ==", "YnVsbHNoaXQ=", "Y2Fjaw==",
        "Y2hvYWQ=", "Y29jaw==", "Y29jayBjaGVlc2U=", "Y29jayBqb2NrZXk=",
        "Y29ja3N1Y2tlcg==", "Y293", "Y3JhcA==", "Y3Jpa2V5",
        "Y3VudA==", "ZGFtbg==", "ZGljaw==", "ZGlja2hlYWQ=",
        "ZGlsZG8=", "ZHVmZmVy", "ZmFubnk=", "ZmVjaw==",
        "ZmxhcHM=", "ZnVjaw==", "ZnVja2luZyBjdW50", "ZnVja3RhcmQ=",
        "Z29kZGFt", "amVzdXMgY2hyaXN0", "aml6eg==", "a25vYg==",
        "a25vYmhlYWQ=", "bWFua3k=", "bWluZ2U=", "bW90aGVyZnVja2Vy",
        "bXVudGVy", "bXVwcGV0", "bmFmZg==", "bml0d2l0",
        "bnVtcHR5", "bnV0dGVy", "cGlzcyBvZmY=", "cGlzcy1mbGFwcw==",
        "cGlzc2Vk", "cGlzc2VkIG9mZg==", "cGxvbmtlcg==", "cG9uY2U=",
        "cG9vZg==", "cG91Zg==", "cHJpY2s=", "cHVzc3k=",
        "cmFwZXk=", "c2hhZw==", "c2hpdA==", "c2thbms=",
        "c2xhZw==", "c2xhcHBlcg==", "c2x1dA==", "c25hdGNo",
        "c3B1bms=", "dGFydA==", "dGl0", "dG9zc2Vy",
        "dHJvbGxvcA==", "dHdhdA==", "d2Fua2Vy", "d2Fua3N0YWlu",
        "d2hvcmU=", "Y3VudA==", "ZmFnZ290", "bmlnZ2Vy",
        "cGVuaXM="
    ];

    var SPEECH_REPLIES = [
        "nice try", "better luck next time",
        "do you talk to your grandmother with that foul language?",
        "ah nope", "HELP! this student is trying to swear", "get back to work please"
    ];

    var SPEECH_LANGUAGES = {
        "arabic": "ar-SA", "bangla": "bn-BD", "indian bangla": "bn-IN",
        "czech": "cs-CZ", "danish": "da-DK", "austrian german": "de-AT",
        "swiss german": "de-CH", "german": "de-DE", "greek": "el-GR",
        "english": "en-AU", "australian english": "en-AU", "canadian english": "en-CA",
        "british english": "en-GB", "irish english": "en-IE", "indian english": "en-IN",
        "new zeland english": "en-NZ", "american english": "en-US", "south african english": "en-ZA",
        "argentine spanish": "es-AR", "chilean spanish": "es-CL", "colombian spanish": "es-CO",
        "spanish": "es-ES", "mexican spanish": "es-MX", "american spanish": "es-US",
        "finnish": "fi-FI", "belgian french": "fr-BE", "canadian french": "fr-CA",
        "swiss french": "fr-CH", "french": "fr-FR", "hebrew": "he-IL",
        "hindi": "hi-IN", "hungarian": "hu-HU", "indonesian": "id-ID",
        "swiss italian": "it-CH", "italian": "it-IT", "japanese": "ja-JP",
        "korean": "ko-KR", "belgian dutch": "nl-BE", "dutch": "nl-NL",
        "norwegian": "no-NO", "polish": "pl-PL", "brazilian portugese": "pt-BR",
        "portugese": "pt-PT", "romanian": "ro-RO", "russian": "ru-RU",
        "slovak": "sk-SK", "swedish": "sv-SE", "tamil": "ta-IN",
        "sri lankan tamil": "ta-LK", "thai": "th-TH", "turkish": "tr-TR",
        "chinese": "zh-CN", "mandarin": "zh-CN", "hong kong chinese": "zh-HK",
        "cantonese": "zh-HK", "taiwan chinese": "zh-TW", "taiwanese": "zh-TW"
    };

    // The object Python sees as `import _host`.
    var hostBridge = {
        readLine: function (prompt) { return cancellable(Promise.resolve(onInput(prompt))); },
        sleep: function (ms) {
            return cancellable(new Promise(function (r) { setTimeout(r, ms); }));
        },
        clearConsole: function () { if (typeof clearConsole === "function") { clearConsole(); } },
        isStopped: function () { return stopped; },
        webServiceURL: function () { return webServiceURL; },
        // One pause of the step debugger or a breakpoint (js/py/stepper.py).
        // Resolves with "step" or "continue" from the editor's buttons; Stop
        // rejects it, like any other blocking call.
        debugPause: function (lineno, locals, reason) {
            return cancellable(Promise.resolve(onStep({
                lineno: lineno,
                locals: locals === undefined ? null : locals,
                reason: reason
            })).then(function (command) { return command || "step"; }));
        },
        // Resolves on the next animation frame. goto-driven frame loops use
        // this to pace themselves; a setTimeout(0) would spin as fast as the
        // event loop allows and make those sketches unwatchable.
        frameYield: function () {
            return cancellable(new Promise(function (r) { requestAnimationFrame(function () { r(true); }); }));
        },
        showSpinner: function () { if (typeof showSpinner === "function") showSpinner(); },
        hideSpinner: function () { if (typeof hideSpinner === "function") hideSpinner(); },

        // --- speech ---------------------------------------------------------
        saySomething: function (text, voice, lang) {
            if (!window.speechSynthesis) { return; }
            text = String(text === undefined || text === null ? "" : text);

            // The filter runs before anything else, and on the whole string -
            // substring match, exactly as the fork does it.
            var lowered = text.toLowerCase();
            for (var i = 0; i < SPEECH_BAD_WORDS.length; i++) {
                if (lowered.indexOf(atob(SPEECH_BAD_WORDS[i])) > -1) {
                    text = SPEECH_REPLIES[Math.floor(Math.random() * SPEECH_REPLIES.length)];
                    break;
                }
            }

            var u = new SpeechSynthesisUtterance(text);
            var voices = window.speechSynthesis.getVoices();
            if (voices.length) {
                var v = Math.abs(voice | 0);
                if (v >= voices.length) { v %= voices.length; }
                u.voice = voices[v];
            }
            u.pitch = 1;
            u.rate = 1;

            if (lang !== undefined && lang !== null) {
                var key = String(lang).toLowerCase();
                if (!(key in SPEECH_LANGUAGES)) { throw new Error("Unknown language"); }
                u.lang = SPEECH_LANGUAGES[key];
            }

            // Fire and forget, as in the fork: csinsc.py's "block until
            // finished speaking" loop is commented out there, so the Python
            // call returns straight away and the browser queues the utterance.
            window.speechSynthesis.speak(u);
        },
        startListen: function () { if (typeof startListen === "function") startListen(); },
        stopListen: function () {
            return typeof stopListen === "function" ? stopListen() : "";
        },
        listenUntilDone: function () {
            return cancellable(new Promise(function (resolve) {
                var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
                if (!SR) { return resolve(""); }
                var rec = new SR();
                rec.continuous = false;
                rec.lang = "en-AU";
                rec.interimResults = false;
                rec.maxAlternatives = 1;
                rec.onresult = function (e) { resolve(e.results[0][0].transcript); };
                rec.onerror = function () { resolve(""); };
                rec.onend = function () { resolve(""); };
                rec.start();
            }));
        },

        // --- Tone.js (synchronous in the original too) -----------------------
        toneStart: function () { if (typeof tone_start === "function") tone_start(); },
        tonePlay: function (n, d, t) { if (typeof tone_play === "function") tone_play(n, d, t); },
        toneSleep: function (d) {
            return typeof tone_sleep === "function" ? tone_sleep(d) : 0;
        },

        // --- sound -----------------------------------------------------------
        setVolume: function (v) {
            document.querySelectorAll("audio").forEach(function (a) { a.volume = v; });
        },
        playSound: function (url, loop) {
            return fromCallbacks(function (u, l, ok, bad) {
                createAudioElement(u, l, ok, bad);
            })(url, !!loop);
        },
        playFreeSoundOrg: function (id) {
            return fromCallbacks(function (i, ok, bad) { playFreeSound(i, ok, bad); })(id);
        },
        stopSound: function () { if (typeof stopSound === "function") stopSound(); },
        getSoundCurrentTime: function () {
            var a = document.querySelector("audio");
            return a ? a.currentTime : -1;
        },

        // --- images and video -------------------------------------------------
        addImage: function (url, w, h, x, y) {
            return fromCallbacks(function (u, ww, hh, xx, yy, ok, bad) {
                addImage(u, ww, hh, xx, yy, ok, bad);
            })(url, w, h, x, y);
        },
        addYoutube: function (id, w, h, x, y) {
            return fromCallbacks(function (i, ww, hh, xx, yy, ok, bad) {
                addYoutube(i, ww, hh, xx, yy, ok, bad);
            })(id, w, h, x, y);
        },

        // --- buttons and textboxes -------------------------------------------
        addButton: function (id, text, w, h, x, y) {
            _clickedButtons = [];
            // Same scrambled argument order as csinscTools.js - see the note in
            // csinsc.printButton.
            addButton(id, text, nul(w), nul(h), nul(x), nul(y), nul(w), nul(h), function (ev) {
                _clickedButtons.push(ev.target.id);
                if (_awaitButton) { var f = _awaitButton; _awaitButton = null; f(_clickedButtons); }
            });
        },
        waitForButtonClick: function () {
            _clickedButtons = [];
            return cancellable(new Promise(function (resolve) { _awaitButton = resolve; }));
        },
        addTextbox: function (id, text, w, h, x, y) {
            addTextbox(id, text, nul(w), nul(h), nul(x), nul(y), nul(w), nul(h), function () {});
        },
        getTextboxContents: function (id) {
            var el = document.getElementById(id);
            return el ? el.value : "";
        },
        setTextboxContents: function (id, v) {
            var el = document.getElementById(id);
            if (el) { el.value = v; }
        },

        // --- web services ------------------------------------------------------
        logToServer: function (school, session, data) {
            service("datalogging/log", { school: school, session: session, data: data });
        },
        getOpenAICompletion: function (prompt, school) {
            return service("openai/completion", { prompt: prompt, school: school });
        },
        getOpenAIImage: function (prompt, school) {
            return service("openai/image", { prompt: prompt, school: school });
        },
        getTranslation: function (text, target, school) {
            return service("translate", { text: text, target: target, school: school }, 10000);
        },
        getWeather: function (location, school) {
            return service("weather", { location: location, school: school }, 10000);
        },
        getTTS: function (text, language, school) {
            return service("tts", { text: text, language: language, school: school }, 10000);
        },
        getTestAPI: function (param, school) {
            return service("test/testapi", { param: param, school: school }, 10000);
        },
        getCloudVariable: function (name, school) {
            return service("cloudvars/get", { name: name, school: school }, 10000);
        },
        setCloudVariable: function (name, val, type, school, constType) {
            return service("cloudvars/put",
                { name: name, val: val, type: type, school: school, const_type: constType }, 10000);
        },
        delCloudVariable: function (name, school) {
            return service("cloudvars/del", { name: name, school: school }, 10000);
        },

        // --- console.js classroom functions (js/py/consolehost.py) -------------
        // console.js's own versions unwrap Skulpt values, so the Pyodide
        // builtins come here instead - reusing console.js's DOM helpers and
        // globals, so there is one implementation of each and stopAllHue()
        // still stops a Hue timeline.
        setConsoleFontSize: function (size) { fontSize = size + "pt"; },
        showIFrame: function (url, w, h, x, y) {
            return cancellable(new Promise(function (resolve, reject) {
                showSpinner();
                var frame = createIFrameElement(url, nul(w), nul(h), nul(x), nul(y));
                frame.onload = function () {
                    frame.style.display = "block";
                    hideSpinner();
                    resolve(true);
                };
                frame.onerror = function () {
                    hideSpinner();
                    reject(new Error("There was an error loading: " + url));
                };
                pyConsole.appendChild(frame);
            }));
        },
        setWebCamCallback: function (f) { webCamCallback = f || null; },

        hueSetBridge: function (IP, user, bridgeUser, useHttps) {
            return cancellable(new Promise(function (resolve, reject) {
                g_hueUserName = bridgeUser;
                var school = "school_huebridge";
                showSpinner();
                fetch(webServiceURL + "cloudvars/get?name=" + school + "_cloud_" + user + "&school=" + school)
                    .then(function (r) { return r.json(); })
                    .then(function (data) {
                        if (data.status === 418 || data.value === "False") {
                            throw new Error("User not enabled:" + user);
                        }
                        if (data.status !== 200) {
                            throw new Error("Error with school code for setting the Hue Bridge IP");
                        }
                        g_hueBridgeIP = IP;
                        g_useHTTPS = useHttps;
                        var ctrl = new AbortController();
                        var timer = setTimeout(function () { ctrl.abort(); }, 5000);
                        return fetch(getHueBridgeURL() + "/api/" + g_hueUserName + "/lights",
                                     { method: "GET", signal: ctrl.signal })
                            .then(function (r) { return r.json(); }, function (err) {
                                throw new Error(err && err.name === "AbortError"
                                    ? "Timed out when trying to connect to IP: " + IP +
                                      " - please check that you have the correct ID address."
                                    : "Error with accessing the hue bridge. Please check that you can access https://" +
                                      IP + " - " + err);
                            })
                            .then(function (lights) {
                                if (lights && lights.length > 0 && "error" in lights[0]) {
                                    throw new Error("Error with accessing the hue bridge:" + lights[0].error.description);
                                }
                                return lights;
                            })
                            .finally(function () { clearTimeout(timer); });
                    })
                    .then(resolve, reject)
                    .finally(hideSpinner);
            }));
        },
        hueSetLight: function (light, on, bright, x, y) {
            var state = {};
            if (on !== undefined && on !== null) { state.on = !!on; }
            if (bright !== undefined && bright !== -1) { state.bri = Math.min(bright, 254); }
            if (x !== undefined && y !== undefined && x !== -1 && y !== -1) {
                state.xy = [x, y];
                state.colormode = "xy";
            }
            hueRequest("/lights/" + light + "/state", "PUT", state);
        },
        hueLight: function (light, on) { hueRequest("/lights/" + light + "/state", "PUT", { on: !!on }); },
        hueBright: function (light, bri) { hueRequest("/lights/" + light + "/state", "PUT", { bri: bri }); },
        hueColour: function (light, x, y) {
            hueRequest("/lights/" + light + "/state", "PUT", { xy: [x, y], colormode: "xy" });
        },
        hueGetLight: function (light) {
            return cancellable(hueFetch("/lights/" + light));
        },
        hueGetButton: function (button) {
            return cancellable(hueFetch("/sensors/" + button).then(function (d) { return d.state.buttonevent; }));
        },
        hueWaitForButton: function (button) {
            var timer = null;
            var wait = new Promise(function (resolve, reject) {
                timer = setInterval(function () {
                    hueFetch("/sensors/" + button).then(function (d) {
                        var event = d.state.buttonevent;
                        // 1002 and 1003 are releases; anything else is a press
                        if (event !== null && event !== 1002 && event !== 1003) {
                            clearInterval(timer);
                            resolve(event);
                        }
                    }, function (err) {
                        clearInterval(timer);
                        reject(new Error("getButton Request failed: " + err));
                    });
                }, 800);
            });
            // Stop rejects the wait; the poll must end with it.
            return cancellable(wait).catch(function (e) { clearInterval(timer); throw e; });
        },
        hueQueue: function (time, light, on, bright, cx, cy) {
            var at = time * 1000;
            var path = "/lights/" + light + "/state";
            if (on !== -1) {
                hueCommands.push({ time: at, execute: function () { hueRequest(path, "PUT", { on: !!on }); } });
            }
            if (bright !== -1) {
                hueCommands.push({ time: at, execute: function () { hueRequest(path, "PUT", { bri: bright }); } });
            }
            if (cx !== -1 && cy !== -1) {
                hueCommands.push({ time: at, execute: function () {
                    hueRequest(path, "PUT", { xy: [cx, cy], colormode: "xy" });
                } });
            }
        },
        hueExecute: function (loopTimes) {
            var loops = loopTimes;
            var index = 0;
            hueTimer = 0;
            hueCommands.sort(function (a, b) { return a.time - b.time; });
            if (hueInterval !== null) { clearInterval(hueInterval); }
            hueInterval = setInterval(function () {
                hueTimer += hueCommandInterval;
                while (index < hueCommands.length && hueCommands[index].time <= hueTimer) {
                    hueCommands[index++].execute();
                }
                if (index === hueCommands.length) {
                    // 0 or less loops for ever; a positive count counts down
                    if (loops <= 0 || --loops > 0) {
                        index = 0;
                        hueTimer = 0;
                    } else {
                        clearInterval(hueInterval);
                        hueInterval = null;
                    }
                }
            }, hueCommandInterval);
        },

        // --- webcam / Teachable Machine (csinsc.py) ------------------------------
        // Each resolves to the {status, response} pair the fork kept in module
        // variables (webcamStatus / webcamResponse and friends): status 0 with
        // the result, or 1 with the message csinsc.py raises. A rejection is the
        // fork's other failure path, which csinsc.py reports with its own
        // "Error attempting to ..." message.
        showWebCam: function () {
            return cancellable(Promise.resolve().then(createWebCam).then(
                function () { return tmResult(""); },
                function () { return tmFailure("Error with opening the webcam"); }));
        },
        printWebCam: function () {
            return cancellable(Promise.resolve().then(printWebCam).then(function () { return tmResult(""); }));
        },
        webCamImage: function () { return getImageFromWebCam(); },
        pauseWebCam: function () {
            pauseWebCam();
            return cancellable(Promise.resolve(tmResult("")));
        },
        resumeWebCam: function () {
            resumeWebCam();
            return cancellable(Promise.resolve(tmResult("")));
        },

        loadImageModel: function (url) {
            var loading = (url === undefined || url === null)
                ? imageModelFromDialog()
                : tmImage.load(modelBase(url) + "model.json", modelBase(url) + "metadata.json");
            return cancellable(loading.then(function (model) {
                tmImageModel = model;
                return tmResult("");
            }));
        },
        predictFromImage: function (url, topK) {
            return cancellable((async function () {
                try {
                    if (topK === -1) { topK = tmImageModel.getTotalClasses(); }
                    var img = new Image();
                    if (url) {
                        await new Promise(function (resolve, reject) {
                            img.onload = resolve;
                            img.onerror = reject;
                            // Before src. The fork set it after, which leaves a
                            // cross-origin image tainted and unreadable.
                            img.crossOrigin = "anonymous";
                            img.src = url;
                        });
                    }
                    return tmResult(predictionPairs(await tmImageModel.predictTopK(img, topK), topK));
                } catch (e) {
                    return tmFailure("Error with predicting from image.");
                }
            })());
        },
        predictFromWebCam: function (topK) {
            return cancellable((async function () {
                var canvas = getWebCamCanvas();
                if (canvas === null) { return tmFailure("WebCam not set up."); }
                try {
                    if (topK === -1) { topK = tmImageModel.getTotalClasses(); }
                    return tmResult(predictionPairs(await tmImageModel.predictTopK(canvas, topK), topK));
                } catch (e) {
                    return tmFailure("Error with predicting from webcam.");
                }
            })());
        },

        loadPoseModel: function (url) {
            // The fork opened the image-model upload dialog here and then waited
            // on a flag that dialog never cleared, so it hung for ever.
            if (url === undefined || url === null) {
                return cancellable(Promise.resolve(tmFailure("loadPoseModel() needs the URL of your pose model.")));
            }
            return cancellable(tmPose.load(modelBase(url) + "model.json", modelBase(url) + "metadata.json")
                .then(function (model) {
                    tmPoseModel = model;
                    // csinsc.py drew the skeleton over the webcam every frame
                    webCamCallback = drawPoseSkeleton;
                    return tmResult("");
                }));
        },
        predictPoseFromWebCam: function (topK) {
            return cancellable((async function () {
                var canvas = getWebCamCanvas();
                if (canvas === null) { return tmFailure("WebCam not set up."); }
                try {
                    if (topK === -1) { topK = tmPoseModel.getTotalClasses(); }
                    var estimate = await tmPoseModel.estimatePose(canvas);
                    tmPoseData = estimate.pose;
                    var response = predictionPairs(await tmPoseModel.predict(estimate.posenetOutput), topK);
                    // the last entry is the skeleton, as in the fork
                    response.push(tmPoseData ? [tmPoseData.keypoints] : []);
                    return tmResult(response);
                } catch (e) {
                    return tmFailure("Error with predicting pose from webcam.");
                }
            })());
        },

        loadAudioModel: function (url) {
            if (url === undefined || url === null) {
                return cancellable(Promise.resolve(tmFailure("loadAudioModel() needs the URL of your audio model.")));
            }
            tmAudioModel = speechCommands.create("BROWSER_FFT", undefined,
                modelBase(url) + "model.json", modelBase(url) + "metadata.json");
            return cancellable(tmAudioModel.ensureModelLoaded().then(function () { return tmResult(""); }));
        },
        predictFromAudio: function () {
            return cancellable(new Promise(function (resolve) {
                try {
                    var labels = tmAudioModel.wordLabels();
                    Promise.resolve(tmAudioModel.listen(function (result) {
                        var response = [];
                        var best = 0;
                        for (var i = 0; i < labels.length; i++) {
                            if (result.scores[i] > result.scores[best]) { best = i; }
                            response.push([labels[i], Number(result.scores[i].toFixed(2))]);
                        }
                        // Keep listening through background noise, as the fork did.
                        var label = labels[best].toLowerCase();
                        if (label.indexOf("background") > -1 || label.indexOf("noise") > -1) { return; }
                        tmAudioModel.stopListening();
                        resolve(tmResult(response));
                    }, {
                        includeSpectrogram: true,
                        probabilityThreshold: 0.5,
                        invokeCallbackOnNoiseAndUnknown: false,
                        overlapFactor: 0.5
                    })).catch(function () { resolve(tmFailure("Error with audio prediction.")); });
                } catch (e) {
                    resolve(tmFailure("Error with audio prediction."));
                }
            }));
        }
    };

    // --- Philips Hue helpers (console.js keeps the bridge address and user) ---
    // A light command does not make the program wait - the fork's reason: several
    // lights should change together, not one after another.
    function hueRequest(path, method, body) {
        return fetch(getHueBridgeURL() + "/api/" + g_hueUserName + path, {
            method: method,
            body: body === undefined ? undefined : JSON.stringify(body)
        }).then(function (r) { return r.json(); })
          .catch(function (err) { console.error("Hue request failed:", err); });
    }

    function hueFetch(path) {
        return fetch(getHueBridgeURL() + "/api/" + g_hueUserName + path, { method: "GET" })
            .then(function (r) { return r.json(); });
    }

    // --- Teachable Machine state (the fork kept it on csinscTools) -------------
    var tmImageModel = null;
    var tmPoseModel = null;
    var tmPoseData = null;
    var tmAudioModel = null;

    function tmResult(response) { return { status: 0, response: response }; }
    function tmFailure(message) { return { status: 1, response: message }; }

    function modelBase(url) {
        url = String(url);
        return url.slice(-1) === "/" ? url : url + "/";
    }

    // [[className, probability], ...] for the first topK predictions, the
    // probability rounded to two places as the fork did.
    function predictionPairs(prediction, topK) {
        var pairs = [];
        for (var i = 0; i < topK && i < prediction.length; i++) {
            pairs.push([prediction[i].className, Number(prediction[i].probability.toFixed(2))]);
        }
        return pairs;
    }

    // loadImageModel() with no URL: the upload dialog in editor.html, taking the
    // three files Teachable Machine exports.
    function imageModelFromDialog() {
        return new Promise(function (resolve, reject) {
            var ok = document.getElementById("tmImageDialogOKBtn");
            function pressed() {
                ok.removeEventListener("click", pressed);
                tmImage.loadFromFiles(document.getElementById("upload-model").files[0],
                                      document.getElementById("upload-weights").files[0],
                                      document.getElementById("upload-metadata").files[0])
                    .then(resolve, reject);
            }
            ok.addEventListener("click", pressed);
            document.getElementById("tmImageDialog").style.display = "block";
        });
    }

    function drawPoseSkeleton() {
        var canvas = getWebCamCanvas();
        if (!canvas || !tmPoseData) { return; }
        var ctx = canvas.getContext("2d");
        tmPose.drawKeypoints(tmPoseData.keypoints, 0.5, ctx);
        tmPose.drawSkeleton(tmPoseData.keypoints, 0.5, ctx);
    }

    // The fork's grammar has a real `forever:` statement and CPython does not.
    // It is `while True:` in every way that matters - loop yielding and Stop
    // included - so it is rewritten in place. On the same line: the step
    // debugger and error messages both point at line numbers. No curriculum
    // file uses it; teachers' code might.
    function rewriteForever(code) {
        return code.replace(/^([ \t]*)forever([ \t]*):/gm, "$1while True$2:");
    }

    var _clickedButtons = [];
    var _awaitButton = null;

    function writeHandler(sink) {
        return function (buf) {
            // Decode with {stream:true}: a chunk boundary can land in the
            // middle of a UTF-8 sequence, and the curriculum is full of emoji
            // and braille box-drawing.
            sink(decoder.decode(buf, { stream: true }));
            return buf.length;
        };
    }

    // Boot fetches every js/py module before the interpreter can start, so one
    // failure takes the whole runtime down. A transient network error - a
    // keep-alive socket closed under the request, a flaky school wifi - would
    // otherwise surface as a bare "TypeError: Failed to fetch" with no
    // indication of which file or that retrying would have worked. Observed
    // intermittently against a local server that answered every request.
    function fetchText(url, attempt) {
        attempt = attempt || 1;
        return fetch(url, { cache: "force-cache" }).then(function (r) {
            if (!r.ok) { throw new Error("could not load " + url + " (" + r.status + ")"); }
            return r.text();
        }).catch(function (err) {
            if (attempt < 3) {
                return new Promise(function (resolve) { setTimeout(resolve, 150 * attempt); })
                    .then(function () { return fetchText(url, attempt + 1); });
            }
            throw new Error("could not load " + url + " after " + attempt +
                            " attempts: " + (err && err.message || err));
        });
    }

    return {
        name: "pyodide",

        // The boot-time capability probe. NOT can_run_sync(), which reports
        // whether a suspension is possible at this instant.
        isSupported: function () {
            return typeof WebAssembly !== "undefined" && "Suspending" in WebAssembly;
        },

        boot: function () {
            if (booting) { return booting; }
            var self = this;
            booting = (async function () {
                if (typeof loadPyodide !== "function") {
                    throw new Error("js/pyodide/pyodide.js is not loaded");
                }
                py = await loadPyodide({ indexURL: "js/pyodide/" });

                py.setStdout({ write: writeHandler(function (t) { onOutput(t); }) });
                py.setStderr({ write: writeHandler(function (t) { onError(t); }) });
                py.setStdin({ error: true });

                py.registerJsModule("_host", hostBridge);

                // The classroom modules are real .py files written into
                // Pyodide's filesystem and imported normally, rather than
                // exec'd from strings: an error inside csinsc.py should point
                // at csinsc.py. The manifest is maintained by hand - there is
                // no build step to generate one.
                var MANIFEST = ["prelude.py", "gotolabel.py", "yielding.py", "csinsc.py",
                                "goodies.py", "pyangelo.py", "turtle.py", "microbit.py",
                                "speech.py", "babylon.py", "perlin.py", "sendsms.py",
                                "pyangelo_builtins.py", "vector.py", "sprite.py", "stepper.py",
                                "consolehost.py"];
                py.FS.mkdirTree(PY_LIB);
                var sources = await Promise.all(MANIFEST.map(function (f) {
                    return fetchText("js/py/" + f + "?t=" + PY_LIB_VERSION);
                }));
                MANIFEST.forEach(function (f, i) {
                    py.FS.writeFile(PY_LIB + "/" + f, sources[i]);
                });
                py.runPython("import sys; sys.path.insert(0, '" + PY_LIB + "')");

                prelude = py.pyimport("prelude");
                prelude.install();
                // Builtin PyAngelo's functions are permanent builtins in the
                // fork; only its constants wait for setCanvasSize(). Bound
                // before the Host names, so console.js's versions still win.
                py.pyimport("pyangelo_builtins").install_functions();

                self.flushHostNames();
                // console.js's classroom functions that only work on Skulpt
                // values, rebound in Python - after the Host names, so these win.
                py.pyimport("consolehost").install();
                return py;
            })();
            return booting;
        },

        setWebServiceURL: function (url) { webServiceURL = url; },

        // CPython has no goto statement, but `goto.foo` is a legal attribute
        // access - so both spellings converge on that and js/py/gotolabel.py
        // gives it meaning.
        normaliseGotoLabels: function (code) {
            return rewriteForever(attributiseGotoLabels(code));
        },

        // Queued rather than applied: console.js declares these at parse time,
        // long before the interpreter exists.
        installHostName: function (entry) {
            hostEntries.push(entry);
            if (py) { this.flushHostNames(); }
        },

        flushHostNames: function () {
            if (!py || !hostEntries.length) { return; }
            var entries = hostEntries;
            hostEntries = [];
            var bind = prelude.bind_host_names;
            var report = bind(py.toPy(entries)).toJs({ dict_converter: Object.fromEntries });
            
            if (report.skipped && report.skipped.length) {
                console.warn("[pyodide] host names not bound:", report.skipped);
            }
            return report;
        },

        stop: function () {
            stopped = true;
            cancelPending();
        },

        isStopped: function () { return stopped; },

        checkForStop: function () {
            if (stopped) { throw "Stopped!"; }
        },

        teardown: function () {
            cancelPending();
            // Stop the pyangelo animation loop and unbind its canvas
            // listeners, the counterpart of Sk.PyAngelo.stopPyangelo().
            try { PyAngeloHost.stop(); } catch (e) {}
            try { TurtleHost.stop(); } catch (e) {}
            // A board left paired across runs keeps notifying into an
            // interpreter that is no longer listening.
            try { MicrobitHost.stopAll(); } catch (e) {}
            try { PyAngeloBuiltinHost.stop(); } catch (e) {}
            // predictFromAudio() leaves the microphone listening if Stop lands
            // before a sound is recognised.
            try { if (tmAudioModel && tmAudioModel.isListening()) { tmAudioModel.stopListening(); } } catch (e) {}
            // A re-run must re-import these so their module-level start()
            // runs again; otherwise the second run draws into a canvas with
            // no render loop, or into a turtle layer that no longer exists.
            try {
                py.runPython("import sys\n" +
                             "for _m in ('pyangelo', 'turtle', 'microbit', 'babylon'):\n" +
                             "    sys.modules.pop(_m, None)\n");
            } catch (e) {}
        },

        // Builtin PyAngelo is a set of *builtins*, so it can only be
        // installed from inside Python. console.js calls this the moment a
        // program opens a canvas - the same point the fork runs preparePage().
        setupBuiltinPyangelo: function (w, h, yAxisMode) {
            if (!py) { throw new Error("The interpreter is still starting up."); }
            var mod = py.pyimport("pyangelo_builtins");
            mod.install();
            mod._setCanvasSize(w, h, yAxisMode === undefined ? 1 : yAxisMode);
        },

        run: function (opts) {
            stopped = false;
            pendingRejects = [];
            onOutput = opts.onOutput || function () {};
            onError = function (text) { (opts.onError || function () {})(text); };
            onInput = opts.onInput || function () { return Promise.resolve(""); };
            onStep = opts.onStep || function () { return Promise.resolve("step"); };
            var breakpoints = (opts.breakpoints || []).slice();

            var self = this;
            return this.boot().then(function () {
                var runner = prelude.run_user_code;
                // callPromising is what arms JSPI. Without it run_sync raises.
                return runner.callPromising(opts.code, !!opts.stepMode, !!opts.autoStep, breakpoints);
            }).catch(function (err) {
                // A stop is a normal ending, not a crash to report twice.
                if (stopped) { throw "Stopped!"; }
                throw err;
            });
        },

        // Renders a PythonError as "TypeError: message on line N", matching the
        // shape Skulpt produced, even though CPython's wording differs.
        formatError: function (err) {
            if (typeof err === "string") { return err; }
            var text = (err && err.message) || String(err);

            var cls = "", msg = "";
            var lines = text.replace(/\s+$/, "").split("\n");
            for (var i = lines.length - 1; i >= 0; i--) {
                var m = lines[i].match(/^(\w+(?:\.\w+)*)\s*:\s*(.*)$/);
                if (m) { cls = m[1]; msg = m[2]; break; }
                if (/^\w+Error$/.test(lines[i].trim())) { cls = lines[i].trim(); break; }
            }
            if (!cls) { return text; }

            // Last frame from the student's own file, matching Skulpt's rule.
            var lineno = null;
            var re = /File "<stdin>\.py", line (\d+)/g, mm;
            while ((mm = re.exec(text)) !== null) { lineno = mm[1]; }
            // SyntaxError puts the location on the File line without a frame
            if (lineno === null) {
                var sm = text.match(/File "<stdin>\.py", line (\d+)/);
                if (sm) { lineno = sm[1]; }
            }

            var out = cls + (msg ? ": " + msg : "");
            return lineno !== null ? out + " on line " + lineno : out + " at <unknown>";
        }
    };
})();
