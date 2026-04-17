const request = require('supertest');
const { Pool } = require('pg');
const { createApp, initSchema } = require('../../src/app');

const INTEGRATION_DB_URL = process.env.INTEGRATION_DB_URL;
const describeIf = INTEGRATION_DB_URL ? describe : describe.skip;

describeIf('user-service CRUD (integration, real PostgreSQL)', () => {
  let app;
  let pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: INTEGRATION_DB_URL });
    await pool.query('DROP TABLE IF EXISTS users');
    await initSchema(pool);
    app = createApp({ pool });
  });

  afterAll(async () => {
    await pool.query('DROP TABLE IF EXISTS users');
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE users RESTART IDENTITY');
  });

  test('full CRUD cycle against real PostgreSQL', async () => {
    const created = await request(app)
      .post('/users')
      .send({ email: 'integ@test.com', name: 'Integ' });
    expect(created.status).toBe(201);

    const list = await request(app).get('/users');
    expect(list.body).toHaveLength(1);

    const got = await request(app).get(`/users/${created.body.id}`);
    expect(got.body.email).toBe('integ@test.com');

    const upd = await request(app)
      .put(`/users/${created.body.id}`)
      .send({ email: 'integ@test.com', name: 'Integ2' });
    expect(upd.body.name).toBe('Integ2');

    const del = await request(app).delete(`/users/${created.body.id}`);
    expect(del.status).toBe(204);
  });

  test('unique email constraint enforced by PostgreSQL returns 409', async () => {
    await request(app).post('/users').send({ email: 'x@t.com', name: 'A' });
    const res = await request(app).post('/users').send({ email: 'x@t.com', name: 'B' });
    expect(res.status).toBe(409);
  });
});
