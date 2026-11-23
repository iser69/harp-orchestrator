const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('harp',{
 qwenStatus:()=>ipcRenderer.invoke('qwen-status'),qwenStart:()=>ipcRenderer.invoke('qwen-start'),qwenStop:()=>ipcRenderer.invoke('qwen-stop'),
 localStop:()=>ipcRenderer.invoke('local-stop'),localStatus:()=>ipcRenderer.invoke('local-status'),localStart:()=>ipcRenderer.invoke('local-start'),
 initial:()=>ipcRenderer.invoke('initial'),choose:()=>ipcRenderer.invoke('choose'),
 save:p=>ipcRenderer.invoke('save',p),usage:p=>ipcRenderer.invoke('usage',p),
 history:()=>ipcRenderer.invoke('history'),aiCheck:()=>ipcRenderer.invoke('ai-check'),open:id=>ipcRenderer.invoke('open',id),
 operation:(type,data)=>ipcRenderer.invoke('operation',type,data),
 onLog:callback=>{const fn=(_,text)=>callback(text);ipcRenderer.on('log',fn);return()=>ipcRenderer.removeListener('log',fn);}
});
