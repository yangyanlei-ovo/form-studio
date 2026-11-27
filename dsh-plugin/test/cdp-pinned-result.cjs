const fs = require('node:fs');
const PORT = Number(process.env.CDP_PORT || 9245);
const OUT = process.env.SHOT || `${process.env.TEMP}\\form-pinned.png`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
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
  await send('Page.enable');
  await send('Page.navigate', { url: 'http://127.0.0.1:52482/form/' });
  await sleep(2400);
  await evaluate(`(() => {
    const cam = state.cameras[0];
    state.history[cam.id] = [{ id: 'test-render', name: '暖木与光的对话', prompt: '测试', imageUrl: 'assets/living-room.png', provider: 'Seedream', model: 'test', createdAt: new Date().toISOString(), revision: state.revision, time: '12:00', keepLayout: true }];
    openRender(cam.id);
  })()`);
  await sleep(700);
  console.log('initial:', await evaluate("JSON.stringify({bar:!!document.getElementById('pinBar'),disabled:document.getElementById('pinResult').disabled,text:document.getElementById('pinResult').textContent,pinned:state.pinnedResult})"));
  await evaluate("document.getElementById('pinResult').click()");
  await sleep(400);
  console.log('pinned:', await evaluate("JSON.stringify({pinned:state.pinnedResult,status:document.getElementById('pinStatus').textContent,meta:document.getElementById('pinMeta').textContent,thumb:document.getElementById('pinThumb').getAttribute('src'),unpinHidden:document.getElementById('unpinResult').hidden})"));
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
  console.log('screenshot', OUT, fs.statSync(OUT).size);
  await evaluate("openRender(state.cameras[1].id)");
  await sleep(500);
  console.log('switched:', await evaluate("JSON.stringify({camera:currentCamera,pinnedCamera:state.pinnedResult.cameraName,status:document.getElementById('pinStatus').textContent,thumb:document.getElementById('pinThumb').getAttribute('src'),pinHidden:document.getElementById('pinBar').hidden,disabled:document.getElementById('pinResult').disabled,text:document.getElementById('pinResult').textContent})"));
  await evaluate("document.getElementById('unpinResult').click()");
  await sleep(300);
  console.log('unpinned:', await evaluate("JSON.stringify({pinned:state.pinnedResult,status:document.getElementById('pinStatus').textContent,thumbHidden:document.getElementById('pinThumb').hidden})"));
  socket.close(); process.exit(0);
}
main().catch((error) => { console.error('FAILED', error.stack || error.message); process.exitCode = 1; });
