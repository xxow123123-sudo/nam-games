import { REST, Routes, SlashCommandBuilder, PermissionFlagsBits, ChannelType } from 'discord.js';
if (!process.env.DISCORD_TOKEN || !process.env.CLIENT_ID || !process.env.GUILD_ID) throw Error('أكمل ملف .env أولًا.');
const commands = [
 new SlashCommandBuilder().setName('setup').setDescription('تعيين روم الألعاب الذي ينظف بالكامل بعد المباريات').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild).addChannelOption(o=>o.setName('channel').setDescription('روم مخصص للألعاب؛ تحذف رسائله بعد كل مباراة').addChannelTypes(ChannelType.GuildText).setRequired(true)),
 new SlashCommandBuilder().setName('cancel').setDescription('إلغاء المباراة الحالية دون نقاط').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
];
await new REST({version:'10'}).setToken(process.env.DISCORD_TOKEN).put(Routes.applicationGuildCommands(process.env.CLIENT_ID,process.env.GUILD_ID),{body:commands.map(c=>c.toJSON())});
console.log('تم تسجيل /setup و /cancel');
