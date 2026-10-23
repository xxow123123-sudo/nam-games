import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
export class Store {
  constructor(path = 'data/nam.sqlite') {
    mkdirSync(dirname(path), { recursive: true }); this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS rooms(channel TEXT PRIMARY KEY,guild TEXT NOT NULL,panel TEXT); CREATE TABLE IF NOT EXISTS scores(guild TEXT,user TEXT,points INTEGER DEFAULT 0,PRIMARY KEY(guild,user)); CREATE TABLE IF NOT EXISTS awards(game TEXT PRIMARY KEY); CREATE TABLE IF NOT EXISTS sessions(channel TEXT PRIMARY KEY,json TEXT NOT NULL);`);
  }
  rooms() { return this.db.prepare('SELECT * FROM rooms').all(); }
  room(id) { return this.db.prepare('SELECT * FROM rooms WHERE channel=?').get(id); }
  setRoom(channel,guild,panel) { this.db.prepare('INSERT INTO rooms VALUES(?,?,?) ON CONFLICT(channel) DO UPDATE SET panel=excluded.panel').run(channel,guild,panel); }
  top(guild) { return this.db.prepare('SELECT user,points FROM scores WHERE guild=? ORDER BY points DESC,user ASC LIMIT 10').all(guild); }
  save(s) { this.db.prepare('INSERT OR REPLACE INTO sessions VALUES(?,?)').run(s.channel,JSON.stringify(s)); }
  remove(channel) { this.db.prepare('DELETE FROM sessions WHERE channel=?').run(channel); }
  sessions() { return this.db.prepare('SELECT json FROM sessions').all().map(r => JSON.parse(r.json)); }
  award(game,guild,ids) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (this.db.prepare('SELECT 1 FROM awards WHERE game=?').get(game)) { this.db.exec('COMMIT'); return; }
      this.db.prepare('INSERT INTO awards VALUES(?)').run(game);
      for (const id of ids) this.db.prepare('INSERT INTO scores VALUES(?,?,1) ON CONFLICT(guild,user) DO UPDATE SET points=points+1').run(guild,id);
      this.db.exec('COMMIT');
    } catch(e) { this.db.exec('ROLLBACK'); throw e; }
  }
}
