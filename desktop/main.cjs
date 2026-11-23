const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const modelSettings = require('../model-settings.cjs');
const root = path.resolve(__dirname, '..');
const runs = path.join(root, '.runs');
const local = require('./local-model.cjs')(root);
const custom = require('./custom-model.cjs');
const qwen = require('./qwen-model.cjs')(root);
let win, active = false, manifest = null;
async function confirmCommand(command,project){const r=await dialog.showMessageBox(win,{type:'question',title:'Команда ИИ',message:'Выполнить команду?',detail:project+'\n\n'+command+'\n\nКоманда выполняется с правами твоего пользователя Windows.',buttons:['Отмена','Выполнить'],defaultId:0,cancelId:0});return r.response===1;}
const preferences = path.join(root, '.runtime', 'desktop-preferences.json');
function prefs() {
  try { return JSON.parse(fs.readFileSync(preferences, 'utf8')); }
  catch { return { name: 'Кирилл', project: '', agent: 'auto', motion: true }; }
}
function exec(args, stream = false) {
  if(args[0]==='plan'){const order=prefs().order||[];const lead=order.find(id=>id==='codex'||id==='claude');args=[...args,'--models',JSON.stringify(modelSettings.normalize(prefs().models)),...(lead?['--lead',lead]:[])];}
  return new Promise((resolve, reject) => {
    const child = spawn('node.exe', [path.join(root, 'orchestrator.mjs'), ...args], { cwd: root, windowsHide: true });
    let out = '', err = '';
    child.stdout.setEncoding('utf8').on('data', text => { out += text; if(stream) win.webContents.send('log', text); });
    child.stderr.setEncoding('utf8').on('data', text => { err += text; if(stream) win.webContents.send('log', text); });
    child.on('error', reject);
    child.on('close', code => resolve({ code, out, err }));
  });
}
function history() {
  return fs.readdirSync(runs, { withFileTypes: true }).filter(e => e.isDirectory()).flatMap(e => {
    try {
      const folder = path.join(runs, e.name);
      const plan = JSON.parse(fs.readFileSync(path.join(folder, 'plan.json'), 'utf8'));
      if(fs.existsSync(path.join(folder,'chat-parent.json')))return [];
      const chatFile=path.join(folder,'chat.json');
      const chat=fs.existsSync(chatFile)?JSON.parse(fs.readFileSync(chatFile,'utf8')):null;
      return [{ messages:chat?.messages, agent:chat?.agent||(plan.mode==='local'?'local':plan.mode==='custom'?'custom:'+plan.ai?.id:plan.steps?.length===1?plan.steps[0].agent:'auto'), id: e.name, goal: plan.goal, project: plan.project, date: chat?.updated||fs.statSync(path.join(folder, 'plan.json')).mtime.toISOString(),
        reports: fs.readdirSync(folder).filter(f=>/^\d+-(codex|claude|inkling|custom)\.md$/.test(f)).sort().map(f=>({name:f, text:fs.readFileSync(path.join(folder,f),'utf8')})) }];
    } catch { return []; }
  }).sort((a,b)=>b.date.localeCompare(a.date));
}
if(!app.requestSingleInstanceLock()) app.quit();
else {
app.on('second-instance',()=>{ if(win){win.restore();win.focus();} });
app.whenReady().then(()=>{
  fs.mkdirSync(runs,{recursive:true});
  win=new BrowserWindow({width:1240,height:850,minWidth:960,minHeight:650,title:'Harp Orchestrator',backgroundColor:'#17191c',
    titleBarStyle:'hidden',titleBarOverlay:{color:'#17191c',symbolColor:'#b9c0ca',height:40},
    webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  win.setMenu(null);
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',e=>e.preventDefault());
  win.on('close',e=>{if(active){e.preventDefault();dialog.showMessageBox(win,{message:'Агенты ещё работают. Дождись завершения операции.'});}});
  win.loadFile(path.join(__dirname,'index.html'));
  ipcMain.handle('qwen-status',()=>qwen.status());
  ipcMain.handle('qwen-start',async()=>{if(active)throw Error('Дождись завершения задачи');await local.stop();return qwen.start();});
  ipcMain.handle('qwen-stop',()=>{if(active)throw Error('Дождись завершения задачи');return qwen.stop();});
  ipcMain.handle('local-status',()=>local.status());
  ipcMain.handle('local-start',async()=>{if(active)throw Error('Дождись завершения задачи');await qwen.stop();return local.start();});
  ipcMain.handle('local-stop',()=>{if(active)throw Error('Дождись завершения текущей задачи.');return local.stop();});
  ipcMain.handle('initial',()=>({prefs:prefs(),history:history(),modelCatalog:modelSettings.catalog()}));
  ipcMain.handle('choose',async()=>{const r=await dialog.showOpenDialog(win,{properties:['openDirectory']});return r.canceled?null:r.filePaths[0];});
  ipcMain.handle('save',(_,p)=>{
    const ais=(Array.isArray(p.ais)?p.ais:[]).slice(0,12).map(a=>({id:String(a.id).replace(/[^\w-]/g,'').slice(0,40),name:String(a.name||'ИИ').slice(0,40),kind:['codex','claude','local','custom'].includes(a.kind)?a.kind:'custom',url:String(a.url||'').slice(0,200),model:String(a.model||'').slice(0,100),color:/^#[0-9a-f]{6}$/i.test(a.color)?a.color:'',glyph:String(a.glyph||'').slice(0,2)}));
    const agent=['auto','codex','claude','local'].includes(p.agent)||(/^custom:/.test(p.agent)&&ais.some(a=>a.kind==='custom'&&'custom:'+a.id===p.agent))?p.agent:'auto';
    const next={models:modelSettings.normalize(p.models),name:String(p.name||'Кирилл').slice(0,60),project:String(p.project||''),agent,motion:!!p.motion,sound:p.sound!==false,orbitSpin:p.orbitSpin!==false,ais,order:(Array.isArray(p.order)?p.order:[]).map(String).slice(0,20)};
    fs.mkdirSync(path.dirname(preferences),{recursive:true});
    fs.writeFileSync(preferences+'.tmp',JSON.stringify(next));
    fs.renameSync(preferences+'.tmp',preferences);
    return next;
  });
  ipcMain.handle('usage',async(_,project)=>{
    const r=await exec(['usage',...(project?['--project',String(project)]:[])]);
    if(r.code)throw Error(r.err||r.out);
    return JSON.parse(r.out);
  });
  ipcMain.handle('history',()=>history());
  ipcMain.handle('ai-check',async()=>{
    const ais=(prefs().ais||[]).filter(a=>a.kind==='custom');
    const [doc,...results]=await Promise.all([exec(['doctor']).catch(e=>({out:'',err:e.message})),...ais.map(a=>custom.check(a))]);
    const text=doc.out+doc.err;
    return {text,codex:/Codex: готов/.test(text),claude:/Claude: готов/.test(text),custom:Object.fromEntries(ais.map((a,i)=>[a.id,results[i]]))};
  });
  ipcMain.handle('open',async(_,id)=>{
    if(!history().some(h=>h.id===id))throw Error('Запуск не найден');
    const error=await shell.openPath(path.join(runs,id)); if(error)throw Error(error);
  });
  ipcMain.handle('operation',async(_,type,data)=>{
    if(active)throw Error('Операция уже выполняется');
    active=true;
    try {
      if(type==='doctor')return await exec(['doctor'],true);
      if(type==='chat'){
        const old=history().find(h=>h.id===data.id);
        if(!old)throw Error('Чат не найден.');
        if(typeof data.goal!=='string'||!data.goal.trim()||data.goal.length>3000)throw Error('Введи сообщение до 3000 символов.');
        const folder=path.join(runs,old.id),file=path.join(folder,'chat.json');
        const chat=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{agent:old.agent,project:fs.existsSync(path.join(folder,'project'))?path.join(folder,'project'):old.project,messages:[{role:'user',text:old.goal},...old.reports.map(r=>({role:'assistant',text:r.text}))]};
        if(data.agent!==undefined){
 const valid=['auto','codex','claude','local',...(prefs().ais||[]).filter(a=>a.kind==='custom').map(a=>'custom:'+a.id)];
 if(!valid.includes(data.agent))throw Error('Неизвестный исполнитель.');
 chat.agent=data.agent;
 }
 const context=chat.messages.slice(-6).map(m=>m.role+': '+m.text).join('\n').slice(-1800);
        const goal=data.goal.trim();
        const prompt=('Предыдущая переписка (контекст):\n'+context+'\n\nТекущий запрос: '+goal).slice(-(3000));
        chat.messages.push({role:'user',agent:chat.agent,text:goal,date:new Date().toISOString()});
        const saveChat=()=>{chat.updated=new Date().toISOString();fs.writeFileSync(file+'.tmp',JSON.stringify(chat,null,2));fs.renameSync(file+'.tmp',file);};
        saveChat();
        const before=new Set(fs.readdirSync(runs));
        let result;
        try{
          if(String(chat.agent).startsWith('custom:')){const ai=(prefs().ais||[]).find(a=>'custom:'+a.id===chat.agent);if(!ai)throw Error('Модель удалена с орбиты.');if(ai.id==='qwen-local'){await local.stop();await qwen.ensure();}result=await custom.reply(root,ai,prompt,chat.project,{log:text=>win.webContents.send('log',text),confirm:confirmCommand});}
          else if(chat.agent==='local')result=await local.reply(prompt,chat.project,{log:text=>win.webContents.send('log',text),confirm:async(command,project)=>{const r=await dialog.showMessageBox(win,{message:'Выполнить команду?',detail:project+'\n'+command,buttons:['Отмена','Выполнить'],defaultId:0,cancelId:0});return r.response===1;}});
          else{
            const planFile=path.join(runs,'desktop-'+randomUUID()+'.json');
            result=await exec(['plan','--project',chat.project,'--goal',prompt,'--agent',chat.agent,'--out',planFile],true);
            if(result.code===0)result=await exec(['run',planFile],true);
          }
          const created=fs.readdirSync(runs,{withFileTypes:true}).filter(e=>e.isDirectory()&&!before.has(e.name)&&fs.existsSync(path.join(runs,e.name,'plan.json')));
          let reports=[];
          for(const e of created){const dir=path.join(runs,e.name);fs.writeFileSync(path.join(dir,'chat-parent.json'),JSON.stringify({id:old.id}));if(fs.existsSync(path.join(dir,'project')))chat.project=path.join(dir,'project');reports.push(...fs.readdirSync(dir).filter(f=>/^\d+-(codex|claude|inkling|custom)\.md$/.test(f)).sort().map(f=>fs.readFileSync(path.join(dir,f),'utf8')));}
          chat.messages.push({role:result.code===0?'assistant':'error',agent:chat.agent,text:reports.join('\n\n')||result.err||result.out,date:new Date().toISOString()});
        }catch(e){chat.messages.push({role:'error',text:e.message,date:new Date().toISOString()});result={code:1,err:e.message};}
        saveChat();return {...result,chat:history().find(h=>h.id===old.id)};
      }
      if(type==='plan'||type==='execute'){
        manifest=null;
        if(!data.project||!data.goal?.trim()||data.goal.length>3000||!['auto','codex','claude'].includes(data.agent))throw Error('Выбери проект и опиши задачу.');
        const file=path.join(runs,'desktop-'+randomUUID()+'.json');
        const r=await exec(['plan','--project',data.project,'--goal',data.goal,'--agent',data.agent,'--out',file],true);
        if(r.code===0){manifest=file;r.plan=JSON.parse(fs.readFileSync(file,'utf8'));if(type==='execute'){manifest=null;win.webContents.send('log','\nПлан готов. Запускаем исполнителей…\n');return await exec(['run',file],true);}}
        return r;
      }
      if(type==='run'){
        if(!manifest)throw Error('Сначала составь план');
        const file=manifest;manifest=null;
        return await exec(['run',file],true);
      }
      if(type==='local')return await local.reply(data.goal,data.project,{log:text=>win.webContents.send('log',text),confirm:async(command,project)=>{const r=await dialog.showMessageBox(win,{type:'question',title:'Команда локальной ИИ',message:'Выполнить команду?',detail:project+'\n\n'+command+'\n\nКоманда выполняется с правами твоего пользователя Windows.',buttons:['Отмена','Выполнить'],defaultId:0,cancelId:0});return r.response===1;}});
      if(type==='custom'){
        const ai=(prefs().ais||[]).find(a=>a.kind==='custom'&&'custom:'+a.id===data.agent);
        if(!ai)throw Error('Модель не найдена на орбите.');
        if(ai.id==='qwen-local'){await local.stop();await qwen.ensure();}
          return await custom.reply(root,ai,data.goal,data.project,{log:text=>win.webContents.send('log',text),confirm:confirmCommand});
      }
      throw Error('Неизвестная операция');
    } finally {active=false;}
  });
});
app.on('window-all-closed',()=>app.quit());
}
