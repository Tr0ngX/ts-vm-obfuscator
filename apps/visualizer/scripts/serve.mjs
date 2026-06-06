import { createReadStream, existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const requestedRoot = process.argv[2] === 'dist' ? resolve(root, 'dist') : root;
const port = Number(process.env.PORT ?? 5173);

const mime = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
]);

createServer(async (req, res) => {
  const rawPath = decodeURIComponent(req.url?.split('?')[0] ?? '/');
  const cleanPath = rawPath === '/' ? '/index.html' : rawPath;
  let filePath = resolve(join(requestedRoot, cleanPath));

  if (!filePath.startsWith(requestedRoot)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  if (!existsSync(filePath)) {
    filePath = resolve(requestedRoot, 'index.html');
  }

  try {
    const fileStat = await stat(filePath);
    if (fileStat.isDirectory()) {
      filePath = join(filePath, 'index.html');
    }
    res.writeHead(200, { 'Content-Type': mime.get(extname(filePath)) ?? 'application/octet-stream' });
    createReadStream(filePath).pipe(res);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}).listen(port, '0.0.0.0', () => {
  console.log(`TSXobf visualizer running at http://localhost:${port}`);
});
