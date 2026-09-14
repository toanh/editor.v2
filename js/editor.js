// Base URL for the codestore and classroom web services. `?webservice=`
// overrides it during startup. Kept as a plain string here and pushed into the
// interpreter via Runtime.setWebServiceURL(), so nothing outside the runtime
// backend has to know how the interpreter stores it.
var webServiceURL = "https://codestore-348206.ts.r.appspot.com/";

var animID = null;

var dots = 0;
var origMsg = "🔗 Getting URL"
var prevTime = null;

var _babylonObjects = {};
var _runtimeObjects = {};
var engine = null;
var scene = null;
var sceneToRender = null;
var _functionQueue = [];

function resetBabylon() {
	_babylonObjects = {};
	_runtimeObjects = {};
}

function stopBabylon() {
	setDisplayMode("side");
	if (engine != null) {
		engine.dispose();
		engine = null;
	}
	_functionQueue = [];
}

//////////////////////////////
// Function wrapping code: from https://stackoverflow.com/questions/899102/how-do-i-store-javascript-functions-in-a-queue-for-them-to-be-executed-eventuall
// fn - reference to function.
// context - what you want "this" to be.
// params - array of parameters to pass to function.
var wrapFunction = function(fn, params) {
    return function(scene) {
        fn.apply(scene, params);
    };
}

//////////////////////////////

function _runtimeBeginAnimation(bObjName, startFrame, endFrame, loop, scene) {
	bObj = _runtimeObjects[bObjName];
	this.beginAnimation(bObj, startFrame, endFrame, loop);
}

function beginAnimation(bObjName, startFrame, endFrame, loop) {
	// TODO: fix this .. it needs to run AFTER babylonCreateScene()
	// just always specify endframe for now
	/*
	if (endFrame == -1) {
		if (bObj.animations !== null) {
			for (i = 0; i < bObj.animations.length; i++) {
				let animation = bObj.animations[i];
				for (j = 0; j < animation._keys.length; j++) {
					if (animation._keys[j].frame > endFrame) {
						endFrame = animation._keys[j].frame;
					}
				}
			}
		}
	}
	*/
	//scene.beginAnimation(bObj, startFrame, endFrame, loop);

	var beginAnimationFunc = wrapFunction(_runtimeBeginAnimation, [bObjName, startFrame, endFrame, loop]);
	_functionQueue.push(beginAnimationFunc);
}

function addObject(bObj) {
  // Takes one Python object's attribute dict and stashes it for
  // babylonCreateScene()'s two passes. References between objects have already
  // been replaced by name on the Python side, in startBabylon().
  //
  // Both interpreters hand it over differently: Skulpt passes its own instance,
  // whose attributes live in $d and need remapping, while the Pyodide module
  // converts __dict__ to a plain object before calling. Accepting either keeps
  // one implementation of the scene builder.
  var jsBObj = (bObj && bObj.$d) ? Sk.ffi.remapToJs(bObj.$d) : bObj;
  _babylonObjects[jsBObj.bObjName] = jsBObj;
}

function babylonCreateScene(scene) {
	// pass 1: add objects to _runtimeObjects
	for (bObjKey in _babylonObjects) {		
		bObj = _babylonObjects[bObjKey];
		let runtimeBObj = null;
		if (bObj.bObjType == "Mesh" ) {
			if (bObj.meshType == "sphere") {
				runtimeBObj = BABYLON.Mesh.CreateSphere("sphere", bObj.segments, bObj.radius, scene);
			}
			runtimeBObj.position.x = bObj.position[0];
			runtimeBObj.position.y = bObj.position[1];
			runtimeBObj.position.z = bObj.position[2];
		} else if (bObj.bObjType == "Material" ) {
			runtimeBObj = new BABYLON.StandardMaterial("material", scene);
			runtimeBObj.ambientColor = new BABYLON.Color3(bObj.ambientColour[0], bObj.ambientColour[1], bObj.ambientColour[2]);
		} else if (bObj.bObjType == "Skybox" ) {
			let envTexture = new BABYLON.CubeTexture(bObj.texture, scene);
			_runtimeObjects[bObj.bObjName + ".texture"] = envTexture;
			runtimeBObj = scene.createDefaultSkybox(envTexture, true, bObj.size);
		} else if (bObj.bObjType == "DirectionalLight" ) {
			runtimeBObj = new BABYLON.DirectionalLight(bObj.bObjName, new BABYLON.Vector3(bObj.direction[0], bObj.direction[1], bObj.direction[2]), scene);
			runtimeBObj.diffuse = new BABYLON.Color3(bObj.diffuse[0], bObj.diffuse[1], bObj.diffuse[2]);
			runtimeBObj.specular = new BABYLON.Color3(bObj.specular[0], bObj.specular[1], bObj.specular[2]);
		} else if (bObj.bObjType == "Texture") {
			runtimeBObj = new BABYLON.Texture(bObj.url, scene);		
		} else if (bObj.bObjType == "Animation") {
			runtimeBObj = new BABYLON.Animation(bObj.bObjName, bObj.property, bObj.frameRate, BABYLON.Animation.ANIMATIONTYPE_FLOAT, BABYLON.Animation.ANIMATIONLOOPMODE_CYCLE);
			runtimeBObj.setKeys(bObj.keys);
		}
		_runtimeObjects[bObj.bObjName] = runtimeBObj;
	}

	// pass 2: adjust object references within objects
	for (bObjKey in _babylonObjects) {		
		bObj = _babylonObjects[bObjKey];
		let runtimeBObj = _runtimeObjects[bObj.bObjName];
		if (bObj.bObjType == "Mesh" ) {
			if (bObj.material !== null && bObj.material in _runtimeObjects) {
				runtimeBObj.material = _runtimeObjects[bObj.material];
			}
		} else if (bObj.bObjType == "Material" ) {
			if (bObj.ambientTexture !== null && bObj.ambientTexture in _runtimeObjects) {
				runtimeBObj.ambientTexture  = _runtimeObjects[bObj.ambientTexture];
			}
		} 	
		
		if (bObj._animations !== null) {
			for (i = 0; i < bObj._animations.length; i++) {
				let bAnimationObj = _runtimeObjects[bObj._animations[i]];					
				runtimeBObj.animations.push(bAnimationObj);
			}
		}	
	}	
}

