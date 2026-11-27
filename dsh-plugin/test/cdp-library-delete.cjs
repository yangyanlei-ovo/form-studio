const fs = require('node:fs');

const PORT = Number(process.env.CDP_PORT || 9230);
const OUT = process.env.SHOT || `${process.env.TEMP}\\form-library-delete.png`;
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
  await sleep(1800);
  await evaluate('window.confirm = () => true');
  const make = (id, name) => `({id:${JSON.stringify(id)},name:${JSON.stringify(name)},type:'custom',x:0,y:0,z:0,sx:2,sy:1,sz:1,c:'#89977d',parts:[{x:0,y:0,z:0,sx:2,sy:1,sz:1,c:'#89977d'}],source:'dsh-form-agent'})`;
  await evaluate(`state.customComponents=[${make('custom-test-1', '测试组件一')},${make('custom-test-2', '测试组件二')}]; save(); library('all')`);
  await sleep(400);
  console.log('customs:', await evaluate('state.customComponents.length'));
  console.log('cards:', await evaluate("document.querySelectorAll('#libraryGrid .block-card').length"));
  console.log('delete buttons:', await evaluate("document.querySelectorAll('#libraryGrid .library-delete').length"));
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
  console.log('screenshot', OUT, fs.statSync(OUT).size);

  await evaluate("document.querySelector('#libraryGrid .library-delete').click()");
  await sleep(400);
  console.log('after delete:', await evaluate('state.customComponents.length'));
  console.log('cards after:', await evaluate("document.querySelectorAll('#libraryGrid .block-card').length"));
  console.log('toast:', await evaluate("document.getElementById('toast').innerText"));

  await evaluate(`state.customComponents=[${make('custom-test-3', '测试组件三')}]; save(); library('all')`);
  await sleep(300);
  await evaluate("document.querySelector('#libraryGrid .library-delete').click()");
  await sleep(300);
  console.log('after last delete:', await evaluate('state.customComponents.length'));
  console.log('cards after last:', await evaluate("document.querySelectorAll('#libraryGrid .block-card').length"));
  socket.close();
}

main().catch((error) => {
  console.error('FAILED', error.stack || error.message);
  process.exitCode = 1;
});
