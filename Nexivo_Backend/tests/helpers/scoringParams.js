// The seeded scoring params as migrations 0011 + 0014 build them (nexivo-1.1, the active seed),
// read from the SQL so engine tests check the real seed.
import { readFileSync } from 'node:fs';

const sql = (file) => readFileSync(new URL(`../../db/migrations/${file}`, import.meta.url), 'utf8');
const base = JSON.parse(/'nexivo-1\.0', true, '(\{[\s\S]*\})'\);/.exec(sql('0011_scoring_configs.sql'))[1]);
// 0014 doubles the apostrophes inside its SQL string literal.
const templates = JSON.parse(
  /params \|\| '(\{[\s\S]*?\})'::jsonb/.exec(sql('0014_explanations.sql'))[1].replaceAll("''", "'"),
);
export const seedParams = { ...base, ...templates };
