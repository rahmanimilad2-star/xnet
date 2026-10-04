'use strict';
const { config, validateConfig } = require('./config');
validateConfig();
const { openDb, getDb } = require('./db');
openDb(config.dbPath);
const { createServer } = require('./app');
const { startCollector } = require('./stats');
const { startSubscriptionRefresher } = require('./subscriptions');

if (!getDb().prepare('SELECT COUNT(*) n FROM admins').get().n) {
  console.warn('[!] No admin account yet. Create one with: npm run create-admin -- <username>');
}
const server = createServer();
server.listen(config.port, config.host, () => console.log(`VPN panel backend listening on http://${config.host}:${config.port} (${config.env})`));
startCollector();
startSubscriptionRefresher();

const shutdown = () => { server.close(() => { getDb().close(); process.exit(0); }); setTimeout(() => process.exit(0), 5000).unref(); };
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
