import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const ctx = vm.createContext({});
vm.runInContext(fs.readFileSync('public/js/stonks-data.js','utf8') + fs.readFileSync('public/js/stonks-engine.js','utf8') + '\nglobalThis.engine=Stonks;globalThis.data=STONKS_DATA;',ctx);
const E = ctx.engine, C = E.cards;
let n = 0;
function test(name, fn) { fn(); console.log('  ok ' + name); n++; }
const id = (effect, index=0) => Object.keys(C).filter(i=>C[i].effect===effect)[index];
const clone = s=>JSON.parse(JSON.stringify(s));
const base = (players=2) => { const s=clone(E.create(Array.from({length:players},(_,i)=>'Player '+i),'unit',0)); s.players.forEach(p=>{p.hand=[];p.treasury=[];p.portfolios=[];}); return s; };
const port = (s, by, group, ids, upgrades=[]) => { const p={id:'p'+ ++s.serial,group,cards:ids,upgrades};s.players[by].portfolios.push(p);return p; };
const co = group => Object.keys(C).filter(i=>C[i].kind==='company'&&C[i].group===group);
const go = (s, type, fields={})=>E.apply(s,{by:E.actor(s),type,...fields});
const fails=(s,type,fields={},pattern)=>assert.throws(()=>go(s,type,fields),pattern);
const attack=(s,card,fields={})=>{s.players[0].hand.push(card);return go(s,'action',{card,...fields});};
const resolve=s=>go(s,'pass');
test('exact inventory, IDs, company roster and 57M funding',()=>{
 const d=ctx.data; assert.equal(d.cards.length,110); assert.equal(new Set(Object.keys(C)).size,110);
 for(const [k,count] of Object.entries({company:28,wild:11,action:34,revenue:13,funding:20,reference:4})) assert.equal(d.cards.filter(c=>c.kind===k).length,count);
 assert.equal(d.cards.filter(c=>c.kind==='funding').reduce((n,c)=>n+c.value,0),57);
 assert.equal(C.C28.title,'BeePee Power');assert.equal(C.W02.value,4); assert.equal(C.A34.title,'IPO Launch');assert.equal(C.R13.title,'Marketwide Revenue');
 for(const sec of d.sectors) { assert.equal(co(sec.key).length,sec.size);for(const i of co(sec.key))assert.equal(C[i].value,sec.value); }
 const data=JSON.parse(fs.readFileSync('docs/stonks-cards.json')); assert.deepEqual(JSON.parse(JSON.stringify(d)),data);
});
test('deterministic shuffle, five each plus starter draw, no references',()=>{
 const s=E.create(['A','B'],'same',1),t=E.create(['A','B'],'same',1); assert.equal(JSON.stringify(s),JSON.stringify(t));
 assert.equal(s.players[0].hand.length,5);assert.equal(s.players[1].hand.length,7);assert.equal(s.deck.length,94);assert.ok(s.deck.every(i=>!i.startsWith('Q')));
 for(let n=2;n<=5;n++)assert.equal(E.create(Array(n).fill('P'),'n').players.length,n);
});
test('turn validation and immutable failures',()=>{let s=base();s.players[0].hand=['C01','F01'];const before=JSON.stringify(s);assert.throws(()=>E.apply(s,{by:1,type:'lay',card:'C01'}));fails(s,'bank',{card:'C01'});assert.equal(JSON.stringify(s),before);s=go(s,'bank',{card:'F01'});assert.equal(s.plays,1);assert.equal(s.players[0].treasury[0],'F01');});
test('company and wild placement; size cap; complete needs named company',()=>{
 let s=base();s.players[0].hand=['C01','W01','W10','W11'];s=go(s,'lay',{card:'C01'});s=go(s,'lay',{card:'W01',group:'brown',dest:s.players[0].portfolios[0].id});assert.ok(E.complete(s.players[0].portfolios[0]));
 fails(s,'lay',{card:'W10',group:'brown',dest:s.players[0].portfolios[0].id});
 s=base();const p=port(s,0,'brown',['W10','W11']);assert.equal(E.complete(p),false);assert.equal(E.revenue(p),0);assert.equal(E.revenue(port(s,0,'brown',['W01'])),1);
});
test('Pitch Deck draws two but costs one play; max three plays',()=>{let s=base();s.players[0].hand=[id('pitch')];s=go(s,'action',{card:id('pitch')});assert.equal(s.players[0].hand.length,2);assert.equal(s.plays,1);s.plays=3;fails(s,'bank',{card:s.players[0].hand[0]});});
test('empty hand draws five next turn, not immediately; discard only excess',()=>{
 let s=base();s.players[1].hand=[];s=go(s,'end');assert.equal(s.players[1].hand.length,5);assert.equal(s.turn,1);
 s=base();s.players[0].hand=Object.keys(C).slice(0,9);fails(s,'discard',{cards:['C01','C02']});s=go(s,'end');assert.equal(s.phase,'discard');fails(s,'discard',{cards:['C01']});s=go(s,'discard',{cards:['C01','C02']});assert.equal(s.players[0].hand.length,7);assert.equal(s.turn,1);
});
test('reshuffle when exhausted; no piles still allows turn',()=>{let s=base();s.deck=[];s.discard=['F01','F02'];s=go(s,'end');assert.equal(s.players[1].hand.length,2);assert.equal(s.reshuffles,1);s=base();s.deck=[];s=go(s,'end');assert.equal(s.players[1].hand.length,0);});
test('revenue ladder used once; upgrades and two Hypes produce 60M',()=>{
 let s=base();const p=port(s,0,'dblue',co('dblue'),[id('growth'),id('ipo')]);assert.equal(E.revenue(p),15);s.players[0].hand=[id('hype'),id('hype',1)];s=attack(s,'R07',{portfolio:p.id,hype:[id('hype'),id('hype',1)]});assert.equal(s.pending.amount,60);assert.equal(s.plays,3);
 s=base();const p2=port(s,0,'green',co('green').slice(0,2));assert.equal(E.revenue(p2),4);
});
test('Revenue pair restrictions and Marketwide targets one; Funding Party all opponents',()=>{
 let s=base(3);const p=port(s,0,'green',co('green'));s.players[0].hand=['R01'];fails(s,'action',{card:'R01',portfolio:p.id});
 s=attack(s,'R11',{portfolio:p.id,target:2});assert.equal(s.pending.targets.length,1);assert.equal(s.pending.targets[0],2);
 s=attack(base(3),id('party'));assert.equal(s.pending.targets.length,2);assert.equal(s.pending.amount,2);
});
test('Legal Team chain with three reactions cancels takeover; counters free after play three',()=>{
 let s=base();const p=port(s,1,'green',co('green'),[id('growth'),id('ipo')]);s.plays=2;s.players[1].hand=[id('legal'),id('legal',2)];s.players[0].hand=[id('legal',1)];
 s=attack(s,id('takeover'),{target:1,portfolio:p.id});s=go(s,'legal',{card:id('legal')});s=go(s,'legal',{card:id('legal',1)});s=go(s,'legal',{card:id('legal',2)});s=resolve(s);
 assert.equal(s.pending,null);assert.equal(s.players[1].portfolios.length,1);assert.equal(s.players[0].portfolios.length,0);assert.equal(s.plays,3);assert.equal(s.discard.length,4);
});
test('even Legal Team chain restores action; takeover preserves upgrades intact',()=>{
 let s=base();const p=port(s,1,'brown',co('brown'));s.players[1].hand=[id('legal')];s.players[0].hand=[id('legal',1)];s=attack(s,id('takeover'),{target:1,portfolio:p.id});s=go(s,'legal',{card:id('legal')});s=go(s,'legal',{card:id('legal',1)});s=resolve(s);assert.equal(s.players[0].portfolios[0].cards.length,2);
 s=base();const x=port(s,1,'green',co('green'),[id('growth'),id('ipo')]);s=attack(s,id('takeover'),{target:1,portfolio:x.id});s=resolve(s);assert.equal(s.players[0].portfolios[0].upgrades.length,2);
});
test('multiplayer Legal Team protects only defender and cancels whole boosted demand',()=>{
 let s=base(3);const p=port(s,0,'brown',['C01']);s.players[0].hand=[id('hype')];s.players[1].hand=[id('legal')];s=attack(s,'R01',{portfolio:p.id,hype:[id('hype')]});assert.equal(s.pending.amount,2);s=go(s,'legal',{card:id('legal')});s=resolve(s);assert.equal(s.pending.responder,2);s=resolve(s);assert.equal(s.pending.stage,'payment');s=go(s,'pay',{cards:[]});assert.equal(s.pending,null);
});
test('payment choice, overpayment without change, rejects hand and redundant cards',()=>{
 let s=base();s.players[1].treasury=['F18','F01'];s.players[1].hand=['F20'];s=resolve(attack(s,id('invoice'),{target:1}));assert.equal(s.pending.amount,5);
 fails(s,'pay',{cards:['F20']});fails(s,'pay',{cards:['F01']});fails(s,'pay',{cards:['F18','F01']});s=go(s,'pay',{cards:['F18']});assert.ok(s.players[0].treasury.includes('F18'));assert.ok(s.players[1].treasury.includes('F01'));assert.ok(s.players[1].hand.includes('F20'));
});
test('partial debt forgiven; Conglomerate cannot pay; complete portfolios can break',()=>{
 let s=base();port(s,1,'grey',['C27','W10']);s.players[1].treasury=['F01'];s=resolve(attack(s,id('invoice'),{target:1}));fails(s,'pay',{cards:['C27','W10','F01']});s=go(s,'pay',{cards:['C27','F01']});assert.equal(s.pending,null);assert.equal(s.players[1].portfolios[0].cards[0],'W10');assert.equal(s.players[0].treasury[0],'F01');
});
test('banked actions stay money; selected upgrades pay as money, unsupported launch discarded',()=>{
 let s=base();port(s,1,'green',co('green'),[id('growth'),id('ipo')]);s.players[1].treasury=[id('legal')];s=resolve(attack(s,id('invoice'),{target:1}));s=go(s,'pay',{cards:[id('growth'),id('ipo')]});assert.ok(s.players[0].treasury.includes(id('growth')));assert.equal(s.players[1].portfolios[0].upgrades.length,0);
 s=base();port(s,1,'green',co('green'),[id('growth'),id('ipo')]);s=resolve(attack(s,id('party')));s=go(s,'pay',{cards:[id('growth')]});assert.ok(s.discard.includes(id('ipo')));
});
test('breaking complete portfolio discards remaining upgrades; all selected assets transfer atomically',()=>{
 let s=base();port(s,1,'green',co('green'),[id('growth'),id('ipo')]);s=resolve(attack(s,id('invoice'),{target:1}));s=go(s,'pay',{cards:[co('green')[0],id('growth')]});assert.ok(s.players[0].treasury.includes(id('growth')));assert.ok(s.discard.includes(id('ipo')));assert.equal(s.players[1].portfolios[0].cards.length,2);
});
test('Stealth Buyout targets incomplete only; incoming wild recipient chooses',()=>{
 let s=base();const p=port(s,1,'brown',co('brown'));s.players[0].hand=[id('steal')];fails(s,'action',{card:id('steal'),target:1,take:'C01'});
 s=base();port(s,1,'brown',['W01']);s=attack(s,id('steal'),{target:1,take:'W01'});s=resolve(s);assert.equal(s.incoming[0].by,0);s=go(s,'receive',{group:'lblue'});assert.equal(s.players[0].portfolios[0].group,'lblue');
});
test('Asset Swap can give from own complete portfolio; cancellation exchanges neither',()=>{
 let s=base();port(s,0,'brown',co('brown'));port(s,1,'green',[co('green')[0]]);s=attack(s,id('swap'),{target:1,give:'C01',take:co('green')[0]});s=resolve(s);assert.ok(s.players[1].portfolios.some(p=>p.cards.includes('C01')));assert.ok(s.players[0].portfolios.some(p=>p.cards.includes(co('green')[0])));
 s=base();port(s,0,'brown',['C01']);port(s,1,'green',[co('green')[0]]);s.players[1].hand=[id('legal')];s=attack(s,id('swap'),{target:1,give:'C01',take:co('green')[0]});s=go(s,'legal',{card:id('legal')});s=resolve(s);assert.ok(s.players[0].portfolios[0].cards.includes('C01'));
});
test('upgrade validation, free movement and atomic named replacement preserve support',()=>{
 let s=base();const p=port(s,0,'dblue',[co('dblue')[0],'W07']);const q=port(s,0,'green',co('green'));s.players[0].hand=[id('growth'),id('ipo'),co('dblue')[1]];
 s=go(s,'action',{card:id('growth'),portfolio:p.id});s=go(s,'action',{card:id('ipo'),portfolio:p.id});s=go(s,'moveUpgrade',{card:id('growth'),dest:q.id});assert.equal(s.plays,2);assert.equal(s.players[0].portfolios[1].upgrades.length,2);
 s=go(s,'lay',{card:co('dblue')[1],dest:p.id,replace:'W07'});s=go(s,'receive',{group:'green'});assert.equal(s.players[0].portfolios[0].cards.length,2);
 s=base();const util=port(s,0,'grey',co('grey'));s.players[0].hand=[id('growth')];fails(s,'action',{card:id('growth'),portfolio:util.id});
});
test('free reassignment breaks portfolio and discards upgrades',()=>{
 let s=base();const p=port(s,0,'dblue',[co('dblue')[0],'W07'],[id('growth'),id('ipo')]);s=go(s,'move',{card:'W07',group:'green'});assert.equal(s.plays,0);assert.equal(s.players[0].portfolios.find(x=>x.id===p.id).upgrades.length,0);assert.equal(s.discard.length,2);
});
test('three different groups win; duplicate colours and wild-only do not',()=>{
 let s=base();port(s,0,'brown',co('brown'));port(s,0,'grey',co('grey'));port(s,0,'dblue',[co('dblue')[0]]);s.players[0].hand=[co('dblue')[1]];s=go(s,'lay',{card:co('dblue')[1]});assert.equal(s.winner,0);fails(s,'end');
 s=base();port(s,0,'brown',co('brown'));port(s,0,'brown',['W10','W11']);port(s,0,'grey',co('grey'));assert.equal(E.colours(s.players[0]).length,2);
});
test('payment can win outside turn, including incoming wild before next payer',()=>{
 let s=base();port(s,1,'brown',co('brown'));port(s,1,'grey',co('grey'));port(s,1,'dblue',[co('dblue')[0]]);port(s,0,'dblue',[co('dblue')[1]]);
 s.turn=1;s.players[1].hand=[id('invoice')];s=go(s,'action',{card:id('invoice'),target:0});s=resolve(s);s=go(s,'pay',{cards:[co('dblue')[1]]});assert.equal(s.winner,1);
 // Receiver is the attacker here; a named Company payment completes their third group.
 s=base(3);port(s,0,'brown',co('brown'));port(s,0,'grey',co('grey'));port(s,0,'dblue',[co('dblue')[0]]);port(s,1,'green',['W07']);s=resolve(attack(s,id('party')));s=go(s,'pay',{cards:['W07']});assert.equal(s.winner,null);s=go(s,'receive',{group:'dblue',dest:s.players[0].portfolios[2].id});assert.equal(s.winner,0);assert.equal(s.pending,null);
});
test('swap simultaneous third portfolios gives active player victory',()=>{
 let s=base();for(let i=0;i<2;i++){port(s,i,'brown',co('brown'));port(s,i,'grey',co('grey'));}port(s,0,'dblue',[co('dblue')[0],'W07']);port(s,1,'green',co('green').slice(0,2));
 // Neither starts at three: active swaps its wild into opponent green and receives BatGPT.
 s.players[0].portfolios[2].cards=['W07'];s.players[0].portfolios[2].group='green';port(s,0,'dblue',[co('dblue')[0]]);port(s,1,'dblue',[co('dblue')[1]]);
 s=attack(s,id('swap'),{target:1,give:'W07',take:co('dblue')[1]});s=resolve(s);s=go(s,'receive',{group:'green',dest:s.players[1].portfolios.find(p=>p.group==='green').id});assert.equal(s.winner,0);
});
test('real shuffled games preserve every card and reach victory',()=>{
 for(let seed=0;seed<20;seed++){
  let s=E.create(['A','B'],'autoplay'+seed),step=0;
  const verify=()=>{const ids=[...s.deck,...s.discard,...s.incoming.map(x=>x.id),...s.players.flatMap(p=>[...p.hand,...p.treasury,...p.portfolios.flatMap(x=>[...x.cards,...x.upgrades])])];assert.equal(ids.length,106);assert.equal(new Set(ids).size,106);};
  while(s.winner===null&&step++<2000){
   verify();const by=E.actor(s),p=s.players[by];
   if(s.incoming.length){const id=s.incoming[0].id,g=C[id].groups.find(g=>p.portfolios.some(x=>x.group===g&&x.cards.length<E.sectors[g].size))||C[id].groups[0];const d=p.portfolios.find(x=>x.group===g&&x.cards.length<E.sectors[g].size);s=go(s,'receive',{group:g,dest:d?.id||''});continue;}
   if(s.pending){if(s.pending.stage==='response')s=go(s,'pass');else{const pay=[];let total=0;const available=E.assets(p).sort((a,b)=>C[a].value-C[b].value);for(const id of available){if(total>=s.pending.amount)break;pay.push(id);total+=C[id].value;}for(let i=pay.length-1;i>=0;i--)if(total-C[pay[i]].value>=s.pending.amount){total-=C[pay[i]].value;pay.splice(i,1);}s=go(s,'pay',{cards:pay});}continue;}
   if(s.phase==='discard'){s=go(s,'discard',{cards:p.hand.slice(0,p.hand.length-7)});continue;}
   const company=p.hand.find(id=>C[id].kind==='company'),wild=p.hand.find(id=>C[id].kind==='wild'),bank=p.hand.find(id=>['funding','action','revenue'].includes(C[id].kind));
   if(s.plays>=3||(!company&&!wild&&!bank)){s=go(s,'end');continue;}
   if(company)s=go(s,'lay',{card:company});else if(wild){const g=C[wild].groups.find(g=>p.portfolios.some(x=>x.group===g&&x.cards.length<E.sectors[g].size))||C[wild].groups[0];const d=p.portfolios.find(x=>x.group===g&&x.cards.length<E.sectors[g].size);s=go(s,'lay',{card:wild,group:g,dest:d?.id||''});}else s=go(s,'bank',{card:bank});
  }
  verify();assert.notEqual(s.winner,null,'seed '+seed+' should produce a winner');
 }
});

test('opponent may win from an incoming swap outside their turn',()=>{
 let s=base();port(s,1,'brown',co('brown'));port(s,1,'dblue',co('dblue'));port(s,1,'grey',['C27']);port(s,1,'green',[co('green')[0]]);port(s,0,'grey',['C28']);
 s=attack(s,id('swap'),{target:1,give:'C28',take:co('green')[0]});s=resolve(s);assert.equal(s.winner,1);
});
test('played named Company may replace a wild atomically for free',()=>{
 let s=base();const to=port(s,0,'dblue',[co('dblue')[0],'W07'],[id('growth'),id('ipo')]);port(s,0,'dblue',[co('dblue')[1]]);
 s=go(s,'replace',{card:co('dblue')[1],dest:to.id,replace:'W07'});assert.equal(s.plays,0);assert.equal(s.players[0].portfolios[0].upgrades.length,2);s=go(s,'receive',{group:'green'});assert.ok(E.complete(s.players[0].portfolios[0]));
});
console.log('\n'+n+' STONKS rules tests passed.');
