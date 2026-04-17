const request = require('supertest');
const { Pool } = require('pg');
const { createApp, initSchema } = require('../../src/app');

const INTEGRATION_DB_URL = process.env.INTEGRATION_DB_URL;
const describeIf = INTEGRATION_DB_URL ? describe : describe.skip;

describeIf('order-service CRUD (integration, real PostgreSQL)', () => {
  let app;
  let pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: INTEGRATION_DB_URL });
    await pool.query('DROP TABLE IF EXISTS orders');
    await initSchema(pool);
    app = createApp({
      pool,
      userServiceUrl: 'http://fake',
      fetchImpl: async () => ({ status: 200 }),
    });
  });

  afterAll(async () => {
    await pool.query('DROP TABLE IF EXISTS orders');
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE orders RESTART IDENTITY');
  });

  test('full CRUD cycle against real PostgreSQL', async () => {
    const created = await request(app)
      .post('/orders')
      .send({ user_id: 1, product: 'Laptop', amount: 999.99 });
    expect(created.status).toBe(201);

    const list = await request(app).get('/orders');
    expect(list.body).toHaveLength(1);

    const got = await request(app).get(`/orders/${created.body.id}`);
    expect(got.body.product).toBe('Laptop');

    const del = await request(app).delete(`/orders/${created.body.id}`);
    expect(del.status).toBe(204);
  });

  test('CHECK constraint enforces amount > 0 at DB level', async () => {
    const res = await request(app)
      .post('/orders')
      .send({ user_id: 1, product: 'X', amount: -1 });
    expect(res.status).toBe(400);
  });
});
