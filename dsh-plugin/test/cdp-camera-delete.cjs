const fs = require('node:fs');

const PORT = Number(process.env.CDP_PORT || 9229);
const OUT = process.env.SHOT || `${process.env.TEMP}\\form-camera-delete.png`;
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
  await sleep(2000);
  await evaluate('window.confirm = () => true');
  console.log('initial cameras:', await evaluate('state.cameras.length'));
  console.log('delete buttons:', await evaluate("document.querySelectorAll('#cameraList .camera-delete').length"));
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
  console.log('screenshot', OUT, fs.statSync(OUT).size);

  await evaluate("document.querySelector('#cameraList .camera-delete').click()");
  await sleep(500);
  console.log('after delete:', await evaluate('state.cameras.length'));
  console.log('count label:', await evaluate("document.getElementById('cameraCount').innerText"));
  console.log('markers:', await evaluate("document.querySelectorAll('#markers .marker').length"));
  console.log('select options:', await evaluate("document.querySelectorAll('#cameraSelect option').length"));

  await evaluate("document.querySelector('#cameraList .camera-delete').click()");
  await sleep(300);
  console.log('after last delete attempt:', await evaluate('state.cameras.length'));
  console.log('toast:', await evaluate("document.getElementById('toast').innerText"));

  await evaluate('undo()');
  await sleep(400);
  console.log('after undo:', await evaluate('state.cameras.length'));

  await evaluate("document.querySelector('#renderTab').click()");
  await sleep(500);
  console.log('render page camera:', await evaluate("document.getElementById('cameraSelect').value"));
  console.log('render delete button:', await evaluate("document.getElementById('formDeleteCamera')?.innerText || 'missing'"));
  await evaluate("document.getElementById('formDeleteCamera').click()");
  await sleep(500);
  console.log('after render delete:', await evaluate('state.cameras.length'));
  console.log('render title:', await evaluate("document.getElementById('renderTitle').innerText"));

  socket.close();
}

main().catch((error) => {
  console.error('FAILED', error.stack || error.message);
  process.exitCode = 1;
});
