const fs = require('node:fs');

const PORT = Number(process.env.CDP_PORT || 9223);
const OUT = process.env.SHOT || `${process.env.TEMP}\\form-agent-shot.png`;
const PROMPT = process.env.PROMPT || '生成一个绿色三人沙发，宽2400 深900 高850 mm';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const target = targets.find((entry) => entry.type === 'page' && entry.url.includes('/form/'));
  if (!target) throw new Error('FORM page target not found');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  let nextId = 1;
  const events = [];
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else resolve(message.result);
      return;
    }
    if (message.method === 'Runtime.exceptionThrown' || message.method === 'Runtime.consoleAPICalled') {
      events.push(message);
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
  await sleep(500);
  const health = await evaluate(`fetch('/form/api/health').then(r=>r.json())`);
  console.log('health', JSON.stringify(health));
  await evaluate(`document.querySelector('.agent-launch').click()`);
  await sleep(300);
  await evaluate(`document.getElementById('agentInput').value = ${JSON.stringify(PROMPT)}; document.getElementById('agentSend').click()`);
  let reply = '';
  for (let i = 0; i < 90; i++) {
    await sleep(1000);
    reply = await evaluate(`(() => {
      const nodes = [...document.querySelectorAll('#agentMessages .chat-message.assistant')];
      const last = nodes[nodes.length - 1];
      return last ? last.innerText : '';
    })()`);
    if (reply && !reply.includes('正在调用 DSH Agent')) break;
  }
  console.log('reply:', reply.slice(0, 1200));
  const errors = events
    .filter((event) => event.method === 'Runtime.exceptionThrown')
    .map((event) => event.params.exceptionDetails?.text || event.params.exceptionDetails?.exception?.description || 'exception');
  console.log('page exceptions:', errors.length, errors.slice(0, 5));
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
  console.log('screenshot', OUT, fs.statSync(OUT).size);
  socket.close();
}

main().catch((error) => {
  console.error('FAILED', error.stack || error.message);
  process.exitCode = 1;
});
