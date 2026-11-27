const fs = require('node:fs');

const PORT = Number(process.env.CDP_PORT || 9235);
const OUT = process.env.SHOT || `${process.env.TEMP}\\form-site-resize.png`;
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
  console.log('initial:', await evaluate("JSON.stringify({site:state.site,w:SITE_W,d:SITE_D,floor:state.objects.find(o=>o.type==='floor')&&{sx:state.objects.find(o=>o.type==='floor').sx,sy:state.objects.find(o=>o.type==='floor').sy},input:[document.getElementById('siteWidth').value,document.getElementById('siteDepth').value],objects:state.objects.length})"));
  const sofaBefore = await evaluate("(()=>{const o=state.objects.find(o=>o.type==='sofa');return o?{x:o.x,y:o.y}:null})()");
  await evaluate("(()=>{const w=document.getElementById('siteWidth'),d=document.getElementById('siteDepth');w.value='10';d.value='8';w.dispatchEvent(new Event('change'));})()");
  await sleep(700);
  console.log('resized:', await evaluate("JSON.stringify({site:state.site,w:SITE_W,d:SITE_D,floor:{sx:state.objects.find(o=>o.type==='floor').sx,sy:state.objects.find(o=>o.type==='floor').sy},input:[document.getElementById('siteWidth').value,document.getElementById('siteDepth').value],sofa:(()=>{const o=state.objects.find(o=>o.type==='sofa');return o?{x:o.x,y:o.y}:null})(),camZoom:state.cameras[0].view.zoom,anchor:state.cameras[0].anchor})"));
  console.log('sofa unchanged:', JSON.stringify(sofaBefore) === JSON.stringify(await evaluate("(()=>{const o=state.objects.find(o=>o.type==='sofa');return o?{x:o.x,y:o.y}:null})()")));
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
  console.log('screenshot', OUT, fs.statSync(OUT).size);

  await evaluate('window.confirm = () => true');
  await evaluate("document.getElementById('resetProject').click()");
  await sleep(800);
  console.log('reset:', await evaluate("JSON.stringify({site:state.site,w:SITE_W,d:SITE_D,objects:state.objects.length,cameras:state.cameras.length,floor:{sx:state.objects.find(o=>o.type==='floor').sx,sy:state.objects.find(o=>o.type==='floor').sy},customs:(state.customComponents||[]).length,history:Object.keys(state.history||{}).length,presets:state.presets.length,currentCamera})"));
  console.log('toast:', await evaluate("document.getElementById('toast').innerText"));
  await evaluate('undo()');
  await sleep(600);
  console.log('undo site:', await evaluate("JSON.stringify({site:state.site,w:SITE_W,d:SITE_D,objects:state.objects.length})"));
  socket.close();
  process.exit(0);
}

main().catch((error) => {
  console.error('FAILED', error.stack || error.message);
  process.exitCode = 1;
});
