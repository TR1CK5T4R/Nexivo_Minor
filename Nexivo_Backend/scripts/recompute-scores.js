// Scores every current observation with the active scoring config. Run it after
// activating a new config version (POST /api/config/scoring). Rows computed with
// older configs are kept, so earlier results stay traceable; observations that
// already have a score for the active config are skipped. Safe to run again.
//
//   npm run db:recompute
//   node scripts/recompute-scores.js --database TEST_DATABASE_URL

import 'dotenv/config';
import { parseArgs } from 'node:util';
import { closePool, initPool } from '../src/db/pool.js';
import { recomputeAllScores } from '../src/services/score.service.js';
import { resolveDatabase } from './lib/target.js';

const { values: args } = parseArgs({ options: { database: { type: 'string', default: 'DATABASE_URL' } } });

const target = resolveDatabase(args.database);
initPool({ connectionString: target.url, applicationName: 'nexivo-recompute-scores' });
try {
  const t = await recomputeAllScores();
  console.log(
    `${target.dbName}: config ${t.configVersion}: ${t.inserted} score(s) added, ${t.skipped} already scored, ${t.patients} patient(s)`,
  );
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await closePool();
}
