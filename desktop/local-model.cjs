const {spawn,execFile}=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
module.exports=function localModel(root){
 let child=null, starting=null, stopping=false, failure='', tail='';
 const url='http://127.0.0.1:8001';
 async function status(){
  if(stopping)return {state:'stopping',message:'Останавливается'};
  try{
   const r=await fetch(url+'/v1/models',{signal:AbortSignal.timeout(2500)});
   if(r.status===503)return {state:'loading',message:'Загружается в память'};
   if(!r.ok)throw Error('HTTP '+r.status);
   const data=await r.json();
   if(!data.data?.some(m=>m.id==='inkling-2-mini'))return {state:'error',message:'На порту 8001 другая модель'};
   return {state:'ready',message:'Готова к работе'};
  }catch{
   if(child)return {state:'loading',message:'Запуск и загрузка модели'};
   return failure?{state:'error',message:failure}:{state:'offline',message:'Выключена'};
  }
 }
 async function start(){
  if(stopping)return {state:'stopping',message:'Останавливается'};
  if(starting)return starting;
  starting=(async()=>{
   const current=await status();
   if(current.state==='ready'||current.state==='loading'||child)return current;
   failure='';tail='';
   const logs=path.join(root,'.runtime');
   fs.mkdirSync(logs,{recursive:true});
   child=spawn('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'inkling.ps1'),'-Setup'],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});
   const capture=chunk=>{tail=(tail+chunk.toString()).slice(-3000);fs.appendFileSync(path.join(logs,'local-model.log'),chunk);};
   child.stdout.on('data',capture);child.stderr.on('data',capture);
   child.on('error',e=>{failure=e.message;});
   child.on('close',code=>{child=null;if(code!==0&&!stopping)failure='Ошибка запуска ('+code+'). '+tail.slice(-600);});
   return {state:'loading',message:'Запуск и загрузка модели'};
  })();
  try{return await starting;}finally{starting=null;}
 }
 async function stop(){
  if(stopping)return {state:'stopping',message:'Останавливается'};
  stopping=true;
  try{
   if(starting)await starting;
   const server=path.join(root,'.runtime','llama','llama-server.exe').replace(/'/g,"''");
   const script=`$ErrorActionPreference='Stop'; Get-CimInstance Win32_Process -Filter "Name='llama-server.exe'" | Where-Object { $_.ExecutablePath -eq '${server}' -and $_.CommandLine -like '*inkling-2-mini*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop }`;
   await new Promise((resolve,reject)=>execFile('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,timeout:15000},e=>e?reject(e):resolve()));
   if(child){const running=child;await new Promise(resolve=>execFile('taskkill.exe',['/PID',String(running.pid),'/T','/F'],{windowsHide:true,timeout:10000},()=>resolve()));child=null;}
   failure='';
  }finally{stopping=false;}
  const current=await status();
  if(current.state==='ready'||current.state==='loading')throw Error('Сервер всё ещё работает. Возможно, он запущен вне Harp.');
  return current;
 }
 async function reply(goal,project,options={}){
  if(typeof goal!=='string'||!goal.trim()||goal.length>3000)throw Error('Введи запрос до 3000 символов.');
  const current=await status();
  if(current.state!=='ready')throw Error('Inkling ещё не готова. Запусти модель и дождись зелёного статуса.');
  const dir=path.join(root,'.runs'),id=randomUUID(),folder=path.join(dir,id);
  fs.mkdirSync(folder,{recursive:true});
  fs.writeFileSync(path.join(folder,'plan.json'),JSON.stringify({version:1,mode:'local',goal,project:project||'',steps:[]}));
  let tokens=0,text='';
  const log=line=>{fs.appendFileSync(path.join(folder,'tools.log'),line);options.log?.(line);};
  try{
   text=await require('./local-agent.cjs')({goal,project,log,artifacts:folder,confirm:options.confirm,request:async messages=>{
    const response=await fetch(url+'/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(360000),body:JSON.stringify({model:'inkling-2-mini',max_tokens:2200,response_format:{type:'json_object'},messages})});
    if(!response.ok)throw Error('Inkling HTTP '+response.status);
    const data=await response.json();tokens+=Number.isSafeInteger(data.usage?.total_tokens)?data.usage.total_tokens:0;return data;
   }});
  }catch(e){text='Ошибка: '+e.message;throw e;}finally{
   fs.writeFileSync(path.join(folder,'1-inkling.md'),text);
   fs.writeFileSync(path.join(dir,'inkling-'+id+'.usage.json'),JSON.stringify({project:project||'',tokens}));
  }
  return {code:0,out:text};
 }
 return {status,start,stop,reply};
};
