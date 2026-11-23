import React,{useEffect,useRef,useState} from 'react';
import * as THREE from 'three';
import {motion,AnimatePresence} from 'motion/react';
import {Plus,X,Settings2,Trash2,Check,Play,Crosshair} from 'lucide-react';

export const BASE_AIS=[{id:'codex',name:'Codex',kind:'codex'},{id:'claude',name:'Claude Code',kind:'claude'},{id:'local',name:'Локальная модель',kind:'local'}];
export const KINDS={codex:{label:'Codex',color:'#8fd6c2',glyph:'◎'},claude:{label:'Claude Code',color:'#d9774a',glyph:'✳'},local:{label:'Локальная модель',color:'#7f93b8',glyph:'●'},custom:{label:'Своя модель (URL)',color:'#b48ce0',glyph:'◆'}};
const PALETTE=['#b48ce0','#e0b45c','#5cb8e0','#e06c8c','#7fe07a','#e0e0e0'];
const GLYPHS=['◆','★','▲','✦','⬢','☾'];
const RADII=[3.1,4.3,5.5,6.7,7.9];
export const colorOf=a=>a.color||(KINDS[a.kind]||KINDS.custom).color;

// --- звук (WebAudio, без файлов) ---
let audio;
function sound(type){
 try{audio??=new AudioContext();const t=audio.currentTime,o=audio.createOscillator(),g=audio.createGain();o.connect(g);g.connect(audio.destination);
  const f={launch:[220,880,.6],click:[660,520,.12],remove:[500,140,.4],drop:[400,620,.2]}[type]||[440,440,.1];
  o.type=type==='launch'?'sawtooth':'sine';o.frequency.setValueAtTime(f[0],t);o.frequency.exponentialRampToValueAtTime(f[1],t+f[2]);
  g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(type==='launch'?.05:.08,t+.02);g.gain.exponentialRampToValueAtTime(.0001,t+f[2]);o.start(t);o.stop(t+f[2]+.05);
 }catch{}
}

function noiseTexture(hex,seed){
 const c=document.createElement('canvas');c.width=256;c.height=128;const g=c.getContext('2d');
 const base=new THREE.Color(hex);g.fillStyle='#'+base.getHexString();g.fillRect(0,0,256,128);
 let s=seed*9301+49297;const rnd=()=>((s=(s*9301+49297)%233280)/233280);
 for(let i=0;i<900;i++){const y=rnd()*128,w=20+rnd()*90,h=1+rnd()*5,l=(rnd()-.5)*.35;
  const col=base.clone().offsetHSL(0,0,l);g.fillStyle=`rgba(${col.r*255|0},${col.g*255|0},${col.b*255|0},.35)`;g.fillRect(rnd()*256,y,w,h);}
 const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;return t;
}
function glowTexture(inner,outer){
 const c=document.createElement('canvas');c.width=c.height=128;const g=c.getContext('2d');
 const r=g.createRadialGradient(64,64,0,64,64,64);r.addColorStop(0,inner);r.addColorStop(.25,outer);r.addColorStop(1,'rgba(0,0,0,0)');
 g.fillStyle=r;g.fillRect(0,0,128,128);return new THREE.CanvasTexture(c);
}
const WHITE_GLOW=()=>glowTexture('rgba(255,255,255,1)','rgba(255,255,255,.35)');
const starShader=()=>({uniforms:{time:{value:0},boost:{value:0}},
 vertexShader:'varying vec3 vP;varying vec3 vN;void main(){vP=position;vN=normalize(normalMatrix*normal);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
 fragmentShader:`uniform float time;uniform float boost;varying vec3 vP;varying vec3 vN;
 float h(vec3 p){return fract(sin(dot(p,vec3(12.9898,78.233,37.719)))*43758.5453);}
 float n(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(mix(h(i),h(i+vec3(1,0,0)),f.x),mix(h(i+vec3(0,1,0)),h(i+vec3(1,1,0)),f.x),f.y),mix(mix(h(i+vec3(0,0,1)),h(i+vec3(1,0,1)),f.x),mix(h(i+vec3(0,1,1)),h(i+vec3(1,1,1)),f.x),f.y),f.z);}
 float fbm(vec3 p){float v=0.,a=.5;for(int i=0;i<5;i++){v+=a*n(p);p*=2.1;a*=.5;}return v;}
 void main(){float sp=1.+boost*2.;vec3 p=vP*2.2+vec3(0.,time*.15*sp,time*.08*sp);float f=fbm(p+fbm(p+time*.1*sp));
  float veins=pow(1.-abs(f*2.-1.),6.);float rim=pow(1.-max(dot(vN,vec3(0,0,1)),0.),2.);
  vec3 col=mix(vec3(.05,.32,.25),vec3(.35,.85,.65),f*f)+veins*vec3(.55,.9,.75)*(1.+boost)+rim*vec3(.25,.8,.55);
  gl_FragColor=vec4(col,1.);}`});

