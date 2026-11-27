const fs = require('node:fs');

const PORT = Number(process.env.CDP_PORT || 9242);
const OUT = process.env.SHOT || `${process.env.TEMP}\\form-overlap.png`;
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
  console.log('initial:', await evaluate("JSON.stringify({objects:state.objects.length,pan:state.view.pan,yaw:state.view.yaw,overlapHook:drawOverlapHighlight.toString().slice(0,40)})"));
  console.log('snap values:', await evaluate("JSON.stringify([snapRotationAngle(26),snapRotationAngle(25.9),snapRotationAngle(34),snapRotationAngle(34.1)])"));
  console.log('place overlap:', await evaluate("(()=>{const sofa=state.objects.find(o=>o.type==='sofa');const b=makeObj('block',2,4,0,'#e8e5da',2,2,2);const r=placeOnGround(b);return JSON.stringify({reason:r.reason,sofa:{x:sofa.x,y:sofa.y,sx:sofa.sx,sy:sofa.sy},object:r.object})})()"));
  await evaluate("(()=>{const b=makeObj('block',2,4,0,'#e8e5da',2,2,2);state.objects.push(b);refresh();})()");
  await sleep(500);
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
  console.log('screenshot', OUT, fs.statSync(OUT).size);

  const coords = await evaluate(`(() => {
    const c = document.getElementById('sceneCanvas'), r = c.getBoundingClientRect();
    const P = projector(c.clientWidth, c.clientHeight, state.view);
    const p = P.project([2.5, 5, 1]);
    return { x: r.left + p[0], y: r.top + p[1] };
  })()`);
  const before = await evaluate("JSON.stringify({pan:state.view.pan,yaw:state.view.yaw,pitch:state.view.pitch})");
  await evaluate(`(() => {
    const c = document.getElementById('sceneCanvas');
    c.setPointerCapture = () => {};
    c.releasePointerCapture = () => {};
    const fire = (type, x, y, buttons) => c.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, composed: true, button: 1, buttons,
      clientX: x, clientY: y, pointerId: 2, pointerType: 'mouse', isPrimary: true
    }));
    fire('pointerdown', ${coords.x}, ${coords.y}, 4);
    fire('pointermove', ${coords.x + 40}, ${coords.y + 20}, 4);
    fire('pointerup', ${coords.x + 40}, ${coords.y + 20}, 0);
  })()`);
  await sleep(500);
  console.log('orbit before:', before);
  console.log('orbit after:', await evaluate("JSON.stringify({pan:state.view.pan,yaw:state.view.yaw,pitch:state.view.pitch,target:[SITE_W/2+(state.view.pan||[0,0,0])[0],SITE_D/2+(state.view.pan||[0,0,0])[1],1.6+(state.view.pan||[0,0,0])[2]]})"));
  socket.close();
  process.exit(0);
}

main().catch((error) => { console.error('FAILED', error.stack || error.message); process.exitCode = 1; });
