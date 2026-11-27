const PORT = Number(process.env.CDP_PORT || 9232);
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
  await sleep(2000);
  await evaluate("document.querySelector('#renderTab').click()");
  await sleep(600);
  await evaluate("(()=>{const n=document.getElementById('negativePrompt');n.value='不要吊灯';n.dispatchEvent(new Event('input'));document.getElementById('allowPeople').checked=true;document.getElementById('allowPeople').dispatchEvent(new Event('change'));})()");
  await sleep(300);
  console.log('cam1 fields:', await evaluate("JSON.stringify(state.cameras.find(c=>c.id==='cam-1')&&{n:state.cameras.find(c=>c.id==='cam-1').negativePrompt,p:state.cameras.find(c=>c.id==='cam-1').allowPeople})"));
  await evaluate("(()=>{const s=document.getElementById('cameraSelect');s.value='cam-2';s.dispatchEvent(new Event('change'));})()");
  await sleep(500);
  console.log('cam2 negative:', await evaluate("document.getElementById('negativePrompt').value"));
  console.log('cam2 allow:', await evaluate("document.getElementById('allowPeople').checked"));
  await evaluate("(()=>{const n=document.getElementById('negativePrompt');n.value='不要人物';n.dispatchEvent(new Event('input'));})()");
  await sleep(300);
  await evaluate("(()=>{const s=document.getElementById('cameraSelect');s.value='cam-1';s.dispatchEvent(new Event('change'));})()");
  await sleep(500);
  console.log('back cam1 negative:', await evaluate("document.getElementById('negativePrompt').value"));
  console.log('back cam1 allow:', await evaluate("document.getElementById('allowPeople').checked"));
  socket.close();
}
main().catch((error) => { console.error('FAILED', error.stack || error.message); process.exitCode = 1; });
