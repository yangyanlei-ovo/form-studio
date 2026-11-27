/**
 * Local stand-in for the Seedream endpoints used by the automated FORM tests.
 *
 * It records every request and returns a fixed PNG so the full render pipeline
 * (download, persistence, history, provider fallback) can be verified without
 * spending a real Seedream call. Never enabled by the shipped profile.
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.MOCK_ARK_PORT || 52999);
const FAIL_ARK = process.env.MOCK_ARK_FAIL === '1';
const image = fs.readFileSync(path.join(__dirname, 'mock-seedream.png'));
const imageDataUrl = `data:image/png;base64,${image.toString('base64')}`;
const requests = [];

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/image.png') {
    res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': image.length });
    res.end(image);
    return;
  }
  if (req.method === 'GET' && req.url === '/requests') {
    const body = JSON.stringify(requests, null, 2);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(body);
    return;
  }
  if (req.method === 'POST' && req.url === '/images/generations') {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      let parsed = {};
      try {
        parsed = JSON.parse(body);
      } catch {
        // keep empty
      }
      requests.push({
        at: new Date().toISOString(),
        provider: 'ark',
        model: parsed.model,
        size: parsed.size,
        prompt: parsed.prompt,
        reference: Array.isArray(parsed.image) ? parsed.image.length : 0,
        watermark: parsed.watermark,
      });
      if (FAIL_ARK) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: { code: 'InternalError', message: 'mock ark failure' } }));
        return;
      }
      const payload = JSON.stringify({
        model: parsed.model || 'doubao-seedream-4-0-250828',
        created: Math.floor(Date.now() / 1000),
        data: [{ url: `http://127.0.0.1:${PORT}/image.png` }],
      });
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(payload);
    });
    return;
  }
  if (req.method === 'POST' && req.url === '/chat/completions') {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      let parsed = {};
      try {
        parsed = JSON.parse(body);
      } catch {
        // keep empty
      }
      requests.push({
        at: new Date().toISOString(),
        provider: 'openrouter',
        model: parsed.model,
        prompt: parsed.messages?.[0]?.content?.[0]?.text,
        reference: Array.isArray(parsed.messages?.[0]?.content)
          ? parsed.messages[0].content.filter((part) => part.type === 'image_url').length
          : 0,
      });
      const payload = JSON.stringify({
        model: parsed.model || 'bytedance-seed/seedream-4.5',
        choices: [
          {
            message: {
              content: 'ok',
              images: [{ image_url: { url: imageDataUrl } }],
            },
          },
        ],
      });
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(payload);
    });
    return;
  }
  res.writeHead(404);
  res.end('not found');
});

server.listen(PORT, '127.0.0.1', () => console.log(`mock seedream on http://127.0.0.1:${PORT}`));
