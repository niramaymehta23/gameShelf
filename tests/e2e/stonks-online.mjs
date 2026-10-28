import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const {chromium}=createRequire(import.meta.url)('playwright');
const vmc=vm.createContext({});vm.runInContext(fs.readFileSync('public/js/stonks-data.js','utf8')+fs.readFileSync('public/js/stonks-engine.js','utf8')+'\nglobalThis.E=Stonks;',vmc);const E=vmc.E,C=E.cards;
const b=await chromium.launch({headless:!process.env.HEADED}),phone={viewport:{width:390,height:844},deviceScaleFactor:2,hasTouch:true};
const ca=await b.newContext(phone),cb=await b.newContext(phone),a=await ca.newPage(),p2=await cb.newPage(),errors=[];
let testCode = null;
for(const p of [a,p2])p.on('pageerror',e=>errors.push(e.message));
const getState=p=>p.evaluate(()=>Stonks.replay({names:[G.table.host.name,G.table.guest.name],seed:G.match.seed||G.match.id,starter:rpsState(G.match).starter==='host'?0:1,rulesVersion:G.match.stRulesVersion||1,log:sortedKeys(G.match.plays).map(k=>G.match.plays[k])}));
const ready=async p=>{const reveal=p.getByRole('button',{name:/reveal my hand/});if(await reveal.count())await reveal.click();};
const sheet=async(p,name)=>p.locator('#sheet').getByRole('button',{name,exact:true}).click();
const pick=async(p,c)=>{await p.locator('.st-hand [data-card="'+c+'"]').click();};
const snap=async(p,n)=>{await p.waitForTimeout(450);await p.screenshot({path:'tests/e2e/screens/'+n+'.png'});};
async function waitLog(n){await Promise.all([a,p2].map(p=>p.waitForFunction(n=>Object.keys(G.match?.plays||{}).length>n,n)));}
async function clickCommand(p,fn){const n=await p.evaluate(()=>Object.keys(G.match.plays||{}).length);await fn();await waitLog(n);}
async function fixture(seed,log=[]){
 const id='stfixture'+Date.now().toString(36);
 await Promise.all([a,p2].map(p=>p.evaluate(id=>{Pref.set('intro:'+id,'1');Pref.set('howto:'+id,'1');},id)));
 await a.evaluate(async({id,seed,log})=>{
  await Net.doc(matchPath(id)).set({id,game:'st',seed,created:Date.now(),by:'host',joined:{host:true,guest:true},rps:{r1:{host:'rock',guest:'scissors'},r2:{host:'paper',guest:'rock'}},plays:Object.fromEntries(log.map((c,i)=>['p'+String(i).padStart(5,'0'),c]))});await Net.doc('tables/'+G.code).update({current:id});
 },{id,seed,log});
 await Promise.all([a,p2].map(p=>p.waitForFunction(id=>G.match?.id===id&&document.querySelector('.st-online'),id)));
}
try{
 await Promise.all([a,p2].map(p=>p.goto(process.env.E2E_URL||'http://localhost:3000')));
 await a.fill('#nameInput','Niramay');await a.getByRole('button',{name:'Set up a table',exact:true}).click();await a.locator('.code-card .tile').first().waitFor();const code=await a.evaluate(()=>G.code);testCode=code;
 await p2.fill('#nameInput','Saharsh');await p2.getByRole('button',{name:'Join with a code',exact:true}).click();await p2.fill('#codeInput',code);
 await a.locator('.gbox.st').waitFor();await p2.locator('.gbox.st').waitFor();await a.waitForTimeout(2700);await snap(a,'st-online-01-shelf');
 await a.locator('.gbox.st').click();await sheet(a,'Play STONKS');await sheet(p2,'Join');
 await Promise.all([a,p2].map(async p=>{await p.locator('.howto-card').getByRole('button',{name:'Got it',exact:true}).click();}));
 for(let i=0;i<2;i++){
  await a.locator('.choices').getByRole('button',{name:'Rock',exact:true}).click();await p2.locator('.choices').getByRole('button',{name:'Scissors',exact:true}).click();await a.waitForTimeout(3700);
 }
 await Promise.all([a,p2].map(p=>p.locator('.st-online').waitFor({timeout:12000})));
 await ready(a);await ready(p2);let s=await getState(a);assert.equal(s.turn,0);assert.equal(s.rulesVersion,2);assert.equal(await a.locator('.st-hand .st-card').count(),s.players[0].hand.length);assert.equal(await p2.locator('.st-hand .st-card').count(),s.players[1].hand.length);assert.ok(s.players.every(p=>p.hand.every(id=>['action','revenue'].includes(C[id].kind))));
 const mine=await a.locator('.st-hand .st-card').evaluateAll(es=>es.map(e=>e.dataset.card)),theirs=await p2.locator('.st-hand .st-card').evaluateAll(es=>es.map(e=>e.dataset.card));assert.ok(!mine.some(id=>theirs.includes(id)));
 await snap(a,'st-online-02-host-hand');await snap(p2,'st-online-03-guest-hand');console.log('  ok online invite, standard RPS, separate hand displays');
 // Valid shuffled fixture sets up an Invoice plus counter-chain on separate phones.
 let room;
 for(let i=0;i<20000;i++){
  room={names:['Niramay','Saharsh'],seed:'ui'+i,starter:0,log:[]};s=E.replay(room);
  if(s.players[0].hand.some(id=>C[id].effect==='invoice')&&s.players[0].hand.some(id=>C[id].effect==='legal')&&s.players[1].hand.some(id=>C[id].effect==='legal')&&s.players[1].hand.some(id=>C[id].kind==='funding'))break;
 }
 const append=c=>{c={...c,by:E.actor(s)};s=E.apply(s,c);room.log.push(c);};const invoice=s.players[0].hand.find(id=>C[id].effect==='invoice');
 append({type:'end'});const funds=s.players[1].hand.filter(id=>C[id].kind==='funding').sort((x,y)=>C[y].value-C[x].value).slice(0,3);for(const card of funds)append({type:'bank',card});append({type:'end'});
 await fixture(room.seed,room.log);await ready(a);await pick(a,invoice);await a.selectOption('#st-target','1');await clickCommand(a,()=>a.getByRole('button',{name:'Use action',exact:true}).click());
 await ready(p2);assert.ok((await a.locator('.st-waiting').innerText()).includes('Saharsh'));await clickCommand(p2,()=>p2.getByRole('button',{name:/Play Legal Team/}).first().click());
 await ready(a);await clickCommand(a,()=>a.getByRole('button',{name:/Play Legal Team/}).first().click());await ready(p2);await clickCommand(p2,()=>p2.getByRole('button',{name:'Pass response',exact:true}).click());
 await snap(p2,'st-online-04-payment');let total=0,chosen=[];for(const f of funds){if(total>=5)break;chosen.push(f);total+=C[f].value;}for(let i=chosen.length-1;i>=0;i--)if(total-C[chosen[i]].value>=5){total-=C[chosen[i]].value;chosen.splice(i,1);}
 for(const f of chosen)await p2.locator('.st-own-table .st-pay-card[data-card="'+f+'"]').click();await clickCommand(p2,()=>p2.getByRole('button',{name:'Confirm payment',exact:true}).click());
 assert.equal(JSON.stringify(await getState(a)),JSON.stringify(await getState(p2)));await p2.reload();await p2.locator('.st-online').waitFor();assert.equal(JSON.stringify(await getState(a)),JSON.stringify(await getState(p2)));console.log('  ok targeting, Legal Team counters, payments and reload agree on both phones');
 // Existing save/resume flow remains available to both players.
 await a.locator('#bar [aria-label="Back to the shelf"]').click();await sheet(a,'Save and quit');await a.locator('.gbox.st .sticker.saved').waitFor({state:'visible'});
 if(await p2.locator('#sheet:not([hidden])').count())await sheet(p2,'OK');await a.locator('.gbox.st').click();await sheet(a,'Carry on the saved game');await sheet(p2,'Carry on');await a.locator('.st-online').waitFor();await p2.locator('.st-online').waitFor();
 assert.equal((await getState(a)).plays,1);console.log('  ok save and resume STONKS through the existing shelf flow');
 // Complete a real two-phone game using card buttons, never storing derived state.
 await fixture('autoplay0');let commands=0;
 while(commands++<400){
  s=await getState(a);if(s.winner!==null)break;const by=E.actor(s),p=by===0?a:p2,pl=s.players[by];await ready(p);
  if(s.incoming.length){const c=C[s.incoming[0].id],g=c.groups.find(g=>pl.portfolios.some(x=>x.group===g&&x.cards.length<E.sectors[g].size))||c.groups[0];await p.selectOption('#st-group',g);const d=pl.portfolios.find(x=>x.group===g&&x.cards.length<E.sectors[g].size);await p.selectOption('#st-dest',d?.id||'');await clickCommand(p,()=>p.getByRole('button',{name:'Place incoming card',exact:true}).click());continue;}
  if(s.phase==='discard'){for(let i=0;i<pl.hand.length-7;i++)await p.locator('.st-controls input[type=checkbox]').nth(i).check();await clickCommand(p,()=>p.getByRole('button',{name:'Discard & finish turn',exact:true}).click());continue;}
  const company=pl.hand.find(id=>C[id].kind==='company'),wild=pl.hand.find(id=>C[id].kind==='wild'),bank=pl.hand.find(id=>['funding','action','revenue'].includes(C[id].kind));
  if(s.plays>=3||(!company&&!wild&&!bank)){await clickCommand(p,()=>p.getByRole('button',{name:'Finish turn',exact:true}).click());continue;}
  const card=company||wild||bank;await pick(p,card);
  if(company)await clickCommand(p,()=>p.getByRole('button',{name:'Lay company · 1 play',exact:true}).click());
  else if(wild){const g=C[wild].groups.find(g=>pl.portfolios.some(x=>x.group===g&&x.cards.length<E.sectors[g].size))||C[wild].groups[0];await p.selectOption('#st-group',g);const d=pl.portfolios.find(x=>x.group===g&&x.cards.length<E.sectors[g].size);await p.selectOption('#st-dest',d?.id||'');await clickCommand(p,()=>p.getByRole('button',{name:'Lay company · 1 play',exact:true}).click());}
  else await clickCommand(p,()=>p.getByRole('button',{name:'Bank '+C[bank].value+'M · 1 play',exact:true}).click());
  if(commands===15){await snap(a,'st-online-05-midgame');await snap(p2,'st-online-06-midgame-partner');await a.setViewportSize({width:1280,height:900});await snap(a,'st-online-desktop');await a.setViewportSize({width:390,height:844});await a.waitForTimeout(250);}
 }
 assert.notEqual(s.winner,null);assert.equal((await getState(p2)).winner,s.winner);await snap(s.winner===0?a:p2,'st-online-07-win');assert.deepEqual(errors,[]);console.log('  ok full two-phone game: '+commands+' commands, shared victory and no browser errors');
}finally{
 if(testCode){
  await Promise.all([a,p2].map(p=>p.evaluate(()=>closeTable()).catch(()=>{})));
  try { await a.evaluate(async code=>{await Net.doc('tables/'+code).delete();},testCode);console.log('  ok removed temporary test table '+testCode); }
  catch(e){console.warn('Could not clean up test table '+testCode+': '+e.message);}
 }
 await b.close();
}

