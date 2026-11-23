const {_electron:electron}=require('playwright-core');
(async()=>{
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch({args:[__dirname],env});
 try{
 const p=await app.firstWindow();
 await p.getByRole('heading',{name:'Что будем создавать?'}).waitFor();
 const original=await p.evaluate(()=>window.harp.initial());
 await p.getByLabel('Исполнитель').selectOption('local');
 await p.getByText('Готова к работе',{exact:true}).waitFor({timeout:45000});
 await p.getByLabel('Описание задачи').fill('Ответь только словом Harp.');
 await p.getByRole('button',{name:'Отправить Inkling'}).click();
 await p.getByText('Ответ локальной модели получен',{exact:true}).waitFor({timeout:360000});
 const history=await p.evaluate(()=>window.harp.history());
 if(!history[0].reports.some(r=>r.name==='1-inkling.md'&&r.text.trim()))throw Error('Missing local report');
 await p.getByLabel('Исполнитель').selectOption('auto');
 await p.getByRole('button',{name:'Составить план'}).waitFor();
 await p.getByRole('button',{name:'Настройки',exact:true}).click();
 await p.getByText('Готова к работе',{exact:true}).waitFor();
 await p.evaluate(prefs=>window.harp.save(prefs),original.prefs);
 console.log('Local mode UI, live ready state, real answer, saved report and distributor selector passed');
 }finally{await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
