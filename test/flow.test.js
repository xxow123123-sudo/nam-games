import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const dir=mkdtempSync(join(tmpdir(),'nam-flow-'));
process.env.NAM_TEST='1';process.env.NAM_DB_PATH=join(dir,'db.sqlite');
const app=await import('../src/index.js');
const {ChannelType,Collection}=await import('discord.js');
const {client,db,sessions,timers}=app;
const messages=new Map(),sent=[],dm=[];let seq=0;
const c={id:'room',type:ChannelType.GuildText,
 send:async payload=>{sent.push(payload);const id=String(++seq);const m={id,createdTimestamp:Date.now(),edit:async p=>{Object.assign(m,p);return m;},pin:async()=>{},delete:async()=>{messages.delete(id);}};messages.set(id,m);return m;},
 messages:{fetch:async arg=>typeof arg==='string'?messages.get(arg):new Collection([...messages.entries()].filter(([id])=>!arg.before||Number(id)<Number(arg.before)).sort((a,b)=>Number(b[0])-Number(a[0])).slice(0,100)),edit:async(id,p)=>messages.get(id)?.edit(p)},
 bulkDelete:async batch=>{for(const id of batch.keys())messages.delete(id);}};
client.channels.fetch=async()=>c;
client.users.fetch=async id=>({send:async payload=>{dm.push({id,payload});},createDM:async()=>({send:async payload=>{dm.push({id,payload});}})});
function session(id){return {id,channel:'room',guild:'guild',leader:'a',players:['a','b','c'].map(id=>({id})),labels:{a:'A',b:'B',c:'C'},settings:{mafia:1,reveal:false,doctor:false,detective:false},phase:'lobby',epoch:0,round:0,actions:{},votes:{},lobby:'lobby'};}
test('complete 3-player flow: panel, lobby, secret cards, day first, hidden elimination, final reveal, score, cleanup',async()=>{
 try{
 db.setRoom('room','guild',null);await app.panel('room');const panelId=db.room('room').panel;
 const s=session('flow');sessions.set('room',s);const payload=app.lobbyPayload(s);
 assert.equal(payload.components.length,4);for(const row of payload.components)row.toJSON();
 await app.start(s);assert.equal(s.phase,'discuss');assert.equal(dm.filter(x=>x.payload.files).length,3);
 await app.advance(s);assert.equal(s.phase,'vote');
 const mafia=s.players.find(p=>p.role==='mafia');s.votes=Object.fromEntries(s.players.filter(p=>p.role!=='mafia').map(p=>[p.id,mafia.id]));
 await app.advance(s);assert.equal(s.phase,'finished');assert.equal(db.top('guild').length,2);
 const exit=sent.find(p=>p.content?.startsWith('خرج '));assert.ok(exit.content.endsWith('بطاقته مخفية.'));assert.equal(exit.files,undefined);
 assert.ok(sent.some(p=>p.files?.length===2)); // All role card types revealed at end.
 await app.cleanup(s);assert.deepEqual([...messages.keys()],[panelId]);assert.equal(sessions.size,0);assert.equal(db.sessions().length,0);
 }finally{for(const t of timers.values())clearTimeout(t);client.destroy();db.db.close();rmSync(dir,{recursive:true,force:true});}
});
