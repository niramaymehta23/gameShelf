import { createRequire } from 'node:module';
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const {chromium}=createRequire(import.meta.url)('playwright');
const engineContext=vm.createContext({});
vm.runInContext(fs.readFileSync('public/js/stonks-data.js','utf8')+fs.readFileSync('public/js/stonks-engine.js','utf8')+'\nglobalThis.E=Stonks;',engineContext);
const E=engineContext.E,C=E.cards, shot='tests/e2e/screens/';fs.mkdirSync(shot,{recursive:true});
const browser=await chromium.launch({headless:!process.env.HEADED});const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,hasTouch:true});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const snap=name=>page.screenshot({path:shot+name+'.png',fullPage:false});
const reveal=async()=>page.getByRole('button',{name:/reveal my hand/}).click();
const load=async room=>{await page.evaluate(room=>{Pref.set('stonks-room',JSON.stringify(room));},room);await page.reload();await page.locator('.st-screen').waitFor();};
try{
 await page.goto((process.env.E2E_URL||'http://localhost:3000')+'/?stonks=1');await page.locator('#st-name-0').fill('Niramay');await page.locator('#st-name-1').fill('Saharsh');await snap('st-01-setup');
 await page.getByRole('button',{name:'Who goes first?'}).click();
 for(let i=0;i<2;i++){
   await page.getByRole('button',{name:'I’m Niramay · ready'}).click();await page.locator('.choices').getByRole('button',{name:'Rock',exact:true}).click();
   assert.equal(await page.locator('.choices').count(),0,'first pick hidden');
   await page.getByRole('button',{name:'I’m Saharsh · ready'}).click();await page.locator('.choices').getByRole('button',{name:'Scissors',exact:true}).click();
 }
 await snap('st-02-rps');await page.getByRole('button',{name:'Open the table'}).click();
 assert.equal(await page.locator('.st-hand .st-card').count(),0);await reveal();assert.ok(await page.locator('.st-hand .st-card').evaluateAll(es=>es.every(e=>['action','revenue'].includes(Stonks.cards[e.dataset.card].kind))));await snap('st-03-hand');
 await page.reload();assert.equal(await page.locator('.st-hand .st-card').count(),0);await reveal();
 await page.getByRole('button',{name:'Rules & cards',exact:true}).click();await page.locator('.st-rules summary',{hasText:'Payments'}).click();await snap('st-04-rules');await page.getByRole('button',{name:'Back to the table'}).click();
 // Generate legal replay fixtures from a real shuffled deck, never inject derived game state.
 let room,s;
 for(let i=0;i<20000;i++){
   room={version:1,code:'TEST',names:['Niramay','Saharsh'],seed:'ui'+i,starter:0,dealt:true,rps:{r1:{host:'rock',guest:'scissors'},r2:{host:'rock',guest:'scissors'}},log:[]};s=E.replay(room);
   if(s.players[0].hand.some(id=>C[id].effect==='invoice')&&s.players[0].hand.some(id=>C[id].effect==='legal')&&s.players[1].hand.some(id=>C[id].effect==='legal')&&s.players[1].hand.some(id=>C[id].kind==='funding'))break;
 }
 const append=cmd=>{cmd={...cmd,by:E.actor(s)};s=E.apply(s,cmd);room.log.push(cmd);};
 const invoice=s.players[0].hand.find(id=>C[id].effect==='invoice');
 append({type:'end'});const funds=s.players[1].hand.filter(id=>C[id].kind==='funding').sort((a,b)=>C[b].value-C[a].value).slice(0,3);
 for(const card of funds)append({type:'bank',card});append({type:'end'});
 append({type:'action',card:invoice,target:1});const responseRoom=JSON.parse(JSON.stringify(room));
 await load(room);await reveal();assert.ok((await page.locator('.st-status').innerText()).includes('Saharsh'));await snap('st-05-response');
 await page.getByRole('button',{name:/Play Legal Team/}).first().click();assert.equal(await page.locator('.st-hand .st-card').count(),0);await reveal();assert.ok((await page.locator('.st-status').innerText()).includes('Niramay'));
 await page.getByRole('button',{name:/Play Legal Team/}).first().click();await reveal();await page.getByRole('button',{name:'Pass response',exact:true}).click();
 await snap('st-06-payment');
 // Select every needed payable asset until covered, retaining no redundant cards.
 const chosen=[];let total=0;for(const f of funds){if(total>=5)break;chosen.push(f);total+=C[f].value;}
 for(let j=chosen.length-1;j>=0;j--)if(total-C[chosen[j]].value>=5){total-=C[chosen[j]].value;chosen.splice(j,1);}
 for(const f of chosen)await page.locator('.st-own-table .st-pay-card[data-card="'+f+'"]').click();
 await page.getByRole('button',{name:'Confirm payment',exact:true}).click();
 const after=await page.evaluate(()=>JSON.parse(window.render_game_to_text()));assert.ok(after.required==='Niramay');assert.equal(after.hand,'hidden');
 await reveal();await page.getByRole('button',{name:'Finish turn',exact:true}).click();
 // Discard if needed, then verify handoff.
 if(await page.getByRole('button',{name:'Discard & finish turn'}).count()){
   const txt=await page.locator('.st-controls h2').innerText();const count=+txt.match(/Discard (\d+)/)[1];for(let i=0;i<count;i++)await page.locator('.st-controls input[type=checkbox]').nth(i).check();await page.getByRole('button',{name:'Discard & finish turn'}).click();
 }
 assert.equal(await page.locator('.st-hand .st-card').count(),0);
 // Realistic built-up board from legal free turns. Place companies and bank actions until populated.
 room=responseRoom;room.log=room.log.slice(0,-1);s=E.replay(room);
 for(let turn=0;turn<12&&s.winner===null;turn++){
   for(let play=0;play<3;play++){
     const p=s.players[s.turn],company=p.hand.find(id=>C[id].kind==='company'),bank=p.hand.find(id=>['action','funding','revenue'].includes(C[id].kind));
     if(company)append({type:'lay',card:company});else if(bank)append({type:'bank',card:bank});else break;
     if(s.winner!==null)break;
   }
   if(s.winner!==null)break;
   append({type:'end'});if(s.phase==='discard')append({type:'discard',cards:s.players[s.turn].hand.slice(0,s.players[s.turn].hand.length-7)});
 }
 await load(room);if(await page.getByRole('button',{name:/reveal my hand/}).count())await reveal();await snap('st-07-portfolios-mobile');
 assert.equal(await page.evaluate(()=>document.querySelector('.st-screen').scrollWidth>document.querySelector('.st-screen').clientWidth),false,'no page overflow');
 await page.setViewportSize({width:1280,height:900});await snap('st-08-desktop');
 assert.deepEqual(errors,[]);console.log('STONKS UI: setup, best-of-three opener, private handoff/reload, response counters, payments, populated boards and desktop/mobile screenshots passed.');
}finally{await browser.close();}
