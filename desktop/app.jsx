import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {LayoutDashboard,MessageSquare,Settings,Plus,Search,Folder,ArrowUpRight,ArrowRight,Play,Activity,Check,ChevronRight,Terminal,Layers,User,RefreshCw,Sparkles} from 'lucide-react';
import '@fontsource/inter/latin.css';
import '@fontsource/inter/cyrillic.css';
import './style.css';
import {Orbits,BASE_AIS} from './orbits.jsx';
import {useMemo} from 'react';

const api=window.harp;
const fmt=n=>new Intl.NumberFormat('ru').format(n||0);
const names={auto:'Inkling распределяет задачи',local:'Только Inkling · локально',codex:'Только Codex',claude:'Только Claude Code'};
function App(){
 const [qwen,setQwen]=useState({state:'checking',message:'Проверяем'}),[qwenBusy,setQwenBusy]=useState(false);
 useEffect(()=>{let alive=true;const poll=()=>api.qwenStatus().then(s=>{if(alive)setQwen(s)}).catch(()=>{});poll();const t=setInterval(poll,2500);return()=>{alive=false;clearInterval(t)}},[]);
 async function toggleQwen(){setQwenBusy(true);try{setQwen(await (['ready','loading'].includes(qwen.state)?api.qwenStop():api.qwenStart()))}catch(e){setError(e.message)}finally{setQwenBusy(false)}}
 const qwenPanel=<div className="local-panel"><span className={'model-light '+qwen.state}/><div><strong>Qwen 3.5 · 4B SOMPOA</strong><small>{qwen.message} · локально, Q4_K_M</small></div><button disabled={qwenBusy} onClick={toggleQwen}>{qwenBusy?'Подожди…':['ready','loading'].includes(qwen.state)?'Остановить Qwen':'Запустить Qwen'}</button></div>;

 const [modelCatalog,setModelCatalog]=useState({codex:[],claude:[],levels:{codex:[],claude:[]}});
 const [local,setLocal]=useState({state:'checking',message:'Проверяем модель'}),[launchBusy,setLaunchBusy]=useState(false);
 useEffect(()=>{
  let stopped=false,timer;
  async function poll(){try{const value=await api.localStatus();if(!stopped)setLocal(value);}catch(e){if(!stopped)setLocal({state:'error',message:e.message});}finally{if(!stopped)timer=setTimeout(poll,2500);}}
  poll();return()=>{stopped=true;clearTimeout(timer)};
 },[]);
 async function startLocal(){setLaunchBusy(true);try{setLocal(await (['ready','loading'].includes(local.state)?api.localStop():api.localStart()));}catch(e){setLocal({state:'error',message:e.message});}finally{setLaunchBusy(false)}}
 const localPanel=<div className="local-panel"><span className={'model-light '+local.state}/><div><strong>Inkling 2 Mini</strong><small>{local.message}</small></div><button disabled={launchBusy||local.state==='stopping'} onClick={startLocal}>{launchBusy||local.state==='stopping'?'Подожди…':['ready','loading'].includes(local.state)?'Остановить модель':'Запустить модель'}</button></div>;
 const [page,setPage]=useState('work'),[prefs,setPrefs]=useState({name:'Кирилл',project:'',agent:'auto',motion:true});
 const [history,setHistory]=useState([]),[query,setQuery]=useState(''),[goal,setGoal]=useState(''),[plan,setPlan]=useState(null);
 const [log,setLog]=useState(''),[busy,setBusy]=useState(false),[status,setStatus]=useState(''),[error,setError]=useState('');
 const [settingsTab,setSettingsTab]=useState('general'),[aiStatus,setAiStatus]=useState({}),[opType,setOpType]=useState(null);
 const [usage,setUsage]=useState(null),[selected,setSelected]=useState(null),[connections,setConnections]=useState('');
 useEffect(()=>{api.initial().then(x=>{setPrefs(x.prefs);setHistory(x.history);setModelCatalog(x.modelCatalog);}).catch(e=>setError(e.message));return api.onLog(t=>setLog(v=>v+t));},[]);
 useEffect(()=>{document.documentElement.dataset.motion=prefs.motion?'on':'off';},[prefs.motion]);
 useEffect(()=>{let alive=true;api.usage(prefs.project).then(x=>{if(alive)setUsage(x)}).catch(e=>{if(alive)setError(e.message)});return()=>{alive=false}},[prefs.project,history]);
 async function checkAis(){try{const r=await api.aiCheck();setAiStatus({codex:r.codex,claude:r.claude,...r.custom});setConnections(r.text);}catch(e){setError(e.message)}}
 useEffect(()=>{if(page!=='settings'||settingsTab!=='ai')return;checkAis();const t=setInterval(checkAis,60000);return()=>clearInterval(t);},[page,settingsTab,(prefs.ais||[]).length]);
 function save(p){const next={...prefs,...p};setPrefs(next);api.save(next).catch(e=>setError(e.message));}
 function invalidate(){setPlan(null);}
 async function choose(){try{const p=await api.choose();if(p){save({project:p});invalidate();}}catch(e){setError(e.message)}}
 async function operation(type){
  setBusy(true);setError('');setSelected(null);setOpType(type);
  if(type==='execute'||type==='plan'||type==='run'||type==='local'||type==='custom'){setPage('work');setLog('');}
  setStatus({execute:'Планируем и выполняем задачу',local:'Inkling отвечает на твоём ПК',plan:'Inkling составляет план',run:'Агенты выполняют задачу',doctor:'Проверяем подключения',custom:'Своя модель выполняет запрос',inkling:'Запускаем Inkling'}[type]);
  try{
   const r=await api.operation(type,{...prefs,goal});
   if(type==='local'||type==='custom'){setLog(r.out||r.err);const items=await api.history();setHistory(items);if(items[0]){setSelected(items[0]);setGoal('');}}
   if(type==='doctor')setConnections(r.out||r.err);
   if(r.code!==0)throw Error(r.err||r.out||'Операция остановлена');
   if(type==='plan')setPlan(r.plan);
   if(type==='run'||type==='execute'){setPlan(null);const items=await api.history();setHistory(items);if(items[0]){setSelected(items[0]);setGoal('');}}
   setStatus(type==='custom'?'Ответ своей модели получен':type==='local'?'Ответ локальной модели получен':type==='plan'?'План готов к запуску':(type==='run'||type==='execute')?'Работа завершена':r.out.trim());
  }catch(e){setError(e.message);if(type==='run'){setPlan(null);setHistory(await api.history());}}
  finally{setBusy(false);setOpType(null);}
 }
 async function sendChat(){
  if(!selected||busy||!goal.trim())return;
  setBusy(true);setError('');setLog('');setOpType('chat');
  try{const r=await api.operation('chat',{id:selected.id,goal,agent:selected.agent});if(r.chat){setSelected(r.chat);setGoal('');}setHistory(await api.history());if(r.code!==0)setError(r.err||'Ошибка выполнения');}
  catch(e){setError(e.message);setHistory(await api.history());}finally{setBusy(false);setOpType(null);}
 }
 function openChat(h){if(busy)return;setSelected(h);setGoal('');setLog('');setError('');setPlan(null);setPage('work');}
 function newTask(){if(busy)return;setSelected(null);setGoal('');setPlan(null);setLog('');setStatus('');setError('');setPage('work');}
 const customs=(prefs.ais||[]).filter(a=>a.kind==='custom');
 const allNames={...names,...Object.fromEntries(customs.map(a=>['custom:'+a.id,'Только '+a.name]))};
 const isCustom=String(prefs.agent).startsWith('custom:');
 const statuses={...aiStatus,local:local.state==='ready'};
 if(!('codex' in aiStatus)&&connections){statuses.codex=/Codex: готов/.test(connections);statuses.claude=/Claude: готов/.test(connections);}
 for(const a of prefs.ais||[])if(a.kind!=='custom'&&a.kind in statuses)statuses[a.id]=statuses[a.kind];
 const orderedAis=useMemo(()=>{const all=[...BASE_AIS,...(prefs.ais||[])],order=prefs.order||[];return all.map((a,i)=>[a,order.includes(a.id)?order.indexOf(a.id):100+i]).sort((x,y)=>x[1]-y[1]).map(x=>x[0]);},[prefs.ais,prefs.order]);
 const activity=!busy?null:opType==='plan'?'__core':opType==='local'?'local':opType==='custom'?prefs.agent.slice(7):(opType==='run'||opType==='chat')?(log.match(/Шаг \d+\/\d+\. (codex|claude):/g)?.at(-1)?.match(/(codex|claude):/)?.[1]||(log.includes('Inkling составляет')?'__core':null)):null;
 const tokens={codex:usage?.totals?.codex||0,claude:usage?.totals?.claude||0,local:usage?.totals?.inkling||0,...(usage?.byAi||{})};
 const orbitProps={ais:orderedAis,statuses,tokens,activity,spin:prefs.orbitSpin!==false,motionOn:prefs.motion,soundOn:prefs.sound!==false,currentAgent:prefs.agent};
 const total=usage?Object.values(usage.totals).reduce((a,b)=>a+b,0):0;
 const projectTotal=usage?Object.values(usage.selected).reduce((a,b)=>a+b,0):0;
 const projectName=prefs.project.split(/[\\/]/).filter(Boolean).pop();
 return <div className="shell">
  <aside><div className="brand"><span className="mark">h</span><div>Harp<span>ORCHESTRATOR</span></div></div>
   <button className="new-task" onClick={newTask} disabled={busy}><Plus size={17}/>Новая задача<span>↗</span></button>
   <nav>{[['dashboard',LayoutDashboard,'Обзор'],['work',MessageSquare,'Рабочая сессия']].map(([id,Icon,label])=><button className={page===id?'active':''} onClick={()=>{setPage(id);setSelected(null)}} key={id}><Icon size={18}/>{label}</button>)}</nav>
   <div className="history-heading">Чаты <span>{history.length}</span></div>
   <div className="search"><Search size={15}/><input aria-label="Поиск запусков" placeholder="Найти задачу" value={query} onChange={e=>setQuery(e.target.value)}/></div>
   <div className="history">{history.filter(h=>h.goal.toLowerCase().includes(query.toLowerCase())).map(h=><button className={selected?.id===h.id?'selected':''} key={h.id} title={h.goal} disabled={busy} onClick={()=>openChat(h)}><span>{h.goal}</span><small>{new Date(h.date).toLocaleDateString('ru',{day:'numeric',month:'short'})} · {h.reports.length} отч.</small></button>)}</div>
   <div className="sidebar-bottom"><button className={page==='settings'?'active':''} onClick={()=>setPage('settings')}><Settings size={18}/>Настройки</button><div className="profile"><span>{prefs.name.slice(0,1).toUpperCase()}</span><div>{prefs.name}<small>Локальный профиль</small></div></div></div>
  </aside>
  <div className="body"><header><span>Harp / {{work:'Рабочая сессия',dashboard:'Обзор',settings:'Настройки'}[page]}</span><span className="header-project"><Folder size={14}/>{projectName||'Проект не выбран'}</span></header>
  <main key={page} className="page">
   {error&&<div className="error" role="alert">{error}</div>}
   {page==='work'&&<>
    <div className="page-title"><div><div className="eyebrow">{selected?'ИСТОРИЯ ЗАПУСКА':'РАБОЧАЯ СЕССИЯ'}</div><h1>{selected?'Переписка':'Что будем создавать?'}</h1></div>{selected&&<button onClick={()=>api.open(selected.id).catch(e=>setError(e.message))}><Folder size={16}/>Открыть файлы</button>}</div>
    {selected?<><h2 className="task-title">{selected.goal}</h2><p className="footnote">{allNames[selected.agent]||selected.agent} · {selected.project}</p>{(selected.messages||[{role:'user',text:selected.goal},...selected.reports.map(r=>({role:'assistant',text:r.text}))]).map((m,i)=><article className="report" key={i}><h3>{m.role==='user'?'Ты':m.role==='error'?'Ошибка':(allNames[m.agent]||'Ассистент')}</h3><pre>{m.text}</pre></article>)}
     {busy&&<div className="mini-orbits"><Orbits {...orbitProps} mini/></div>}{busy&&<details className="logs" open><summary>Выполняется…</summary><pre>{log}</pre></details>}
     <div className="composer"><textarea aria-label="Сообщение в чат" placeholder="Продолжить разговор…" maxLength={3000} value={goal} disabled={busy} onChange={e=>setGoal(e.target.value)}/><div className="composer-footer"><select aria-label="Исполнитель в чате" disabled={busy} value={selected.agent||'auto'} onChange={e=>setSelected({...selected,agent:e.target.value})}>{Object.entries(allNames).map(([id,n])=><option key={id} value={id}>{n}</option>)}</select><small>С контекстом переписки</small><button className="primary" disabled={busy||!goal.trim()} onClick={sendChat}>{busy?'Выполняется…':'Отправить'}</button></div></div></>:
    <><div className="project-bar"><Folder size={18}/><div><small>Проект</small><span title={prefs.project}>{prefs.project||'Выбери папку проекта'}</span></div><button disabled={busy} onClick={choose}>Выбрать<ChevronRight size={15}/></button></div>
     {(prefs.agent==='auto'||prefs.agent==='local')&&localPanel}{prefs.agent==='custom:qwen-local'&&qwenPanel}
{prefs.agent==='local'&&<p className="local-note">Локальная ИИ может работать с файлами и открывать сайты с JavaScript. Команды, ввод на сайтах и нажатия кнопок — после подтверждения.</p>}
{busy&&!selected&&<div className="mini-orbits"><Orbits {...orbitProps} mini/></div>}
<section className="workspace">
      {!plan&&!log?<div className="empty"><span className="empty-mark"><Layers size={28}/></span><h2>От идеи к результату</h2><p>{prefs.agent==='local'?'Задай вопрос локальной модели Inkling.':'Опиши задачу. Harp составит план и сразу запустит выбранных агентов.'}</p>{prefs.agent!=='local'&&<div className="agents"><span>Inkling <small>планирование</small></span><ArrowRight size={14}/><span>Codex + Claude <small>выполнение</small></span></div>}</div>:<>
       {plan&&<div className="plan"><h3><Check size={18}/>План готов</h3><p>{plan.mode==='directory'?'Агенты изменят файлы прямо в выбранной папке.':'Агенты работают в отдельной ветке Git.'}</p>{plan.steps.map((s,i)=><div className="step" key={i}><span>{i+1}</span><div><strong>{s.agent==='codex'?'Codex':'Claude Code'}<small>{s.role==='review'?'Ревью':'Реализация'}</small></strong><p>{s.task}</p><small>{s.acceptance}</small></div></div>)}</div>}
       {log&&<details className="logs" open={!plan}><summary>Журнал выполнения</summary><pre>{log}</pre></details>}
      </>}
     </section>
     <div className="composer"><textarea aria-label="Описание задачи" maxLength={3000} placeholder="Опиши задачу для проекта…" value={goal} disabled={busy} onChange={e=>{setGoal(e.target.value);invalidate()}}/><div className="composer-footer"><select aria-label="Исполнитель" disabled={busy} value={prefs.agent} onChange={e=>{save({agent:e.target.value});invalidate()}}>{Object.entries(allNames).map(([id,n])=><option key={id} value={id}>{n}</option>)}</select><button className="primary" disabled={busy||(prefs.agent!=='local'&&!isCustom&&!prefs.project)||!goal.trim()||(['auto','local'].includes(prefs.agent)&&local.state!=='ready')} onClick={()=>operation(isCustom?'custom':prefs.agent==='local'?'local':plan?'run':'execute')}>{busy?<RefreshCw size={16} className="spin"/>:plan?<Play size={16}/>:<Sparkles size={16}/>} {busy?'Выполняется':isCustom?'Отправить: '+(customs.find(a=>'custom:'+a.id===prefs.agent)?.name||''):prefs.agent==='local'?'Отправить Inkling':plan?'Запустить задачи':'Выполнить задачу'}</button></div></div>
     {status&&<div className="status"><span className={busy?'pulse':''}/>{status}</div>}
    </>}
   </>}
   {page==='dashboard'&&<><div className="page-title"><div><div className="eyebrow">ОБЗОР</div><h1>Работа в цифрах</h1><p>Расход и результаты твоих проектов.</p></div><button onClick={choose} disabled={busy}><Folder size={16}/>{projectName||'Выбрать проект'}</button></div>
    <div className="metrics">{[['Токены проекта',prefs.project?fmt(projectTotal):'—',projectName||'Выбери проект'],['Всего токенов',fmt(total),'По сохранённым журналам'],['Запуски',history.length,'За всё время']].map(([label,note,sub])=><article key={label}><small>{label}</small><strong>{note}</strong><span>{sub}</span></article>)}</div>
    <div className="dashboard-grid"><section className="card"><h3>Расход по агентам <Activity size={16}/></h3>{Object.entries(usage?.totals||{codex:0,claude:0,inkling:0}).map(([name,n])=><div className="model" key={name}><div><span>{name==='codex'?'Codex':name==='claude'?'Claude Code':name==='custom'?'Свои модели':'Inkling'}</span><strong>{fmt(n)}</strong></div><div className="bar"><i style={{width:total?n/total*100+'%':'0%'}}/></div></div>)}<p className="footnote">Записей без счётчика · {usage?.missing||0}</p></section><section className="card"><h3>Последние задачи</h3>{history.slice(0,4).map(h=><button className="recent" key={h.id} disabled={busy} onClick={()=>openChat(h)}><span>{h.goal}<small>{new Date(h.date).toLocaleDateString('ru')}</small></span><ArrowUpRight size={17}/></button>)}</section></div>
    {usage?.fileTypes&&<section className="card file-types"><h3>Файлы выбранного проекта</h3><p>{usage.fileTypes}</p></section>}
   </>}
   {page==='settings'&&<><div className="page-title"><div><div className="eyebrow">НАСТРОЙКИ</div><h1>Твоё рабочее пространство</h1></div></div><div className="settings-tabs">{[['general','Общие'],['models','Модели и усилия'],['ai','Подключённые ИИ']].map(([id,l])=><button key={id} className={settingsTab===id?'active':''} onClick={()=>setSettingsTab(id)}>{l}</button>)}</div>
    {settingsTab==='models'?<><p className="footnote">Применяется к новым планам и следующим сообщениям в чатах. Составленный план сохраняет свой выбор моделей.</p>{['codex','claude'].map(agent=>{const value=prefs.models?.[agent]||{model:'',effort:''};const entries=modelCatalog[agent]||[];const levels=entries.find(m=>m.id===value.model)?.efforts||modelCatalog.levels[agent];const update=v=>{save({models:{...prefs.models,[agent]:{...value,...v}}});invalidate();};return <section className="card settings" key={agent}><h3>{agent==='codex'?'Codex · GPT':'Claude Code'}</h3><label>Модель<select aria-label={agent+' модель'} disabled={busy} value={entries.some(m=>m.id===value.model)||!value.model?value.model:'custom'} onChange={e=>update({model:e.target.value==='custom'?'custom':e.target.value,effort:''})}><option value="">По умолчанию CLI</option>{entries.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}<option value="custom">Другая модель…</option></select></label>{value.model&&!entries.some(m=>m.id===value.model)&&<label>Идентификатор модели<input aria-label={agent+' идентификатор'} value={value.model==='custom'?'':value.model} onChange={e=>update({model:e.target.value})}/></label>}<label>Усилие рассуждения<select aria-label={agent+' effort'} disabled={busy} value={value.effort} onChange={e=>update({effort:e.target.value})}><option value="">По умолчанию</option>{levels.map(l=><option key={l} value={l}>{l}</option>)}</select></label><p className="footnote">{agent==='codex'?'Список из локального каталога Codex.':'Версия закрепляется точным именем, например claude-opus-5-5.'} Доступность зависит от аккаунта. Выше effort — обычно дольше ответ и больше расход.</p></section>})}</>:settingsTab==='ai'?<section className="card orbit-card"><Orbits {...orbitProps}
      onAdd={a=>save({ais:[...(prefs.ais||[]),a]})} onRemove={id=>save({ais:(prefs.ais||[]).filter(a=>a.id!==id),order:(prefs.order||[]).filter(x=>x!==id),agent:prefs.agent==='custom:'+id?'auto':prefs.agent})} onCheck={checkAis} onReorder={order=>save({order})} onUse={agent=>{save({agent});invalidate();}}/>
     <div className="orbit-footer"><label>Вращение орбит<input type="checkbox" role="switch" checked={prefs.orbitSpin!==false} onChange={e=>save({orbitSpin:e.target.checked})}/></label>
      <label>Автораспределение<input type="checkbox" role="switch" checked={prefs.agent==='auto'} onChange={e=>{save({agent:e.target.checked?'auto':'codex'});invalidate()}}/></label>
      <label>Звуки<input type="checkbox" role="switch" checked={prefs.sound!==false} onChange={e=>save({sound:e.target.checked})}/></label><span className="orbit-count"><span className="dot on"/>{orderedAis.filter(a=>statuses[a.id]).length} из {orderedAis.length} подключены</span></div></section>:<><section className="card settings"><h3><User size={17}/>Профиль и интерфейс</h3><label>Имя профиля<input value={prefs.name} onChange={e=>save({name:e.target.value})} maxLength={60}/></label><label>Анимации<span className="hint">Переходы и индикация работы</span><input type="checkbox" role="switch" checked={prefs.motion} onChange={e=>save({motion:e.target.checked})}/></label></section>
    <section className="card settings"><h3><Layers size={17}/>Оркестрация</h3><label>Исполнитель<select disabled={busy} value={prefs.agent} onChange={e=>{save({agent:e.target.value});invalidate()}}>{Object.entries(allNames).map(([id,n])=><option key={id} value={id}>{n}</option>)}</select></label>{localPanel}{qwenPanel}<p className="footnote">Inkling и Qwen запускаются по очереди, чтобы освободить память видеокарты. Qwen включается автоматически при отправке ей задачи.</p></section>
    <section className="card settings"><h3><Terminal size={17}/>Подключения</h3><label>Codex<span>Вход через ChatGPT</span></label><label>Claude Code<span>Вход через Claude.ai</span></label><button disabled={busy} onClick={()=>operation('doctor')}><RefreshCw size={16} className={busy?'spin':''}/>Проверить подключения</button>{connections&&<pre className="connection-state">{connections}</pre>}</section></>}{status&&<p className="footnote">{status}</p>}
   </>}
  </main></div></div>
}
createRoot(document.getElementById('root')).render(<App/>);
