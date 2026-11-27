const PORT = Number(process.env.CDP_PORT || 9230);
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
  await evaluate('window.confirm = () => true');
  await evaluate(`state.customComponents=[{id:'custom-pending',name:'待放置组件',type:'custom',x:0,y:0,z:0,sx:2,sy:1,sz:1,c:'#89977d',parts:[{x:0,y:0,z:0,sx:2,sy:1,sz:1,c:'#89977d'}]}]; save(); library('all')`);
  await sleep(300);
  await evaluate("document.querySelector('#libraryGrid .block-card[data-type=\"custom-pending\"]').click()");
  await sleep(300);
  console.log('pending before:', await evaluate('pendingCustom?.name || null'));
  console.log('mode before:', await evaluate('mode'));
  await evaluate("document.querySelector('#libraryGrid .library-delete').click()");
  await sleep(400);
  console.log('pending after:', await evaluate('pendingCustom?.name || null'));
  console.log('mode after:', await evaluate('mode'));
  console.log('customs after:', await evaluate('state.customComponents.length'));
  socket.close();
}

main().catch((error) => {
  console.error('FAILED', error.stack || error.message);
  process.exitCode = 1;
});
