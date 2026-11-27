'use strict';
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const canvas=$('#sceneCanvas'), ctx=canvas.getContext('2d');
const COLORS=['#e8e5da','#c9b69a','#89977d','#a8b4b5','#bc8e79','#5c6b60'];
const COLOR_NAMES=['奶油白','浅橡木','鼠尾草绿','雾蓝灰','赤陶色','森林绿'];
const TYPES=[{id:'block',name:'基础方块',group:'structure'},{id:'wall',name:'墙体模块',group:'structure'},{id:'window',name:'窗框',group:'structure'},{id:'sofa',name:'模块沙发',group:'furniture'},{id:'table',name:'茶几',group:'furniture'},{id:'plant',name:'绿植',group:'furniture'}];
const PRESETS=[{name:'暖木极简',icon:'sun',text:'暖木色极简客厅，浅橡木家具，米白色亚麻沙发，柔和的奶油色墙面。午后自然光从窗户洒入，真实的材质纹理，宁静而温暖的居住氛围。建筑室内摄影，细腻光影。'},{name:'自然侘寂',icon:'spark',text:'自然侘寂风格，手工灰泥墙面，原木家具，天然亚麻与粗陶细节，温暖的中性色，柔和漫射日光，安静克制的室内建筑摄影。'},{name:'积木世界',icon:'cube',text:'将空间表现为精致的积木模型，保留方块造型与模块拼接感，哑光塑料材质，柔和工作室照明，微缩模型摄影，干净温暖的色彩。'}];
const DEFAULT_VIEW={yaw:-.83,pitch:.62,zoom:1,projection:'ortho'};
let state={objects:[],cameras:[{id:'cam-1',name:'客厅主视角',view:{yaw:-1.03,pitch:.27,zoom:1.15,projection:'perspective'},anchor:[10,1,1]},{id:'cam-2',name:'窗边一角',view:{yaw:-.55,pitch:.42,zoom:1.05,projection:'perspective'},anchor:[11,7,1]}],view:{...DEFAULT_VIEW},revision:1,presets:[],history:{},site:{width:7,depth:6},pinnedResult:null};
let SITE_W=14,SITE_D=12;
function syncSiteFromState(){
  const floor=(state.objects||[]).find(o=>o.type==='floor');
  let width=Number(state.site?.width),depth=Number(state.site?.depth);
  if(!(width>0))width=floor?floor.sx/2:7;
  if(!(depth>0))depth=floor?floor.sy/2:6;
  width=Math.max(2,Math.min(30,Math.round(width*2)/2));
  depth=Math.max(2,Math.min(30,Math.round(depth*2)/2));
  state.site={width,depth};
  SITE_W=Math.round(width*2);
  SITE_D=Math.round(depth*2);
}
function syncFloorToSite(){
  let floor=(state.objects||[]).find(o=>o.type==='floor');
  if(!floor){floor=makeObj('floor',0,0,-.28,'#d5c9b4',SITE_W,SITE_D,.28);state.objects.push(floor);}
  floor.x=0;
  floor.y=0;
  floor.sx=SITE_W;
  floor.sy=SITE_D;
}
let mode='orbit',type='block',color=COLORS[0],grid=true,currentCamera='cam-1',capture=false,adjusting=false,hover=null,faces=[],undoStack=[],planImage=null,planData=null,planAlpha=.45,busy=false,activeHistory=0;
const clone=x=>JSON.parse(JSON.stringify(x));
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,7);
function makeObj(t,x,y,z,c,sx=1,sy=1,sz=1){return {id:uid(),type:t,x,y,z,c,sx,sy,sz};}
function initialScene(){let a=[];a.push(makeObj('floor',0,0,-.28,'#d5c9b4',SITE_W,SITE_D,.28));
 for(let y=0;y<12;y++)a.push(makeObj('block',0,y,0,'#e9e8df',.35,1,5.6));
 for(let x=0;x<14;x++){a.push(makeObj('block',x,11.65,0,'#e7e5db',1,.35,1.8));a.push(makeObj('block',x,11.65,4.8,'#e7e5db',1,.35,.8));if(x<4||x>=10)a.push(makeObj('block',x,11.65,1.8,'#e7e5db',1,.35,3));}
 a.push(makeObj('window',4,11.58,1.8,'#d5dfd7',6,.15,3));
 a.push(makeObj('rug',3,2,.03,'#e7e2d5',7.2,6.6,.035));
 a.push(makeObj('sofa',.9,3.2,0,'#d2d2ba',2.6,6.2,1.7));
 a.push(makeObj('table',5,4.5,0,'#bd9f78',3.6,2.5,1.1));
 a.push(makeObj('sofa',9.8,6,0,'#86937b',2,2.6,1.7));
 a.push(makeObj('plant',11.2,9.5,0,'#7f9275',1.3,1.3,3.7));
 a.push(makeObj('cabinet',.7,9.8,0,'#bdab8d',2.2,1.1,1.8));return a;}
