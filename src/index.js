import { Client, GatewayIntentBits, Events, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, PermissionFlagsBits, MessageFlags, AttachmentBuilder, ChannelType } from 'discord.js';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { Store } from './store.js';
import { names, validate, deal, winner, tally, nightResult } from './engine.js';
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const db = new Store(process.env.NAM_DB_PATH || 'data/nam.sqlite'), sessions = new Map(), timers = new Map(), locks = new Set();
const seconds = (key, fallback) => { const n = Number(process.env[key] || fallback); if (!Number.isInteger(n) || n < 5 || n > 3600) throw Error(`Invalid ${key}`); return n; };
const duration = {night:seconds('NIGHT_SECONDS',45),discuss:seconds('DISCUSS_SECONDS',120),vote:seconds('VOTE_SECONDS',45),finished:seconds('CLEANUP_SECONDS',30),lobby:seconds('LOBBY_SECONDS',600)};
const mention = id => `<@${id}>`;
const asset = name => resolve('assets',name);
const row = (...items) => new ActionRowBuilder().addComponents(...items);
const button = (id,label,disabled=false) => new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(ButtonStyle.Secondary).setDisabled(disabled);
const select = (id,placeholder,options) => row(new StringSelectMenuBuilder().setCustomId(id).setPlaceholder(placeholder).addOptions(options));
const embed = (title,description) => new EmbedBuilder().setColor(0x141d30).setTitle(title).setDescription(description);
const privateReply = (i,content) => i.reply({content,flags:MessageFlags.Ephemeral,allowedMentions:{parse:[]}});
function save(s) { db.save(s); }
async function channel(s) { const c=await client.channels.fetch(s.channel); if(!c || c.type!==ChannelType.GuildText) throw Error('روم الألعاب غير متاح'); return c; }
async function announce(s,content,components=[]) { return (await channel(s)).send({content,components,allowedMentions:{parse:[]}}); }
function runTimer(s) {
 if(sessions.get(s.channel)!==s)return;
 if(locks.has(s.channel)){timers.set(s.channel,setTimeout(()=>runTimer(s),500));return;}
 locked(s.channel,()=>advance(s)).catch(e=>{
  console.error('تعذر إكمال المرحلة',e.message);
  // Retry cleanup; cancel interrupted game transitions without awarding points.
  if(s.phase==='finished')timers.set(s.channel,setTimeout(()=>runTimer(s),5000));
  else {s.phase='finished';save(s);timers.set(s.channel,setTimeout(()=>runTimer(s),5000));}
 });
}
function schedule(s) { clearTimeout(timers.get(s.channel)); s.deadline=Date.now()+duration[s.phase]*1000; save(s); timers.set(s.channel,setTimeout(()=>runTimer(s),duration[s.phase]*1000)); }
async function locked(key,fn) { if(locks.has(key)) throw Error('جارٍ تنفيذ إجراء آخر. حاول مجددًا.'); locks.add(key); try{return await fn();} finally{locks.delete(key);} }
async function panel(channelId) {
 const room=db.room(channelId); if(!room)return;
 const c=await client.channels.fetch(channelId);
 const top=db.top(room.guild).map((r,i)=>`${i+1}- ${mention(r.user)} — ${r.points} نقطة`).join('\n') || 'لم تُسجّل نقاط بعد.';
 const payload={embeds:[embed('Games','**الألعاب**\n**المافيا**\nأدوار خفية. قرارات حاسمة. فريق يفوز.\n٣ لاعبين فأكثر.\n\n**المتصدرون**\n'+top).setImage('attachment://banner.png')],components:[row(button('new','لعبة جديدة'))],allowedMentions:{parse:[]}};
 let message=room.panel?await c.messages.fetch(room.panel).catch(()=>null):null;
 if(message) await message.edit(payload);
 else { message=await c.send({...payload,files:[new AttachmentBuilder(asset('banner.png'))]}); db.setRoom(channelId,room.guild,message.id); await message.pin().catch(()=>{}); }
}
function lobbyPayload(s) {
 const rows=[row(button(`g:${s.id}:join`,'انضمام'),button(`g:${s.id}:leave`,'انسحاب'),button(`g:${s.id}:start`,'بدء اللعبة'),button(`g:${s.id}:cancel`,'إلغاء')),
 select(`g:${s.id}:mafia`,'عدد المافيا',[{label:'مافيا واحد',value:'1',default:s.settings.mafia===1},{label:'مافيا اثنان',value:'2',default:s.settings.mafia===2}]),
 select(`g:${s.id}:reveal`,'كشف البطاقات عند الخروج',[{label:'كشف البطاقات',value:'yes',default:s.settings.reveal},{label:'إخفاء البطاقات',value:'no',default:!s.settings.reveal}]),
 select(`g:${s.id}:special`,'الأدوار الإضافية',[{label:'مواطنون فقط مع المافيا',value:'none',default:!s.settings.doctor&&!s.settings.detective},{label:'طبيب',value:'doctor',default:s.settings.doctor&&!s.settings.detective},{label:'محقق',value:'detective',default:s.settings.detective&&!s.settings.doctor},{label:'طبيب ومحقق',value:'both',default:s.settings.doctor&&s.settings.detective}])];
 return {embeds:[embed('المافيا',`الليدر: ${mention(s.leader)}\nاللاعبون (${s.players.length}/24): ${s.players.map(p=>mention(p.id)).join('، ')}\n\nالمافيا: ${s.settings.mafia}\nكشف البطاقات: ${s.settings.reveal?'مفعّل':'مخفي'}\nالطبيب: ${s.settings.doctor?'مفعّل':'معطّل'} | المحقق: ${s.settings.detective?'مفعّل':'معطّل'}\n\nالإعدادات والبدء لليدر فقط. افتح الخاص قبل البدء.\nتنتهي مهلة الانتظار خلال ${duration.lobby/60} دقائق.`)],components:rows,allowedMentions:{parse:[]}};
}
async function lobbyUpdate(s) { await (await channel(s)).messages.edit(s.lobby,lobbyPayload(s)); }
async function reveal(s,p) {
 if(s.settings.reveal) await (await channel(s)).send({content:`خرج ${mention(p.id)} — ${names[p.role]}`,files:[asset(`${p.role}.png`)],allowedMentions:{parse:[]}});
 else await announce(s,`خرج ${mention(p.id)}. بطاقته مخفية.`);
}
async function finish(s,team=null) {
 clearTimeout(timers.get(s.channel)); s.phase='finished'; s.epoch++; save(s);
 if(team) {
  db.award(s.id,s.guild,s.players.filter(p=>(p.role==='mafia')===(team==='mafia')).map(p=>p.id));
  await announce(s,`انتهت المباراة. فاز ${team==='mafia'?'فريق المافيا':'فريق المواطنين'}.\nأُضيفت نقطة لكل لاعب من الفريق الفائز، بمن فيهم الخارجون.\n\n${s.players.map(p=>`${mention(p.id)} — ${names[p.role]}`).join('\n')}`);
  // Reveal all cards at the end, even with hidden elimination cards.
  await (await channel(s)).send({files:[...new Set(s.players.map(p=>p.role))].map(r=>asset(`${r}.png`))});
 } else await announce(s,'أُلغيت المباراة دون احتساب نقاط.');
 await panel(s.channel);
 await announce(s,`سيتم تنظيف روم الألعاب بالكامل بعد ${duration.finished} ثانية، مع إبقاء اللوحة.`); schedule(s);
}
async function cleanup(s) {
 clearTimeout(timers.get(s.channel));
 const c=await channel(s), room=db.room(s.channel); let before;
 // Paginate including old messages; bulk-delete recent messages and delete old ones individually.
 while(true) {
  const batch=await c.messages.fetch({limit:100,...(before?{before}:{})}); if(!batch.size)break;
  before=batch.last().id;
  const targets=batch.filter(m=>m.id!==room.panel);
  const recent=targets.filter(m=>Date.now()-m.createdTimestamp<13.9*86400000);
  if(recent.size) await c.bulkDelete(recent,true);
  for(const m of targets.values()) if(!recent.has(m.id)) await m.delete();
 }
 db.remove(s.channel); sessions.delete(s.channel); timers.delete(s.channel); await panel(s.channel);
}
async function sendChoices(s,p,kind) {
 let eligible=s.players.filter(q=>q.alive);
 if(kind==='vote') eligible=eligible.filter(q=>q.id!==p.id);
 else if(p.role==='mafia') eligible=eligible.filter(q=>q.role!=='mafia');
 else if(p.role==='detective') eligible=eligible.filter(q=>q.id!==p.id);
 else if(p.role==='doctor') eligible=eligible.filter(q=>q.id!==s.lastProtected);
 const options=eligible.map(q=>({label:s.labels[q.id].slice(0,100),value:q.id}));
 if(kind==='vote') options.push({label:'تخطي التصويت',value:'skip'});
 if(!options.length)return;
 const c=kind==='vote'?await channel(s):await client.users.fetch(p.id).then(u=>u.createDM());
 await c.send({content:kind==='vote'?'اختر لاعبًا للتصويت. يمكن تغيير اختيارك حتى انتهاء الوقت.':`الليلة ${s.round} — ${names[p.role]}: اختر هدفك. ${p.role==='mafia'?'يجب أن يتفق جميع أفراد المافيا على هدف واحد.':''}`,
 components:[select(`a:${s.channel}:${s.id}:${s.epoch}:${kind}${kind==='vote'?'':':'+p.id}`,'اختر اللاعب',options)],allowedMentions:{parse:[]}});
}
async function phase(s,next) {
 s.phase=next; s.epoch++; s.actions={}; s.votes={}; save(s);
 if(next==='night') {
  s.round++; await announce(s,`الليل ${s.round} — ${duration.night} ثانية. اختيارات الأدوار في الخاص.`);
  for(const p of s.players.filter(p=>p.alive&&p.role!=='citizen')) { try{await sendChoices(s,p,'night');}catch{await announce(s,`تعذّر إرسال خيارات ${mention(p.id)} بالخاص. افتح الخاص؛ ستتاح الخيارات في الليلة القادمة.`);} }
 } else if(next==='discuss') await announce(s,`وقت النقاش — ${duration.discuss} ثانية. الأحياء فقط يشاركون في اللعبة.`);
 else {
  const options=s.players.filter(p=>p.alive).map(p=>({label:s.labels[p.id].slice(0,100),value:p.id})); options.push({label:'تخطي التصويت',value:'skip'});
  const msg=await announce(s,`وقت التصويت — ${duration.vote} ثانية.\nالمصوّتون: 0 / ${s.players.filter(p=>p.alive).length}`,[select(`a:${s.channel}:${s.id}:${s.epoch}:vote`,'اختر لاعبًا أو تخطَّ التصويت',options)]); s.voteMessage=msg.id;
 }
 schedule(s);
}
async function advance(s) {
 if(sessions.get(s.channel)!==s)return;
 if(s.phase==='finished')return cleanup(s);
 if(s.phase==='lobby')return finish(s);
 if(s.phase==='discuss')return phase(s,'vote');
 let dead;
 if(s.phase==='night') {
  dead=nightResult(s.players,s.actions);
  const doc=s.players.find(p=>p.alive&&p.role==='doctor'); s.lastProtected=s.actions[doc?.id] || null;
  await announce(s,dead?'طلع الصباح.':'طلع الصباح دون ضحايا.');
 } else {
  const result=tally(s.votes); dead=result.target;
  const resultText=Object.entries(result.counts).sort((a,b)=>b[1]-a[1]).map(([id,n])=>`${id==='skip'?'تخطي':mention(id)} — ${n}`).join('\n') || 'لم يصوّت أحد.';
  await announce(s,`نتائج التصويت\n${resultText}${dead?'':'\nلا يخرج أحد: تعادل، تخطي، أو لا أصوات.'}`);
 }
 if(dead) { const p=s.players.find(p=>p.id===dead); p.alive=false; await reveal(s,p); }
 const team=winner(s.players); if(team)return finish(s,team);
 return phase(s,s.phase==='night'?'discuss':'night');
}
async function start(s) {
 validate(s.players.length,s.settings); clearTimeout(timers.get(s.channel)); s.phase='starting'; save(s);
 try {
  for(const p of s.players)await client.users.fetch(p.id).then(u=>u.send('تجهيز مباراة NAM. ستصلك بطاقتك بعد التأكد من وصول الرسائل للجميع.'));
 }catch {s.phase='lobby';schedule(s);throw Error('تعذّر الوصول لخاص أحد اللاعبين. افتحوا الخاص ثم أعد البدء.');}
 s.players=deal(s.players.map(p=>p.id),s.settings); save(s);
 try {
  const mafia=s.players.filter(p=>p.role==='mafia');
  for(const p of s.players) {
   const help={mafia:'اتفق مع فريقك واختر هدفًا واحدًا كل ليلة.',doctor:'احمِ لاعبًا كل ليلة. تستطيع حماية نفسك، ولا تكرر الشخص ليلتين متتاليتين.',detective:'افحص لاعبًا كل ليلة لتعرف هل هو مافيا أم بريء.',citizen:'ناقش وصوّت لكشف المافيا.'}[p.role];
   await client.users.fetch(p.id).then(u=>u.send({content:`دورك: ${names[p.role]}\n${help}${p.role==='mafia'?'\nفريقك: '+mafia.map(q=>s.labels[q.id]).join('، '):''}`,files:[asset(`${p.role}.png`)]}));
  }
 }catch { await finish(s); throw Error('تعذّر توزيع كل البطاقات؛ ألغيت المباراة دون نقاط.'); }
 await (await channel(s)).messages.edit(s.lobby,{components:[]});
 await phase(s,s.players.length===3?'discuss':'night');
}
client.on(Events.InteractionCreate,async i=>{
 try {
  if(i.isChatInputCommand()) {
   if(!i.inGuild())return privateReply(i,'هذا الأمر داخل السيرفر فقط.');
   if(!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild))return privateReply(i,'هذا الأمر لإدارة السيرفر.');
   if(i.commandName==='setup') {
    const c=i.options.getChannel('channel',true);
    if(c.type!==ChannelType.GuildText)return privateReply(i,'اختر رومًا نصيًا عاديًا.');
    const required=[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.EmbedLinks,PermissionFlagsBits.AttachFiles,PermissionFlagsBits.ReadMessageHistory,PermissionFlagsBits.ManageMessages];
    if(!c.permissionsFor(i.guild.members.me)?.has(required))return privateReply(i,'البوت يحتاج عرض الروم، إرسال الرسائل، الروابط المضمنة، الملفات، قراءة السجل وإدارة الرسائل.');
    await i.deferReply({flags:MessageFlags.Ephemeral}); const old=db.room(c.id); db.setRoom(c.id,i.guildId,old?.panel||null); await panel(c.id);
    return i.editReply(`تم تجهيز ${mention(c.id).replace('<@','<#')}. هذا روم ألعاب مخصص: تُحذف جميع رسائله بعد المباريات وتبقى اللوحة.`);
   }
   if(i.commandName==='cancel') {
    await i.deferReply({flags:MessageFlags.Ephemeral}); await locked(i.channelId,async()=>{const s=sessions.get(i.channelId);if(!s||s.phase==='finished')throw Error('لا توجد مباراة قابلة للإلغاء.');await finish(s);});return i.editReply('تم الإلغاء.');
   }
   return;
  }
  if(!i.isButton()&&!i.isStringSelectMenu())return;
  if(i.customId==='new') {
   if(!i.inGuild()||db.room(i.channelId)?.panel!==i.message.id)return privateReply(i,'استخدم اللوحة الحالية.');
   return i.reply({components:[select('choose-game','اختر اللعبة',[{label:'المافيا',value:'mafia'}])],flags:MessageFlags.Ephemeral});
  }
  if(i.customId==='choose-game') {
   await i.deferReply({flags:MessageFlags.Ephemeral});
   await locked(i.channelId,async()=>{
    if(!db.room(i.channelId))throw Error('استخدم روم الألعاب.');if(sessions.has(i.channelId))throw Error('توجد مباراة أو عملية تنظيف في هذا الروم.');
    const s={id:randomUUID(),guild:i.guildId,channel:i.channelId,leader:i.user.id,players:[{id:i.user.id}],labels:{[i.user.id]:`${i.user.username} (${i.user.id.slice(-4)})`},settings:{mafia:1,reveal:true,doctor:false,detective:false},phase:'lobby',epoch:0,round:0,actions:{},votes:{}};
    sessions.set(s.channel,s);save(s);
    try{const m=await (await channel(s)).send(lobbyPayload(s));s.lobby=m.id;schedule(s);}catch(e){sessions.delete(s.channel);db.remove(s.channel);throw e;}
   });return i.editReply('تم فتح المافيا. أنت الليدر، اضبط الإعدادات ثم ابدأ.');
  }
  if(i.customId.startsWith('g:')) {
   const [,id,action]=i.customId.split(':');await i.deferReply({flags:MessageFlags.Ephemeral});
   await locked(i.channelId,async()=>{
    const s=sessions.get(i.channelId);if(!s||s.id!==id||s.phase!=='lobby')throw Error('هذه القائمة قديمة أو بدأت المباراة.');
    if(!['join','leave'].includes(action)&&i.user.id!==s.leader)throw Error('هذا الخيار لليدر فقط.');
    if(action==='join') {if(s.players.some(p=>p.id===i.user.id))throw Error('أنت منضم بالفعل.');if(s.players.length>=24)throw Error('اكتمل العدد.');s.players.push({id:i.user.id});s.labels[i.user.id]=`${i.user.username} (${i.user.id.slice(-4)})`;}
    if(action==='leave') {if(i.user.id===s.leader)throw Error('الليدر يمكنه إلغاء المباراة.');s.players=s.players.filter(p=>p.id!==i.user.id);}
    if(action==='mafia')s.settings.mafia=Number(i.values[0]);
    if(action==='reveal')s.settings.reveal=i.values[0]==='yes';
    if(action==='special'){s.settings.doctor=['doctor','both'].includes(i.values[0]);s.settings.detective=['detective','both'].includes(i.values[0]);}
    if(action==='cancel')return finish(s);
    if(action==='start')return start(s);
    save(s);await lobbyUpdate(s);
   });return i.editReply('تم.');
  }
  if(i.customId.startsWith('a:')) {
   const [,cid,id,epoch,kind,owner]=i.customId.split(':');await i.deferReply({flags:MessageFlags.Ephemeral});let reply='تم تسجيل اختيارك. يمكنك تغييره قبل انتهاء الوقت.';
   await locked(cid,async()=>{
    const s=sessions.get(cid);if(!s||s.id!==id||String(s.epoch)!==epoch||s.phase!==kind||Date.now()>s.deadline)throw Error('انتهت صلاحية هذا الاختيار.');
    const p=s.players.find(p=>p.id===i.user.id&&p.alive);if(!p)throw Error('التصويت والاختيارات للاعبين الأحياء فقط.');
    const target=i.values[0],q=s.players.find(q=>q.id===target&&q.alive);
    if(kind==='vote') {
     if(i.channelId!==cid||(!q&&target!=='skip')||target===p.id)throw Error('اختيار غير صالح. لا يمكنك التصويت لنفسك.');
     s.votes[p.id]=target;save(s);
     await (await channel(s)).messages.edit(s.voteMessage,{content:`وقت التصويت — ينتهي <t:${Math.ceil(s.deadline/1000)}:R>\nالمصوّتون: ${Object.keys(s.votes).length} / ${s.players.filter(p=>p.alive).length}`});
    } else {
     if(i.inGuild()||owner!==p.id||p.role==='citizen'||!q)throw Error('هذا الاختيار ليس لك.');
     if(p.role==='mafia'&&q.role==='mafia')throw Error('لا يمكنك استهداف المافيا.');
     if(p.role==='detective'&&q.id===p.id)throw Error('لا يمكنك فحص نفسك.');
     if(p.role==='doctor'&&q.id===s.lastProtected)throw Error('لا تكرر حماية نفس اللاعب ليلتين متتاليتين.');
     if(p.role==='detective'&&s.actions[p.id])throw Error('لديك فحص واحد فقط في الليلة.');
     s.actions[p.id]=q.id;save(s);
     if(p.role==='detective')reply=`نتيجة فحص ${s.labels[q.id]}: ${q.role==='mafia'?'مافيا':'بريء'}.`;
     if(p.role==='mafia')for(const mate of s.players.filter(x=>x.alive&&x.role==='mafia'&&x.id!==p.id))await client.users.fetch(mate.id).then(u=>u.send(`${s.labels[p.id]} اختار ${s.labels[q.id]}. يجب الاتفاق على هدف واحد.`)).catch(()=>{});
    }
   });return i.editReply(reply);
  }
 } catch(e) {
  console.error(e.message);
  const payload={content:e.message||'تعذّر تنفيذ العملية.'};
  if(i.deferred||i.replied)await i.editReply(payload).catch(()=>{});else await privateReply(i,payload.content).catch(()=>{});
 }
});
client.once(Events.ClientReady,async()=>{
 console.log(`NAM جاهز: ${client.user.tag}`);
 for(const s of db.sessions()) {
  sessions.set(s.channel,s);
  try {if(s.phase==='finished'){schedule(s);}else await finish(s);}catch(e){console.error('تعذر استعادة الروم',s.channel,e.message);}
 }
 for(const room of db.rooms())await panel(room.channel).catch(e=>console.error('تعذر تحديث اللوحة',e.message));
});
client.on(Events.Error,console.error);
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{client.destroy();process.exit(0);});
if(process.env.NAM_TEST !== '1') {
 if(!process.env.DISCORD_TOKEN||process.env.DISCORD_TOKEN==='put_your_bot_token_here')throw Error('ضع DISCORD_TOKEN في ملف .env محليًا.');
 await client.login(process.env.DISCORD_TOKEN);
}
export { client, db, sessions, timers, lobbyPayload, start, phase, advance, cleanup, panel }; 
