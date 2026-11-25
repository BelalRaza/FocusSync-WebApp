import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { projectRoot } from './sites-env.mjs';
if (!existsSync('dist/server/wrangler.json')) { console.error('Run npm run build before initializing the local database.'); process.exit(1); }
const journal = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8'));
const record = '.sites-runtime/local-migrations.json';
let applied = existsSync(record) ? JSON.parse(readFileSync(record, 'utf8')) : [];
// If the local DB was deliberately removed, its local migration record is reset.
if (!existsSync('.wrangler/state/v3/d1')) applied = [];
for (const entry of journal.entries) {
  if (applied.includes(entry.tag)) continue;
  const result = spawnSync(process.execPath, ['--import', './scripts/sites-env.mjs', './node_modules/wrangler/bin/wrangler.js', 'd1', 'execute', 'DB', '--local', '--config', 'dist/server/wrangler.json', '--persist-to', '.wrangler/state', '--file', `drizzle/${entry.tag}.sql`], { cwd: projectRoot, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
  applied.push(entry.tag); mkdirSync('.sites-runtime', { recursive: true }); writeFileSync(record, JSON.stringify(applied));
}
console.log('FocusSync local database is ready.');
