/**
 * BCP server security tests — unified POST /bcp endpoint.
 */

import { createBCPServer } from '../src/transport/server';
import { SessionManager } from '../src/state/session';
import request from 'supertest';

describe('BCP Server (v0.3)', () => {
  const sm = new SessionManager();
  const app = createBCPServer(sm, {
    disableTimestampCheck: true,
    disableReplayProtection: true,
  });

  test('POST /bcp accepts valid INTENT', async () => {
    const res = await request(app)
      .post('/bcp')
      .send({
        bcp_version: '0.3',
        type: 'intent',
        sessionId: 'server-test-1',
        timestamp: new Date().toISOString(),
        service: 'Test service',
      });
    expect(res.status).toBe(200);
    expect(res.body.accepted).toBe(true);
    expect(res.body.session_state).toBe('initiated');
  });

  test('POST /bcp rejects invalid message', async () => {
    const res = await request(app)
      .post('/bcp')
      .send({
        bcp_version: '0.3',
        type: 'intent',
        sessionId: 'server-test-2',
        timestamp: new Date().toISOString(),
        // missing service
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  test('POST /bcp rejects unknown message type', async () => {
    const res = await request(app)
      .post('/bcp')
      .send({
        bcp_version: '0.3',
        type: 'garbage',
        sessionId: 'server-test-3',
        timestamp: new Date().toISOString(),
      });
    expect(res.status).toBe(400);
  });

  test('POST /bcp rejects invalid state transition', async () => {
    // Session doesn't exist, so COMMIT should fail
    const res = await request(app)
      .post('/bcp')
      .send({
        bcp_version: '0.3',
        type: 'commit',
        sessionId: 'nonexistent-session',
        timestamp: new Date().toISOString(),
        agreedPrice: 100,
        currency: 'USDC',
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBeDefined();
  });

  test('full flow: intent → quote → commit → fulfil', async () => {
    const sessionId = 'server-flow-1';

    // Intent
    const r1 = await request(app).post('/bcp').send({
      bcp_version: '0.3', type: 'intent', sessionId, timestamp: new Date().toISOString(), service: 'Flow test',
    });
    expect(r1.body.session_state).toBe('initiated');

    // Quote
    const r2 = await request(app).post('/bcp').send({
      bcp_version: '0.3', type: 'quote', sessionId, timestamp: new Date().toISOString(), price: 100, currency: 'USDC',
    });
    expect(r2.body.session_state).toBe('quoted');

    // Commit
    const r3 = await request(app).post('/bcp').send({
      bcp_version: '0.3', type: 'commit', sessionId, timestamp: new Date().toISOString(), agreedPrice: 100, currency: 'USDC',
    });
    expect(r3.body.session_state).toBe('committed');

    // Fulfil
    const r4 = await request(app).post('/bcp').send({
      bcp_version: '0.3', type: 'fulfil', sessionId, timestamp: new Date().toISOString(), summary: 'Done',
    });
    expect(r4.body.session_state).toBe('fulfilled');
  });
});

describe('BCP Server timestamp check', () => {
  const sm = new SessionManager();
  const app = createBCPServer(sm, {
    disableTimestampCheck: false,
    disableReplayProtection: true,
    maxAgeSec: 60,
  });

  test('rejects expired messages', async () => {
    const oldTimestamp = new Date(Date.now() - 120_000).toISOString();
    const res = await request(app)
      .post('/bcp')
      .send({
        bcp_version: '0.3',
        type: 'intent',
        sessionId: 'ts-test-1',
        timestamp: oldTimestamp,
        service: 'Expired',
      });
    expect(res.status).toBe(400);
  });

  test('accepts fresh messages', async () => {
    const res = await request(app)
      .post('/bcp')
      .send({
        bcp_version: '0.3',
        type: 'intent',
        sessionId: 'ts-test-2',
        timestamp: new Date().toISOString(),
        service: 'Fresh',
      });
    expect(res.status).toBe(200);
  });
});

describe('BCP Server replay protection', () => {
  const sm = new SessionManager();
  const app = createBCPServer(sm, {
    disableTimestampCheck: true,
    disableReplayProtection: false,
  });

  test('rejects duplicate messages', async () => {
    const msg = {
      bcp_version: '0.3',
      type: 'intent',
      sessionId: 'replay-test-1',
      timestamp: new Date().toISOString(),
      service: 'Replay test',
    };

    const r1 = await request(app).post('/bcp').send(msg);
    expect(r1.status).toBe(200);

    const r2 = await request(app).post('/bcp').send(msg);
    expect(r2.status).toBe(409);
  });
});
