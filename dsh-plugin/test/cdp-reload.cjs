const PORT = Number(process.env.CDP_PORT || 9237);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function main() {
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const target = targets.find((entry) => entry.type === 'page' && entry.url.includes('/form/'));
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
  await send('Page.reload', { ignoreCache: true });
  await sleep(2500);
  console.log(await evaluate("JSON.stringify({objects:state.objects.length,windows:state.objects.filter(o=>o.type==='window').length,openingBlocks:state.objects.filter(o=>o.openings&&o.openings.length).length,blockParts:components(state.objects.find(o=>o.type==='block'&&o.x===0&&o.y===3)).length,site:state.site})"));
  socket.close();
  process.exit(0);
}
main().catch((error) => { console.error('FAILED', error.stack || error.message); process.exitCode = 1; });
