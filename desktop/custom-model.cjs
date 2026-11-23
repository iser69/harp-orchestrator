// Пользовательские OpenAI-совместимые модели: проверка связи и выполнение задач через инструментальный цикл local-agent.
const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');

function base(url){
 let u;try{u=new URL(String(url||''));}catch{throw Error('Некорректный адрес модели.');}
 if(!['http:','https:'].includes(u.protocol))throw Error('Адрес модели должен начинаться с http:// или https://');
 return u.origin+u.pathname.replace(/\/+$/,'').replace(/\/v1$/,'');
}
async function models(url,timeout=3000){
 const r=await fetch(base(url)+'/v1/models',{signal:AbortSignal.timeout(timeout)});
 if(!r.ok)throw Error('HTTP '+r.status);
 const data=await r.json();return (data.data||[]).map(m=>m.id).filter(Boolean);
}
async function check(ai){try{return (await models(ai.url)).length>0;}catch{return false;}}

async function reply(root,ai,goal,project,options={}){
 if(typeof goal!=='string'||!goal.trim()||goal.length>3000)throw Error('Введи запрос до 3000 символов.');
 const list=await models(ai.url,5000).catch(e=>{throw Error(`${ai.name} недоступна (${base(ai.url)}): ${e.message}`);});
 const model=ai.model||list[0];
 const dir=path.join(root,'.runs'),id=randomUUID(),folder=path.join(dir,id);
 fs.mkdirSync(folder,{recursive:true});
 fs.writeFileSync(path.join(folder,'plan.json'),JSON.stringify({version:1,mode:'custom',ai:{id:ai.id,name:ai.name,url:base(ai.url),model},goal,project:project||'',steps:[]}));
 let tokens=0,text='';
 const log=line=>{fs.appendFileSync(path.join(folder,'tools.log'),line);options.log?.(line);};
 log(`Исполнитель: ${ai.name} · ${model}\n`);
 try{
  text=await require('./local-agent.cjs')({goal,project,log,artifacts:folder,confirm:options.confirm,request:async messages=>{
   const r=await fetch(base(ai.url)+'/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(360000),
    body:JSON.stringify({model,max_tokens:2200,response_format:{type:'json_object'},messages})});
   if(!r.ok)throw Error(`${ai.name} HTTP ${r.status}: ${(await r.text()).slice(0,300)}`);
   const data=await r.json();tokens+=Number.isSafeInteger(data.usage?.total_tokens)?data.usage.total_tokens:0;return data;
  }});
 }catch(e){text='Ошибка: '+e.message;throw e;}finally{
  fs.writeFileSync(path.join(folder,'1-custom.md'),text);
  fs.writeFileSync(path.join(dir,'custom-'+id+'.usage.json'),JSON.stringify({project:project||'',ai:ai.id,tokens}));
 }
 return {code:0,out:text};
}
module.exports={base,check,reply};
