// Tiny read-only static server for dist/ (GET/HEAD only, bound to 127.0.0.1).
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json' };

export function startServer(port: number, root = 'dist'): void {
  createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
    const url = new URL(req.url ?? '/', 'http://x');
    const rel = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '').replace(/^(\.\.[/\\])+/, '');
    let p = join(root, rel || 'index.html');
    if (!existsSync(p) || statSync(p).isDirectory()) p = join(root, 'index.html');
    res.writeHead(200, { 'Content-Type': TYPES[extname(p)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : readFileSync(p));
  }).listen(port, '127.0.0.1', () => console.log(`MVHBS scores → http://localhost:${port}`));
}
