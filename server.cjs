// Local UI preview only; production API remains served by the DSH plugin.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = __dirname;
const types = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml'};
http.createServer((req,res) => {
  let relative;
  try { relative = decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\/form(?=\/|$)/,''); }
  catch { res.writeHead(400); return res.end(); }
  if (relative === '/' || relative === '') relative = '/index.html';
  const file = path.resolve(root, '.' + relative);
  if (!file.startsWith(root + path.sep) || !types[path.extname(file)] || relative.includes('/design-backup/') || relative.includes('/dsh-plugin/')) {res.writeHead(404);return res.end();}
  fs.readFile(file,(error,data) => {
    if(error){res.writeHead(404);return res.end('Not found');}
    res.writeHead(200,{'Content-Type':types[path.extname(file)],'Cache-Control':'no-store'});res.end(data);
  });
}).listen(4173,'127.0.0.1',()=>console.log('FORM UI preview: http://127.0.0.1:4173/form/ (no generation API)'));
