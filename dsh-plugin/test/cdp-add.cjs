const PORT = Number(process.env.CDP_PORT || 9223);

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
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'evaluate failed');
    }
    return result.result?.value;
  };

  console.log('before custom:', await evaluate('state.customComponents?.length || 0'));
  console.log('button:', await evaluate("document.querySelector('.agent-window .add-generated')?.textContent || 'missing'"));
  await evaluate("document.querySelector('.agent-window .add-generated').click()");
  await sleep(500);
  console.log('after custom:', await evaluate('state.customComponents?.length || 0'));
  console.log('localStorage bytes:', await evaluate("localStorage.getItem('form-studio-v1')?.length || 0"));
  console.log('library cards:', await evaluate("document.querySelectorAll('#libraryGrid .block-card').length"));
  console.log('button2:', await evaluate("document.querySelector('.agent-window .add-generated')?.textContent || 'missing'"));
  await evaluate("document.querySelector('.agent-window .add-generated').click()");
  await sleep(300);
  console.log('pendingCustom:', await evaluate('pendingCustom?.name || null'));
  console.log('type:', await evaluate('type'));
  socket.close();
}

main().catch((error) => {
  console.error('FAILED', error.stack || error.message);
  process.exitCode = 1;
});
