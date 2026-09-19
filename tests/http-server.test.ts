import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startHttpServer, stopHttpServer } from '../src/core/http-server.js';

describe('HTTP Health Server', () => {
  const TEST_PORT = 19876;
  let baseUrl: string;

  beforeAll(async () => {
    await startHttpServer(TEST_PORT);
    baseUrl = `http://127.0.0.1:${TEST_PORT}`;
  });

  afterAll(async () => {
    await stopHttpServer();
  });

  it('responds with 200 OK and {"status":"ok"} on GET /health', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const data = await res.json();
    expect(data).toEqual({ status: 'ok' });
  });

  it('responds with 200 OK on HEAD /health without exposing body', async () => {
    const res = await fetch(`${baseUrl}/health`, { method: 'HEAD' });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toBe('');
  });

  it('responds with 404 Not Found on root /', async () => {
    const res = await fetch(`${baseUrl}/`);
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data).toEqual({ error: 'not_found' });
  });

  it('responds with 404 Not Found on arbitrary routes (e.g. /status, /api)', async () => {
    const res = await fetch(`${baseUrl}/api/bots`);
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data).toEqual({ error: 'not_found' });
  });

  it('responds with 405 Method Not Allowed on POST /health', async () => {
    const res = await fetch(`${baseUrl}/health`, { method: 'POST' });
    expect(res.status).toBe(405);
    const data = await res.json();
    expect(data).toEqual({ error: 'method_not_allowed' });
  });
});
