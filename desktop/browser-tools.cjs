const {chromium}=require('playwright-core');
const fs=require('fs'),path=require('path');
module.exports=function browserTools({folder,confirm}){
 let browser,page;
 async function init(){if(page)return;browser=await chromium.launch({channel:'msedge',headless:true});const context=await browser.newContext({acceptDownloads:false,viewport:{width:1280,height:800}});await context.route('**/*',route=>{const u=new URL(route.request().url());return ['http:','https:','data:','blob:'].includes(u.protocol)?route.continue():route.abort();});page=await context.newPage();page.setDefaultTimeout(12000);page.on('dialog',d=>d.dismiss());}
 async function snapshot(){const text=await page.locator('body').innerText({timeout:12000});const items=await page.locator('a,button,input,textarea,select').evaluateAll(nodes=>nodes.slice(0,100).map((n,i)=>{n.setAttribute('data-harp-id',String(i));return {id:i,tag:n.tagName,text:(n.innerText||n.getAttribute('aria-label')||n.getAttribute('placeholder')||'').slice(0,100),href:n.tagName==='A'?n.href:undefined,type:n.getAttribute('type')};}));return {url:page.url(),title:await page.title(),text:text.slice(0,10000),elements:items};}
 async function act(a){await init();
  if(a.action==='web_open'){const u=new URL(a.url);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw Error('Нужен адрес HTTP/HTTPS без пароля.');await page.goto(u.href,{waitUntil:'domcontentloaded',timeout:30000});await page.waitForTimeout(700);return snapshot();}
  if(!page.url().startsWith('http'))throw Error('Сначала web_open.');
  if(a.action==='web_read')return snapshot();
  if(a.action==='web_screenshot'){fs.mkdirSync(folder,{recursive:true});const file=path.join(folder,'page-'+Date.now()+'.png');await page.screenshot({path:file});return {file,note:'Скриншот сохранён для пользователя. Текущая текстовая модель не получает изображение.',...(await snapshot())};}
  if(!Number.isInteger(a.id)||a.id<0||a.id>99)throw Error('Укажи id элемента из последнего результата.');
  const el=page.locator('[data-harp-id="'+a.id+'"]');
  if(a.action==='web_click'){
   const tag=await el.evaluate(n=>n.tagName);const href=tag==='A'?await el.getAttribute('href'):null;
   if(!(tag==='A'&&href&&/^https?:/i.test(new URL(href,page.url()).href))&&!await confirm('Нажать элемент '+a.id+' на '+page.url(),await el.innerText().catch(()=>'')))throw Error('Пользователь отклонил действие.');
   await el.click();await page.waitForTimeout(700);return snapshot();
  }
  if(a.action==='web_fill'){if(typeof a.text!=='string'||a.text.length>10000)throw Error('Некорректный текст.');if(!await confirm('Ввести текст на '+page.url(),a.text))throw Error('Пользователь отклонил ввод.');await el.fill(a.text);return snapshot();}
  throw Error('Неизвестный браузерный инструмент');
 }
 return {act,close:async()=>{await browser?.close();}};
};
