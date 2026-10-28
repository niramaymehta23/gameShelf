import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const ctx=vm.createContext({clone:x=>JSON.parse(JSON.stringify(x)),sortedKeys:o=>Object.keys(o||{}).sort(),other:s=>s==='host'?'guest':'host',rpsState:()=>({starter:'host'})});
vm.runInContext(fs.readFileSync('public/js/hues.js','utf8')+'\nglobalThis.E={hueInitial,hueApply,huState,hueCanSay,hueCanCall,hueNeedsNotice,hueFits,hueFitsAll,deck:HUE_DECK};',ctx);
const E=ctx.E,D=E.deck;let n=0,seq=0;
const test=(title,fn)=>{fn();console.log('  ok '+title);n++;};
const ids=(kind,colour)=>D.filter(c=>c.k===kind&&(colour===undefined||c.c===colour)).map(c=>c.id);
const num=(colour,value,copy=0)=>D.filter(c=>c.k==='n'&&c.c===colour&&c.v===value)[copy].id;
const base=(rules='custom')=>E.hueInitial({id:'test',seed:'test',hueVersion:2,hueRules:rules});
function fixture({host,guest,pile,colour=0,top=num(0,5),rules='custom'}){
 const s=base(rules);s.hands={host:host.slice(),guest:guest.slice()};s.discard=[top];s.colour=colour;s.pile=pile||D.map(c=>c.id).filter(id=>![...host,...guest,top].includes(id));return s;
}
const go=(s,k,args={},by=s.turn)=>E.hueApply(s,{by,k,at:10000,...args},'p'+String(++seq).padStart(5,'0'));
const fails=(s,k,args={},by=s.turn)=>assert.throws(()=>go(s,k,args,by));
test('initial deal and reproducible state; both modes preserve the complete Hues deck',()=>{
 const a=base(),b=base();assert.equal(JSON.stringify(a),JSON.stringify(b));assert.equal(a.hands.host.length,7);assert.equal(a.hands.guest.length,7);assert.equal(a.pile.length,80);assert.equal(a.discard.length,1);
 const o=base('official');assert.equal(JSON.stringify([...o.pile,...o.hands.host,...o.hands.guest,...o.discard].sort((a,b)=>a-b)),JSON.stringify(D.map(c=>c.id)));assert.equal(o.pile.length,80);assert.equal(JSON.stringify(o.hands),JSON.stringify(a.hands));
});
test('colour audit: all 95 IDs survive 1000 seeded deals, with 22 cards in every colour',()=>{
 const sums=[0,0,0,0];let lowLavender=0;
 for(let i=0;i<1000;i++){
  const s=E.hueInitial({seed:'colour-audit'+i,hueRules:'custom'}),all=[...s.hands.host,...s.hands.guest,...s.pile,...s.discard];
  assert.equal(new Set(all).size,95);
  for(let c=0;c<4;c++)assert.equal(all.filter(id=>D[id].c===c).length,22);
  const hands=[...s.hands.host,...s.hands.guest];for(let c=0;c<4;c++)sums[c]+=hands.filter(id=>D[id].c===c).length;
  if(hands.filter(id=>D[id].c===0).length<=1)lowLavender++;
 }
 assert.ok(Math.max(...sums)/Math.min(...sums)<1.15);assert.ok(lowLavender>0,'random hands can have little lavender while it remains in the pile');
 console.log('       dealt colour totals: '+sums.join(', ')+'; low-lavender openings: '+lowLavender+'/1000');
});
test('either Custom player may shuffle between moves, twice each, without changing turn or hands',()=>{
 let s=base(),before=JSON.stringify(s.hands),top=s.discard.at(-1);s=go(s,'shuffle',{},'guest');s=go(s,'shuffle',{},'guest');
 assert.equal(s.turn,'host');assert.equal(s.shuffles.guest,2);assert.equal(JSON.stringify(s.hands),before);assert.equal(s.discard.at(-1),top);fails(s,'shuffle',{},'guest');
 s=go(s,'shuffle',{},'host');s=go(s,'shuffle',{},'host');assert.equal(s.shuffles.host,2);fails(s,'shuffle',{},'host');
 const all=[...s.hands.host,...s.hands.guest,...s.pile,...s.discard];for(let c=0;c<4;c++)assert.equal(all.filter(id=>D[id].c===c).length,22);
});
test('Trade remains playable in both modes and swaps hands before checking one-card declarations',()=>{
 for(const rules of ['custom','official']) {
  const trade=ids('trade')[0],left=num(0,1),opponent=[num(1,3),num(2,4)];
  let s=fixture({host:[trade,left],guest:opponent,rules});
  assert.ok(E.hueFits(s,D[trade]));s=go(s,'play',{ids:[trade],col:2});
  assert.equal(JSON.stringify(s.hands.host),JSON.stringify(opponent));assert.equal(JSON.stringify(s.hands.guest),JSON.stringify([left]));
  assert.equal(s.turn,'guest');assert.equal(s.colour,2);assert.ok(E.hueCanSay(s,'guest'));
 }
});
test('cannot pre-call at two, zero, or another player’s one-card hand',()=>{
 let s=fixture({host:[num(0,1),num(0,2)],guest:[num(1,3)]});assert.equal(E.hueCanSay(s,'host'),false);fails(s,'hues');s.hands.host=[];fails(s,'hues');
 s=fixture({host:[num(0,1)],guest:[num(1,3),num(2,4)]});s=go(s,'hues');assert.equal(s.said.host,true);fails(s,'hues');
});
test('drawing always resets Hues; returning to one needs a new declaration',()=>{
 let s=fixture({host:[num(0,1)],guest:[num(1,3),num(2,4)],pile:[num(0,7)]});s=go(s,'hues');s=go(s,'draw');assert.equal(s.said.host,false);assert.equal(s.drawn,num(0,7));fails(s,'hues');s=go(s,'play',{ids:[num(0,7)]});assert.equal(s.hands.host.length,1);assert.equal(s.owes.host,true);s=go(s,'hues',{},'host');assert.equal(s.said.host,true);
});
test('no callout before one card, or before the opponent screen notices its new turn',()=>{
 let s=fixture({host:[num(0,1),num(0,2)],guest:[num(1,3),num(2,4)]});fails(s,'callout',{},'guest');s=go(s,'play',{ids:[num(0,1)]});assert.equal(E.hueCanCall(s,'guest'),false);assert.equal(E.hueNeedsNotice(s,'guest'),true);fails(s,'callout',{one:s.oneKey.host},'guest');fails(s,'notice',{one:s.oneKey.host},'host');
});
test('two-second lockout starts at the receiving screen notice, with no automatic penalty',()=>{
 let s=fixture({host:[num(0,1),num(0,2)],guest:[num(1,3),num(2,4)]});s=go(s,'play',{ids:[num(0,1)]});const one=s.oneKey.host;s=go(s,'notice',{one,at:50000},'guest');assert.equal(s.callWindow.until,52000);assert.equal(E.hueCanCall(s,'guest',51999),false);assert.equal(E.hueCanCall(s,'guest',52000),true);fails(s,'callout',{one,at:51999},'guest');assert.equal(s.hands.host.length,1);fails(s,'notice',{one,at:60000},'guest');
});
test('Hues inside the lockout makes the player safe; no queued or later callout',()=>{
 let s=fixture({host:[num(0,1),num(0,2)],guest:[num(1,3),num(2,4)]});s=go(s,'play',{ids:[num(0,1)]});const one=s.oneKey.host;s=go(s,'notice',{one},'guest');s=go(s,'hues',{at:11000},'host');assert.equal(s.callWindow,null);assert.equal(s.said.host,true);fails(s,'callout',{one,at:14000},'guest');
});
test('player may still declare after two seconds if not yet caught',()=>{
 let s=fixture({host:[num(0,1),num(0,2)],guest:[num(1,3),num(2,4)]});s=go(s,'play',{ids:[num(0,1)]});const one=s.oneKey.host;s=go(s,'notice',{one},'guest');s=go(s,'hues',{at:20000},'host');assert.equal(s.hands.host.length,1);assert.equal(s.said.host,true);fails(s,'callout',{one,at:20001},'guest');
});
test('unlocked Call out pays exactly two immediately and cannot be spammed',()=>{
 let s=fixture({host:[num(0,1),num(0,2)],guest:[num(1,3),num(2,4)]});s=go(s,'play',{ids:[num(0,1)]});const one=s.oneKey.host;s=go(s,'notice',{one},'guest');s=go(s,'callout',{one,at:12000},'guest');assert.equal(s.hands.host.length,3);assert.equal(s.callWindow,null);assert.equal(s.said.host,false);assert.equal(s.log.at(-1).ids.length,2);fails(s,'callout',{one,at:12001},'guest');fails(s,'hues',{},'host');
});
test('timestamp objects replay correctly; old episode IDs cannot catch a later one',()=>{
 let s=fixture({host:[num(0,1),num(0,2)],guest:[num(0,3),num(2,4)],pile:[num(0,7)]});s=go(s,'play',{ids:[num(0,1)]});const old=s.oneKey.host;s=go(s,'notice',{one:old,at:{seconds:42,nanoseconds:500000000}},'guest');assert.equal(s.callWindow.until,44500);s=go(s,'play',{ids:[num(0,3)]});s=go(s,'draw');s=go(s,'play',{ids:[num(0,7)]});fails(s,'notice',{one:old},'guest');assert.notEqual(s.oneKey.host,old);
});
test('ordinary play/draw closes an unchallenged missed declaration',()=>{
 let s=fixture({host:[num(0,1),num(0,2)],guest:[num(0,3),num(2,4)]});s=go(s,'play',{ids:[num(0,1)]});assert.equal(E.hueNeedsNotice(s,'guest'),true);s=go(s,'play',{ids:[num(0,3)]});assert.equal(E.hueCanCall(s,'guest'),false);
});
test('custom matching-number pairs; official-style rejects multiple cards',()=>{
 const host=[num(0,3),num(1,3),num(0,8)],guest=[num(2,4),num(3,5)];let s=fixture({host,guest});s=go(s,'play',{ids:host.slice(0,2)});assert.equal(s.hands.host.length,1);assert.equal(s.colour,1);s=fixture({host,guest,rules:'official'});fails(s,'play',{ids:host.slice(0,2)});
});
test('custom stack uses only existing hand cards; paying final penalty ends immediately',()=>{
 let s=fixture({host:[ids('p2',0)[0]],guest:[num(1,3),num(2,4)],pile:[ids('p4')[0],num(0,8)]});s=go(s,'play',{ids:[ids('p2',0)[0]]});assert.equal(s.winner,null);s=go(s,'draw');assert.equal(s.winner,'host');assert.equal(s.turn,null);assert.equal(s.hands.guest.length,4);fails(s,'play',{ids:[ids('p4')[0]],col:0},'guest');
});
test('last +2 can be stacked in-hand, returning penalty to empty-handed player',()=>{
 let s=fixture({host:[ids('p2',0)[0]],guest:[ids('p2',1)[0],num(2,4)]});s=go(s,'play',{ids:[ids('p2',0)[0]]});s=go(s,'play',{ids:[ids('p2',1)[0]]});assert.equal(s.penalty,4);assert.equal(s.turn,'host');s=go(s,'draw');assert.equal(s.winner,null);assert.equal(s.hands.host.length,4);assert.equal(s.penalty,0);
});
test('custom penalty payment with a nonempty opponent grants play or pass but no second draw',()=>{
 let s=fixture({host:[ids('p2',0)[0],num(0,8)],guest:[num(1,3),num(2,4)]});s=go(s,'play',{ids:[ids('p2',0)[0]]});s=go(s,'draw');assert.equal(s.turn,'guest');assert.equal(s.paid,true);fails(s,'draw');s=go(s,'pass');assert.equal(s.turn,'host');
});
test('official-style draw penalties cannot stack and skip after paying',()=>{
 let s=fixture({host:[ids('p2',0)[0],num(0,8)],guest:[ids('p2',1)[0],num(2,4)],rules:'official'});s=go(s,'play',{ids:[ids('p2',0)[0]]});fails(s,'play',{ids:[ids('p2',1)[0]]});s=go(s,'draw');assert.equal(s.turn,'host');assert.equal(s.paid,false);
});
test('official-style Flood requires no active-colour card; Blend is unrestricted',()=>{
 let s=fixture({host:[ids('p4')[0],ids('blend')[0],num(0,3)],guest:[num(1,4),num(2,5)],rules:'official'});fails(s,'play',{ids:[ids('p4')[0]],col:1});s=go(s,'play',{ids:[ids('blend')[0]],col:1});assert.equal(s.colour,1);
 s=fixture({host:[ids('p4')[0],num(2,3)],guest:[num(1,4),num(2,5)],rules:'official'});s=go(s,'play',{ids:[ids('p4')[0]],col:1});assert.equal(s.penalty,4);
});
test('last Blend ends after colour choice; last Flood waits for mandatory draw',()=>{
 let s=fixture({host:[ids('blend')[0]],guest:[num(1,3),num(2,4)]});s=go(s,'play',{ids:[ids('blend')[0]],col:2});assert.equal(s.winner,'host');
 s=fixture({host:[ids('p4')[0]],guest:[num(1,3),num(2,4)],rules:'official'});s=go(s,'play',{ids:[ids('p4')[0]],col:2});assert.equal(s.winner,null);s=go(s,'draw');assert.equal(s.winner,'host');
});
test('two independent shuffles each; no hand, discard, turn or colour changes',()=>{
 let s=base(),before=JSON.stringify({hands:s.hands,discard:s.discard,turn:s.turn,colour:s.colour}),original=JSON.stringify(s.pile);s=go(s,'shuffle');assert.notEqual(JSON.stringify(s.pile),original);s=go(s,'shuffle');fails(s,'shuffle');assert.equal(JSON.stringify({hands:s.hands,discard:s.discard,turn:s.turn,colour:s.colour}),before);assert.equal(s.shuffles.host,2);s.turn='guest';s=go(s,'shuffle');s=go(s,'shuffle');assert.equal(s.shuffles.guest,2);fails(s,'shuffle');fails(base('official'),'shuffle');
});
test('invalid commands never mutate source state or duplicated/replayed cards',()=>{
 const s=base(),before=JSON.stringify(s);fails(s,'play',{ids:[-1]});assert.equal(JSON.stringify(s),before);fails(s,'draw',{},'guest');
});
test('new replay ignores stale commands and conserves cards in 30 complete seeded games',()=>{
 for(let i=0;i<30;i++){
  const m={id:'auto',seed:'hue'+i,hueVersion:2,hueRules:i%2?'official':'custom',plays:{}};let s=E.huState(m),step=0;
  while(!s.winner&&step<2500){
   const by=s.turn,hand=s.hands[by],fits=hand.filter(id=>E.hueFits(s,D[id]));let command;
   if(s.drawn!=null)command=fits.length?{k:'play',ids:[s.drawn],col:0}:{k:'keep'};
   else if(fits.length){const c=D[fits[0]];command={k:'play',ids:[c.id],col:c.c<0?step%4:undefined};}
   else command={k:s.paid?'pass':'draw'};
   const key='p'+String(step++).padStart(5,'0');m.plays[key]={by,...command};s=E.hueApply(s,m.plays[key],key);
   const all=[...s.hands.host,...s.hands.guest,...s.pile,...s.discard];assert.equal(new Set(all).size,all.length);assert.equal(all.length,95);
  }
  assert.ok(s.winner,'seed '+i+' finishes');assert.equal(JSON.stringify(E.huState(m)),JSON.stringify(s));
 }
});
console.log('\n'+n+' Hues rules tests passed.');
