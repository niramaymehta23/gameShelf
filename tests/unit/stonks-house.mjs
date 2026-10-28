import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const ctx=vm.createContext({});
vm.runInContext(fs.readFileSync('public/js/stonks-data.js','utf8')+fs.readFileSync('public/js/stonks-engine.js','utf8')+'\nglobalThis.E=Stonks;',ctx);
const E=ctx.E,C=E.cards,clone=x=>JSON.parse(JSON.stringify(x));let count=0;
const test=(name,fn)=>{fn();console.log('  ok '+name);count++;};
const effect=(name,n=0)=>Object.keys(C).filter(id=>C[id].effect===name)[n];
const go=(s,type,args={})=>E.apply(s,{by:E.actor(s),type,...args});
const all=s=>[...s.deck,...s.discard,...s.players.flatMap(p=>[...p.hand,...p.treasury,...p.portfolios.flatMap(p=>[...p.cards,...p.upgrades])]),...s.incoming.map(x=>x.id)];
const bare=(deck=[])=>{const s=clone(E.create(['A','B'],'house',0,2));s.players.forEach(p=>{p.hand=[];p.treasury=[];p.portfolios=[];});s.deck=deck.slice();s.discard=[];s.turn=0;s.plays=0;s.phase='play';s.winner=null;s.serial=0;return s;};
const port=(s,by,group,ids)=>s.players[by].portfolios.push({id:'p'+ ++s.serial,group,cards:ids,upgrades:[]});
test('new rules route the same twelve dealt cards without losing or duplicating any card',()=>{
 const s=E.create(['A','B'],'house-deal',0,2),t=E.create(['A','B'],'house-deal',0,2);
 assert.equal(JSON.stringify(s),JSON.stringify(t));assert.equal(s.deck.length,94);
 assert.equal(all(s).length,106);assert.equal(new Set(all(s)).size,106);
 assert.ok(s.players.every(p=>p.hand.every(id=>['action','revenue'].includes(C[id].kind))));
 const size=p=>p.hand.length+p.treasury.length+p.portfolios.reduce((n,p)=>n+p.cards.length,0);
 assert.equal(size(s.players[0]),7);assert.equal(size(s.players[1]),5);assert.equal(s.plays,0);
});
test('turn draw places Companies and Funding automatically and costs no plays',()=>{
 let s=bare(['F01','C01']);s.players[1].hand=[effect('legal')];s=go(s,'end');
 assert.equal(s.turn,1);assert.equal(s.plays,0);assert.equal(s.players[1].hand.length,1);assert.equal(s.players[1].treasury[0],'F01');assert.equal(s.players[1].portfolios[0].cards[0],'C01');
});
test('an empty action hand draws five and routes the whole batch',()=>{
 let s=bare(['F01','C01','W01','C03',effect('pitch')]);s=go(s,'end');
 assert.equal(s.deck.length,0);assert.equal(s.players[1].hand.length,1);assert.equal(s.players[1].treasury.length,1);assert.equal(s.players[1].portfolios.reduce((n,p)=>n+p.cards.length,0),3);
});
test('matching named Companies fill their matching portfolio, with overflow starting another',()=>{
 let s=bare(['C02','C01']);s=go(s,'end');assert.equal(s.players[1].portfolios.length,1);assert.equal(s.players[1].portfolios[0].cards.length,2);assert.ok(E.complete(s.players[1].portfolios[0]));
});
test('automatic wild placement considers all named Companies in the draw batch first',()=>{
 let s=bare(['C03','W01']);s=go(s,'end');assert.equal(s.incoming.length,0);assert.equal(s.players[1].portfolios.length,1);assert.equal(s.players[1].portfolios[0].group,'lblue');assert.equal(s.players[1].portfolios[0].cards.length,2);
});
test('Conglomerate starts on the table with zero revenue and cannot pay or be banked',()=>{
 let s=bare(['W10']);s=go(s,'end');const p=s.players[1].portfolios[0];assert.equal(E.revenue(p),0);assert.equal(E.complete(p),false);assert.equal(E.assets(s.players[1]).length,0);
 assert.throws(()=>go(s,'bank',{card:'W10'}));
});
test('banking actions and Revenue Calls is free even after all three plays',()=>{
 let s=bare();s.plays=3;s.players[0].hand=[effect('pitch'),'R01'];s=go(s,'bank',{card:effect('pitch')});s=go(s,'bank',{card:'R01'});
 assert.equal(s.plays,3);assert.equal(s.turn,0);assert.equal(s.players[0].treasury.length,2);assert.equal(s.players[0].hand.length,0);
 assert.throws(()=>go(s,'action',{card:'R01'}),'Treasury money cannot be reused as an action');
});
test('Companies cannot be banked, and failed commands never mutate their input',()=>{
 const s=bare();s.players[0].hand=['C01'];const before=JSON.stringify(s);assert.throws(()=>go(s,'bank',{card:'C01'}));assert.equal(JSON.stringify(s),before);
});
test('Pitch Deck uses one play and routes its two drawn cards onto the table',()=>{
 let s=bare(['F01','C01']);s.players[0].hand=[effect('pitch')];s=go(s,'action',{card:effect('pitch')});assert.equal(s.plays,1);assert.equal(s.players[0].hand.length,0);assert.equal(s.players[0].treasury[0],'F01');assert.equal(s.players[0].portfolios[0].cards[0],'C01');
});
test('automatic placement detects victory at the beginning of the next turn',()=>{
 let s=bare(['C28']);port(s,1,'brown',['C01','C02']);port(s,1,'dblue',['C21','C22']);port(s,1,'grey',['C27']);s.players[1].hand=[effect('legal')];s=go(s,'end');assert.equal(s.winner,1);assert.equal(s.phase,'over');assert.throws(()=>go(s,'end'));
});
test('a two-colour wild can flip free between sectors without changing payment value',()=>{
 let s=bare();port(s,0,'brown',['C01','W01']);const id=s.players[0].portfolios[0].id;s=go(s,'move',{card:'W01',group:'lblue',dest:''});assert.equal(s.plays,0);assert.equal(E.ownerPortfolio(s.players[0],'W01').group,'lblue');assert.equal(C.W01.value,1);assert.equal(s.players[0].portfolios.find(p=>p.id===id).cards.length,1);
});
test('Legal Team chains and payment still work, then free banking remains legal at play three',()=>{
 let s=bare(),invoice=effect('invoice'),a=effect('legal'),b=effect('legal',1),pitch=effect('pitch');s.plays=2;s.players[0].hand=[invoice,a,pitch];s.players[1].hand=[b];s.players[1].treasury=['F18'];
 s=go(s,'action',{card:invoice,target:1});assert.equal(s.plays,3);assert.throws(()=>go(s,'bank',{card:b}));
 s=go(s,'legal',{card:b});s=go(s,'legal',{card:a});s=go(s,'pass');assert.equal(s.pending.stage,'payment');s=go(s,'pay',{cards:['F18']});assert.equal(s.pending,null);assert.equal(s.plays,3);s=go(s,'bank',{card:pitch});assert.equal(s.plays,3);assert.ok(s.players[0].treasury.includes(pitch));
});
test('old saved games retain original hands and one-play banking',()=>{
 const room={names:['A','B'],seed:'legacy',starter:0,log:[]};let s=E.replay(room);assert.equal(s.rulesVersion,1);assert.equal(s.players[0].hand.length,7);assert.equal(s.players[1].hand.length,5);
 const card=s.players[0].hand.find(id=>['action','revenue','funding'].includes(C[id].kind));s=go(s,'bank',{card});assert.equal(s.plays,1);
});
test('new-rule replays conserve every card and reach a shared winner across 100 complete games',()=>{
 for(let seed=0;seed<100;seed++){
  const room={names:['A','B'],seed:'house-complete'+seed,starter:seed%2,rulesVersion:2,log:[]};let s=E.replay(room),n=0;
  while(s.winner===null&&n++<300){const p=s.players[E.actor(s)],cmd={by:E.actor(s),type:p.hand.length?'bank':'end',...(p.hand.length?{card:p.hand[0]}:{})};s=E.apply(s,cmd);room.log.push(cmd);const ids=all(s);assert.equal(ids.length,106);assert.equal(new Set(ids).size,106);assert.ok(s.players.every(p=>p.hand.every(id=>['action','revenue'].includes(C[id].kind))));}
  assert.notEqual(s.winner,null,'seed '+seed+' finishes');assert.equal(JSON.stringify(E.replay(room)),JSON.stringify(s));
 }
});
console.log('\n'+count+' STONKS house-rule tests passed.');
