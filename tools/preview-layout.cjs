// Generate an isolated visual fixture. No business scripts, APIs or storage.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname,'..');
let html = fs.readFileSync(path.join(root,'index.html'),'utf8');
html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'');
html = html.replace('<head>','<head><base href="/form/">');
html = html.replace('林间客厅','布局校验 · 内置示例');
html = html.replace('</body>',`<script>
const page = new URLSearchParams(location.search).get('page') || 'render';
const ids = {scene:'editor',render:'renderPage',gs:'gsPage',roam:'roamPage'};
for (const [name,id] of Object.entries(ids)) document.getElementById(id).hidden = name !== page;
document.querySelectorAll('.step').forEach(e=>e.classList.toggle('active',e.id===page+'Tab'));
document.getElementById('gsSourceImage').src='assets/living-room.png';
document.getElementById('roamPoster').src='assets/living-room.png';
document.getElementById('prompt').value='暖木色极简客厅，浅橡木家具，米白色亚麻沙发。午后自然光，真实材质与细腻光影。';
document.getElementById('cameraSelect').innerHTML='<option>01 · 客厅主视角</option>';
document.getElementById('history').innerHTML='<p class="history-empty">布局校验 · 图片为内置示例，未调用生成服务</p>';
</script><script src="night-ui.js?v=1"></script></body>`);
fs.mkdirSync(path.join(root,'output','ui-qa'),{recursive:true});
fs.writeFileSync(path.join(root,'output','ui-qa','layout.html'),html);
console.log('Visual-only fixture: /output/ui-qa/layout.html?page=render|gs|roam');