/** 3D-система ИИ. mini — компактный режим без управления (для рабочей сессии). */
export function Orbits({ais,statuses={},spin=true,motionOn=true,soundOn=false,tokens={},activity=null,mini=false,onAdd,onRemove,onCheck,onReorder,onUse,currentAgent}){
 const mount=useRef(null),labels=useRef({}),api=useRef({}),[selected,setSelected]=useState(null),[adding,setAdding]=useState(false),[focused,setFocused]=useState(null);
 const live=useRef({});live.current={ais,statuses,tokens,activity,spin:spin&&motionOn,soundOn,onReorder,focused};
 const play=t=>{if(soundOn&&!mini)sound(t);};

 useEffect(()=>{
  const el=mount.current,renderer=new THREE.WebGLRenderer({antialias:!mini,alpha:true,powerPreference:mini?'low-power':'default'});
  renderer.setPixelRatio(Math.min(devicePixelRatio,mini?1.25:2));el.appendChild(renderer.domElement);
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(40,1,.1,200);
  scene.add(new THREE.AmbientLight(0x334455,1.2));scene.add(new THREE.PointLight(0xaaffdd,60,0,1.6));
  const sp=new Float32Array((mini?400:1500)*3);for(let i=0;i<sp.length;i++)sp[i]=(Math.random()-.5)*120;
  const sg=new THREE.BufferGeometry();sg.setAttribute('position',new THREE.BufferAttribute(sp,3));
  scene.add(new THREE.Points(sg,new THREE.PointsMaterial({color:0x9fb7c9,size:.12,transparent:true,opacity:.7})));
  const system=new THREE.Group();scene.add(system);
  const shader=starShader();
  const star=new THREE.Mesh(new THREE.SphereGeometry(1.5,64,64),new THREE.ShaderMaterial(shader));star.userData.id='__core';system.add(star);
  const halo=new THREE.Sprite(new THREE.SpriteMaterial({map:glowTexture('rgba(170,255,215,.9)','rgba(60,200,150,.35)'),blending:THREE.AdditiveBlending,depthWrite:false}));
  halo.scale.set(6,6,1);system.add(halo);
  const orbitGroup=new THREE.Group();system.add(orbitGroup);const planets=new Map(),comets=[];
  const glowMap=WHITE_GLOW();
  function makeRing(r){
   const pts=new THREE.EllipseCurve(0,0,1,1).getPoints(160).map(p=>new THREE.Vector3(p.x,0,p.y));
   const line=new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts),new THREE.LineBasicMaterial({color:0x6fd8b0,transparent:true,opacity:.22}));
   const spark=new THREE.Sprite(new THREE.SpriteMaterial({map:glowTexture('rgba(220,255,240,1)','rgba(90,230,170,.5)'),blending:THREE.AdditiveBlending,depthWrite:false}));
   spark.scale.set(.5,.5,1);const g=new THREE.Group();g.add(line,spark);g.userData={line,spark,phase:Math.random()*6.28};return g;
  }
  function radius(i){return RADII[i%RADII.length]+Math.floor(i/RADII.length)*.6;}
  function sync(){
   const list=live.current.ais,ids=new Set(list.map(a=>a.id));
   for(const [id,p] of planets)if(!ids.has(id)){p.dying=performance.now();}
   list.forEach((a,i)=>{
    let p=planets.get(a.id);const col=colorOf(a);
    if(p&&p.color!==col){orbitGroup.remove(p.mesh,p.ring,p.glow);planets.delete(a.id);p=null;}
    if(!p){
     const mesh=new THREE.Mesh(new THREE.SphereGeometry(.42,40,40),new THREE.MeshStandardMaterial({map:noiseTexture(col,a.id.length*7+i),roughness:.8,emissive:new THREE.Color(col),emissiveIntensity:.08}));
     mesh.userData.id=a.id;mesh.scale.setScalar(.001);
     const glow=new THREE.Sprite(new THREE.SpriteMaterial({map:glowMap,color:new THREE.Color(col),blending:THREE.AdditiveBlending,depthWrite:false,transparent:true,opacity:0}));
     p={mesh,glow,color:col,ring:makeRing(),angle:Math.random()*6.28,r:radius(i),born:performance.now()};orbitGroup.add(p.ring,mesh,glow);planets.set(a.id,p);}
    p.target=radius(i);p.dying=null;
   });
  }
  api.current.sync=sync;sync();

  // --- камера и управление ---
  let yaw=0,tilt=mini?.95:.42,vy=0,vt=0,dist=mini?13:12.5,drag=null,moved=0,grab=null;
  const look=new THREE.Vector3(),lookGoal=new THREE.Vector3(),plane=new THREE.Plane(new THREE.Vector3(0,1,0),0),hitPoint=new THREE.Vector3();
  let distGoal=dist;
  const ray=new THREE.Raycaster(),ndc=new THREE.Vector2();
  const pick=e=>{const b=el.getBoundingClientRect();ndc.set((e.clientX-b.left)/b.width*2-1,-(e.clientY-b.top)/b.height*2+1);ray.setFromCamera(ndc,camera);
   return ray.intersectObjects([...planets.values()].filter(p=>!p.dying).map(p=>p.mesh))[0]?.object.userData.id;};
  const down=e=>{if(mini)return;moved=0;const id=pick(e);el.setPointerCapture(e.pointerId);
   if(id&&e.button===0){grab={id,x:e.clientX,y:e.clientY,active:false};}else drag={x:e.clientX,y:e.clientY};};
  const move=e=>{
   if(grab){if(!grab.active&&Math.hypot(e.clientX-grab.x,e.clientY-grab.y)>6){grab.active=true;el.classList.add('grabbing-planet');}
    if(grab.active){pick(e);if(!ray.ray.intersectPlane(plane,hitPoint))return;const p=planets.get(grab.id);
     p.r=Math.min(9,Math.max(2.4,Math.hypot(hitPoint.x,hitPoint.z)));p.angle=Math.atan2(hitPoint.z,hitPoint.x);}return;}
   if(!drag)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;moved+=Math.abs(dx)+Math.abs(dy);
   vy=dx*.005;vt=dy*.004;yaw+=vy;tilt=Math.min(1.3,Math.max(.05,tilt+vt));drag={x:e.clientX,y:e.clientY};};
  const up=e=>{
   if(grab){el.classList.remove('grabbing-planet');
    if(grab.active){const list=live.current.ais,p=planets.get(grab.id);
     const order=list.map(a=>a.id).filter(id=>id!==grab.id);let idx=order.findIndex((id,i)=>p.r<radius(i));if(idx<0)idx=order.length;order.splice(idx,0,grab.id);
     live.current.onReorder?.(order);api.current.play?.('drop');}
    else{setSelected(grab.id);api.current.play?.('click');}
    grab=null;return;}
   if(drag&&moved<5){const id=pick(e);setSelected(id||null);if(!id)setFocused(null);}drag=null;};
  api.current.grab=(id,e)=>{if(mini||e.button!==0)return;grab={id,x:e.clientX,y:e.clientY,active:false};el.setPointerCapture(e.pointerId);};
  const dbl=e=>{if(mini)return;const id=pick(e);if(id){setFocused(id);setSelected(id);api.current.play?.('click');}else setFocused(null);};
  const wheel=e=>{if(mini)return;e.preventDefault();distGoal=Math.min(28,Math.max(5,distGoal+e.deltaY*.01));};
  const key=e=>{if(e.key==='Escape'){setFocused(null);setSelected(null);}};
  el.addEventListener('pointerdown',down);el.addEventListener('pointermove',move);el.addEventListener('pointerup',up);el.addEventListener('dblclick',dbl);el.addEventListener('wheel',wheel,{passive:false});window.addEventListener('keydown',key);
  api.current.unfocus=()=>{distGoal=mini?13:12.5;};
  const resize=()=>{const {clientWidth:w,clientHeight:h}=el;if(!w||!h)return;renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();};
  const ro=new ResizeObserver(resize);ro.observe(el);resize();

  // --- пауза, когда не видно (п.10) ---
  let visible=true,onScreen=true,raf=0;
  const io=new IntersectionObserver(([en])=>{onScreen=en.isIntersecting;wake();});io.observe(el);
  const vis=()=>{visible=document.visibilityState==='visible';wake();};document.addEventListener('visibilitychange',vis);
  function wake(){if(visible&&onScreen&&!raf){last=performance.now();raf=requestAnimationFrame(tick);}}

  let last=performance.now(),nextComet=0;const v=new THREE.Vector3(),tmp=new THREE.Vector3();
  const tick=now=>{
   if(!visible||!onScreen){raf=0;return;}
   const dt=Math.min(.05,(now-last)/1000);last=now;const L=live.current,on=L.spin;
   if(!drag){yaw+=vy;vy*=.94;vt*=.9;if(on&&!L.focused)yaw+=dt*.03;}
   // фокус камеры (п.7)
   const fp=L.focused&&planets.get(L.focused);
   if(fp){lookGoal.copy(fp.mesh.position);if(distGoal>6.5&&!fp.zoomed){distGoal=5.5;fp.zoomed=true;}}else{lookGoal.set(0,0,0);for(const p of planets.values())if(p.zoomed){p.zoomed=false;distGoal=mini?13:12.5;}}
   look.lerp(lookGoal,1-Math.pow(.02,dt));dist+=(distGoal-dist)*(1-Math.pow(.03,dt));
   camera.position.set(look.x+Math.sin(yaw)*Math.cos(tilt)*dist,look.y+Math.sin(tilt)*dist,look.z+Math.cos(yaw)*Math.cos(tilt)*dist);camera.lookAt(look);
   const act=L.activity,coreBusy=act==='__core';
   shader.uniforms.time.value=now/1000;shader.uniforms.boost.value+=((coreBusy||act?.length?1:0)-shader.uniforms.boost.value)*dt*2;
   star.rotation.y+=dt*.05;halo.material.opacity=.85+Math.sin(now/(coreBusy?250:700))*.1;halo.scale.setScalar(6+(coreBusy?Math.sin(now/250)*.5+.6:0));
   const totalTokens=Object.values(L.tokens||{}).reduce((a,b)=>a+b,0);
   const b=el.getBoundingClientRect();
   for(const [id,p] of planets){
    // плавный переход на целевую орбиту
    if(!(grab?.active&&grab.id===id))p.r+=(p.target-p.r)*(1-Math.pow(.05,dt));
    if(on&&!(grab?.active&&grab.id===id))p.angle+=dt*.18/Math.sqrt(p.r);
    const connected=id in L.statuses?!!L.statuses[id]:true,busy=act===id;
    // размер по токенам (п.5)
    const share=totalTokens?(L.tokens[id]||0)/totalTokens:0,size=.85+share*.9;
    let s;if(p.dying){const k=(now-p.dying)/500;s=Math.max(0,1-k)*size;if(k>=1){orbitGroup.remove(p.ring,p.mesh,p.glow);planets.delete(id);continue;}}
    else{const age=(now-p.born)/900;s=(age>=1?1:1-Math.pow(1-age,3)*Math.cos(age*8))*size;}
    const pulse=busy?1+Math.sin(now/140)*.12:1;
    p.mesh.scale.setScalar(Math.max(.001,s*pulse));p.mesh.position.set(Math.cos(p.angle)*p.r,0,Math.sin(p.angle)*p.r);p.mesh.rotation.y+=dt*.4;
    // статус (п.2): отключённые тусклые и мигают красным
    p.mesh.material.emissiveIntensity=connected?(busy?.5+Math.sin(now/140)*.3:.1):.02;
    p.mesh.material.color.setScalar(connected?1:.45);
    p.glow.position.copy(p.mesh.position);
    if(!connected){p.glow.material.color.set('#ff5a5a');p.glow.material.opacity=.25+.25*Math.sin(now/300);p.glow.scale.setScalar(1.6*s);}
    else{p.glow.material.color.set(p.color);p.glow.material.opacity=busy?.9:.25;p.glow.scale.setScalar((busy?2.6:1.5)*s*pulse);}
    const u=p.ring.userData;u.line.scale.setScalar(p.r);u.line.material.opacity=grab?.active&&grab.id===id?.6:busy?.5:.22;
    if(on)u.phase+=dt*.25;u.spark.position.set(Math.cos(u.phase)*p.r,0,Math.sin(u.phase)*p.r);
    const lab=labels.current[id];if(lab){v.copy(p.mesh.position).project(camera);lab.style.transform=`translate(${(v.x+1)/2*b.width}px,${(1-v.y)/2*b.height}px)`;lab.style.zIndex=Math.round((1-v.z)*1e4);
     const starScreen=tmp.set(0,0,0).project(camera),hide=p.mesh.position.distanceTo(camera.position)>camera.position.distanceTo(star.position)&&Math.hypot((v.x-starScreen.x)*b.width/2,(v.y-starScreen.y)*b.height/2)<b.height*.16*12.5/dist;
     lab.style.filter=hide?'opacity(.12)':'';}
   }
   // поток задач (п.4): кометы от звезды к активной планете
   const target=act&&act!=='__core'&&planets.get(act);
   if(target&&now>nextComet){nextComet=now+550;
    const c=new THREE.Sprite(new THREE.SpriteMaterial({map:glowMap,color:new THREE.Color(target.color),blending:THREE.AdditiveBlending,depthWrite:false,transparent:true}));
    c.scale.setScalar(.45);c.userData={t:0,to:act};system.add(c);comets.push(c);}
   for(let i=comets.length-1;i>=0;i--){const c=comets[i],p=planets.get(c.userData.to);c.userData.t+=dt/.9;
    if(!p||c.userData.t>=1){system.remove(c);c.material.dispose();comets.splice(i,1);continue;}
    const t=c.userData.t,e=t*t*(3-2*t);c.position.set(p.mesh.position.x*e,Math.sin(t*Math.PI)*.8,p.mesh.position.z*e);c.material.opacity=1-t*.6;}
   const cl=labels.current.__core;if(cl){v.set(0,-1.9,0).project(camera);cl.style.transform=`translate(${(v.x+1)/2*b.width}px,${(1-v.y)/2*b.height}px)`;}
   renderer.render(scene,camera);raf=requestAnimationFrame(tick);};
  raf=requestAnimationFrame(tick);
  return()=>{cancelAnimationFrame(raf);raf=-1;visible=false;ro.disconnect();io.disconnect();document.removeEventListener('visibilitychange',vis);window.removeEventListener('keydown',key);el.removeEventListener('wheel',wheel);renderer.dispose();el.removeChild(renderer.domElement);};
 },[mini]);
 useEffect(()=>{api.current.sync?.()},[ais]);
 api.current.play=play;

 const sel=ais.find(a=>a.id===selected);
 const st=id=>id in statuses?!!statuses[id]:null;
 const stateText=id=>st(id)===null?'Проверяем…':st(id)?'Подключён':'Нет связи';
 return <div className={'orbits'+(mini?' mini':'')}>
  <div ref={mount} className="orbits-canvas"/>
  <div className="orbits-labels">
   <div className="orbit-core" ref={n=>labels.current.__core=n}><strong>Inkling 2 Mini</strong>{!mini&&<small>{activity==='__core'?'Составляет план…':'Управляет процессом'}</small>}<span className={'dot '+(statuses.local?'on':'')}/>{statuses.local?'Запущена':'Остановлена'}</div>
   {ais.map((a,i)=><motion.button key={a.id} ref={n=>labels.current[a.id]=n} className={'orbit-label'+(selected===a.id?' active':'')+(activity===a.id?' working':'')+(st(a.id)===false?' offline':'')} initial={{opacity:0}} animate={{opacity:1}} transition={{delay:.4}} onPointerDown={e=>api.current.grab?.(a.id,e)} onDoubleClick={()=>{if(!mini){setFocused(a.id);setSelected(a.id);}}}>
    <span className="orbit-name">{a.name}{i===0&&!mini&&<em className="lead">ведущий</em>}</span><span className={'dot '+(st(a.id)?'on':st(a.id)===false?'off':'')}/><small>{activity===a.id?'Работает…':stateText(a.id)}</small></motion.button>)}
  </div>
  {!mini&&<>
   <motion.button className="orbit-add" aria-label="Добавить ИИ" whileHover={{scale:1.08,rotate:90}} whileTap={{scale:.92}} onClick={()=>{setAdding(true);play('click');}}><Plus size={22}/></motion.button>
   <span className="orbit-add-label">Добавить ИИ</span>
   <p className="orbits-hint">Тяни фон — вращать · тяни планету ближе к звезде — больше задач · двойной клик — приблизить · Esc — назад</p>
   <AnimatePresence>
    {focused&&<motion.button key="back" className="orbit-back" initial={{opacity:0,y:-10}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-10}} onClick={()=>{setFocused(null);}}><Crosshair size={15}/>Вся система</motion.button>}
    {sel&&<motion.div key={'panel-'+sel.id} className="orbit-panel" initial={{x:40,opacity:0}} animate={{x:0,opacity:1}} exit={{x:40,opacity:0}} transition={{type:'spring',stiffness:300,damping:28}}>
     <button className="ghost close" aria-label="Закрыть" onClick={()=>{setSelected(null);setFocused(null);}}><X size={16}/></button>
     <h3><span className="swatch" style={{background:colorOf(sel)}}>{sel.glyph||(KINDS[sel.kind]||KINDS.custom).glyph}</span>{sel.name}</h3>
     <p>{(KINDS[sel.kind]||KINDS.custom).label}{sel.url?' · '+sel.url:''}{sel.model?' · '+sel.model:''}</p>
     <p className="state"><span className={'dot '+(st(sel.id)?'on':st(sel.id)===false?'off':'')}/>{activity===sel.id?'Работает над задачей':stateText(sel.id)}</p>
     <dl><dt>Орбита</dt><dd>{ais.findIndex(a=>a.id===sel.id)+1} из {ais.length}{ais[0]?.id===sel.id?' · ведущий':''}</dd><dt>Токены</dt><dd>{new Intl.NumberFormat('ru').format(tokens[sel.id]||0)}</dd></dl>
     <button onClick={()=>onCheck?.()}><Settings2 size={16}/>Проверить подключение</button>
     {sel.kind==='custom'&&<button className={currentAgent==='custom:'+sel.id?'primary':''} onClick={()=>onUse?.('custom:'+sel.id)}><Play size={16}/>{currentAgent==='custom:'+sel.id?'Выбрана исполнителем':'Сделать исполнителем'}</button>}
     {!BASE_AIS.some(b=>b.id===sel.id)&&<button className="danger" onClick={()=>{onRemove(sel.id);setSelected(null);setFocused(null);play('remove');}}><Trash2 size={16}/>Убрать с орбиты</button>}
    </motion.div>}
    {adding&&<AddDialog key="add" onClose={()=>setAdding(false)} onAdd={a=>{onAdd(a);setAdding(false);play('launch');}}/>}
   </AnimatePresence>
  </>}
 </div>;
}

