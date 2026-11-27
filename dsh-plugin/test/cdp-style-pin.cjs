const PORT = Number(process.env.CDP_PORT || 9246);
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
    state.history[cam.id] = [{ id: 'test-style', name: '风格基准图', prompt: 'test', imageUrl: 'assets/living-room.png', provider: 'Seedream', model: 'test', createdAt: new Date().toISOString(), revision: state.revision, time: '12:00', keepLayout: true }];
    openRender(cam.id);
    state.pinnedResult = { cameraId: cam.id, cameraName: cam.name, historyId: 'test-style', imageUrl: 'assets/living-room.png', name: '风格基准图', meta: '测试', prompt: 'test', createdAt: new Date().toISOString() };
    historyUI();
  })()`);
  await sleep(400);
  console.log('pin:', await evaluate("JSON.stringify({status:document.getElementById('pinStatus').textContent,meta:document.getElementById('pinMeta').textContent})"));
  await evaluate(`(() => {
    window.__renderBody = null;
    const original = window.fetch;
    window.fetch = function(url, options) {
      if (String(url).includes('/api/render') && options?.body) {
        window.__renderBody = options.body;
        return Promise.reject(new Error('test stop before real render'));
      }
      return original.apply(this, arguments);
    };
    document.getElementById('generate').click();
  })()`);
  await sleep(2000);
  const body = await evaluate('window.__renderBody');
  if (!body) { console.log('no render body'); process.exit(1); }
  const data = JSON.parse(body);
  console.log('body:', JSON.stringify({ styleReference: data.styleReference, hasReferenceImage: data.hasReferenceImage, stylePrefix: String(data.styleReferenceDataUrl || '').slice(0, 30), styleLength: String(data.styleReferenceDataUrl || '').length, referenceLength: String(data.referenceDataUrl || '').length }));
  await evaluate("document.getElementById('previewPrompt').click()");
  await sleep(1200);
  console.log('preview:', await evaluate("JSON.stringify({open:document.getElementById('promptDialog').open,length:document.getElementById('promptStats').innerText,head:document.getElementById('finalPromptPreview').innerText.slice(0,260)})"));
  socket.close(); process.exit(0);
}
main().catch((error) => { console.error('FAILED', error.stack || error.message); process.exitCode = 1; });
