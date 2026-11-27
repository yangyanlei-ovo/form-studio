const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const core=fs.readFileSync(__dirname+'/app.js','utf8'),v2=fs.readFileSync(__dirname+'/editor-v2.js','utf8');
const chunk=(src,start,end)=>src.slice(src.indexOf(start),src.indexOf(end,src.indexOf(start)));
const sandbox={};vm.createContext(sandbox);
vm.runInContext(`const add=(a,b)=>a.map((v,i)=>v+b[i]),sub=(a,b)=>a.map((v,i)=>v-b[i]),mul=(a,b)=>a.map(v=>v*b),dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),norm=a=>mul(a,1/Math.hypot(...a)),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];const limit=(x,a,b)=>Math.max(a,Math.min(b,x));const uid=()=>"test";let SITE_W=14,SITE_D=12;`+chunk(core,'function shade(c,n)','const add=')+chunk(core,'function projector(','function components(')+chunk(v2,'function snapRotationAngle(','const baseComponents=')+chunk(v2,'function simulatedComponent(','async function sendAgent('),sandbox);
let shelf=sandbox.simulatedComponent('浅木色书架，宽1800 深400 高2000 mm','furniture');assert.equal(shelf.sx,3.6);assert.equal(shelf.sy,.8);assert.equal(shelf.sz,4);assert.equal(shelf.parts.length,14);
let sofa=sandbox.simulatedComponent('绿色沙发，宽2.4米 深90cm 高850mm','furniture');assert.equal(sofa.sx,4.8);assert.equal(sofa.sy,1.8);assert.equal(sofa.c,'#89977d');assert.equal(sandbox.simulatedComponent('生成一辆跑车','furniture'),null);
const p=sandbox.rotateVector([1,0,0],[0,0,90]);assert.ok(Math.abs(p[0])<1e-9);assert.ok(Math.abs(p[1]-1)<1e-9);
assert.equal(sandbox.snapRotationAngle(29),30);assert.equal(sandbox.snapRotationAngle(28),30);assert.equal(sandbox.snapRotationAngle(27.9),30);
assert.equal(sandbox.snapRotationAngle(-29),-30);assert.equal(sandbox.snapRotationAngle(61.9),60);assert.equal(sandbox.snapRotationAngle(34),30);
assert.equal(sandbox.snapRotationAngle(25.9),25.9);assert.equal(sandbox.snapRotationAngle(34.1),34.1);
let o={x:1,y:2,z:0,sx:2,sy:2,sz:2,rot:[0,0,90],scale:[2,1,1]};let t=sandbox.transformPoint([3,3,1],o);assert.ok(Math.abs(t[0]-2)<1e-9);assert.ok(Math.abs(t[1]-5)<1e-9);
for(const projection of ['ortho','perspective']){let w=900,h=700,v={yaw:-.8,pitch:.6,zoom:1,projection};let P=sandbox.projector(w,h,v),point=[7,6,1.6],old=P.project(point),dx=30,dy=20,s=projection==='perspective'?Math.min(w,h)*1.22/24:Math.min(w/25,h/20);v.pan=P.right.map((x,i)=>-x*dx/s+P.up[i]*dy/s);let next=sandbox.projector(w,h,v).project(point);assert.ok(Math.abs(next[0]-old[0]-dx)<1e-8);assert.ok(Math.abs(next[1]-old[1]-dy)<1e-8);}
for(const str of ['fetch(', 'XMLHttpRequest','api.deepseek.com','WebSocket('])assert.ok(!v2.includes(str),'No external integration: '+str);
for(const name of ['app.js','editor-v2.js'])new vm.Script(fs.readFileSync(__dirname+'/'+name,'utf8'));
console.log('PASS: component dimensions/units/color, unsupported descriptions, 3D rotation/scaling, same-direction pan in both projections, no external API calls, script syntax.');
