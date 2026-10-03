import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import { Worker } from 'node:worker_threads';

import type { ImageRequest } from './renderer';

const publicRoot = resolve(process.env.LIXIANGQI_PUBLIC ?? 'public');
const maxQueue = 4;
type Job = { input: ImageRequest; response: ServerResponse };
const queue: Job[] = [];
let current: Job | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let worker: Worker;
let workerReady = false;

function reply(response: ServerResponse, status: number, message: string): void {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify({ error: message }));
}
function startWorker(): void {
  workerReady = false;
  worker = new Worker(new URL('./renderer.mjs', import.meta.url), { workerData: { publicRoot } });
  worker.on('online', () => {
    workerReady = true;
    runNext();
  });
  worker.on('message', (result: { image?: Uint8Array; error?: string }) => {
    clearTimeout(timer);
    const job = current;
    current = undefined;
    if (job && !job.response.destroyed) {
      if (result.error || !result.image) reply(job.response, 400, result.error ?? 'Image rendering failed');
      else {
        job.response.writeHead(200, {
          'Content-Type': `image/${job.input.format}`,
          'Content-Length': result.image.length,
        });
        job.response.end(result.image);
      }
    }
    runNext();
  });
  worker.on('error', () => {
    workerReady = false;
    clearTimeout(timer);
    if (current) reply(current.response, 500, 'Image worker failed');
    current = undefined;
  });
  worker.on('exit', () => {
    workerReady = false;
    if (!closing) startWorker();
  });
}
function runNext(): void {
  if (current || !workerReady || closing) return;
  do {
    current = queue.shift();
  } while (current?.response.destroyed);
  if (!current) return;
  worker.postMessage(current.input);
  timer = setTimeout(() => {
    if (current) reply(current.response, 503, 'Image export exceeded the time limit');
    current = undefined;
    workerReady = false;
    void worker.terminate();
  }, 60_000);
}
async function body(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 2_000_000) throw new Error('Image request is too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
let closing = false;
startWorker();
const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname === '/health') {
    res.writeHead(workerReady ? 200 : 503);
    res.end(workerReady ? 'ok' : 'starting');
    return;
  }
  if (queue.length >= maxQueue) {
    reply(res, 429, 'Image export queue is full');
    return;
  }
  try {
    let input: ImageRequest;
    if (req.method === 'POST' && url.pathname === '/game.gif') {
      input = { ...((await body(req)) as ImageRequest), format: 'gif' };
    } else if (req.method === 'GET' && ['/image.gif', '/image.png'].includes(url.pathname)) {
      const p = url.searchParams;
      input = {
        format: url.pathname.endsWith('.png') ? 'png' : 'gif',
        orientation: (p.get('orientation') ?? 'red') as 'red' | 'black',
        theme: p.get('theme') ?? undefined,
        piece: p.get('piece') ?? undefined,
        red: p.get('red') ?? undefined,
        black: p.get('black') ?? undefined,
        size: p.has('size') ? Number(p.get('size')) : undefined,
        frames: [{ fen: p.get('fen') ?? '', lastMove: p.get('lastMove') ?? undefined }],
      };
    } else {
      reply(res, 404, 'Unknown image operation');
      return;
    }
    if (closing) {
      reply(res, 503, 'Image renderer is shutting down');
      return;
    }
    if (queue.length >= maxQueue) {
      reply(res, 429, 'Image export queue is full');
      return;
    }
    queue.push({ input, response: res });
    runNext();
  } catch (error) {
    reply(res, 400, error instanceof Error ? error.message : 'Invalid image request');
  }
});
server.requestTimeout = 15_000;
server.headersTimeout = 10_000;
server.listen(Number(process.env.PORT ?? 6175), process.env.HOST ?? '127.0.0.1');
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    closing = true;
    clearTimeout(timer);
    if (current) reply(current.response, 503, 'Image renderer is shutting down');
    for (const job of queue) reply(job.response, 503, 'Image renderer is shutting down');
    server.close();
    void worker.terminate();
  });
