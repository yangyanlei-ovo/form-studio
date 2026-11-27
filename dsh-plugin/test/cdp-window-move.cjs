const fs = require('node:fs');

const PORT = Number(process.env.CDP_PORT || 9240);
const OUT = process.env.SHOT || `${process.env.TEMP}\\form-window-move.png`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const target = targets.find((entry) => entry.type === 'page' && entry.url.includes('/form/'));
  if (!target) throw new Error('page not found');
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
  const send = (method, params = {}) => new Promise((resolve, reject) => {
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
  await evaluate("document.querySelector('#libraryGrid .block-card[data-type=\"window\"]').click()");
  await sleep(200);
  const point = await evaluate(`(() => {
    const c = document.getElementById('sceneCanvas'), r = c.getBoundingClientRect();
    const P = projector(c.clientWidth, c.clientHeight, state.view);
    const p = P.project([0.35, 3, 1.5]);
    return { x: r.left + p[0], y: r.top + p[1] };
  })()`);
  await evaluate(`(() => {
    const c = document.getElementById('sceneCanvas');
    c.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, cancelable: true, composed: true, button: 0, buttons: 1,
      clientX: ${point.x}, clientY: ${point.y}, pointerId: 1, pointerType: 'mouse', isPrimary: true
    }));
  })()`);
  await sleep(600);
  const before = await evaluate("JSON.stringify((()=>{const w=state.objects.find(o=>o.type==='window'&&o.wallInfo);return {x:w.x,y:w.y,z:w.z,sx:w.sx,sz:w.sz,wallInfo:w.wallInfo,center:[w.x+w.sx/2,w.y+w.sy/2,w.z+w.sz/2]}})())");
  console.log('placed:', before);

  console.log('vertical:', await evaluate(`(() => {
    const w = state.objects.find(o => o.type === 'window' && o.wallInfo);
    const prev = JSON.parse(JSON.stringify(w));
    const next = JSON.parse(JSON.stringify(w));
    next.z += 1;
    const r = resolveMotion(prev, next, 'move');
    Object.assign(w, r.object);
    refresh();
    return JSON.stringify({blocked:r.blocked,reason:r.reason,z:w.z,center:[w.x+w.sx/2,w.y+w.sy/2,w.z+w.sz/2],openings:state.objects.filter(o=>o.openings&&o.openings.some(op=>op.windowId===w.id)).map(o=>({id:o.id,y:o.y,opening:o.openings.find(op=>op.windowId===w.id)})),parts:components(state.objects.find(o=>o.id===w.wallInfo.ids[1])).length});
  })()`));

  console.log('along:', await evaluate(`(() => {
    const w = state.objects.find(o => o.type === 'window' && o.wallInfo);
    const prev = JSON.parse(JSON.stringify(w));
    const next = JSON.parse(JSON.stringify(w));
    next.y += 1;
    const r = resolveMotion(prev, next, 'move');
    Object.assign(w, r.object);
    refresh();
    return JSON.stringify({blocked:r.blocked,reason:r.reason,x:w.x,y:w.y,z:w.z,center:[w.x+w.sx/2,w.y+w.sy/2,w.z+w.sz/2],openings:state.objects.filter(o=>o.openings&&o.openings.some(op=>op.windowId===w.id)).map(o=>({id:o.id,y:o.y,opening:o.openings.find(op=>op.windowId===w.id)}))});
  })()`));

  console.log('depth:', await evaluate(`(() => {
    const w = state.objects.find(o => o.type === 'window' && o.wallInfo);
    const prev = JSON.parse(JSON.stringify(w));
    const next = JSON.parse(JSON.stringify(w));
    next.x += 1;
    const r = resolveMotion(prev, next, 'move');
    Object.assign(w, r.object);
    refresh();
    return JSON.stringify({blocked:r.blocked,x:w.x,center:[w.x+w.sx/2,w.y+w.sy/2,w.z+w.sz/2],plane:w.wallInfo.plane});
  })()`));

  console.log('rotate blocked:', await evaluate(`(() => {
    const w = state.objects.find(o => o.type === 'window' && o.wallInfo);
    const prev = JSON.parse(JSON.stringify(w));
    const next = JSON.parse(JSON.stringify(w));
    next.rot = [0, 0, 120];
    const r = resolveMotion(prev, next, 'rotate');
    return JSON.stringify({blocked:r.blocked,reason:r.reason});
  })()`));

  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
  console.log('screenshot', OUT, fs.statSync(OUT).size);
  socket.close();
  process.exit(0);
}

main().catch((error) => { console.error('FAILED', error.stack || error.message); process.exitCode = 1; });
