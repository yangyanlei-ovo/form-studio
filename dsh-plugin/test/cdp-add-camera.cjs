const PORT = Number(process.env.CDP_PORT || 9229);
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

  await send('Page.navigate', { url: 'http://127.0.0.1:52482/form/' });
  await sleep(1800);
  console.log('cameras before:', await evaluate('state.cameras.length'));
  await evaluate("document.querySelector('#addCamera').click()");
  await sleep(300);
  console.log('capture:', await evaluate('capture'));
  console.log('capture bar hidden:', await evaluate("document.getElementById('cameraCapture').hidden"));
  console.log('canvas mode:', await evaluate("document.getElementById('canvasMode').innerText"));
  await evaluate("document.querySelector('#cancelCamera').click()");
  await sleep(300);
  console.log('capture after cancel:', await evaluate('capture'));
  console.log('cameras after cancel:', await evaluate('state.cameras.length'));
  socket.close();
}

main().catch((error) => {
  console.error('FAILED', error.stack || error.message);
  process.exitCode = 1;
});
