// Vercel entry point: Vercel runs the app as a function, so this file hands over
// the Express app instead of opening a port. src/server.js stays the entry point
// everywhere else. Database setup runs at build time (npm run vercel-build).

import 'dotenv/config';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
// Validated (zod) when it loads, as in src/server.js.
import '../src/config/riskRules.js';
import { initPool, setDbLogger } from '../src/db/pool.js';
import { createLogger } from '../src/utils/logger.js';

const config = loadConfig(process.env);
const logger = createLogger(config.log);
initPool({ ...config.db, applicationName: 'nexivo-vercel' });
setDbLogger(logger);

export default createApp({ config, logger });
