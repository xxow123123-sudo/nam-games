import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validate,deal,winner,tally,nightResult } from '../src/engine.js';
import { Store } from '../src/store.js';
const config={mafia:1,doctor:false,detective:false};
test('3 players supported; instant mafia wins rejected',()=>{
 assert.doesNotThrow(()=>validate(3,config));
 for(const n of [2,25])assert.throws(()=>validate(n,config));
 for(const n of [3,4])assert.throws(()=>validate(n,{...config,mafia:2}));
 assert.doesNotThrow(()=>validate(5,{...config,mafia:2}));
});
test('random deals preserve roles and unique players for every supported size',()=>{
 for(let n=3;n<=24;n++)for(let repeat=0;repeat<20;repeat++){
  const cfg={mafia:n>=5?2:1,doctor:n>3,detective:n>4};
  const p=deal(Array.from({length:n},(_,i)=>String(i)),cfg);
  assert.equal(p.length,n);assert.equal(new Set(p.map(x=>x.id)).size,n);
  assert.equal(p.filter(x=>x.role==='mafia').length,cfg.mafia);
  assert.equal(p.filter(x=>x.role==='doctor').length,+cfg.doctor);
  assert.equal(p.filter(x=>x.role==='detective').length,+cfg.detective);
  assert.equal(winner(p),null);
 }
});
test('plurality, ties, skip, no votes and changed vote',()=>{
 assert.equal(tally({}).target,null);
 assert.equal(tally({a:'b',c:'b',d:'c'}).target,'b');
 assert.equal(tally({a:'b',b:'a'}).target,null);
 assert.equal(tally({a:'skip',b:'skip',c:'a'}).target,null);
 const v={a:'b'};v.a='c';assert.deepEqual(tally(v).counts,{c:1});
});
const players=[{id:'m1',role:'mafia',alive:true},{id:'m2',role:'mafia',alive:true},{id:'d',role:'doctor',alive:true},{id:'c',role:'citizen',alive:true},{id:'c2',role:'citizen',alive:true}];
test('mafia must agree; doctor blocks; missing choices never kill',()=>{
 assert.equal(nightResult(players,{m1:'c',m2:'c'}),'c');
 assert.equal(nightResult(players,{m1:'c',m2:'c',d:'c'}),null);
 assert.equal(nightResult(players,{m1:'c',m2:'d'}),null);
 assert.equal(nightResult(players,{m1:'c'}),null);
 assert.equal(nightResult(players,{}),null);
});
test('dead doctor cannot protect; dead mafia has no vote',()=>{
 const p=players.map(x=>({...x,alive:!['d','m2'].includes(x.id)}));
 assert.equal(nightResult(p,{m1:'c',d:'c'}),'c');
});
test('victory checks only surviving players',()=>{
 assert.equal(winner(players),null);
 assert.equal(winner(players.map(p=>({...p,alive:p.role==='mafia'||p.id==='c'}))),'mafia');
 assert.equal(winner(players.map(p=>({...p,alive:p.role!=='mafia'}))),'citizens');
});
test('scores survive reopening, awards idempotent, guilds isolated, sessions saved',()=>{
 const dir=mkdtempSync(join(tmpdir(),'nam-'));const file=join(dir,'db.sqlite');
 try{
 let s=new Store(file);s.setRoom('room','guild','panel');
 s.award('game1','guild',['dead-winner','winner']);s.award('game1','guild',['winner']);
 s.award('game2','other-guild',['winner']);s.save({channel:'room',phase:'night'});s.db.close();
 s=new Store(file);assert.equal(s.top('guild').length,2);assert.equal(s.top('guild')[0].points,1);
 assert.equal(s.room('room').panel,'panel');assert.equal(s.sessions()[0].phase,'night');
 s.remove('room');assert.equal(s.sessions().length,0);s.db.close();
 }finally{rmSync(dir,{recursive:true,force:true});}
});
