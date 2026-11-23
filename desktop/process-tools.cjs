const {spawn,execFile}=require('child_process');
const jobs=new Map();let seq=0;
function kill(pid){return new Promise(resolve=>execFile('taskkill.exe',['/PID',String(pid),'/T','/F'],{windowsHide:true,timeout:10000},()=>resolve()));}
function start(command,cwd,{signal,timeout=60000}={}){
 signal?.throwIfAborted();const id=String(++seq);const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{cwd,windowsHide:true,stdio:['ignore','pipe','pipe']});const job={id,pid:child.pid,command,state:'running',output:'',exitCode:null};jobs.set(id,job);
 const append=c=>job.output=(job.output+c.toString()).slice(-24000);child.stdout.on('data',append);child.stderr.on('data',append);
 const abort=()=>kill(child.pid);signal?.addEventListener('abort',abort,{once:true});const timer=timeout?setTimeout(abort,timeout):null;
 job.done=new Promise(resolve=>{const end=(code,error)=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);job.state=signal?.aborted?'stopped':'exited';job.exitCode=code;if(error)append(error);resolve(info(id));};child.on('error',e=>end(-1,e.message));child.on('close',code=>end(code));});return info(id);
}
function info(id){const j=jobs.get(String(id));if(!j)throw Error('Процесс не найден');const {done,...out}=j;return out;}
async function stop(id){const j=jobs.get(String(id));if(!j)throw Error('Процесс не найден');if(j.state==='running')await kill(j.pid);return info(id);}
module.exports={start,info,stop,kill,list:()=>[...jobs.keys()].map(info),wait:id=>jobs.get(id).done,stopAll:async()=>{await Promise.all([...jobs.keys()].map(stop));}};