function startBabylon() {
	setDisplayMode("babylon");
	var canvas = document.getElementById("babylonCanvas");

	var startRenderLoop = function (engine, canvas) {
		engine.runRenderLoop(function () {
			if (sceneToRender && sceneToRender.activeCamera) {
				sceneToRender.render();
			}
		});
	}

	var createDefaultEngine = function() { 
		return new BABYLON.Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true,  disableWebGL2Support: false}); 
	};
	var createScene = async function () {
	
		var scene = new BABYLON.Scene(engine);
		// Parameters: name, alpha, beta, radius, target position, scene
		//const camera = new BABYLON.ArcRotateCamera("Camera", 0, 0, 8, new BABYLON.Vector3(0, 0, 0), scene);	
		var camera = new BABYLON.FreeCamera("camera1", new BABYLON.Vector3(0, 0, 0), scene);		
		camera.setTarget(new BABYLON.Vector3(0, 0, 5));
		camera.attachControl(canvas, true);

		scene.ambientColor = new BABYLON.Color3(1, 1, 1);

		/*
		var light = new BABYLON.DirectionalLight("light1", new BABYLON.Vector3(1, -1, 0), scene);
		light.diffuse = new BABYLON.Color3(0.7, 0.7, 0.7);
		light.specular = new BABYLON.Color3(1, 1, 1);	
		//light.intensity = 0.7;

		var redMat = new BABYLON.StandardMaterial("redMat", scene);
		redMat.ambientColor = new BABYLON.Color3(1, 0, 0);
		
		var greenMat = new BABYLON.StandardMaterial("greenMat", scene);
		greenMat.ambientColor = new BABYLON.Color3(0, 1, 0);
		
		var blueMat = new BABYLON.StandardMaterial("blueMat", scene);
		blueMat.ambientColor = new BABYLON.Color3(0, 0, 1);		

		var yellowMat = new BABYLON.StandardMaterial("yellowMat", scene);
		yellowMat.ambientColor = new BABYLON.Color3(1, 1, 0);				

		
		var sphere1 = BABYLON.Mesh.CreateSphere("sphere1", 16, 5, scene);
		sphere1.position.z = 10;
		sphere1.material = redMat;

		//var sphere2 = BABYLON.Mesh.CreateSphere("sphere2", 16, 5, scene);
		const capsule = new BABYLON.MeshBuilder.CreateCapsule("capsule", {height: 4, radius: 1}, scene)
		capsule.position.z = -10;
		capsule.material = greenMat;
		
		//var sphere3 = BABYLON.Mesh.CreateSphere("sphere3", 16, 5, scene);
		const box = BABYLON.MeshBuilder.CreateBox("box", {height: 4, width: 4, depth: 4}, scene);
		box.position.x = 10;
		box.rotation = new BABYLON.Vector3(0, 3.14159 / 4.0, 0);
		box.material = blueMat;

		//var sphere4 = BABYLON.Mesh.CreateSphere("sphere4", 16, 5, scene);
		const torus = BABYLON.MeshBuilder.CreateTorus("torus", {diameter: 4, tessellation: 32});
		torus.position.x = -10;
		torus.material = yellowMat;
		torus.rotation = new BABYLON.Vector3(-3.14159 / 4.0, 3.14159 / 8.0, -3.14159 / 4.0);
		*/

		// instantiate all our meshes
		babylonCreateScene(scene);

		// Remove and execute all functions in the array
		while (_functionQueue.length > 0) {
			(_functionQueue.shift())(scene);   
		}		

		//const env = scene.createDefaultEnvironment();
		
		try {
			const xr = await scene.createDefaultXRExperienceAsync({
				//floorMeshes: [env.ground]
			});     

			xr.input.onControllerAddedObservable.add((inputSource) => {
				xr.baseExperience.sessionManager.session.onselect = (inputSource) => {
					// Note that this gets triggered by any selection, including those
					// made with motion-controller buttons. If those buttons are
					// dealt with elsewhere, you'll need top check for gaze here. Otherwise,
					// the actOnButton function will get called twice.
					xr.camera.position = new BABYLON.Vector3(0, 0, 0);
					xr.camera.setTarget(new BABYLON.Vector3(0, 0, 5));		

				};
			});		
		}
		catch(error) {
			console.log("error creating XR scene");
		}
		

		return scene;
	};
	window.initFunction = async function() {
		var asyncEngineCreation = async function() {
			try {
				return createDefaultEngine();
			} catch(e) {
				console.log("the available createEngine function failed. Creating the default engine instead");
				return createDefaultEngine();
			}
		}
		engine = await asyncEngineCreation();
		if (!engine) throw 'engine should not be null.';
		startRenderLoop(engine, canvas);
		scene = createScene();
	};

	initFunction().then(() => {
		scene.then(returnedScene => { sceneToRender = returnedScene; });                            
	});
	// Resize
	window.addEventListener("resize", function () {
		engine.resize();
	});
}
function animateURL(timestamp) {    
    document.getElementById("codestoreURL").disabled = true;
	if (prevTime == null) {
		prevTime = timestamp;
	}
	if (timestamp - 400 >
		 prevTime) {
		prevTime = timestamp;
		msg = document.getElementById("codestoreURL").innerText;
		
		if (dots < 5) {
			dots += 1;
			msg = msg + ".";
		}
		else {
			msg = origMsg;
			dots = 0;
		}
		document.getElementById("codestoreURL").innerText = msg;
	}
	animID = window.requestAnimationFrame(animateURL);
}

function checkBrowser() {
	var supported = false;
	let userAgent = navigator.userAgent;
	
	if(userAgent.match(/chrome|chromium|crios/i)) {
		supported |= true;
	} else if(userAgent.match(/safari/i)) {
		supported |= true;
	} else if(userAgent.match(/edg/i)) {
		supported |= true;
	}
	if (!supported) {
		showURLDialog("<p style='color: red;'>Sorry, your browser is not supported and the editor may not work as expected.</p>We recommend you use <b>Google Chrome</b>.")
	}
}

function showURLDialog(msg, showCopy = false) {
	document.getElementById("copyToClip").style.display = showCopy ? "inline" : "none"; 
	document.getElementById("headlessCheckbox").style.display = showCopy ? "block" : "none"; 
    document.getElementById("urlContent").innerHTML = msg;
    document.getElementById("urlDialog").style.display = "block";      
}

function showErrorDialog(msg, onclose) {
	document.getElementById("errContent").innerHTML = msg;
	document.getElementById("errDialog").style.display = "block";     
	document.getElementById('errDialog').onclick = hideErrorDialog;
	document.getElementById('errDialog').addEventListener("click", onclose);	 
}

const afterDialogCloseEvent = new Event("afterDialogClose");
function hideErrorDialog() {
	document.getElementById("errDialog").style.display = "none";  
	let src = document.getElementById("errDialog").getAttribute("source");
	document.getElementById(src).dispatchEvent(afterDialogCloseEvent);
	
}

function resetSnapURLButton() {    
    document.getElementById("codestoreURL").disabled = false;
    document.getElementById("codestoreURL").innerText = "🔗 Snapshot to URL";  
    document.getElementById("codestoreURL").style.textAlign = "center";          
	document.getElementById("copyToClip").innerText = "Copy URL";      
}

var codeurl;
function copyURLToClipboard() {
	navigator.clipboard.writeText(codeurl);
	document.getElementById("copyToClip").innerText = "Copied!";

	setTimeout(function() {
		document.getElementById("copyToClip").innerText = "Copy URL";
	}, 3000);
	
}

function constructSnapshotURL(headlessMode) {
	_codeurl = window.location.toString();

	// TODO: fix to work with display mode (need save it out)
	if (prevDisplay == "babylon") {
		// genereate a url with the wrapper around the editor.html (the index.html file => ATM works for the XR overlay)
		_codeurl = _codeurl.split('?')[0] + "?";
		_codeurl = _codeurl.replace("editor.html", "")
	} else {
		_codeurl = _codeurl.split('?')[0] + "?";	
	}
	
	delimit = "";

	urlParams.forEach(function(value, key) {
	  if (key != "id" && key !== "undefined" && key != "project" && key != "headless" && key != "code") {
		_codeurl = _codeurl + "&" + key + "=" + value;
	  }
	});
	
	// id is global
	_codeurl += "&id=" + g_id; 
	if (headlessMode) {
		_codeurl += "&headless=1";
	}

	return _codeurl;
}

function constructSnapshotURLDialogText() {
	codeurl = constructSnapshotURL(document.getElementById("headlessURL").checked);

	showURLDialog(generateURLMsg(codeurl), true);
	genereateQRCode(codeurl);	
}
  
async function getCodestoreURL() {
    document.getElementById("codestoreURL").innerText = origMsg;    
    document.getElementById("codestoreURL").style.textAlign = "left";
	dots = 0;
	animID = window.requestAnimationFrame(animateURL);
	
	var xhr = new XMLHttpRequest();
	xhr.open("POST", webServiceURL +'put', true);
	xhr.setRequestHeader('Content-type', 'application/x-www-form-urlencoded');
    xhr.timeout = 10000; // time in milliseconds

    xhr.ontimeout = (e) => {
		console.log("Timeout");
		window.cancelAnimationFrame(animID);
        showURLDialog("Unfortunately it took too long to generate your URL, please save your code to a file instead and try again later.");            
    };    

	xhr.onerror = function() {
		console.log("Error");
		window.cancelAnimationFrame(animID);
        showURLDialog("Unfortunately there was an error generating your URL, please save your code to a file instead and try again later.");  
	}
	
	xhr.onreadystatechange = function() {
	  if (this.readyState === XMLHttpRequest.DONE && this.status === 200) {
		if (xhr.responseText.length == 0) {
            showURLDialog("Unfortunately there was an error generating your URL, please save your code to a file instead and try again later.");
		}
        else {
			// this is a global variable!
			g_id = xhr.responseText;
			// handling the headless checkbox
			document.getElementById("headlessURL").checked = false;
			constructSnapshotURLDialogText();

			// regenerate on headless checkbox changee
			document.getElementById("headlessURL").onchange = constructSnapshotURLDialogText;
        }
		window.cancelAnimationFrame(animID);
	  }
	}
	var code = Editor.getValue();

	saveToLocalStorage();
	sendURL = "code="+ encodeURIComponent(code);

	xhr.send(sendURL);            
}

