const {_electron: electron}=require('playwright-core');
const path=require('node:path');
(async()=>{
 const env={...process.env}; delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch({args:[__dirname],env});
 try{
 const page=await app.firstWindow();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.getByRole('heading',{name:'Что будем создавать?'}).waitFor();
 await page.screenshot({path:path.join(__dirname,'../.runs/electron-work.png')});
 await page.getByRole('button',{name:'Обзор',exact:true}).click();
 await page.locator('.metrics article').nth(1).locator('strong').filter({hasText:/[1-9]/}).waitFor();
 await page.screenshot({path:path.join(__dirname,'../.runs/electron-dashboard.png')});
 await page.getByRole('button',{name:'Настройки',exact:true}).click();
 await page.getByRole('button',{name:'Проверить подключения'}).click();
 await page.getByText(/Codex: готов/).first().waitFor({timeout:45000});
 const prefs=await page.evaluate(()=>window.harp.initial());
 const result=await page.evaluate(async p=>{
   return await window.harp.operation('plan',{project:p,goal:'Создай файл electron-check.txt с единственной строкой ready.',agent:'codex'});
 },path.resolve(__dirname,'../.runs/codex-smoke'));
 if(result.code!==0||result.plan.steps[0].agent!=='codex')throw Error(JSON.stringify(result));
 const run=await page.evaluate(()=>window.harp.operation('run'));
 if(run.code!==0)throw Error(run.err||run.out);
 console.log('Electron renderer, navigation, diagnostics, plan and real Codex run OK');
 if(errors.length)throw Error(errors.join('\n'));
 } finally{await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
