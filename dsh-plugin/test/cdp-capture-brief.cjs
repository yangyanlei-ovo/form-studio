const fs = require('node:fs');
const PORT = Number(process.env.CDP_PORT || 9244);
async function main() {
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const target = targets.find((entry) => entry.type === 'page' && entry.url.includes('/form/'));
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map(); let nextId = 1;
  socket.addEventListener('message', (event) => { const message = JSON.parse(event.data); if (message.id && pending.has(message.id)) { const entry = pending.get(message.id); pending.delete(message.id); message.error ? entry.reject(new Error(JSON.stringify(message.error))) : entry.resolve(message.result); } });
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  const send = (method, params = {}) => new Promise((resolve, reject) => { const id = nextId++; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expression) => { const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text); return result.result?.value; };
  await send('Runtime.enable');
  await evaluate("(()=>{window.__lastBody=null;const original=window.fetch;window.fetch=function(...args){try{if(args[1]&&args[1].body)window.__lastBody=args[1].body;}catch(e){}return original.apply(this,args);};document.getElementById('previewPrompt').click();})()");
  await new Promise((r) => setTimeout(r, 1500));
  const body = await evaluate('window.__lastBody');
  if (!body) { console.log('no body'); process.exit(1); }
  const data = JSON.parse(body);
  const lines = String(data.sceneBrief || '').split('\n');
  const structural = lines.filter((line) => /^\d{2}\|(block|wall|floor|window)\|/.test(line));
  const seven = lines.filter((line) => line.split('|').length === 7);
  console.log(JSON.stringify({ promptLength: data.prompt.length, briefLength: data.sceneBrief.length, lines: lines.length, structural: structural.length, seven: seven.length, sample: structural[0], head: data.sceneBrief.slice(0, 300) }, null, 2));
  fs.writeFileSync(`${process.env.TEMP}\\form-scene-brief.txt`, data.sceneBrief, 'utf8');
  socket.close(); process.exit(0);
}
main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
