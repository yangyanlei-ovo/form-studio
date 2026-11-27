const PORT = Number(process.env.CDP_PORT || 9239);
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
  await evaluate("document.querySelector('#libraryGrid .block-card[data-type=\"window\"]').click()");
  await sleep(200);
  const point = await evaluate(`(() => {
    const c = document.getElementById('sceneCanvas'), r = c.getBoundingClientRect();
    const P = projector(c.clientWidth, c.clientHeight, state.view);
    const p = P.project([0.35, 3, 1.5]);
    const f = P.project([7, 6, 0]);
    return { wx: r.left + p[0], wy: r.top + p[1], fx: r.left + f[0], fy: r.top + f[1] };
  })()`);
  const click = (x, y) => evaluate(`(() => {
    const c = document.getElementById('sceneCanvas');
    c.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, cancelable: true, composed: true, button: 0, buttons: 1,
      clientX: ${x}, clientY: ${y}, pointerId: 1, pointerType: 'mouse', isPrimary: true
    }));
  })()`);
  await click(point.wx, point.wy);
  await sleep(600);
  console.log('placed:', await evaluate("JSON.stringify({windows:state.objects.filter(o=>o.type==='window').length,openingBlocks:state.objects.filter(o=>o.openings&&o.openings.length).length,blockParts:components(state.objects.find(o=>o.type==='block'&&o.x===0&&o.y===3)).length})"));
  const newWindow = await evaluate("state.objects.filter(o=>o.type==='window')[1].id");
  await evaluate(`(() => { state.objects = state.objects.filter(o => o.id !== ${JSON.stringify(newWindow)}); selectedId = null; refresh(); })()`);
  await sleep(400);
  console.log('after delete:', await evaluate("JSON.stringify({windows:state.objects.filter(o=>o.type==='window').length,blockParts:components(state.objects.find(o=>o.type==='block'&&o.x===0&&o.y===3)).length,activeOpenings:state.objects.flatMap(o=>o.openings||[]).filter(o=>state.objects.some(w=>w.id===o.windowId)).length})"));
  await evaluate("document.querySelector('#libraryGrid .block-card[data-type=\"window\"]').click()");
  await sleep(200);
  await click(point.fx, point.fy);
  await sleep(300);
  console.log('floor click:', await evaluate("JSON.stringify({windows:state.objects.filter(o=>o.type==='window').length,toast:document.getElementById('toast').innerText})"));
  socket.close();
  process.exit(0);
}

main().catch((error) => {
  console.error('FAILED', error.stack || error.message);
  process.exitCode = 1;
});
