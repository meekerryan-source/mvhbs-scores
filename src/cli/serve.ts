// npm run serve [-- --port 5173] — serves dist/ read-only on localhost. Build it first with npm run build:web.
import { existsSync } from 'node:fs';
import { startServer } from './server.js';

const args = process.argv.slice(2);
const port = Number(args[args.indexOf('--port') + 1]) || Number(process.env.PORT) || 5173;
if (!existsSync('dist/data.json')) { console.error('dist/ is empty — run `npm run build:web` first.'); process.exit(1); }
startServer(port);
