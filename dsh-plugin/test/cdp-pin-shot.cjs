const fs = require('node:fs');
const PORT = Number(process.env.CDP_PORT || 9246);
async function main() {
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const target = targets.find((entry) => entry.type === 'page' && entry.url.includes('/form/'));
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map(); let nextId = 1;
  socket.addEventListener('message', (event) => { const message = JSON.parse(event.data); if (message.id && pending.has(message.id)) { const entry = pending.get(message.id); pending.delete(message.id); message.error ? entry.reject(new Error(JSON.stringify(message.error))) : entry.resolve(message.result); } });
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  const send = (method, params = {}) => new Promise((resolve, reject) => { const id = nextId++; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expression) => { const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text); return result.result?.value; };
  await send('Runtime.enable');
  await evaluate("document.getElementById('promptDialog').close(); window.scrollTo(0,0);");
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const out = `${process.env.TEMP}\\form-pinned-style.png`;
  fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
  console.log(out, fs.statSync(out).size, await evaluate("document.getElementById('pinStatus').innerText"));
  socket.close(); process.exit(0);
}
main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