state.objects=initialScene();
try{const raw=JSON.parse(localStorage.getItem('form-studio-v1'));if(raw&&Array.isArray(raw.objects)&&raw.objects.length&&Array.isArray(raw.cameras)&&raw.cameras.length){state={...state,...raw};state.presets=state.presets||[];state.history=state.history||{};currentCamera=state.cameras[0].id;}const p=localStorage.getItem('form-plan-v1');if(p)loadPlan(p,false);}catch(e){console.info('Using initial scene',e);}syncSiteFromState();syncFloorToSite();stripDemoHistory();
function save(){try{localStorage.setItem('form-studio-v1',JSON.stringify(state));$('#saveStatus').innerHTML='<i></i> 已在本地保存';}catch(e){$('#saveStatus').textContent='存储空间不足 · 请导出项目';}}
function checkpoint(){undoStack.push(clone(state));if(undoStack.length>40)undoStack.shift();}
function changed(){state.revision++;save();refresh();}
function toast(s){$('#toast').textContent=s;$('#toast').classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').classList.remove('show'),2800);}
function shade(c,n){let rgb=c.replace('#','').match(/../g).map(x=>parseInt(x,16));return '#'+rgb.map(x=>Math.max(0,Math.min(255,Math.round(x*n))).toString(16).padStart(2,'0')).join('');}
const add=(a,b)=>a.map((v,i)=>v+b[i]),sub=(a,b)=>a.map((v,i)=>v-b[i]),mul=(a,b)=>a.map(v=>v*b),dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),norm=a=>mul(a,1/Math.hypot(...a)),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
function projector(w,h,view,mini=false){const target=add([SITE_W/2,SITE_D/2,1.6],view.pan||[0,0,0]),distance=view.projection==='perspective'?24/(view.zoom||1):1000,eye=add(target,[Math.cos(view.yaw)*Math.cos(view.pitch)*distance,Math.sin(view.yaw)*Math.cos(view.pitch)*distance,Math.sin(view.pitch)*distance]);const forward=norm(sub(target,eye)),right=norm(cross(forward,[0,0,1])),up=cross(right,forward),scale=Math.min(w/25,h/20)*(view.zoom||1);const center=[w*.5,h*(mini?.53:.45)],focal=Math.min(w,h)*1.22;return {eye,forward,right,up,perspective:view.projection==='perspective',project(p){let q=sub(p,eye),depth=dot(q,forward),factor=view.projection==='perspective'?focal/Math.max(.4,depth):scale;return [center[0]+dot(q,right)*factor,center[1]-dot(q,up)*factor,depth];}};}
function components(o){const {x,y,z,c,sx,sy,sz}=o;const b=(dx,dy,dz,w,d,h,col=c)=>({x:x+dx,y:y+dy,z:z+dz,sx:w,sy:d,sz:h,c:col,id:o.id,type:o.type});
 if(o.type==='sofa'){let a=[b(0,0,.25,sx,sy,.55,shade(c,.92)),b(0,0,.8,.4,sy,.9,c),b(0,0,.65,sx,.35,.65,c),b(0,sy-.35,.65,sx,.35,.65,c)];let n=Math.max(1,Math.floor(sy/1.7));for(let i=0;i<n;i++){a.push(b(.45,.4+i*(sy-.8)/n,.8,sx-.5,(sy-.8)/n-.07,.35,shade(c,1.06)));a.push(b(.4,.45+i*(sy-.8)/n,1.1,.33,(sy-.8)/n-.16,.65,shade(c,1.02)));}a.push(b(.8,.7,1.12,.7,.65,.23,'#b9ac8d'));return a;}
 if(o.type==='table')return [b(0,0,.85,sx,sy,.25),b(.2,.2,0,.25,.25,.85,shade(c,.9)),b(sx-.45,.2,0,.25,.25,.85,shade(c,.9)),b(.2,sy-.45,0,.25,.25,.85,shade(c,.9)),b(sx-.45,sy-.45,0,.25,.25,.85,shade(c,.9)),b(.45,.6,1.1,.85,.7,.09,'#f0ede1'),b(.5,.65,1.19,.72,.55,.07,'#7a8978'),b(2,1,1.1,.5,.5,.23,'#b6a58e')];
 if(o.type==='plant')return [b(.2,.2,0,.9,.9,.9,'#b4aa94'),b(.58,.58,.9,.18,.18,2.1,'#8f8062'),b(.2,.1,1.8,1.2,1.2,.9,c),b(-.2,.4,2.4,1.1,1.1,.7,shade(c,1.08)),b(.65,.15,2.65,.9,.9,.8,shade(c,.94)),b(.3,.5,3.15,.7,.7,.65,shade(c,1.1))];
 if(o.type==='window')return [b(0,0,0,sx,.13,sz,'#cfddd9'),b(0,-.1,0,.12,.32,sz,'#d9d5c6'),b(sx-.12,-.1,0,.12,.32,sz,'#d9d5c6'),b(sx/2-.06,-.12,0,.12,.35,sz,'#c7c5b7'),b(0,-.12,0,sx,.35,.13,'#d8d4c4'),b(0,-.12,sz-.13,sx,.35,.13,'#dedacd')];
 if(o.type==='cabinet')return [b(0,0,.1,sx,sy,sz-.1),b(.07,-.04,.2,sx-.14,.05,sz-.4,shade(c,1.08)),b(.4,.3,sz,.3,.3,.55,'#eee8dc')];
 return [o];}