function generateURLMsg(_codeurl) {
	return "The code has been snapshotted to the url below:<br><br><a href=" + _codeurl + " target='_blank'>" + _codeurl + "</a><br><br><b>NOTE:</b> This URL will not save your changes, so if you change your code, you MUST regenerate the URL.";
}

function genereateQRCode(codeurl) {
	// TODO: fix to work with display mode (need save it out)
	if (document.getElementById("qrcode") !== null) {
		// remove any previous qr codes from the dialog (e.g. before the user toggles the headless checkbox)
		document.getElementById("qrcode").remove();
	}

	let qrCode = document.createElement('div');
	qrCode.id = "qrcode";
	qrCode.style.marginTop = "10px";
	qrCode.style.maxWidth = "fit-content";
	qrCode.style.marginLeft = "auto";
	qrCode.style.marginRight = "auto";
	qrCode.style.width = "128px";
	qrCode.style.height = "128px";
			
	document.getElementById("urlContent").appendChild(qrCode);

	var qrCodeGenerator = new QRCode("qrcode", {
		text: codeurl,
		width: 128,
		height: 128,
		colorDark : "#000000",
		colorLight : "#ffffff",
		correctLevel : QRCode.CorrectLevel.H
	});
}

function setTrainingWheels() {
	if (document.getElementById("trainingWheels") !== null && document.getElementById("trainingWheels").checked)
		urlParams.set('wheels', 1)
	else
		urlParams.delete('wheels')
}

function setThemeByButton() {
	document.getElementById("lightTheme").checked = !document.getElementById("lightTheme").checked;
	if (document.getElementById("lightTheme").checked) {
		themeButton.innerText = "⚫ Theme";
	} else {
		themeButton.innerText = "💡 Theme";
	}
	setTheme();
}

function setTheme() {
	// The step-line highlight is a marker owned by the editor backend and
	// styled by .step-line in css/styles.css, so it survives a theme change
	// on its own - nothing to re-apply here.
	if (document.getElementById("lightTheme") !== null && document.getElementById("lightTheme").checked) {
		urlParams.set('light', 1);
		Editor.setTheme("light");
	}
	else {
		Editor.setTheme("dark");
		urlParams.delete('light')
	}
}
 
function clearConsole() {
	var clearButton = document.getElementById("consoleClear");

	pyConsole.innerHTML = "";
	if (inputElement != null)
	{
		inputElement.innerText = "";
		pyConsole.appendChild(inputElement);
	}
	//pyConsole.appendChild(clearButton);
}

/* When the openFullscreen() function is executed, open the video in fullscreen.
Note that we must include prefixes for different browsers, as they don't support the requestFullscreen property yet */
function openFullscreen() {
	/* Get the element you want displayed in fullscreen mode (a video in this example): */
	var isInFullScreen = (document.fullscreenElement && document.fullscreenElement !== null) ||
		(document.webkitFullscreenElement && document.webkitFullscreenElement !== null) ||
		(document.mozFullScreenElement && document.mozFullScreenElement !== null) ||
		(document.msFullscreenElement && document.msFullscreenElement !== null);

	if (!isInFullScreen) {
		var docElm = document.documentElement;
		if (docElm.requestFullscreen) {
			docElm.requestFullscreen();
		} else if (docElm.mozRequestFullScreen) {
			docElm.mozRequestFullScreen();
		} else if (docElm.webkitRequestFullScreen) {
			docElm.webkitRequestFullScreen();
		} else if (docElm.msRequestFullscreen) {
			docElm.msRequestFullscreen();
		}
	} else {
		if (document.exitFullscreen) {
			document.exitFullscreen();
		} else if (document.webkitExitFullscreen) {
			document.webkitExitFullscreen();
		} else if (document.mozCancelFullScreen) {
			document.mozCancelFullScreen();
		} else if (document.msExitFullscreen) {
			document.msExitFullscreen();
		}
	}
}

//gets the type of browser
function detectBrowser() {
	if((navigator.userAgent.indexOf("Opera") || navigator.userAgent.indexOf('OPR')) != -1 ) {
		return 'Opera';
	} else if(navigator.userAgent.indexOf("Chrome") != -1 ) {
		return 'Chrome';
	} else if(navigator.userAgent.indexOf("Safari") != -1) {
		return 'Safari';
	} else if(navigator.userAgent.indexOf("Firefox") != -1 ){
		return 'Firefox';
	} else if((navigator.userAgent.indexOf("MSIE") != -1 ) || (!!document.documentMode == true )) {
		return 'IE';
	} else {
		return 'Unknown';
	}
}

function copyToClipboard(text, successMsg, errorMsg)
{
	var browser = detectBrowser();
	if (browser == "Firefox")
	{
		navigator.clipboard.writeText(text);
		alert(successMsg);
	}
	else
	{
		navigator.permissions.query({name: "clipboard-write"}).then(result => {
		  if (result.state == "granted" || result.state == "prompt") {
			navigator.clipboard.writeText(text);
			alert(successMsg);
		  }
		  else
		  {
			alert(errorMsg);
		  }
		});
	}
}

function generateURL()
{
	var url = window.location.href.split("?")[0];

	url = url + "?code=" + encodeURIComponent(Editor.getValue());

	copyToClipboard(url, "URL copied to clipboard.", "Unable to copy URL to clipboard. Please copy the URL below manually: \n" + url);
}

function copyCode()
{
	var code = Editor.getValue();
	navigator.clipboard.writeText(code);

	copyToClipboard(code, "Code copied to clipboard.", "Unable to copy code to clipboard. Please copy the code manually.");
}

