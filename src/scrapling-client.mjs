import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {resolve} from 'node:path';

// Two persistent workers isolate market cookies while allowing independent scans.
export function createScraplingClient(root,{spawnWorker=spawn,timeoutMs=120000}={}) {
  const workers=new Map();
  function start(market) {
    const child=spawnWorker(process.env.SCRAPLING_PYTHON||resolve(root,'.venv/bin/python'),
      [resolve(root,'src/scrapling_fetch.py')],{stdio:['pipe','pipe','pipe']});
    const worker={child,pending:null,error:null,diagnostic:'',queue:Promise.resolve()};
    function fail(error) {
      worker.error=error;
      if(worker.pending){clearTimeout(worker.pending.timer);worker.pending.reject(error);worker.pending=null;}
    }
    child.stderr.on('data',chunk=>{worker.diagnostic=(worker.diagnostic+chunk).slice(-2000);});
    child.on('error',fail);child.stdin.on('error',fail);
    child.on('exit',code=>fail(new Error('Scrapling worker exited ('+code+'): '+worker.diagnostic.slice(-500))));
    createInterface({input:child.stdout}).on('line',line=>{
      if(!worker.pending)return;
      const call=worker.pending;worker.pending=null;clearTimeout(call.timer);
      try {
        const result=JSON.parse(line);
        if(result.error)throw new Error(result.error);
        call.resolve(result);
      } catch(error){call.reject(error);}
    });
    workers.set(market,worker);return worker;
  }
  return {
    async fetch(url,market,options={}) {
      const parsed=new URL(url);
      if(!['US','CA'].includes(market)||parsed.origin!=='https://www.hermes.com'||
        !parsed.pathname.startsWith('/'+market.toLowerCase()+'/en/')||parsed.username||parsed.password)
        throw new Error('Only matching official market URLs are allowed');
      const worker=workers.get(market)||start(market);
      const request=worker.queue.then(()=>{
        if(worker.error)throw worker.error;
        return new Promise((resolve,reject)=>{
          const timer=setTimeout(()=>{
            const error=new Error('Scrapling request timed out');
            worker.error=error;worker.pending=null;reject(error);worker.child.kill();
          },timeoutMs);
          worker.pending={resolve,reject,timer};
          worker.child.stdin.write(JSON.stringify({url,browserOnly:options.browserOnly===true})+'\n');
        });
      });
      worker.queue=request.catch(()=>{});return request;
    },
    close() {for(const {child} of workers.values()){child.stdin.end();child.kill();}}
  };
}
