// Loads a page in headless Chrome, waits until it sets document.title to
// "DONE", and prints the text of one element.
//
//   node tests/cdp-run.js <url> [selector] [timeoutMs]
//
// Why not --dump-dom --virtual-time-budget, which the rest of the harness
// uses? Because a pyangelo program starts a permanent requestAnimationFrame
// loop. Virtual time then races ahead as fast as the renderer can paint,
// burning the entire budget on real work, and the dump never arrives - the
// symptom is a zero-byte output file. Driving the browser over CDP lets the
// page take as long as it needs in real time and say when it is finished.
//
// Uses Node's built-in WebSocket (Node 22+); no dependencies.

const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const CHROME = process.env.CHROME ||
    "C:/Program Files/Google/Chrome/Application/chrome.exe";

async function main() {
    const url = process.argv[2];
    const selector = process.argv[3] || "#out";
    const timeoutMs = parseInt(process.argv[4] || "60000", 10);
    if (!url) {
        console.error("usage: node tests/cdp-run.js <url> [selector] [timeoutMs]");
        process.exit(2);
    }

    const profile = fs.mkdtempSync(path.join(os.tmpdir(), "cdp-"));
    const port = 9200 + Math.floor(Math.random() * 700);
    // Chrome opens the URL itself, so we attach to a page target that is
    // already loading. Connecting to the *browser* endpoint instead would give
    // a Runtime with no document, and every evaluate would return undefined.
    const chrome = spawn(CHROME, [
        "--headless", "--disable-gpu", "--no-sandbox",
        "--remote-debugging-port=" + port,
        "--user-data-dir=" + profile,
        url
    ], { stdio: "ignore" });

    const cleanup = () => { try { chrome.kill(); } catch (e) {} };
    process.on("exit", cleanup);

    const target = await waitForTarget(port, 20000);
    const ws = new WebSocket(target);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

    let id = 0;
    const pending = new Map();
    ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.id && pending.has(msg.id)) {
            pending.get(msg.id)(msg);
            pending.delete(msg.id);
        }
    };
    const send = (method, params) => new Promise((res) => {
        const myId = ++id;
        pending.set(myId, res);
        ws.send(JSON.stringify({ id: myId, method, params: params || {} }));
    });
    const evaluate = async (expr) => {
        const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true });
        return r.result && r.result.result ? r.result.result.value : undefined;
    };

    await send("Runtime.enable");

    const deadline = Date.now() + timeoutMs;
    let title = "";
    while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 150));
        title = await evaluate("document.title");
        if (title === "DONE") { break; }
    }

    const text = await evaluate(
        "(document.querySelector(" + JSON.stringify(selector) + ")||{}).textContent || ''");
    ws.close();
    cleanup();
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}

    if (title !== "DONE") {
        console.error("TIMEOUT after " + timeoutMs + "ms (title=" + JSON.stringify(title) + ")");
        console.log(text || "");
        process.exit(1);
    }
    console.log(text);
}

// The first page target, which is the tab Chrome opened for our URL.
async function waitForTarget(port, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const r = await fetch("http://127.0.0.1:" + port + "/json/list");
            const list = await r.json();
            const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
            if (page) { return page.webSocketDebuggerUrl; }
        } catch (e) { /* not up yet */ }
        await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error("no page target appeared on port " + port);
}

main().catch((e) => { console.error(String(e && e.stack || e)); process.exit(1); });
