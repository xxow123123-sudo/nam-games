import { randomInt } from 'node:crypto';
export const names = { mafia: 'المافيا', detective: 'المحقق', doctor: 'الطبيب', citizen: 'المواطن' };
export function validate(n, settings) {
  if (n < 3 || n > 24) throw Error('عدد اللاعبين من ٣ إلى ٢٤.');
  if (![1, 2].includes(settings.mafia) || settings.mafia * 2 >= n) throw Error('عدد المافيا غير مناسب: اختر مافيا واحدًا حتى ٤ لاعبين، وواحدًا أو اثنين من ٥ لاعبين.');
  if (Number(settings.doctor) + Number(settings.detective) > n - settings.mafia) throw Error('الأدوار أكثر من اللاعبين.');
}
export function deal(ids, settings) {
  validate(ids.length, settings);
  const roles = Array(settings.mafia).fill('mafia');
  if (settings.doctor) roles.push('doctor');
  if (settings.detective) roles.push('detective');
  while (roles.length < ids.length) roles.push('citizen');
  for (let i = roles.length - 1; i > 0; i--) { const j = randomInt(i + 1); [roles[i], roles[j]] = [roles[j], roles[i]]; }
  return ids.map((id, i) => ({ id, role: roles[i], alive: true }));
}
export function winner(players) {
  const alive = players.filter(p => p.alive), m = alive.filter(p => p.role === 'mafia').length;
  if (!m) return 'citizens';
  if (m >= alive.length - m) return 'mafia';
  return null;
}
export function tally(votes) {
  const counts = {};
  for (const id of Object.values(votes)) counts[id] = (counts[id] || 0) + 1;
  const sorted = Object.entries(counts).sort((a,b) => b[1]-a[1]);
  return { counts, target: !sorted.length || sorted[0][0] === 'skip' || sorted[0][1] === sorted[1]?.[1] ? null : sorted[0][0] };
}
export function nightResult(players, actions) {
  const mafias = players.filter(p => p.alive && p.role === 'mafia');
  const choices = mafias.map(p => actions[p.id]).filter(Boolean);
  // Only a unanimous choice among all living mafia confirms a victim.
  const target = choices.length === mafias.length && new Set(choices).size === 1 ? choices[0] : null;
  const doctor = players.find(p => p.alive && p.role === 'doctor');
  return target && actions[doctor?.id] !== target ? target : null;
}
