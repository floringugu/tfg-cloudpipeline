const request = require('supertest');
const { newDb } = require('pg-mem');
const { createApp, initSchema } = require('../../src/app');

function makeFetch(responses) {
  let call = 0;
  return async () => {
    const resp = responses[call] || responses[responses.length - 1];
    call += 1;
    if (resp instanceof Error) throw resp;
    return { status: resp };
  };
}

describe('order-service CRUD (unit, pg-mem)', () => {
  let app;
  let pool;

  beforeEach(async () => {
    const db = newDb();
    const { Pool } = db.adapters.createPg();
    pool = new Pool();
    await initSchema(pool);
  });

  afterEach(async () => {
    await pool.end();
  });

  describe('GET /health', () => {
    test('returns 200', async () => {
      app = createApp({ pool, userServiceUrl: 'http://fake', fetchImpl: makeFetch([200]) });
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.service).toBe('order-service');
    });
  });

  describe('GET /ready', () => {
    test('returns 200 when DB responds', async () => {
      app = createApp({ pool, userServiceUrl: 'http://fake', fetchImpl: makeFetch([200]) });
      const res = await request(app).get('/ready');
      expect(res.status).toBe(200);
    });
  });

  describe('POST /orders validation', () => {
    beforeEach(() => {
      app = createApp({ pool, userServiceUrl: 'http://fake', fetchImpl: makeFetch([200]) });
    });

    test('returns 400 when user_id missing', async () => {
      const res = await request(app)
        .post('/orders')
        .send({ product: 'X', amount: 10 });
      expect(res.status).toBe(400);
    });

    test('returns 400 when product missing', async () => {
      const res = await request(app)
        .post('/orders')
        .send({ user_id: 1, amount: 10 });
      expect(res.status).toBe(400);
    });

    test('returns 400 when amount missing', async () => {
      const res = await request(app)
        .post('/orders')
        .send({ user_id: 1, product: 'X' });
      expect(res.status).toBe(400);
    });

    test('returns 400 when amount <= 0', async () => {
      const res = await request(app)
        .post('/orders')
        .send({ user_id: 1, product: 'X', amount: 0 });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /orders cross-service validation', () => {
    test('creates order when user-service returns 200', async () => {
      app = createApp({ pool, userServiceUrl: 'http://fake', fetchImpl: makeFetch([200]) });
      const res = await request(app)
        .post('/orders')
        .send({ user_id: 1, product: 'Laptop', amount: 999.99 });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ user_id: 1, product: 'Laptop' });
    });

    test('returns 404 when user-service returns 404', async () => {
      app = createApp({ pool, userServiceUrl: 'http://fake', fetchImpl: makeFetch([404]) });
      const res = await request(app)
        .post('/orders')
        .send({ user_id: 9999, product: 'X', amount: 10 });
      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/9999/);
    });

    test('returns 503 when user-service throws (unreachable)', async () => {
      const unreachable = makeFetch([new Error('ECONNREFUSED')]);
      app = createApp({ pool, userServiceUrl: 'http://fake', fetchImpl: unreachable });
      const res = await request(app)
        .post('/orders')
        .send({ user_id: 1, product: 'X', amount: 10 });
      expect(res.status).toBe(503);
    });

    test('returns 503 when user-service returns 500', async () => {
      app = createApp({ pool, userServiceUrl: 'http://fake', fetchImpl: makeFetch([500]) });
      const res = await request(app)
        .post('/orders')
        .send({ user_id: 1, product: 'X', amount: 10 });
      expect(res.status).toBe(503);
    });
  });

  describe('GET /orders', () => {
    beforeEach(() => {
      app = createApp({ pool, userServiceUrl: 'http://fake', fetchImpl: makeFetch([200]) });
    });

    test('returns empty array initially', async () => {
      const res = await request(app).get('/orders');
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    test('lists created orders', async () => {
      await request(app).post('/orders').send({ user_id: 1, product: 'A', amount: 10 });
      await request(app).post('/orders').send({ user_id: 1, product: 'B', amount: 20 });
      const res = await request(app).get('/orders');
      expect(res.body).toHaveLength(2);
    });
  });

  describe('GET /orders/:id', () => {
    test('returns the order when exists', async () => {
      app = createApp({ pool, userServiceUrl: 'http://fake', fetchImpl: makeFetch([200]) });
      const created = await request(app)
        .post('/orders')
        .send({ user_id: 1, product: 'X', amount: 10 });
      const res = await request(app).get(`/orders/${created.body.id}`);
      expect(res.status).toBe(200);
      expect(res.body.product).toBe('X');
    });

    test('returns 404 when not found', async () => {
      app = createApp({ pool, userServiceUrl: 'http://fake', fetchImpl: makeFetch([200]) });
      const res = await request(app).get('/orders/9999');
      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /orders/:id', () => {
    test('deletes existing order', async () => {
      app = createApp({ pool, userServiceUrl: 'http://fake', fetchImpl: makeFetch([200]) });
      const created = await request(app)
        .post('/orders')
        .send({ user_id: 1, product: 'D', amount: 5 });
      const res = await request(app).delete(`/orders/${created.body.id}`);
      expect(res.status).toBe(204);
    });

    test('returns 404 when not found', async () => {
      app = createApp({ pool, userServiceUrl: 'http://fake', fetchImpl: makeFetch([200]) });
      const res = await request(app).delete('/orders/9999');
      expect(res.status).toBe(404);
    });
  });
});