function boxFaces(b,P){let {x,y,z,sx:w,sy:d,sz:h}=b;let a=[[[x,y,z],[x+w,y,z],[x+w,y,z+h],[x,y,z+h]],[ [x+w,y,z],[x+w,y+d,z],[x+w,y+d,z+h],[x+w,y,z+h] ],[[x+w,y+d,z],[x,y+d,z],[x,y+d,z+h],[x+w,y+d,z+h]],[[x,y+d,z],[x,y,z],[x,y,z+h],[x,y+d,z+h]],[[x,y,z+h],[x+w,y,z+h],[x+w,y+d,z+h],[x,y+d,z+h]]];const ns=[[0,-1,0],[1,0,0],[0,1,0],[-1,0,0],[0,0,1]],sh=[.89,.79,.92,.95,1.04];return a.flatMap((p,i)=>{let mid=mul(p.reduce((a,b)=>add(a,b),[0,0,0]),.25);if(dot(ns[i],sub(P.eye,mid))<=0)return [];let pts=p.map(P.project);if(pts.some(p=>p[2]<.2))return [];return [{pts,world:p,normal:ns[i],depth:pts.reduce((s,p)=>s+p[2],0)/4,c:shade(b.c,sh[i]),id:b.id,box:b}];});}
function poly(context,points,fill,stroke){context.beginPath();points.forEach((p,i)=>i?context.lineTo(p[0],p[1]):context.moveTo(p[0],p[1]));context.closePath();if(fill){context.fillStyle=fill;context.fill();}if(stroke){context.strokeStyle=stroke;context.lineWidth=.6;context.stroke();}}
function fitCanvas(c){let r=c.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,2),w=r.width||300,h=r.height||160;if(c.width!==Math.round(w*dpr)||c.height!==Math.round(h*dpr)){c.width=Math.round(w*dpr);c.height=Math.round(h*dpr);}const context=c.getContext('2d');context.setTransform(dpr,0,0,dpr,0,0);return {context,w,h};}
function drawOverlapHighlight(){}
function render(c,view,mini=false,objects=state.objects,background=false){const {context:g,w,h}=fitCanvas(c);g.clearRect(0,0,w,h);if(background){g.fillStyle='#edf1e9';g.fillRect(0,0,w,h);}let P=projector(w,h,view,mini);if(!mini&&grid){g.lineWidth=.65;g.strokeStyle='#dbe2d8';const gridMax=Math.max(SITE_W,SITE_D)+8;for(let i=-7;i<=gridMax;i++){const a=P.project([i,-7,-.3]),b=P.project([i,gridMax,-.3]),d=P.project([-7,i,-.3]),e=P.project([gridMax,i,-.3]);g.beginPath();g.moveTo(a[0],a[1]);g.lineTo(b[0],b[1]);g.moveTo(d[0],d[1]);g.lineTo(e[0],e[1]);g.stroke();}}
 // A soft projected contact shadow under the physical model.
 g.save();g.filter='blur(15px)';poly(g,[[.5,-.2,-.32],[SITE_W+.5,-.2,-.32],[SITE_W+.5,SITE_D+.5,-.32],[.5,SITE_D+.5,-.32]].map(P.project),'#65745c22');g.restore();
 let fs=objects.flatMap(o=>components(o).flatMap(b=>boxFaces(b,P))).sort((a,b)=>{const layer=f=>f.box.type==='floor'?0:f.box.type==='rug'?1:2;return layer(a)-layer(b)||b.depth-a.depth;});drawDepthFaces(g,fs,P,w,h);
 if(c===canvas){faces=fs;if(hover&&mode!=='orbit'&&!capture){if(mode==='delete'&&hover.id){for(let f of fs.filter(f=>f.id===hover.id))poly(g,f.pts,'#c77b6744','#b07363');}else if(mode==='build'&&hover.position){let ob=placement(hover.position);g.save();g.globalAlpha=.48;for(let f of components(ob).flatMap(b=>boxFaces(b,P)).sort((a,b)=>b.depth-a.depth))poly(g,f.pts,f.c,'#4e7754');g.restore();}}updateMarkers(P);}
 return P;}
