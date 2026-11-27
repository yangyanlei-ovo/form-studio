const fs = require('node:fs');

const PORT = Number(process.env.CDP_PORT || 9243);
const OUT = process.env.SHOT || `${process.env.TEMP}\\form-floor-dialog.png`;
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
  await sleep(2400);
  await evaluate("document.querySelector('[data-lib=\"structure\"]').click()");
  await sleep(400);
  console.log('floor card:', await evaluate("Boolean(document.getElementById('floorSettingsCard'))"));
  await evaluate("document.getElementById('floorSettingsCard').click()");
  await sleep(300);
  console.log('dialog:', await evaluate("JSON.stringify({open:document.getElementById('floorDialog').open,w:document.getElementById('floorWidth').value,d:document.getElementById('floorDepth').value,t:document.getElementById('floorThickness').value,c:document.getElementById('floorColor').value,m:document.getElementById('floorMaterial').value})"));
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
  console.log('screenshot', OUT, fs.statSync(OUT).size);

  await evaluate(`(()=>{document.getElementById('floorWidth').value='8';document.getElementById('floorDepth').value='7';document.getElementById('floorThickness').value='150';document.getElementById('floorColor').value='#b8b4a8';document.getElementById('floorMaterial').value='暖灰哑光瓷砖';document.getElementById('floorApply').click();})()`);
  await sleep(800);
  console.log('applied:', await evaluate("JSON.stringify({site:state.site,w:SITE_W,d:SITE_D,floor:(()=>{const f=state.objects.find(o=>o.type==='floor');return {c:f.c,sz:f.sz,z:f.z,material:f.material}})(),dialog:document.getElementById('floorDialog').open})"));

  await evaluate("document.getElementById('floorSettingsCard').click()");
  await sleep(300);
  await evaluate("document.getElementById('floorPrompt').value='浅橡木直纹地板，温暖哑光，厚150mm';document.getElementById('floorGenerate').click()");
  await sleep(5000);
  console.log('agent:', await evaluate("JSON.stringify({status:document.getElementById('floorAgentStatus').innerText,color:document.getElementById('floorColor').value,material:document.getElementById('floorMaterial').value,thickness:document.getElementById('floorThickness').value})"));
  await evaluate("document.getElementById('floorApply').click()");
  await sleep(600);
  console.log('agent applied:', await evaluate("JSON.stringify((()=>{const f=state.objects.find(o=>o.type==='floor');return {c:f.c,sz:f.sz,z:f.z,material:f.material}})())"));

  // SketchUp-style pivot orbit: the clicked 3D point should stay at the same screen position.
  const orbit = await evaluate(`(() => {
    const c = document.getElementById('sceneCanvas'), r = c.getBoundingClientRect();
    const P = projector(c.clientWidth, c.clientHeight, state.view);
    const screen = P.project([2.5, 5, 1]);
    const x = r.left + screen[0], y = r.top + screen[1];
    const pivot = orbitPivotAt(screen[0], screen[1]);
    const before = P.project(pivot);
    return {x, y, pivot, before, pan:state.view.pan, yaw:state.view.yaw, pitch:state.view.pitch};
  })()`);
  await evaluate(`(() => {
    const c = document.getElementById('sceneCanvas');
    c.setPointerCapture = () => {};
    c.releasePointerCapture = () => {};
    const fire = (type, x, y, buttons) => c.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, composed: true, button: 1, buttons,
      clientX: x, clientY: y, pointerId: 3, pointerType: 'mouse', isPrimary: true
    }));
    fire('pointerdown', ${orbit.x}, ${orbit.y}, 4);
    fire('pointermove', ${orbit.x + 70}, ${orbit.y + 35}, 4);
    fire('pointerup', ${orbit.x + 70}, ${orbit.y + 35}, 0);
  })()`);
  await sleep(500);
  console.log('orbit:', JSON.stringify({before: orbit.before, after: await evaluate(`(()=>{const c=document.getElementById('sceneCanvas');const P=projector(c.clientWidth,c.clientHeight,state.view);return {screen:P.project(${JSON.stringify(orbit.pivot)}),pan:state.view.pan,yaw:state.view.yaw,pitch:state.view.pitch}})()`)}, null, 2));
  socket.close();
  process.exit(0);
}

main().catch((error) => { console.error('FAILED', error.stack || error.message); process.exitCode = 1; });
