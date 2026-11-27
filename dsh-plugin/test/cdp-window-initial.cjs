const PORT = Number(process.env.CDP_PORT || 9241);
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
  await send('Page.navigate', { url: 'http://127.0.0.1:52482/form/' });
  await sleep(2200);
  console.log('initial:', await evaluate("JSON.stringify(state.objects.filter(o=>o.type==='window').map(o=>({x:o.x,y:o.y,z:o.z,sx:o.sx,sz:o.sz,wallInfo:o.wallInfo&&{normal:o.wallInfo.normal,direction:o.wallInfo.direction,plane:o.wallInfo.plane,minS:o.wallInfo.minS,maxS:o.wallInfo.maxS,ids:o.wallInfo.ids.length}})))"));
  console.log('move:', await evaluate(`(() => {
    const w = state.objects.find(o => o.type === 'window');
    const prev = JSON.parse(JSON.stringify(w));
    const next = JSON.parse(JSON.stringify(w));
    next.x += 1;
    const r = resolveMotion(prev, next, 'move');
    Object.assign(w, r.object);
    refresh();
    return JSON.stringify({blocked:r.blocked,reason:r.reason,x:w.x,y:w.y,z:w.z,openings:state.objects.filter(o=>o.openings&&o.openings.some(op=>op.windowId===w.id)).length});
  })()`));
  socket.close();
  process.exit(0);
}
main().catch((error) => { console.error('FAILED', error.stack || error.message); process.exitCode = 1; });