function resetCanvas()
{
	window.cancelAnimationFrame(Sk.builtins.animationFrameRequest);
	var canvas = document.getElementById("pyangelo");
	var ctx = canvas.getContext('2d');
	ctx.fillStyle = "rgb(127, 127, 127)";
	ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function isChromiumBrowser()
{
	agent = window.navigator.userAgent.toLowerCase();
	if ((agent.indexOf("edg/") > -1) || (agent.indexOf("chrome") > -1 && !!window.chrome))
		return true;
	else
		return false;
}

async function saveCode(filename)
{
	if (isChromiumBrowser())
		saveCodeFS(filename);
	else
		saveCodeFilesaver(filename);            
}

async function saveCodeFS(filename)
{          
  const options = {
	suggestedName: filename,
	types: [
	  {
		
		description: 'Text Files',
		accept: {
		  'text/plain': ['.txt'],
		},
	  },
	],
  };
  const handle = await window.showSaveFilePicker(options);
  var code = Editor.getValue();

  const writable = await handle.createWritable();
  // Write the contents of the file to the stream.
  await writable.write(code);
  // Close the file and write the contents to disk.
  await writable.close();          

  if (filename != null)
  {
	// only save to local storage if a filename was specified
	saveToLocalStorage();            
  }
}        

function saveCodeFilesaver(filename) {
	filename = window.prompt("Enter file name:", filename)
	if (filename == null)
	{
		return;
	}
	var code = Editor.getValue();
	var file = new File([code], filename + ".txt", {type: "text/plain;charset=utf-8"});
	saveAs(file);
	saveToLocalStorage();
}

function saveToLocalStorage()
{
  try {
	var code = Editor.getValue();
	localStorage.setItem(filename, code);
  }
  catch(e) {
	console.log("Unable to save to local storage");
  }
} 

async function loadCode()
{
	if (isChromiumBrowser())
		loadCodeFS();
	else
		document.getElementById('file-input').click();           
	return false;
}

async function loadCodeFS()
{             
	const options = {    
		suggestedName: filename,        
		types: [
		  {                                
			description: 'Text Files',
			accept: {
			  'text/plain': ['.txt'],
			},
		  },
		],};          
	[fileHandle] = await window.showOpenFilePicker(options);
	const file = await fileHandle.getFile();
	codestring = await file.text();

	checkForPyangelo(codestring);
	Editor.setValue(codestring);
	clearConsole();//pyConsole.innerHTML = "";            
	stopEditor();            
}

function userLoadCode(event) {
	var files = event.target.files;
	var file = null;
	if (files.length > 0) file = files[0];
	else return;
	var reader = new FileReader();
	reader.onload = (function (theFile) {
		codestring = e.target.result;
		return function (e) {
			checkForPyangelo(codestring);
			Editor.setValue(codestring);
			clearConsole();//pyConsole.innerHTML = "";
		};
	})(file);
	reader.readAsText(file);
	stopEditor();
}        

function loadFromLocalStorage() {
  if (filename == null || filename.length == 0)
  {
	return;
  }
  try {
	var src = localStorage.getItem(filename);
	return src;
  }
  catch (e) {
	console.log("Unable to load from local storage");
  }
} 

function sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

// Resolves with "step" (Next) or "continue" (Continue) once the student picks
// one; Stop also ends the wait. Every listener is removed however the wait ends -
// the version this replaced added a fresh {once} Stop listener on every single
// step and never removed any, so a long stepping session piled them up.
function waitForDebugCommand() {
	return new Promise(function (resolve) {
		function finish(command) {
			nextButton.removeEventListener("click", onNext);
			continueButton.removeEventListener("click", onContinue);
			stopButton.removeEventListener("click", onStop);
			resolve(command);
		}
		function onNext() { finish("step"); }
		function onContinue() { finish("continue"); }
		function onStop() { stopSkulpt(); finish("step"); }
		nextButton.addEventListener("click", onNext);
		continueButton.addEventListener("click", onContinue);
		stopButton.addEventListener("click", onStop);
	});
}

// The paused-state UI: watch table, Next and Continue, editor read-only. The
// Step button shows it from the first line; a normal Run shows it the first
// time it stops at a breakpoint.
var debugUiShown = false;
function showDebugUi() {
	if (debugUiShown) {
		return;
	}
	debugUiShown = true;
	prevTraces = null;
	createWatchTableFrame(200, 100);
	Editor.setReadOnly(true);
	stopButton.style.width = "72px";
	nextButton.style.display = "inline";
	continueButton.style.display = "inline";
}

var prevTraces = null;
// traces is [[name, value], ...] as supplied by the runtime.
function populateTraceTable(traces) {
	if (document.getElementById("watch-table") === null || traces == null) {
		return;
	}

	var tabledata = [];
	for (n = 0; n < traces.length; n++) {
		if (prevTraces != null) {

		}
		tabledata.push({id: n, name: traces[n][0], value: traces[n][1]});
	}

	//create Tabulator on DOM element with id "example-table"
	var table = new Tabulator("#watch-table", {
		height:205, // set height of table (in CSS or here), this enables the Virtual DOM and improves render speed dramatically (can be any valid css height value)
		data:tabledata, //assign data to table
		layout:"fitColumns", //fit columns to width of table (optional)
		columns:[ //Define Table Columns
			{title:"Name", field:"name", width:100, formatter:function(cell, formatterParams, onRendered){
				let name = cell.getValue();
				if (prevTraces == null || !(name in prevTraces)) {
					return "<span style='color:red; font-weight: bold;'>" + cell.getValue() + "</span>"
				}
				else {
					return cell.getValue();
				}
			}},
			{title:"Value", field:"value", hozAlign:"right", width:100, formatter:function(cell, formatterParams, onRendered){
				let name = cell.getRow().getCells()[0].getValue();
				let value = cell.getValue();
				if (prevTraces == null || !(name in prevTraces) || (prevTraces[name] != value)) {
					return "<span style='color:red; font-weight: bold;'>" + cell.getValue() + "</span>"
				}
				else {
					return cell.getValue();
				}
			}},
		],
	});

	table.on("tableBuilt", function() {	
		prevTraces = {};
		for (n = 0; n < traces.length; n++) {
			prevTraces[traces[n][0]] = traces[n][1];
	}});
}

// Called by the runtime at every pause: each new line while stepping, and each
// breakpoint. Resolves with "step" or "continue" when the student is ready to
// advance - or, in ?autostep slow-mo, after a fixed delay. A breakpoint waits for
// a button even under ?autostep, because that is the point of setting one.
function onStepLine(info) {
	var waitForButton = autostep == null || info.reason === "breakpoint";
	if (waitForButton) {
		showDebugUi();
	}
	populateTraceTable(info.locals);
	Editor.setStepLine(info.lineno);
	if (!waitForButton) {
		return sleep(1000).then(function () { return "step"; });
	}
	return waitForDebugCommand().then(function (command) {
		// Running on to the next breakpoint: the highlighted line is no longer
		// where execution is.
		if (command === "continue") {
			Editor.clearStepLine();
		}
		return command;
	});
}

// Breakpoints are available wherever the step debugger is.
function breakpointsAllowed() {
	return !(nostep != null && nostep.length > 0) && !headless;
}

function logError(text)
{
	// replacing sk.builtin constants with string literals to avoid name class with builtins_pyangelo.js
	//outputf(Sk.builtins.RESET + Sk.builtins.RED + text + "\n" + Sk.builtins.RESET);
	outputf("\u001b[ 0;2;0;0;0 m" + "\u001b[ 38;2;255;0;0 m" + text + "\n" + "\u001b[ 0;2;0;0;0 m");
}

var stepRun = false;
function runSkulpt(stepMode, code = "") {
	stepRun = stepMode;
	if (!headless) {
		code = Editor.getValue();
		saveToLocalStorage();
	} else {
		var clearButton = document.getElementById("consoleClear");
		if (clearButton !== null) {
			clearButton.style.display = "none";
		}
	}
	code = run_lexer(code);
	// Each interpreter wants goto/label spelled its own way.
	code = Runtime.normaliseGotoLabels(code);
	if (document.getElementById("trainingWheels") !== null && document.getElementById("trainingWheels").checked) {
		code = replacePrintConcatenationWithArgs(code);
		code = pygmify(code);
	}

	// testing pyangelo integration
	//createPyangeloFrame();

	if (code !== "") {
		usingPyangelo = checkForPyangelo(code);
	}
	setDisplayMode(usingPyangelo ? "canvas": display);
	if (usingPyangelo) document.getElementById("pyangelo").focus();

	stopButton.style.display = "inline";
	stepButton.style.display = "none";
	runButton.style.display = "none";
	stopButton.style.width = "144px";

	// clear the console
	clearConsole();
	just_run = true;

	resetConsole();

	let usingPyangeloBuiltin = checkForBuiltinPyangelo(code);

	debugUiShown = false;
	if (stepRun) {
		Editor.clearStepLine();
		if (autostep == null) {
			showDebugUi();
		} else {
			// ?autostep slow-mo: a watch table but no buttons to press
			prevTraces = null;
			createWatchTableFrame(200, 100);
			Editor.setReadOnly(true);
		}
	}

	var e = Runtime.run({
		code: code,
		stepMode: stepRun,
		autoStep: autostep != null,
		breakpoints: breakpointsAllowed() ? Editor.getBreakpoints() : [],
		takesPrompt: usingPyangelo ? true : false,
		debugging: usingPyangeloBuiltin ? false : true,
		onOutput: outputf,
		onInput: inputf,
		onStep: onStepLine,
		onError: logError
	});
	e.catch((function(err) {
		if (err.message) {
		   logError(err.message);
		   logError(err.stack);
		   if (err.nativeError) {
			   logError(err.nativeError.message);
			   logError(err.nativeError.stack);
		   }
		}
		else {
			logError(Runtime.formatError(err));
			if (err.stack)
			{
				logError(err.stack);
			}
	}}));
	e.finally((function() {
		stopSkulpt();
	} ));
}

function stopSkulpt() {
	Editor.setReadOnly(false);
	Editor.clearStepLine();
	stopAllSounds();
	stopAllHue();
	hideSpinner();
	destroyWebCam();
	destroyWatchTableFrame();
	// stop the keylisteners for pyangelo
	Runtime.teardown();
	// Don't always destroy pyangelo frame - leave hanging for any one-off images
	// destroyPyangeloFrame();

	stopBabylon();
	// if stop button pressed then kill pyangelo frame
	// otherwise leave it up after the program ends
	if (Runtime.isStopped()) {
		destroyPyangeloFrame();
	}

	just_run = false;

	stopButton.style.display = "none";
	nextButton.style.display = "none";
	continueButton.style.display = "none";
	debugUiShown = false;
	runButton.style.display = "inline";
	if (nostep != null && nostep.length > 0) {
		stepButton.style.display = "none";
	} else {
		stepButton.style.display = "inline";
	}
	if (norun != null && norun.length > 0) {
		runButton.style.display = "none";
	} else
	{
		runButton.style.display = "inline";
	}
	resetCanvas();
	if (headless) {
		// add re-run button to the console
		runButton.innerText = "🌀Rerun";
		if (!compiled) {
			// update the run button handler to re-run code
			// not needed for compiled code because runSkulpt can be called with "" code (default)
			// as it will be clobbered by the codescript global in the sk.afterCompile handler anyway
			runButton.onclick = function() {
				if (codestring !== "") {
					runSkulpt(false, codestring);
				} else if (esc !== "") {
					runSkulpt(false, esc);
				}
				// otherwise no code to run in a headless mode!
			};
	    }
		pyConsole.appendChild(runButton);
		document.getElementById("consoleWrapper").scrollTop = document.getElementById("consoleWrapper").scrollHeight;
	}
	stepRun = false;
	setDisplayMode(display);
}

function stopEditor() {
	Runtime.stop();
	if (inputElement != null)
	{
		// if stopped during an input...
		stopSkulpt();
		userResponse = inputElement.innerText.replace(/\n+$/, "");
		inputElement.remove();
		outputf(userResponse);
		outputf("\n");
		// TODO: fold this into the main promise/catch process?
		inputElement = null;
		logError("Stopped!");
		throw "Stopped!";
	}
}
function checkForPyangelo(code) {
	//var pyangeloPattern = /^(?:\s*import\s+pyangelo.*)|(?:\s*from\s+pyangelo\s+import.*)$/gm;
	var pyangeloPattern = /^(?:\s*import\s+pyangelo.*)|(?:\s*from\s+pyangelo\s+import.*)|(?:Sk\.builtin\.__import__\('pyangelo'.*)$/gm;
	var match = code.match(pyangeloPattern);
	return (match != null ? true: false);
}

function checkForBuiltinPyangelo(code) {
	var pyangeloPattern = /^(?:\s*setCanvasSize)/gm;
	var match = code.match(pyangeloPattern);
	return (match != null ? true: false);
}

function setDisplayMode(mode) {
	if (prevDisplay != null && prevDisplay == mode)
	{
		return;
	}
	var gutters = document.getElementsByClassName("gutter");
	if (typeof(gutters) !== 'undefined' && gutters.length > 0)
	{
		for (gutter of gutters)
		{
			gutter.parentNode.removeChild(gutter);
		}
	}

	prevDisplay = mode;
	// FIXME: Setting display mode to non-canvas after it has been set to canvas causes issues
	// we're in canvas demo mode
	document.getElementById('babylonCanvas').style = "display:none";
	document.getElementById('pyangelo').style = "display:none";
	if (mode == "canvas")
	{
		if (headless) {
			// headless inside canvas only
			let split = document.getElementById('split');
			let left = document.getElementById('leftpane');
			let right = document.getElementById('rightpane');
			let bottom = document.getElementById('bottompane');
			let pyangelo = document.getElementById('pyangelo');
			let console = document.getElementById('consoleWrapper');
			split.appendChild(pyangelo);
			bottom.appendChild(console);
			bottom.style = "display:flex; height: " + prefixedCalc() + "(100% - 580px); justify-content: center;";
			console.style.width = "330px";
			split.removeChild(left);		
			split.removeChild(right);		
			split.style = "height: 505px; display: block;text-align:center;";
			pyangelo.style = "display:inline-block;";
		}
		else {			
			document.getElementById('leftpane').appendChild(document.getElementById('editor'));
			document.getElementById('rightpane').appendChild(document.getElementById('pyangelo'));
			document.getElementById('bottompane').appendChild(document.getElementById('consoleWrapper'));

			document.getElementById('bottompane').style = "display:block; height: " + prefixedCalc() + "(100% - 580px);";

			//document.getElementById('split').style = "height: 505px; display: flex; flex-direction:row;";
			document.getElementById('split').style = "height: 505px; display: flex; flex-direction:row;";
			document.getElementById('rightpane').style = "width: 330px;"
			document.getElementById('leftpane').style = "height: 500px; flex-grow: 1;";

			//document.getElementById('editor').style.height = "100%";
			document.getElementById('editor').style.height = "500px";
			document.getElementById('pyangelo').style = "display:block";

			new ResizeObserver(function(entries) {
				// needed so that resizing the divider forces a resize on the window
				// and thereby updating the ace code window properly
				window.dispatchEvent(new Event('resize'));
			}).observe(document.getElementById('leftpane'));			
		}

		document.getElementById('consoleWrapper').style.height = "200px";
		//document.getElementById('console').style = "height: 100%";

		// no step-run for canvas items
		// TODO: implement optional immediate drawing mode to support this
		nostep = "1";
		stepButton.style.display = "none";
	} else if (mode == "babylon")
	{
		if (headless) {
			// headless inside canvas only
			let split = document.getElementById('split');
			let left = document.getElementById('leftpane');
			let right = document.getElementById('rightpane');
			let bottom = document.getElementById('bottompane');			
			let babylonCanvas = document.getElementById('babylonCanvas');
			split.appendChild(babylonCanvas);
			bottom.appendChild(document.getElementById('consoleWrapper'));
			bottom.style = "display:block; height: " + prefixedCalc() + "(100% - 580px);";
			split.removeChild(left);		
			split.removeChild(right);		
			split.style = "height: 505px; display: block;text-align:center;";
			babylonCanvas.style = "display:inline-block;";
		}
		else {			
			document.getElementById('leftpane').appendChild(document.getElementById('editor'));
			document.getElementById('rightpane').appendChild(document.getElementById('babylonCanvas'));
			document.getElementById('bottompane').appendChild(document.getElementById('consoleWrapper'));

			document.getElementById('bottompane').style = "display:block; height: " + prefixedCalc() + "(100% - 580px);";

			//document.getElementById('split').style = "height: 505px; display: flex; flex-direction:row;";
			document.getElementById('split').style = "height: 505px; display: flex; flex-direction:row;";
			document.getElementById('rightpane').style = "width: 500px;"
			document.getElementById('leftpane').style = "height: 500px; flex-grow: 1;";

			//document.getElementById('editor').style.height = "100%";
			document.getElementById('editor').style.height = "500px";
			document.getElementById('babylonCanvas').style = "display:block";

			new ResizeObserver(function(entries) {
				// needed so that resizing the divider forces a resize on the window
				// and thereby updating the ace code window properly
				window.dispatchEvent(new Event('resize'));
			}).observe(document.getElementById('leftpane'));			
		}

		document.getElementById('consoleWrapper').style = "height: 200px";
		//document.getElementById('console').style = "height: 100%";

		// no step-run for canvas items
		// TODO: implement optional immediate drawing mode to support this
		nostep = "1";
		stepButton.style.display = "none";
	} else if (mode == "top") {
	   // editor on top, console at the bottom, splittable
		document.getElementById('split').style = "display: flex; flex-direction: column";
		document.getElementById('split').style.width = "100%";
		document.getElementById('split').style.height = prefixedCalc() + "(100% - 60px)";

		document.getElementById('editor').style.width = "100%";
		document.getElementById('editor').style.height = "100%";
		document.getElementById('consoleWrapper').style.width = "100%";
		document.getElementById('consoleWrapper').style.height = "100%";

		document.getElementById('leftpane').appendChild(document.getElementById('editor'));
		document.getElementById('rightpane').appendChild(document.getElementById('consoleWrapper'));
		document.getElementById('bottompane').appendChild(document.getElementById('pyangelo'));

		Split(['#leftpane', '#rightpane'], {direction: 'vertical', minSize: [128, 128], snapOffset: 0,})

		document.getElementById('rightpane').style.width = "100%";
		document.getElementById('leftpane').style.width = "100%";
		document.getElementById('bottompane').style = "display:none";

		new ResizeObserver(function(entries) {
			// needed so that resizing the divider forces a resize on the window
			// and thereby updating the ace code window properly
			window.dispatchEvent(new Event('resize'));
		}).observe(document.getElementById('leftpane'));
	}
	else if (mode == "bottom")
	{
		// console on top, editor at the bottom, splittable
		document.getElementById('split').style = "display: flex; flex-direction: column";
		document.getElementById('split').style.width = "100%";
		document.getElementById('split').style.height = prefixedCalc() + "(100% - 60px)";

		document.getElementById('editor').style.width = "100%";
		document.getElementById('editor').style.height = "100%";
		document.getElementById('consoleWrapper').style.width = "100%";
		document.getElementById('consoleWrapper').style.height = "100%";

		document.getElementById('leftpane').appendChild(document.getElementById('consoleWrapper'));
		document.getElementById('rightpane').appendChild(document.getElementById('editor'));
		document.getElementById('bottompane').appendChild(document.getElementById('pyangelo'));

		Split(['#leftpane', '#rightpane'], {direction: 'vertical', minSize: [128, 128], snapOffset: 0,})

		document.getElementById('rightpane').style.width = "100%";
		document.getElementById('leftpane').style.width = "100%";
		document.getElementById('bottompane').style = "display:none";

		new ResizeObserver(function(entries) {
			// needed so that resizing the divider forces a resize on the window
			// and thereby updating the ace code window properly
			window.dispatchEvent(new Event('resize'));
		}).observe(document.getElementById('rightpane'));
	}
	else
	{
		// "side" is the default
		// standard editor mode: console to the right of the editor, no canvas - splittable view
		//document.getElementById('split').style.height = "100%";
		document.getElementById('split').style.height = prefixedCalc() + "(100% - 80px)";
		document.getElementById('editor').style.height = "100%";
		document.getElementById('consoleWrapper').style.height = "100%";

		document.getElementById('rightpane').style.height = "100%;"
		document.getElementById('leftpane').style.height = "100%";
		document.getElementById('bottompane').style = "display:none";

		document.getElementById('leftpane').appendChild(document.getElementById('editor'));
		document.getElementById('rightpane').appendChild(document.getElementById('consoleWrapper'));
		document.getElementById('bottompane').appendChild(document.getElementById('pyangelo'));

		Split(['#leftpane', '#rightpane'], {direction: 'horizontal', minSize: [128, 128], snapOffset: 0,})

		new ResizeObserver(function(entries) {
			// needed so that resizing the divider forces a resize on the window
			// and thereby updating the ace code window properly
			window.dispatchEvent(new Event('resize'));
		}).observe(document.getElementById('leftpane'));
	}

	// Every branch above re-parents #editor. Monaco watches its container for
	// resizes, but a detached-then-reattached container measures 0x0 and the
	// observer alone does not always recover, so re-measure once the browser
	// has laid the new arrangement out.
	requestAnimationFrame(function () { Editor.layout(); });
}

function prefixedCalc () {
	var prefixes = ["","-webkit-","-moz-","-o-"], el;
	for (var i = 0; i < prefixes.length; i++) {
		el = document.createElement('div');
		el.style.cssText = "width:" + prefixes[i] + "calc(9px)";
		if (el.style.length) return prefixes[i] + "calc";
	}
}

function resetEditor() {
	if (confirm("This will reset the code and you will lose your progress so far.\nIs this okay?"))
	{
		clearConsole();
		resetConsole();
		Editor.setValue("");
		// clear local storage
		localStorage.removeItem(filename);		
		if (esc != null && esc.length > 0)
		{
			// Already decoded by URLSearchParams - see the note at the ?code=
			// parse site.
			codestring = esc;
			usingPyangelo = checkForPyangelo(codestring);
			setDisplayMode(usingPyangelo ? "canvas": display);
			Editor.setValue(codestring);

			saveToLocalStorage();
		}
		else if (project != null && project.length > 0)
		{
			var client = new XMLHttpRequest();
			// Fixes a race condition where .py is not appended to the project name if user double clicks on the reset button
			// before code fully loads (??)
			if (!compiled && project.slice(-3) !== ".py") {
				project += ".py";
			}			
			client.open("GET", "projects/" + project);// Removed adding ".py" after compiled query param auto adds .py for non-compiled code
			client.onreadystatechange = function () {
				if (client.readyState == 4) {
					codestring = client.responseText;
					usingPyangelo = checkForPyangelo(codestring);
					setDisplayMode(usingPyangelo ? "canvas": display);
					Editor.setValue(codestring);
				}

				//saveToLocalStorage();
			};
			client.send();
		}
	}
}

// for all headless setup (see the setDisplayMode() for canvas specific setup)
function setupHeadless() {
	let body = document.getElementsByTagName('body')[0];	
	body.style.backgroundColor = "#000";
	let editorDiv = document.getElementById("editor");  
	editorDiv.style.display = "none";	
	document.getElementById('container').appendChild(document.getElementById('consoleWrapper'));

	document.getElementById("split").style.display = "none";
	document.getElementById("buttons").style.display = "none";
}

function stopAllSounds() {
	// cancelling speech synthesis means any queues speech will stop, this means a program with a say function on it's own will not speak (because it immediately terminates)
	// HOWEVER, this does mean that a program with a lot of speech will keep speaking even if the user presses STOP.
	//window.speechSynthesis.cancel();
    document.querySelectorAll('audio').forEach(element => {
        element.pause();
		// don't trigger the original error handlers
		element.onerror = null;
        element.currentTime = 0;
        element.src ="";
        element = null;        
    });
}

function openPiskel() {
	window.open('piskel', '_blank');
}

// setting up the editor
checkBrowser();

var pyConsole = document.getElementById("console");

// Monaco is the editor; ?editor=ace falls back to the old one while the switch
// beds in. The Ace path goes away once Skulpt does.
var editorParam = new URLSearchParams(window.location.search).get('editor');
Editor.use(editorParam === "ace" ? AceEditorBackend : MonacoEditorBackend);

// code here to define custom strings?

// Choosing the backend is synchronous and cheap; starting it is not, so
// Runtime.boot() and the Host binding happen in boot() at the end of the file.
// Skulpt is still the default; ?runtime=pyodide opts in. Pyodide needs JSPI
// (Chrome/Edge 137+) for its blocking calls, so an unsupported browser falls
// back rather than loading 13 MB it cannot use.
var runtimeParam = new URLSearchParams(window.location.search).get('runtime');
if (runtimeParam === "pyodide" && !PyodideRuntime.isSupported()) {
	runtimeParam = "skulpt";
	console.warn("This browser has no WebAssembly JSPI; falling back to Skulpt.");
}
Runtime.use(runtimeParam === "pyodide" ? PyodideRuntime : SkulptRuntime);

// Completions offered once the code imports goodies.
// This used to test `'goodies' in Sk.parse(...).cst.used_names`, which matched
// any use of the name - a variable called `goodies` counted. Matching the
// import statement is both more precise and free of any interpreter coupling.
var goodiesImportPattern = /^\s*(?:from|import)\s+goodies\b/m;

function goodiesCompletions(code) {
		if (goodiesImportPattern.test(code)) {
			/*
			// TODO: bring this back after improving the formating of the doc text, also investigate optional parameters
			var wordList = [
				{					
					caption: 'printImage(url, width, height, x, y)',
					snippet: "printImage(${1:url}, ${2:width}, ${3:height}, ${4:x}, ${5:y})$0",
					//value: 'printImage(url, width, height, x, y)',
					meta: 'function',
					docText: 'Displays an image at the URL with the width and height and at the x and y coordinates', 
					parameters: ['url', 'width', 'height', 'x', 'y'],
				},
				{
					caption: 'printButton(text, x, y)',
					snippet: "printButton(${1:text}, ${2:x}, ${3:y})$0",
					//value: 'printButton(text, x, y)',
					meta: 'function',
					docText: 'Displays a button with the text at the x and y coordinates', 
					parameters: ['text', 'x', 'y'],
				},
				{
					caption: 'waitForButtonClick()',
					value: 'waitForButtonClick()',
					meta: 'function',
					docText: 'Waits until any button is clicked', 

				}
				// Add more completions as needed
			];
			*/
			var wordList = [
				{					
					caption: 'printImage(url, width, height, x, y)',
					value: 'printImage()',
					meta: 'function',
				},
				{
					caption: 'printButton(text, x, y)',
					value: 'printButton()',
					meta: 'function',
				},
				{
					caption: 'waitForButtonClick()',
					value: 'waitForButtonClick()',
					meta: 'function',
				}
				// Add more completions as needed
			];
			return wordList;
		}
		return null;
}

// Completions are still disabled; uncomment to turn them on.
// Editor.registerCompletions(goodiesCompletions);


document.getElementById('file-input').addEventListener('change', userLoadCode, false);

// configurable buttons
var runButton = document.getElementById("runButton");
var saveButton = document.getElementById("saveButton");
var loadButton = document.getElementById("loadButton");
var stepButton = document.getElementById("stepButton");
var nextButton = document.getElementById("nextButton");
var continueButton = document.getElementById("continueButton");
var copyButton = document.getElementById("copyButton");
var stopButton = document.getElementById("stopButton");
var themeButton = document.getElementById("themeToggle");
var URLButton = document.getElementById("URLButton");
var fsButton = document.getElementById("fullscreenButton");
var piskelButton = document.getElementById("piskelButton");

var just_run = false;
var inputElement = null;

resetCanvas();

// grabbing the URL parameters and processing them
// Order in which we process the URL params are IMPORTANT!
// e.g. display is needed before project and id
// e.g. project (filename) is needed opening the project (because localstore is queried on the name)
urlParams = new URLSearchParams(window.location.search);

// piskel button
piskelButton.style.display = "none";
piskelButtonOn = urlParams.get('piskel')
if (piskelButtonOn != null && piskelButtonOn.length > 0)
{
	piskelButton.style.display = "inline";
}

// alternate webservice URL (for testing purposes - can be replaced with http://localhost:3000 etc.)
webserviceURLParam = urlParams.get('webservice')
if (webserviceURLParam != null && webserviceURLParam.length > 0)
{
	// add trailing "/" if not already there
	if (webserviceURLParam.slice(-1) != "/") {
		webserviceURLParam += "/";
	}
	// boot() pushes this into the interpreter once it is up.
	webServiceURL = webserviceURLParam;
}

// training wheels
wheels = urlParams.get('wheels')
if (wheels != null && wheels.length > 0 && document.getElementById("trainingWheels") !== null) {
	document.getElementById("trainingWheels").checked = true;
}

var compiled = false;
var headless = false;
compiled = urlParams.get('compiled');
if (compiled) {
	// if we're running compiled code, then headless will be on by default
	// as we don't want to show the compiled code in the editor
	headless = true;
	Sk.onAfterCompile = function(name, code) {
		// clobber compiled code and return with pre-compiled codestring instead
		if (name == "<stdin>") {
			// codestring is global - populated by code in the editor
			return codestring;
		}
		else {
			return code;
		}
	}	
} else {
	headless = urlParams.get('headless');
}

// canvas demo mode: canvas to the right of the editor, console at the bottom
var prevDisplay = null;
var display = urlParams.get('display');
// TODO: the order below is important

if (display == null || display.length == 0)
{
	display = "side";
}
setDisplayMode(display);

// hide stop and next button on load
stopButton.style.display = "none";
nextButton.style.display = "none";
stepButton.style.display = "none";


// auto run
autorun = urlParams.get('autorun')
autorun =  (autorun != null && autorun.length > 0);

// embedded code in the URL. The editor does not exist yet - Monaco's loader is
// asynchronous - so boot() puts the source in once it does.
esc = urlParams.get('code')
if (esc != null && esc.length > 0) {
	// URLSearchParams.get() has already percent-decoded this. Decoding a
	// second time - which this used to do - corrupts any literal %XX in the
	// student's source and throws URIError: URI malformed on a bare "%".
	// Since "%" is Python's modulo operator, that made the URL button produce
	// links that broke the editor outright for any program containing `i % 2`:
	// an uncaught exception at top level, so the rest of this file never ran.
	usingPyangelo = checkForPyangelo(esc);
	setDisplayMode(usingPyangelo ? "canvas": display);
}

// dark/light theme. Recorded here, applied by boot() as the editor is created,
// so there is no flash of the wrong theme.
light = urlParams.get('light')
var startTheme = "dark";
if (light != null && light.length > 0) {
	startTheme = "light";
	if (document.getElementById("lightTheme") !== null)
        document.getElementById("lightTheme").checked = true;
	themeButton.innerText = "⚫ Theme";
}

// code store id
var g_id = urlParams.get('id');
// project mode: load from code from existing .py file under /projects
// only works when hosted on web server (no filesystem mode)
project = urlParams.get('project');
var filename = null;
filename = urlParams.get('name');
// is there a project?
if (project != null && project.length > 0) {
	// if there is a project but no filename, use the project as the filename
	if (filename == null || filename.length == 0)
	{
		filename = project;
	}
	// if there is a project AND a filename, then the filename takes precedence
}
else {
	// no project and no filename? use a default value		
	if (filename == null || filename.length == 0)
	{
		// default file name (for saving)
		filename = "my_code";
	}
}
// disable headless only if there is something in the localstorage but this is not from the codestore 
// would occur when 
// TESTME: never disabling headless
/*
if (localStorage.getItem(filename) !== null && !(id != null && id.length > 0) && !compiled && !(esc != null && esc.length > 0)) {
	headless = false;
}
*/

var editorDiv = document.getElementById("editor");

function setSpinnerInEditor(visible) {
	if (visible) {
		spinner.style.display = "block";
		editorDiv.appendChild(spinner);
	} else {
		spinner.style.display = "none";
		editorDiv.removeChild(spinner);			
	}
}

// Button visibility and the remaining run-behaviour params are resolved BEFORE
// the load branch below, because several of its paths call runSkulpt()
// synchronously. runSkulpt/stopSkulpt read nostep, norun and autostep, so
// leaving these until afterwards meant they were still undefined on those
// paths - `undefined != null` is false, so ?nostep, ?norun and ?autostep were
// silently ignored depending on how the page happened to be loaded.

// allows save (and load)
nosave = urlParams.get('nosave')
if (nosave != null && nosave.length > 0) {
	saveButton.style.display = "none";
	loadButton.style.display = "none";
} else {
	saveButton.style.display = "inline";
	loadButton.style.display = "inline";
}

// disable step-run button
nostep = urlParams.get('nostep')
// always hide step button on load
stepButton.style.display = "none";


// disable codestore button
nosnap = urlParams.get('nosnap')
if (nosnap != null && nosnap.length > 0) {
	codestoreURL.style.display = "none";
} else {
	codestoreURL.style.display = "inline";
}

// disable run button
norun = urlParams.get('norun')
if (norun != null && norun.length > 0) {
	runButton.style.display = "none";
	stopButton.style.width = "72px";
	stepButton.innerHTML = "👣 Step";
} else {
	// this was turning the runButton on when loading from ID as autorun
	// do an explicit check for autorun first
	if (!autorun) {
		runButton.style.display = "inline";
	}
}

/*
// disable copy code button
nocopy = urlParams.get('nocopy')
if (nocopy != null && nocopy.length > 0)
{
	copyButton.style.display = "none";
}
else
{
	copyButton.style.display = "inline";
}
*/

// autostep
// (linestepper with sleep)
autostep = urlParams.get('autostep')
autodelay = urlParams.get('autodelay')

// get URL button
URLButton.style.display = "none";
urlButtonOn = urlParams.get('url')
if (urlButtonOn != null && urlButtonOn.length > 0) {
	URLButton.style.display = "inline";
} else {
	URLButton.style.display = "none";
}


// hides the drawing canvas
nocanvas = urlParams.get('nocanvas')
if (nocanvas != null && nocanvas.length > 0) {
	var rightpane = document.getElementById("rightpane");
	rightpane.style.display = "none";
	var leftpane = document.getElementById("leftpane");
	leftpane.style.width = "100%";
}

// no full screen (if unsupported by other widgets etc.)
nofs = urlParams.get('nofs')
if (nofs != null && nofs.length > 0) {
	fsButton.style.display = "none";
}

var gutters = document.getElementsByClassName('gutter');
if (gutters.length > 0 && gutters !== undefined)
	gutters[0].style.zIndex = 10;

var codestring = "";

// Fetch a curriculum project. Resolves on readyState 4 regardless of status,
// which is what the original code did - a 404 body becomes the "source" and
// then fails to parse, in front of the student.
function fetchProject(url) {
	return new Promise(function (resolve) {
		var client = new XMLHttpRequest();
		client.open("GET", url);
		client.onreadystatechange = function () {
			if (client.readyState == 4) {
				resolve(client.responseText);
			}
		};
		client.send();
	});
}

// Fetch a snapshot from the codestore, with the spinner in whichever pane is
// visible. Resolves to null if the request times out or errors.
function fetchFromCodestore() {
	var consoleDiv = document.getElementById("console");
	if (!headless) {
		setSpinnerInEditor(true);
		Editor.setValue("# Loading code... please wait.");
	}
	else {
		spinner.style.display = "block";
		consoleDiv.appendChild(spinner);
		setupHeadless();
	}

	return new Promise(function (resolve) {
		var xhr2 = new XMLHttpRequest();
		xhr2.open("GET", webServiceURL + 'get?id=' + g_id, true);
		xhr2.timeout = 10000; // time in milliseconds

		xhr2.onreadystatechange = function () {
			if (this.readyState === XMLHttpRequest.DONE && this.status === 200) {
				// don't check local storage for when there are ids
				// btw, we purge the id from the URL params when the page is loaded
				// this is so users don't save to local storage and think the code is actually part of the codestore id in the URL
				spinner.style.display = "none";
				(headless ? consoleDiv : editorDiv).removeChild(spinner);
				resolve(xhr2.responseText);
			}
			// A non-200 deliberately does nothing and leaves the spinner up.
			// That is pre-existing behaviour, kept here so this refactor stays
			// verifiable; ontimeout/onerror are the only paths that tell the
			// student anything. Worth fixing separately.
		};

		xhr2.ontimeout = (e) => {
			console.log("Timeout on retrieving code from id:" + g_id + ". Please check the URL and try again.");
			setSpinnerInEditor(false);
			showURLDialog("Timeout on retrieving code from id:" + g_id + ". Please check the URL and try again.");
			resolve(null);
		};

		xhr2.onerror = function () {
			console.log("Error with retrieving code from id:" + g_id + ". Please check the URL and try again.");
			setSpinnerInEditor(false);
			showURLDialog("Error with retrieving code from id:" + g_id + ". Please check the URL and try again.");
			resolve(null);
		};

		xhr2.send();
	});
}

// Where this page's program comes from, in priority order. Resolves to the
// source, or null when there is nothing to load.
async function acquireSource() {
	// 1. embedded in the URL - already decoded and placed in the editor above
	if (esc != null && esc.length > 0) {
		if (headless) {
			setupHeadless();
		}
		return esc;
	}

	// 2. a codestore snapshot
	if (g_id != null && g_id.length > 0) {
		return await fetchFromCodestore();
	}

	// 3. a curriculum project - unless the student has unsaved local edits,
	//    in which case those win. Compiled payloads always come from the
	//    server and keep their own file extension.
	if (project != null && project.length > 0) {
		if (headless) {
			setupHeadless();
		}
		if (localStorage.getItem(filename) === null || compiled) {
			if (!compiled) {
				project += ".py";
			}
			return await fetchProject("projects/" + project);
		}
		return loadFromLocalStorage();
	}

	// 4. whatever the student last had open
	if (headless) {
		setupHeadless();
	}
	return loadFromLocalStorage();
}

// Startup. Everything above this point is synchronous DOM and URL-parameter
// work; everything that has to wait - the interpreter coming up, the source
// arriving over the network - happens here. Skulpt is ready immediately, but
// Pyodide will not be, which is why this is shaped as an await.
(async function boot() {
	// The editor first: Monaco's AMD loader has to fetch ~3.8 MB before there
	// is anything to put source into.
	await Editor.create("editor", { theme: startTheme });
	Editor.setBreakpointsEnabled(breakpointsAllowed());

	Runtime.setWebServiceURL(webServiceURL);
	// console.js declares the classroom builtins into the Host registry at
	// parse time; binding them to the interpreter happens once, here. Queued
	// by a backend that is not up yet, and flushed when it is.
	Host.installInto(Runtime);

	// Start the interpreter and fetch the source at the same time. Skulpt is
	// ready immediately; Pyodide is 13 MB, and there is no reason the student
	// should stare at an empty editor while it arrives.
	var runtimeReady = Runtime.boot();

	var src = await acquireSource();
	if (src !== null && src !== undefined && src !== "") {
		codestring = src;
		usingPyangelo = checkForPyangelo(codestring);
		setDisplayMode(usingPyangelo ? "canvas" : display);
		if (!headless) {
			Editor.setValue(codestring);
		}
	}

	await runtimeReady;
	if (codestring === "") {
		return;
	}

	if (autorun || headless) {
		// For a compiled payload the source is swapped in by the runtime's
		// after-compile hook, so the run is kicked off with nothing.
		runSkulpt(false, compiled ? "" : codestring);
	}
})();

// if not in headless mode:
if (!headless) {
	// get rid of id= from param string
	// this is so users don't save to local storage and think the code is actually part of the codestore id in the URL
	//
	// The values have to be RE-ENCODED. urlParams.forEach hands back decoded
	// values, and this used to concatenate them into the URL raw - so a single
	// "<" inside ?code= produced a document URL that broke every subsequent
	// *relative* subresource load: Monaco's AMD modules and the Pyodide
	// runtime's js/py/*.py both failed, reporting errors that pointed anywhere
	// but here. A "#" in the source (i.e. any Python comment) also swallowed
	// every following parameter into the fragment. URLSearchParams escapes
	// properly and drops the stray leading "&" the old code emitted.
	let kept = new URLSearchParams();
	urlParams.forEach(function(value, key) {
		if (key != "id" && key !== "undefined") {
			kept.append(key, value);
		}
	});
	let query = kept.toString();
	window.history.replaceState(null, null,
		window.location.pathname + (query ? "?" + query : "") + window.location.hash);
}
// if we are in headless mode, then editor is not active anyway and the ID needs to be in the url for the user to restart via refresh