function AddDialog({onClose,onAdd}){
 const [kind,setKind]=useState('custom'),[name,setName]=useState(''),[url,setUrl]=useState('http://127.0.0.1:8080'),[model,setModel]=useState(''),[color,setColor]=useState(PALETTE[0]),[glyph,setGlyph]=useState(GLYPHS[0]);
 const urlOk=kind!=='custom'||/^https?:\/\/[^\s]+$/.test(url.trim());
 return <motion.div className="orbit-modal" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} onClick={onClose}>
  <motion.form initial={{scale:.85,y:30}} animate={{scale:1,y:0}} exit={{scale:.9,y:20}} transition={{type:'spring',stiffness:320,damping:24}} onClick={e=>e.stopPropagation()}
   onSubmit={e=>{e.preventDefault();if(!urlOk)return;onAdd({id:'ai-'+Date.now().toString(36),kind,name:(name.trim()||KINDS[kind].label).slice(0,40),url:kind==='custom'?url.trim().slice(0,200):'',model:kind==='custom'?model.trim().slice(0,100):'',color,glyph})}}>
   <h3>Добавить ИИ на орбиту</h3>
   <div className="kind-grid">{Object.entries(KINDS).map(([id,k])=><motion.button type="button" key={id} whileHover={{y:-3}} className={kind===id?'active':''} onClick={()=>setKind(id)}>
    <span style={{background:k.color}}>{k.glyph}</span>{k.label}{kind===id&&<Check size={14}/>}</motion.button>)}</div>
   <label>Название<input value={name} placeholder={KINDS[kind].label} maxLength={40} onChange={e=>setName(e.target.value)}/></label>
   {kind==='custom'&&<><label>Адрес OpenAI-совместимого сервера<input value={url} aria-invalid={!urlOk} onChange={e=>setUrl(e.target.value)}/></label>
    <label>Модель <span className="hint">пусто — первая из /v1/models</span><input value={model} placeholder="например, qwen3-coder" onChange={e=>setModel(e.target.value)}/></label></>}
   <div className="look-row"><div><small>Цвет планеты</small><div className="swatches">{PALETTE.map(c=><motion.button type="button" key={c} aria-label={'Цвет '+c} whileTap={{scale:.85}} className={color===c?'active':''} style={{background:c}} onClick={()=>setColor(c)}/>)}</div></div>
    <div><small>Значок</small><div className="swatches">{GLYPHS.map(g=><motion.button type="button" key={g} whileTap={{scale:.85}} className={'glyph'+(glyph===g?' active':'')} onClick={()=>setGlyph(g)}>{g}</motion.button>)}</div></div>
    <motion.span className="preview-planet" key={color+glyph} initial={{scale:.5,rotate:-30}} animate={{scale:1,rotate:0}} style={{background:`radial-gradient(circle at 35% 30%,#fff6,${color} 45%,#0008)`}}>{glyph}</motion.span></div>
   <div className="row"><button type="button" onClick={onClose}>Отмена</button><button className="primary" type="submit" disabled={!urlOk}><Plus size={16}/>Запустить на орбиту</button></div>
  </motion.form>
 </motion.div>;
}
