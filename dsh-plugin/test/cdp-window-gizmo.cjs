const PORT = Number(process.env.CDP_PORT || 9240);
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
  await evaluate("(()=>{const o=state.objects.find(x=>x.type==='window'&&x.wallInfo);selectedId=o.id;selectionUI();mode='orbit';setMode('orbit');draw();})()");
  const data = await evaluate(`(() => {
    const o = selectedObject();
    const c = document.getElementById('sceneCanvas'), r = c.getBoundingClientRect();
    const P = projector(c.clientWidth, c.clientHeight, state.view);
    const center = pivotOf(o);
    const origin = P.project(center), up = P.project(add(center, [0,0,1]));
    const scalePx = Math.max(5, Math.hypot(up[0]-origin[0], up[1]-origin[1]));
    const length = Math.min(5, Math.max(1, 77 / scalePx));
    const end = P.project(add(center, [0,0,length]));
    return { x: r.left + end[0], y: r.top + end[1], z: o.z, center };
  })()`);
  console.log('handle:', data);
  await evaluate(`(() => {
    const c = document.getElementById('sceneCanvas');
    const fire = (type, x, y, buttons) => c.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, composed: true, button: 0, buttons,
      clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', isPrimary: true
    }));
    fire('pointerdown', ${data.x}, ${data.y}, 1);
    fire('pointermove', ${data.x}, ${data.y - 45}, 1);
    fire('pointerup', ${data.x}, ${data.y - 45}, 0);
  })()`);
  await sleep(700);
  console.log('after:', await evaluate("JSON.stringify({z:state.objects.find(o=>o.type==='window'&&o.wallInfo).z,center:(()=>{const o=state.objects.find(o=>o.type==='window'&&o.wallInfo);return [o.x+o.sx/2,o.y+o.sy/2,o.z+o.sz/2]})(),openings:state.objects.filter(o=>o.openings&&o.openings.some(op=>op.windowId===state.objects.find(w=>w.type==='window'&&w.wallInfo).id)).map(o=>o.openings.find(op=>op.windowId===state.objects.find(w=>w.type==='window'&&w.wallInfo).id).z0)})"));
  socket.close();
  process.exit(0);
}
main().catch((error) => { console.error('FAILED', error.stack || error.message); process.exitCode = 1; });
