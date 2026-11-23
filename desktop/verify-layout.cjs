const {_electron:electron}=require('playwright-core');
(async()=>{
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch({args:[__dirname],env});
 try {
 const page=await app.firstWindow();
 await page.getByRole('heading',{name:'Что будем создавать?'}).waitFor();
 await page.screenshot({path:require('node:path').join(__dirname,'../.runs/harp-electron-final.png'),animations:'disabled'});
 await page.getByRole('button',{name:'Настройки',exact:true}).click();
 const motion=page.getByRole('switch');
 const original=await motion.isChecked();
 await motion.setChecked(!original);
 const saved=await page.evaluate(()=>window.harp.initial());
 if(saved.prefs.motion===original)throw Error('Preference not saved');
 await motion.setChecked(original);
 await page.getByRole('button',{name:'Обзор',exact:true}).click();
 await page.locator('.metrics article').nth(1).locator('strong').filter({hasText:/[1-9]/}).waitFor();
 await page.screenshot({path:require('node:path').join(__dirname,'../.runs/harp-electron-dashboard.png'),animations:'disabled'});
 console.log('Settings persisted and dashboard rendered');
 }finally{await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
