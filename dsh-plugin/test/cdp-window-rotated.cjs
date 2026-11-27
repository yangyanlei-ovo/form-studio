const PORT = Number(process.env.CDP_PORT || 9238);
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
  const walls = await evaluate("state.objects.filter(o=>o.type==='wall')");
  console.log('walls before:', JSON.stringify(walls));
  if (!walls.length) throw new Error('no wall');
  const wall = walls[0];
  const cx = wall.x + wall.sx / 2;
  const cy = wall.y + wall.sy / 2;
  const point = await evaluate(`(() => {
    const c = document.getElementById('sceneCanvas'), r = c.getBoundingClientRect();
    const P = projector(c.clientWidth, c.clientHeight, state.view);
    const p = P.project([${cx}, ${cy}, 1.5]);
    return { x: r.left + p[0], y: r.top + p[1] };
  })()`);
  await evaluate("document.querySelector('#libraryGrid .block-card[data-type=\"window\"]').click()");
  await sleep(200);
  await evaluate(`(() => {
    const c = document.getElementById('sceneCanvas');
    c.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, cancelable: true, composed: true, button: 0, buttons: 1,
      clientX: ${point.x}, clientY: ${point.y}, pointerId: 1, pointerType: 'mouse', isPrimary: true
    }));
  })()`);
  await sleep(600);
  console.log('after:', await evaluate("JSON.stringify({windows:state.objects.filter(o=>o.type==='window').map(o=>({x:o.x,y:o.y,z:o.z,sx:o.sx,sz:o.sz,rot:o.rot})),wall:state.objects.filter(o=>o.type==='wall').map(o=>({openings:o.openings,parts:components(o).length})),toast:document.getElementById('toast').innerText})"));
  socket.close();
  process.exit(0);
}
main().catch((error) => { console.error('FAILED', error.stack || error.message); process.exitCode = 1; });
