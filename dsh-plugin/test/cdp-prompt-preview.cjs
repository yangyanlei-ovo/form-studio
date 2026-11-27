const fs = require('node:fs');

const PORT = Number(process.env.CDP_PORT || 9231);
const OUT = process.env.SHOT || `${process.env.TEMP}\\form-prompt-preview.png`;
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
  await evaluate("document.querySelector('#renderTab').click()");
  await sleep(700);
  await evaluate("document.getElementById('negativePrompt').value='不要吊灯'; document.getElementById('negativePrompt').dispatchEvent(new Event('input')); document.getElementById('allowPeople').checked=false;");
  console.log('chips:', await evaluate("document.querySelectorAll('#builtinNegative .negative-chip').length"));
  console.log('builtin chars:', await evaluate("document.getElementById('builtinRules').innerText.length"));
  await evaluate("document.getElementById('previewPrompt').click()");
  await sleep(1200);
  const prompt = await evaluate("document.getElementById('finalPromptPreview').innerText");
  console.log('final length:', prompt.length);
  console.log('object lines:', (prompt.match(/^\d{2}\|/gm) || []).length);
  console.log('has reference rule:', prompt.includes('layout/color reference only'));
  console.log('has avoid:', prompt.includes('AVOID:'));
  console.log('has user:', prompt.includes('暖木色极简') || prompt.includes('暖木极简'));
  console.log('has negative extra:', prompt.includes('不要吊灯'));
  console.log('head:', prompt.slice(0, 500));
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
  console.log('screenshot', OUT, fs.statSync(OUT).size);
  socket.close();
}

main().catch((error) => {
  console.error('FAILED', error.stack || error.message);
  process.exitCode = 1;
});