function drawPlan(g,P){let p0=P.project([0,0,.015]),p1=P.project([SITE_W,0,.015]),p2=P.project([0,SITE_D,.015]);g.save();g.globalAlpha=planAlpha;g.transform((p1[0]-p0[0])/planImage.width,(p1[1]-p0[1])/planImage.width,(p2[0]-p0[0])/planImage.height,(p2[1]-p0[1])/planImage.height,p0[0],p0[1]);g.drawImage(planImage,0,0);g.restore();}
function updateMarkers(P){let occupied=[];state.cameras.forEach((cam,i)=>{let el=document.getElementById('mark-'+cam.id);if(!el)return;let p=P.project(cam.anchor);let labelY=p[1]-22;while(occupied.some(q=>Math.abs(q[0]-p[0])<125&&Math.abs(q[1]-labelY)<38))labelY-=40;occupied.push([p[0],labelY]);el.style.left=p[0]+'px';el.style.top=labelY+'px';el.hidden=capture||p[2]<0;});}
function draw(){if(!$('#editor').hidden)render(canvas,state.view);else{let cam=state.cameras.find(c=>c.id===currentCamera);if(cam){render($('#previewCanvas'),cam.view,true);if(!$('#compareCanvas').hidden)render($('#compareCanvas'),cam.view,true,state.objects,true);}}}
function inside(p,vs){let yes=false;for(let i=0,j=vs.length-1;i<vs.length;j=i++){let a=vs[i],b=vs[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;}
function rayAt(sx,sy){let r=canvas.getBoundingClientRect(),P=projector(r.width,r.height,state.view),v=state.view,center=[r.width*.5,r.height*.45];if(v.projection==='perspective'){let focal=Math.min(r.width,r.height)*1.22;return {origin:P.eye,dir:norm(add(P.forward,add(mul(P.right,(sx-center[0])/focal),mul(P.up,-(sy-center[1])/focal))))};}let scale=Math.min(r.width/25,r.height/20)*v.zoom;return {origin:add(P.eye,add(mul(P.right,(sx-center[0])/scale),mul(P.up,-(sy-center[1])/scale))),dir:P.forward};}
function hitAt(x,y){let ray=rayAt(x,y),closest=null,nearest=Infinity;for(let f of faces){if(!inside([x,y],f.pts))continue;let den=dot(ray.dir,f.normal);if(Math.abs(den)<1e-6)continue;let t=dot(sub(f.world[0],ray.origin),f.normal)/den;if(t<0||t>=nearest)continue;nearest=t;closest=f;}if(closest){let pos=add(add(ray.origin,mul(ray.dir,nearest)),mul(closest.normal,.02));return {id:closest.id,position:pos.map((v,i)=>i===2?Math.max(0,Math.floor(v)):Math.floor(v))};}let t=-ray.origin[2]/ray.dir[2];if(Number.isFinite(t)&&t>0){let p=add(ray.origin,mul(ray.dir,t));return {position:[Math.floor(p[0]),Math.floor(p[1]),0]};}return null;}
function placement(p){let dims={block:[+$('#dimX').value||1,+$('#dimY').value||1,+$('#dimZ').value||1],wall:[1,.35,5.6],window:[3,.25,2.5],sofa:[2.6,4.5,1.7],table:[3.6,2.5,1.1],plant:[1.3,1.3,3.7]}[type];return makeObj(type,...p,color,...dims.map(v=>Math.min(8,Math.max(.1,v))));}
function setMode(m){mode=m;hover=null;['Orbit','Build','Delete'].forEach(n=>$('#tool'+n).classList.toggle('active',n.toLowerCase()===m));$('#canvasHint').textContent={orbit:'中键旋转 · Shift+左键平移 · 滚轮/＋－缩放 · 点击机位出图',build:'左键放置 · Shift+左键平移 · 中键旋转 · 滚轮/＋－缩放',delete:'点击删除整个构件 · Ctrl+Z 撤销'}[m];canvas.style.cursor=m==='orbit'?'grab':m==='build'?'crosshair':'not-allowed';draw();}
function undo(){if(!undoStack.length){toast('没有可撤销的操作');return;}state=undoStack.pop();currentCamera=state.cameras.some(c=>c.id===currentCamera)?currentCamera:state.cameras[0].id;syncSiteFromState();syncFloorToSite();save();refresh();toast('已撤销上一步');}
function library(filter='all'){$('#libraryGrid').replaceChildren();for(let t of TYPES.filter(t=>filter==='all'||t.group===filter)){let b=document.createElement('button');b.className='block-card'+(type===t.id?' selected':'');b.dataset.type=t.id;let cv=document.createElement('canvas'),label=document.createElement('span');label.textContent=t.name;b.append(cv,label);b.onclick=()=>{type=t.id;setMode('build');$$('.block-card').forEach(x=>x.classList.toggle('selected',x.dataset.type===type));};$('#libraryGrid').append(b);requestAnimationFrame(()=>{let dims={block:[2,2,2],wall:[.5,3,3],window:[3,.25,2.5],sofa:[2.6,4.5,1.7],table:[3.6,2.5,1.1],plant:[1.3,1.3,3.7]}[t.id];let o=makeObj(t.id,6,5,0,t.id==='plant'?'#87987e':t.id==='table'?'#c2ac8e':'#cfcebc',...dims);render(cv,{yaw:-.8,pitch:.55,zoom:3,projection:'ortho'},true,[o]);});}}
function cameraUI(){$('#cameraList').replaceChildren();$('#markers').replaceChildren();$('#cameraSelect').replaceChildren();state.cameras.forEach((c,i)=>{let card=document.createElement('div');card.className='camera-card';card.tabIndex=0;card.setAttribute('role','button');card.setAttribute('aria-label','进入机位 '+c.name);let cv=document.createElement('canvas');let number=document.createElement('span');number.className='camera-number';number.textContent=String(i+1).padStart(2,'0');let bottom=document.createElement('div');bottom.className='camera-card-bottom';let name=document.createElement('strong');name.style.fontWeight='500';name.textContent=c.name;let end=document.createElement('span');end.textContent='进入出图 ↗';bottom.append(name,end);card.append(cv,number,bottom);card.onclick=()=>openRender(c.id);card.onkeydown=e=>{if(e.key==='Enter')openRender(c.id);};$('#cameraList').append(card);requestAnimationFrame(()=>render(cv,c.view,true));let marker=document.createElement('button');marker.className='marker';marker.id='mark-'+c.id;let nb=document.createElement('b');nb.textContent=String(i+1).padStart(2,'0');let txt=document.createElement('span');txt.textContent=c.name;marker.append(nb,txt);marker.onclick=()=>openRender(c.id);$('#markers').append(marker);let option=document.createElement('option');option.value=c.id;option.textContent=String(i+1).padStart(2,'0')+' · '+c.name;$('#cameraSelect').append(option);});$('#cameraCount').textContent=String(state.cameras.length).padStart(2,'0');}
function refresh(){cameraUI();$('#objectCount').textContent=state.objects.length+' 个构件';$('#undo').disabled=!undoStack.length;draw();}
function showScene(){if(busy){toast('演示生成正在进行，请稍候');return;}$('#editor').hidden=false;$('#renderPage').hidden=true;$('#sceneTab').classList.add('active');$('#renderTab').classList.remove('active');requestAnimationFrame(()=>{refresh();});}
function openRender(id){if(capture||busy)return;currentCamera=id;let cam=state.cameras.find(c=>c.id===id);if(!cam)return;$('#editor').hidden=true;$('#renderPage').hidden=false;$('#sceneTab').classList.remove('active');$('#renderTab').classList.add('active');$('#renderTitle').textContent=String(state.cameras.indexOf(cam)+1).padStart(2,'0')+' · '+cam.name;$('#cameraSelect').value=id;$('#sceneVersion').textContent='V.'+String(state.revision).padStart(2,'0');$('#prompt').value=cam.prompt||PRESETS[0].text;$('#keepLayout').checked=cam.keepLayout!==false;$('#compareCanvas').hidden=true;$('#compare').textContent='◫ 对比底图';updateChars();presetsUI();activeHistory=Math.max(0,getHistory().length-1);historyUI();requestAnimationFrame(draw);window.scrollTo(0,0);}
let preCapture=null;
function startCapture(edit=false){if(state.cameras.length>=10&&!edit){toast('预览版最多保存 10 个机位');return;}if(!$('#renderPage').hidden)showScene();preCapture=clone(state.view);capture=true;adjusting=edit;state.view=edit?clone(state.cameras.find(c=>c.id===currentCamera).view):{...state.view,projection:'perspective'};$('#cameraCapture').hidden=false;$('#canvasMode').textContent='透视取景';$('.scene-caption').hidden=true;$('#canvasHint').textContent='中键旋转 · H＋中键平移 · 滚轮缩放 · 保存机位';draw();}
function endCapture(){capture=false;$('#cameraCapture').hidden=true;$('#canvasMode').textContent='轴侧总览';$('.scene-caption').hidden=false;state.view=preCapture||{...DEFAULT_VIEW};setMode('orbit');refresh();save();}
async function askName(title,value){let d=$('#nameDialog');$('#nameDialogTitle').textContent=title;$('#nameInput').value=value;d.returnValue='cancel';d.showModal();$('#nameInput').focus();$('#nameInput').select();return new Promise(resolve=>d.addEventListener('close',()=>resolve(d.returnValue==='save'?$('#nameInput').value.trim():null),{once:true}));}
function presetsUI(){$('#presets').replaceChildren();[...PRESETS,...state.presets].forEach(p=>{let b=document.createElement('button');b.className='preset'+($('#prompt').value===p.text?' active':'');let sp=document.createElement('span');sp.textContent=p.name;b.append(sp);b.onclick=()=>{$('#prompt').value=p.text;updatePrompt();presetsUI();};$('#presets').append(b);});}
function updateChars(){$('#charCount').textContent=$('#prompt').value.length+' 字';}
function updatePrompt(){let cam=state.cameras.find(c=>c.id===currentCamera);if(cam){cam.prompt=$('#prompt').value;cam.keepLayout=$('#keepLayout').checked;save();}updateChars();}
function stripDemoHistory(){
  if(!state.history||typeof state.history!=='object')state.history={};
  Object.values(state.history).forEach(list=>{
    if(!Array.isArray(list))return;
    for(let i=list.length-1;i>=0;i--){if(list[i]?.id==='example'||list[i]?.time==='预生成示例')list.splice(i,1);}
  });
}
function getHistory(){
  if(!state.history[currentCamera])state.history[currentCamera]=[];
  return state.history[currentCamera];
}
function selectHistory(i){
  const hist=getHistory();
  const name=$('#resultName'),meta=$('#resultMeta'),image=$('#resultImage'),wrap=$('#resultWrap');
  if(!hist.length){
    activeHistory=0;
    if(name)name.textContent='暂无出图';
    if(meta)meta.textContent='生成后会出现在这里';
    if(image){image.removeAttribute('src');image.alt='当前机位尚无效果图';}
    if(wrap&&!wrap.querySelector('.form-result-overlay')){
      const overlay=document.createElement('div');overlay.className='form-result-overlay';
      overlay.textContent='此机位还没有出图。输入风格后生成。';wrap.append(overlay);
    }
    $$('.history-item').forEach(b=>b.classList.remove('active'));
    return;
  }
  i=Math.max(0,Math.min(Number(i)||0,hist.length-1));
  activeHistory=i;const item=hist[i];
  if(name)name.textContent=item.name||'Seedream 出图';
  if(meta)meta.textContent=`${item.time||''} · 场景 V.${item.revision||1}${item.imageUrl?'':' · 示例图片'}`;
  if(item.imageUrl&&wrap)wrap.querySelector('.form-result-overlay')?.remove();
  if(item.prompt!=null){$('#prompt').value=item.prompt;$('#keepLayout').checked=item.keepLayout!==false;updateChars();presetsUI();}
  $$('.history-item').forEach((b,j)=>b.classList.toggle('active',i===j));
}
async function deleteHistory(index){
  const hist=getHistory(),item=hist[index];if(!item)return;
  if(!confirm('删除这张效果图？删除后不可恢复。'))return;
  hist.splice(index,1);
  if(index<activeHistory)activeHistory--;
  if(activeHistory>=hist.length)activeHistory=Math.max(0,hist.length-1);
  if(state.pinnedResult?.historyId===item.id)state.pinnedResult=null;
  save();historyUI();
  try{if(item.id)await fetch('/form/api/render/'+encodeURIComponent(item.id),{method:'DELETE'});}catch(e){}
  toast('已删除');
}
function historyUI(){
  const hist=getHistory(),container=$('#history');container.replaceChildren();
  hist.forEach((item,i)=>{
    const entry=document.createElement('div');entry.className='history-entry';
    const b=document.createElement('button');b.type='button';b.className='history-item';
    const img=document.createElement('img');img.src=item.imageUrl||'assets/living-room.png';img.alt=item.name||'效果图';
    const n=document.createElement('b');n.textContent=String(i+1).padStart(2,'0');
    const title=document.createElement('span');title.textContent=item.time||'出图';
    b.append(img,n,title);b.onclick=()=>selectHistory(i);
    const del=document.createElement('button');del.type='button';del.className='history-delete';del.textContent='×';
    del.title='删除这张效果图';del.setAttribute('aria-label','删除这张效果图');
    del.onclick=event=>{event.stopPropagation();deleteHistory(i);};
    entry.append(b,del);container.append(entry);
  });
  $('#historyCount').textContent=String(hist.length).padStart(2,'0');
  if(!hist.length){const empty=document.createElement('p');empty.className='history-empty';empty.textContent='暂无出图，生成后自动记录。';container.append(empty);selectHistory(0);return;}
  if(activeHistory>=hist.length)activeHistory=hist.length-1;
  selectHistory(activeHistory);
}
async function demoGenerate(){if(busy)return;if(!$('#prompt').value.trim()){toast('先写下你想要的空间氛围');return;}updatePrompt();const id=currentCamera,cam=state.cameras.find(c=>c.id===id),snapshot={id:uid(),name:'空间灵感 · '+String(getHistory().length+1).padStart(2,'0'),prompt:$('#prompt').value,keepLayout:$('#keepLayout').checked,revision:state.revision,view:clone(cam.view),time:new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}),resolution:$('#resolution').value};busy=true;$('#generate').disabled=true;$('#cameraSelect').disabled=true;$('#generating').hidden=false;$('#compareCanvas').hidden=true;$('#compare').textContent='◫ 对比底图';await new Promise(r=>setTimeout(r,1800));state.history[id].push(snapshot);busy=false;$('#generate').disabled=false;$('#cameraSelect').disabled=false;$('#generating').hidden=true;save();historyUI();toast('演示完成：已记录参数，展示预生成示例（未调用 API）');}
function downloadBlob(data,name){let url=URL.createObjectURL(data),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function loadPlan(data,persist=true){let img=new Image();img.onload=()=>{planImage=img;planData=data;$('#planControls').hidden=false;if(persist){try{localStorage.setItem('form-plan-v1',data);}catch(e){toast('底图较大，仅在本次会话显示');}draw();}};img.onerror=()=>toast('图片读取失败，请选择 PNG 或 JPG');img.src=data;}
$('#planFile').onchange=e=>{const file=e.target.files[0];if(!file)return;if(file.size>8*1024*1024){toast('预览版请使用小于 8MB 的底图');return;}let reader=new FileReader();reader.onload=()=>{loadPlan(reader.result);toast('底图已铺设到地面，按场景范围缩放（未自动识图）');};reader.readAsDataURL(file);};
$('#importPlan').onclick=()=>$('#planFile').click();$('#planOpacity').oninput=e=>{planAlpha=e.target.value/100;draw();};$('#removePlan').onclick=()=>{planImage=null;planData=null;try{localStorage.removeItem('form-plan-v1');}catch(e){}$('#planControls').hidden=true;$('#planFile').value='';draw();};
$('#toolOrbit').onclick=()=>setMode('orbit');$('#toolBuild').onclick=()=>setMode('build');$('#toolDelete').onclick=()=>setMode('delete');$('#undo').onclick=undo;$('#toggleGrid').onclick=()=>{grid=!grid;$('#toggleGrid').classList.toggle('active',grid);draw();};$('#resetView').onclick=()=>{state.view={...DEFAULT_VIEW,projection:capture?'perspective':'ortho'};draw();save();};
$('#isoView').onclick=()=>{state.view={...DEFAULT_VIEW,projection:capture?'perspective':'ortho'};$('#isoView').classList.add('active');$('#topView').classList.remove('active');draw();};$('#topView').onclick=()=>{state.view={yaw:-Math.PI/2,pitch:1.5,zoom:1,projection:capture?'perspective':'ortho'};$('#topView').classList.add('active');$('#isoView').classList.remove('active');draw();};
$('#addCamera').onclick=()=>startCapture();$('#cancelCamera').onclick=endCapture;$('#confirmCamera').onclick=async()=>{if(adjusting){checkpoint();state.cameras.find(c=>c.id===currentCamera).view=clone(state.view);endCapture();openRender(currentCamera);toast('机位已更新');return;}let name=await askName('保存新机位','空间视角 '+String(state.cameras.length+1).padStart(2,'0'));if(!name)return;checkpoint();let yaw=state.view.yaw;let c={id:'cam-'+uid(),name,view:clone(state.view),anchor:[Math.max(1,Math.min(SITE_W-1,SITE_W/2+SITE_W*.42*Math.cos(yaw))),Math.max(1,Math.min(SITE_D-1,SITE_D/2+SITE_D*.42*Math.sin(yaw))),1]};state.cameras.push(c);endCapture();toast('机位已保存，点击画布标记进入出图');};
$('#sceneTab').onclick=showScene;$('#renderTab').onclick=()=>openRender(currentCamera);$('#backScene').onclick=showScene;$('#startRender').onclick=()=>openRender(currentCamera);$('#brand').onclick=e=>{e.preventDefault();showScene();};$('#cameraSelect').onchange=e=>openRender(e.target.value);$('#adjustCamera').onclick=()=>startCapture(true);$('#prompt').oninput=()=>{updatePrompt();presetsUI();};$('#keepLayout').onchange=updatePrompt;$('#generate').onclick=demoGenerate;
$('#savePreset').onclick=async()=>{if(!$('#prompt').value.trim()){toast('请输入提示词');return;}let name=await askName('保存提示词预设','我的空间风格');if(name){state.presets.push({name,text:$('#prompt').value});save();presetsUI();toast('预设已保存，可在其他机位复用');}};
$('#compare').onclick=()=>{if(busy)return;$('#compareCanvas').hidden=!$('#compareCanvas').hidden;$('#compare').textContent=$('#compareCanvas').hidden?'◫ 对比底图':'◫ 返回效果图';draw();};$('#fullscreen').onclick=()=>$('#imageDialog').showModal();$('#closeImage').onclick=()=>$('#imageDialog').close();$('#downloadImage').onclick=()=>{let a=document.createElement('a');a.href='assets/living-room.png';a.download='FORM-空间效果示例.png';a.click();};$('#exportProject').onclick=()=>downloadBlob(new Blob([JSON.stringify({...state,planImage:planData,notice:'HTML interaction prototype. Generated results are pre-generated examples, not Seedream API responses.'},null,2)],{type:'application/json'}),'FORM-林间客厅.json');
$$('[data-lib]').forEach(b=>b.onclick=()=>{$$('[data-lib]').forEach(x=>x.classList.toggle('active',x===b));library(b.dataset.lib);});
COLORS.forEach((c,i)=>{let b=document.createElement('button');b.className='swatch'+(!i?' selected':'');b.style.background=c;b.title=COLOR_NAMES[i];b.setAttribute('aria-label',COLOR_NAMES[i]);b.onclick=()=>{color=c;$('#colorName').textContent=COLOR_NAMES[i];$$('.swatch').forEach(x=>x.classList.toggle('selected',x===b));draw();};$('#swatches').append(b);});
new ResizeObserver(()=>{draw();$$('.camera-card canvas').forEach((cv,i)=>{if(state.cameras[i])render(cv,state.cameras[i].view,true);});}).observe(document.body);
library();refresh();presetsUI();save();

