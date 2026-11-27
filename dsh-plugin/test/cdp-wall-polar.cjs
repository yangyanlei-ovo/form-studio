const fs = require('node:fs');

const PORT = Number(process.env.CDP_PORT || 9238);
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
  await evaluate("document.querySelector('#libraryGrid .block-card[data-type=\"wall\"]').click()");
  await sleep(200);
  const coords = await evaluate(`(() => {
    const c = document.getElementById('sceneCanvas'), r = c.getBoundingClientRect();
    const P = projector(c.clientWidth, c.clientHeight, state.view);
    const a = P.project([4, 9, 0]), b = P.project([6.2, 9.8, 0]);
    return { ax: r.left + a[0], ay: r.top + a[1], bx: r.left + b[0], by: r.top + b[1] };
  })()`);
  await evaluate(`(() => {
    const c = document.getElementById('sceneCanvas');
    const fire = (type, x, y, buttons) => c.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, composed: true, button: 0, buttons,
      clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', isPrimary: true
    }));
    fire('pointerdown', ${coords.ax}, ${coords.ay}, 1);
    fire('pointermove', ${coords.bx}, ${coords.by}, 1);
    fire('pointerup', ${coords.bx}, ${coords.by}, 0);
  })()`);
  await sleep(600);
  console.log('walls:', await evaluate("JSON.stringify(state.objects.filter(o=>o.type==='wall').map(o=>({x:o.x,y:o.y,sx:o.sx,sy:o.sy,rot:o.rot})))"));
  console.log('toast:', await evaluate("document.getElementById('toast').innerText"));
  socket.close();
  process.exit(0);
}

main().catch((error) => {
  console.error('FAILED', error.stack || error.message);
  process.exitCode = 1;
});
