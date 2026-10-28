import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const {chromium}=createRequire(import.meta.url)('playwright'),context=vm.createContext({});
vm.runInContext(fs.readFileSync('public/js/stonks-data.js','utf8')+fs.readFileSync('public/js/stonks-engine.js','utf8')+'\nglobalThis.E=Stonks;',context);
const E=context.E,C=E.cards;
const browser=await chromium.launch({headless:!process.env.HEADED}),phone={viewport:{width:390,height:844},deviceScaleFactor:2,hasTouch:true};
const ca=await browser.newContext(phone),cb=await browser.newContext(phone),a=await ca.newPage(),b=await cb.newPage(),errors=[];
for(const p of [a,b])p.on('pageerror',e=>errors.push(e.message));
const snap=async(p,name)=>{await p.waitForTimeout(450);await p.screenshot({path:'tests/e2e/screens/'+name+'.png'});};
const state=p=>p.evaluate(()=>Stonks.replay({names:[G.table.host.name,G.table.guest.name],seed:G.match.seed,starter:0,rulesVersion:G.match.stRulesVersion||1,log:sortedKeys(G.match.plays).map(k=>G.match.plays[k])}));
async function fixture(seed,log=[]){
 const id='sthouse'+Date.now().toString(36);await Promise.all([a,b].map(p=>p.evaluate(id=>{Pref.set('intro:'+id,'1');Pref.set('howto:'+id,'1');},id)));
 await a.evaluate(async({id,seed,log})=>{await Net.doc(matchPath(id)).set({id,game:'st',stRulesVersion:2,seed,created:Date.now(),joined:{host:true,guest:true},rps:{r1:{host:'rock',guest:'scissors'},r2:{host:'paper',guest:'rock'}},plays:Object.fromEntries(log.map((c,i)=>['p'+String(i).padStart(5,'0'),c]))});await Net.doc('tables/'+G.code).update({current:id});},{id,seed,log});
 await Promise.all([a,b].map(p=>p.waitForFunction(id=>G.match?.id===id&&document.querySelectorAll('.st-table').length===1,id)));
}
async function command(p,action){const n=await p.evaluate(()=>Object.keys(G.match.plays||{}).length);await action();await Promise.all([a,b].map(q=>q.waitForFunction(n=>Object.keys(G.match.plays||{}).length>n,n)));}
const pick=(p,id)=>p.locator('.st-hand [data-card="'+id+'"]').click({position:{x:12,y:20}});
async function openStack(p,key){const stack=p.locator('[data-stack="'+key+'"]');if(await stack.getAttribute('aria-expanded')!=='true')await stack.click();}
function payment(s){const p=s.players[E.actor(s)],amount=s.pending.amount;let ids=E.assets(p).sort((x,y)=>C[y].value-C[x].value),chosen=[],total=0;for(const id of ids){if(total>=amount)break;chosen.push(id);total+=C[id].value;}for(let i=chosen.length-1;i>=0;i--)if(total-C[chosen[i]].value>=amount){total-=C[chosen[i]].value;chosen.splice(i,1);}return chosen;}
function next(s){
 const by=E.actor(s),p=s.players[by],opp=1-by,base={by};
 if(s.incoming.length){const c=C[s.incoming[0].id],dest=p.portfolios.find(x=>c.groups.includes(x.group)&&x.cards.length<E.sectors[x.group].size);return {...base,type:'receive',group:dest?.group||c.groups[0],dest:dest?.id||''};}
 if(s.pending)return {...base,...(s.pending.stage==='response'?{type:'pass'}:{type:'pay',cards:payment(s)})};
 if(s.phase==='discard')return {...base,type:'discard',cards:p.hand.slice(0,p.hand.length-7)};
 if(s.plays<3)for(const id of p.hand){
  const c=C[id],cmd={...base,type:'action',card:id,target:opp};
  if(c.kind==='revenue'||['growth','ipo'].includes(c.effect)){
   for(const port of p.portfolios)try{const candidate={...cmd,portfolio:port.id};E.apply(s,candidate);return candidate;}catch(_){}
  } else if(['pitch','party','invoice'].includes(c.effect))try{E.apply(s,cmd);return cmd;}catch(_){}
 }
 return p.hand.length?{...base,type:'bank',card:p.hand[0]}:{...base,type:'end'};
}
function scenario(predicate,prefix='house-ui'){
 for(let i=0;i<300;i++){
  const room={names:['Niramay','Saharsh'],seed:prefix+i,starter:0,rulesVersion:2,log:[]};let s=E.replay(room);
  for(let step=0;step<120&&s.winner===null;step++){
   if(predicate(s))return {room,s};const cmd=next(s);s=E.apply(s,cmd);room.log.push(cmd);
  }
 }
 throw Error('No legal scenario found');
}
async function selectPayment(p,s,ids){
 const by=E.actor(s),pl=s.players[by];
 for(const id of ids){const group=pl.treasury.includes(id)?'money':E.ownerPortfolio(pl,id).group;await openStack(p,by+':'+group);await p.locator('.st-own-table .st-pay-card[data-card="'+id+'"]').click();}
}
async function play(p,s,cmd){
 if(cmd.type==='bank'){await pick(p,cmd.card);await command(p,()=>p.getByRole('button',{name:'Bank '+C[cmd.card].value+'M · free',exact:true}).click());}
 else if(cmd.type==='end')await command(p,()=>p.getByRole('button',{name:'Finish turn',exact:true}).click());
 else if(cmd.type==='action'){
  await pick(p,cmd.card);if(cmd.portfolio)await p.selectOption('#st-portfolio',cmd.portfolio);
  await command(p,()=>p.getByRole('button',{name:/^Use action/}).click());
 } else if(cmd.type==='pass')await command(p,()=>p.getByRole('button',{name:'Pass response',exact:true}).click());
 else if(cmd.type==='pay'){await selectPayment(p,s,cmd.cards);await command(p,()=>p.getByRole('button',{name:cmd.cards.length?'Confirm payment':'Confirm no assets',exact:true}).click());}
 else if(cmd.type==='receive'){await p.selectOption('#st-group',cmd.group);await p.selectOption('#st-dest',cmd.dest);await command(p,()=>p.getByRole('button',{name:'Place incoming card',exact:true}).click());}
 else if(cmd.type==='discard'){for(const id of cmd.cards)await p.locator('.st-controls input[type=checkbox]').nth(s.players[cmd.by].hand.indexOf(id)).check();await command(p,()=>p.getByRole('button',{name:'Discard & finish turn',exact:true}).click());}
}
try{
 await Promise.all([a,b].map(p=>p.goto(process.env.E2E_URL||'http://localhost:3000')));
 await a.fill('#nameInput','Niramay');await a.getByRole('button',{name:'Set up a table',exact:true}).click();await a.locator('.code-card .tile').first().waitFor();const code=await a.evaluate(()=>G.code);
 await b.fill('#nameInput','Saharsh');await b.getByRole('button',{name:'Join with a code',exact:true}).click();await b.fill('#codeInput',code);await a.locator('.gbox.st').waitFor();await b.locator('.gbox.st').waitFor();await a.waitForTimeout(2700);
 await fixture('design9');let s=await state(a);assert.equal(s.rulesVersion,2);assert.ok(s.players.every(p=>p.hand.every(id=>['action','revenue'].includes(C[id].kind))));assert.equal(JSON.stringify(s),JSON.stringify(await state(b)));
 await snap(a,'st-house-01-table');const hand=await a.locator('.st-hand').boundingBox();assert.ok(hand.y+hand.height<=845,'the complete action hand fits on the phone');
 const group=s.players[0].portfolios[0].group,key='0:'+group,stack=a.locator('[data-stack="'+key+'"]');await stack.click();assert.equal(await stack.getAttribute('aria-expanded'),'true');await snap(a,'st-house-02-company-stack');await stack.click();assert.equal(await a.locator('[data-spread="'+key+'"]').count(),0);
 await openStack(a,'0:money');await snap(a,'st-house-03-treasury');await a.locator('[data-stack="0:money"]').click();
 await openStack(a,key);const wild=s.players[0].portfolios[0].cards.find(id=>C[id].kind==='wild');await command(a,()=>a.locator('[data-spread="'+key+'"] [data-card="'+wild+'"]').click());s=await state(a);assert.equal(E.ownerPortfolio(s.players[0],wild).group,C[wild].groups.find(g=>g!==group));assert.equal(s.plays,0);assert.equal(JSON.stringify(s),JSON.stringify(await state(b)));
 console.log('  ok automatic public assets, action-only hands, compact phone table, stack toggles and free dual-wild flip');
 const any=scenario(s=>s.turn===0&&!s.pending&&!s.incoming.length&&s.players[0].portfolios.some(p=>p.cards.some(id=>C[id].kind==='wild'&&!C[id].value)),'any-ui');await fixture(any.room.seed,any.room.log);s=await state(a);const anyId=s.players[0].portfolios.flatMap(p=>p.cards).find(id=>C[id].kind==='wild'&&!C[id].value),anyPort=E.ownerPortfolio(s.players[0],anyId);await openStack(a,'0:'+anyPort.group);const anyFace=a.locator('.st-own-table [data-card="'+anyId+'"]');assert.equal(await anyFace.locator('.st-rainbow i').count(),10);assert.ok((await anyFace.innerText()).includes('No payment value'));await snap(a,'st-house-09-any-sector-wild');await anyFace.click();const anyGroup=anyPort.group==='grey'?'green':'grey';await a.selectOption('#st-group',anyGroup);await command(a,()=>a.getByRole('button',{name:'Move card · free',exact:true}).click());assert.equal(E.ownerPortfolio((await state(a)).players[0],anyId).group,anyGroup);
 const spent=scenario(s=>s.plays===3&&!s.pending&&!s.incoming.length&&s.players[s.turn].hand.length>0,'spent-ui');await fixture(spent.room.seed,spent.room.log);s=await state(a);const payer=s.turn===0?a:b,bank=s.players[s.turn].hand[0];await pick(payer,bank);await snap(payer,'st-house-04-free-bank-after-three');await command(payer,()=>payer.getByRole('button',{name:'Bank '+C[bank].value+'M · free',exact:true}).click());assert.equal((await state(a)).plays,3);assert.ok((await state(a)).players[s.turn].treasury.includes(bank));
 console.log('  ok any-sector zero-value face and free banking after all three actions');
 // A real shuffled house-rule opening supports a counter-chain and mixed Treasury/Company payment.
 let legal;
 for(let i=0;i<20000;i++){
  const seed='legal-house'+i,t=E.create(['Niramay','Saharsh'],seed,0,2),p=t.players[1],cash=p.treasury.reduce((n,id)=>n+C[id].value,0),named=p.portfolios.flatMap(p=>p.cards).filter(id=>C[id].kind==='company');
  if(t.players[0].hand.some(id=>C[id].effect==='invoice')&&t.players[0].hand.some(id=>C[id].effect==='legal')&&p.hand.some(id=>C[id].effect==='legal')&&cash>0&&cash<5&&cash+named.reduce((n,id)=>n+C[id].value,0)>=5){legal={seed,t};break;}
 }
 assert.ok(legal);await fixture(legal.seed);s=await state(a);const invoice=s.players[0].hand.find(id=>C[id].effect==='invoice');await pick(a,invoice);await command(a,()=>a.getByRole('button',{name:'Use action',exact:true}).click());await command(b,()=>b.getByRole('button',{name:'Play Legal Team · free',exact:true}).click());await command(a,()=>a.getByRole('button',{name:'Play Legal Team · free',exact:true}).click());await command(b,()=>b.getByRole('button',{name:'Pass response',exact:true}).click());
 s=await state(b);let chosen=[...s.players[1].treasury,...s.players[1].portfolios.flatMap(p=>p.cards).filter(id=>C[id].kind==='company')],total=chosen.reduce((n,id)=>n+C[id].value,0);for(let i=chosen.length-1;i>=0;i--)if(total-C[chosen[i]].value>=5){total-=C[chosen[i]].value;chosen.splice(i,1);}
 await selectPayment(b,s,chosen);await snap(b,'st-house-05-payment-from-stacks');await command(b,()=>b.getByRole('button',{name:'Confirm payment',exact:true}).click());assert.equal(JSON.stringify(await state(a)),JSON.stringify(await state(b)));await b.reload();await b.locator('.st-table').waitFor();assert.equal(JSON.stringify(await state(a)),JSON.stringify(await state(b)));
 const savedState=JSON.stringify(await state(a));
 await a.locator('#bar [aria-label="Back to the shelf"]').click();await a.locator('#sheet').getByRole('button',{name:'Save and quit',exact:true}).click();await a.locator('.gbox.st .sticker.saved').waitFor({state:'visible'});
 if(await b.locator('#sheet:not([hidden])').count())await b.locator('#sheet').getByRole('button',{name:'OK',exact:true}).click();
 await a.locator('.gbox.st').click();await a.locator('#sheet').getByRole('button',{name:'Carry on the saved game',exact:true}).click();await b.locator('#sheet').getByRole('button',{name:'Carry on',exact:true}).click();await a.locator('.st-table').waitFor();await b.locator('.st-table').waitFor();assert.equal((await state(a)).rulesVersion,2);assert.equal(JSON.stringify(await state(a)),savedState);
 console.log('  ok house-rule Legal Team counters, payment from public stacks, reload and save/resume on both phones');
 await fixture('house-ui-complete');let commands=0;
 while(commands++<400){s=await state(a);if(s.winner!==null)break;const cmd=next(s),p=cmd.by===0?a:b;await play(p,s,cmd);if(commands===12){await snap(a,'st-house-06-midgame');await a.setViewportSize({width:1280,height:900});await snap(a,'st-house-07-desktop');await a.setViewportSize({width:390,height:844});}}
 assert.notEqual(s.winner,null);assert.equal((await state(b)).winner,s.winner);await snap(s.winner===0?a:b,'st-house-08-win');assert.deepEqual(errors,[]);console.log('  ok complete house-rule two-phone game: '+commands+' commands, matching winner, no browser errors');
}catch(e){await snap(a,'st-house-ERR-a').catch(()=>{});await snap(b,'st-house-ERR-b').catch(()=>{});console.error(await state(a).catch(()=>null));throw e;}finally{await browser.close();}
