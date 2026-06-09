import { describe, it, expect, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { fetchUrl } from '../src/fetcher.js';

let server: Server;
const base = await new Promise<string>((resolve) => {
  server = createServer((req, res) => {
    if (req.url === '/ok') { res.setHeader('x-test', '1'); res.end('<title>ok</title>'); }
    else { res.statusCode = 404; res.end('nope'); }
  }).listen(0, () => {
    const addr = server.address();
    resolve(`http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`);
  });
});
afterAll(() => server.close());

describe('fetchUrl', () => {
  it('renvoie status, headers minuscules et html', async () => {
    const r = await fetchUrl(`${base}/ok`);
    expect(r.ok).toBe(true);
    expect(r.status).toBe(200);
    expect(r.headers['x-test']).toBe('1');
    expect(r.html).toContain('ok');
  });

  it('marque ok=false sur hôte injoignable', async () => {
    const r = await fetchUrl('http://127.0.0.1:1/down', 200);
    expect(r.ok).toBe(false);
    expect(r.status).toBe(0);
  });
});
