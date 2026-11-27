const fs = require('node:fs');

const PORT = Number(process.env.CDP_PORT || 9223);
const OUT = process.env.SHOT || `${process.env.TEMP}\\form-render-shot.png`;

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
      if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
      else entry.resolve(message.result);
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
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'evaluate failed');
    return result.result?.value;
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: 'http://127.0.0.1:52482/form/' });
  await sleep(1800);
  await evaluate(`document.querySelector('#renderTab').click()`);
  await sleep(800);
  await evaluate(`document.querySelector('#prompt').value = '暖木极简客厅，浅橡木家具，午后自然光从窗户洒入'; document.querySelector('#prompt').dispatchEvent(new Event('input')); document.querySelector('#generate').click()`);
  let errorText = '';
  let imageUrl = '';
  for (let i = 0; i < 30; i++) {
    await sleep(700);
    errorText = await evaluate(`document.querySelector('.form-generate-error')?.textContent || ''`);
    imageUrl = await evaluate(`document.getElementById('resultImage')?.getAttribute('src') || ''`);
    if (errorText || imageUrl.includes('/assets/generated/')) break;
  }
  console.log('error:', errorText);
  console.log('image:', imageUrl);
  console.log('history:', await evaluate(`document.querySelectorAll('#history .history-item').length`));
  console.log('overlay:', await evaluate(`document.querySelector('#resultWrap .form-result-overlay')?.innerText || ''`));
  console.log('overlay link:', await evaluate(`document.querySelector('#resultWrap .form-result-overlay a')?.href || ''`));
  console.log('status:', await evaluate(`document.getElementById('formServiceStatus')?.innerText`));
  console.log('badge:', await evaluate(`document.querySelector('.render-settings .demo-badge')?.innerText`));
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
  console.log('screenshot', OUT, fs.statSync(OUT).size);
  socket.close();
}

main().catch((error) => {
  console.error('FAILED', error.stack || error.message);
  process.exitCode = 1;
});
