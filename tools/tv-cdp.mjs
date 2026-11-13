// Tiny Chrome DevTools client for the TV's web inspector (port 9998).
// usage: node cdp.mjs key LEFT RIGHT ENTER BACK ...   |   node cdp.mjs eval '<js>'   |   node cdp.mjs hold ENTER
const HOST = process.env.TV || '192.168.178.25:9998';
const list = await (await fetch(`http://${HOST}/json/list`)).json();
const target = list.find((t) => /customlauncher/.test(t.url)) || list[0];
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
await new Promise((r) => ws.onopen = r);
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({id: i, method, params})); });
const KEYS = {LEFT: [37, 'ArrowLeft'], UP: [38, 'ArrowUp'], RIGHT: [39, 'ArrowRight'], DOWN: [40, 'ArrowDown'], ENTER: [13, 'Enter'], BACK: [461, 'GoBack'], HOME: [36, 'Home'], ESC: [27, 'Escape']};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const [cmd, ...args] = process.argv.slice(2);
if (cmd === 'eval') {
	const r = await send('Runtime.evaluate', {expression: args.join(' '), returnByValue: true, awaitPromise: true});
	console.log(JSON.stringify(r.result?.result?.value ?? r.result ?? r, null, 1));
} else if (cmd === 'key' || cmd === 'hold') {
	for (const a of args) {
		const m = a.match(/^([A-Z]+)(?:x(\d+))?$/); const [code, key] = KEYS[m[1]]; const n = +(m[2] || 1);
		for (let k = 0; k < n; k++) {
			const p = {windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, key, code: key};
			await send('Input.dispatchKeyEvent', {type: 'rawKeyDown', ...p});
			if (cmd === 'hold') { for (let j = 0; j < 12; j++) { await sleep(80); await send('Input.dispatchKeyEvent', {type: 'rawKeyDown', autoRepeat: true, ...p}); } }
			await send('Input.dispatchKeyEvent', {type: 'keyUp', ...p});
			await sleep(Number(process.env.GAP || 350));
		}
	}
}
ws.close();
process.exit(0);
