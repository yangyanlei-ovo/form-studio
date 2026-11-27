const fs = require('node:fs');

const PORT = Number(process.env.CDP_PORT || 9237);
const OUT = process.env.SHOT || `${process.env.TEMP}\\form-window-placement.png`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const target = targets.find((entry) => entry.type === 'page' && entry.url.includes('/form/'));
  if (!target) throw new Error('FORM page target not found');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  let nextId = 1;
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const entry = pending.get(message.id);
      pending.delete(message.id);
      message.error ? entry.reject(new Error(JSON.stringify(message.error))) : entry.resolve(message.result);
    }
  });
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result?.value;
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: 'http://127.0.0.1:52482/form/' });
  await sleep(2200);
  await evaluate("window.confirm = () => true");
  await evaluate("document.querySelector('#libraryGrid .block-card[data-type=\"window\"]').click()");
  await sleep(300);
  console.log('options hidden:', await evaluate("document.getElementById('windowOptions').hidden"));
  console.log('type/mode:', await evaluate('type'), await evaluate('mode'));
  const before = await evaluate("JSON.stringify({objects:state.objects.length,windows:state.objects.filter(o=>o.type==='window').length,leftBlockParts:components(state.objects.find(o=>o.type==='block'&&o.x===0&&o.y===3)).length})");
  console.log('before:', before);
  const coords = await evaluate(`(() => {
    const c = document.getElementById('sceneCanvas'), r = c.getBoundingClientRect();
    const P = projector(c.clientWidth, c.clientHeight, state.view);
    const p = P.project([0.35, 3, 1.5]);
    return { x: r.left + p[0], y: r.top + p[1] };
  })()`);
  console.log('click:', coords);
  await evaluate(`(() => {
    const c = document.getElementById('sceneCanvas');
    c.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, cancelable: true, composed: true, button: 0, buttons: 1,
      clientX: ${coords.x}, clientY: ${coords.y}, pointerId: 1, pointerType: 'mouse', isPrimary: true
    }));
  })()`);
  await sleep(700);
  console.log('after:', await evaluate("JSON.stringify({objects:state.objects.length,windows:state.objects.filter(o=>o.type==='window').map(o=>({id:o.id,x:o.x,y:o.y,z:o.z,sx:o.sx,sy:o.sy,sz:o.sz,rot:o.rot,wallIds:o.wallIds})),openings:state.objects.filter(o=>o.openings).map(o=>({id:o.id,type:o.type,x:o.x,y:o.y,openings:o.openings})),leftParts:components(state.objects.find(o=>o.type==='block'&&o.x===0&&o.y===3)).length})"));
  console.log('toast:', await evaluate("document.getElementById('toast').innerText"));
  console.log('selected/type/mode:', await evaluate('selectedId'), await evaluate('type'), await evaluate('mode'));
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
  console.log('screenshot', OUT, fs.statSync(OUT).size);
  socket.close();
  process.exit(0);
}

main().catch((error) => {
  console.error('FAILED', error.stack || error.message);
  process.exitCode = 1;
});
