'use strict';
// Usage: node src/cli.js create-admin <username>   (password read from ADMIN_PASSWORD env or prompted)
const readline = require('node:readline');
const { config, validateConfig } = require('./config');
validateConfig();
const { openDb } = require('./db');
const { hashPassword } = require('./security');

async function ask(q, hidden) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  if (hidden) rl._writeToOutput = (s) => { if (s.includes(q)) process.stdout.write(s); };
  return new Promise((res) => rl.question(q, (a) => { rl.close(); if (hidden) process.stdout.write('\n'); res(a); }));
}

(async () => {
  const [cmd, username] = process.argv.slice(2);
  if (cmd !== 'create-admin' || !username) { console.log('usage: npm run create-admin -- <username>'); process.exit(1); }
  if (!/^[a-zA-Z0-9._-]{3,32}$/.test(username)) { console.error('invalid username'); process.exit(1); }
  const pw = process.env.ADMIN_PASSWORD || await ask('Admin password (min 10 chars): ', true);
  if (!pw || pw.length < 10) { console.error('password must be at least 10 characters'); process.exit(1); }
  const db = openDb(config.dbPath);
  const existing = db.prepare('SELECT id FROM admins WHERE username=?').get(username);
  if (existing) {
    db.prepare('UPDATE admins SET password_hash=?, token_version=token_version+1 WHERE id=?').run(hashPassword(pw), existing.id);
    console.log(`admin "${username}" password updated`);
  } else {
    db.prepare('INSERT INTO admins(username,password_hash,created_at) VALUES (?,?,?)').run(username, hashPassword(pw), Date.now());
    console.log(`admin "${username}" created`);
  }
})();
