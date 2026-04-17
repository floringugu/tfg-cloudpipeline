const request = require('supertest');
const { newDb } = require('pg-mem');
const { createApp, initSchema } = require('../../src/app');

describe('user-service CRUD (unit, pg-mem)', () => {
  let app;
  let pool;

  beforeEach(async () => {
    const db = newDb();
    const { Pool } = db.adapters.createPg();
    pool = new Pool();
    await initSchema(pool);
    app = createApp({ pool });
  });

  afterEach(async () => {
    await pool.end();
  });

  describe('GET /health', () => {
    test('returns 200 with status ok', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'ok', service: 'user-service' });
    });
  });

  describe('GET /ready', () => {
    test('returns 200 when DB responds', async () => {
      const res = await request(app).get('/ready');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ready');
    });
  });

  describe('POST /users', () => {
    test('creates a user with 201', async () => {
      const res = await request(app)
        .post('/users')
        .send({ email: 'a@test.com', name: 'Alice' });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ email: 'a@test.com', name: 'Alice' });
      expect(res.body.id).toBeDefined();
    });

    test('returns 400 when email missing', async () => {
      const res = await request(app).post('/users').send({ name: 'Bob' });
      expect(res.status).toBe(400);
    });

    test('returns 400 when name missing', async () => {
      const res = await request(app).post('/users').send({ email: 'b@test.com' });
      expect(res.status).toBe(400);
    });

    test('returns 409 on duplicate email', async () => {
      await request(app).post('/users').send({ email: 'dup@test.com', name: 'X' });
      const res = await request(app)
        .post('/users')
        .send({ email: 'dup@test.com', name: 'Y' });
      expect(res.status).toBe(409);
    });
  });

  describe('GET /users', () => {
    test('returns empty array initially', async () => {
      const res = await request(app).get('/users');
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    test('lists created users', async () => {
      await request(app).post('/users').send({ email: '1@t.com', name: 'One' });
      await request(app).post('/users').send({ email: '2@t.com', name: 'Two' });
      const res = await request(app).get('/users');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
    });
  });

  describe('GET /users/:id', () => {
    test('returns the user when exists', async () => {
      const created = await request(app)
        .post('/users')
        .send({ email: 'g@t.com', name: 'Get' });
      const res = await request(app).get(`/users/${created.body.id}`);
      expect(res.status).toBe(200);
      expect(res.body.email).toBe('g@t.com');
    });

    test('returns 404 when not found', async () => {
      const res = await request(app).get('/users/9999');
      expect(res.status).toBe(404);
    });
  });

  describe('PUT /users/:id', () => {
    test('updates an existing user', async () => {
      const created = await request(app)
        .post('/users')
        .send({ email: 'u@t.com', name: 'Original' });
      const res = await request(app)
        .put(`/users/${created.body.id}`)
        .send({ email: 'u@t.com', name: 'Updated' });
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Updated');
    });

    test('returns 404 when user not found', async () => {
      const res = await request(app)
        .put('/users/9999')
        .send({ email: 'x@t.com', name: 'X' });
      expect(res.status).toBe(404);
    });

    test('returns 400 when fields missing', async () => {
      const res = await request(app).put('/users/1').send({ email: 'x@t.com' });
      expect(res.status).toBe(400);
    });
  });

  describe('DELETE /users/:id', () => {
    test('deletes an existing user', async () => {
      const created = await request(app)
        .post('/users')
        .send({ email: 'd@t.com', name: 'Delete' });
      const res = await request(app).delete(`/users/${created.body.id}`);
      expect(res.status).toBe(204);
      const check = await request(app).get(`/users/${created.body.id}`);
      expect(check.status).toBe(404);
    });

    test('returns 404 when user not found', async () => {
      const res = await request(app).delete('/users/9999');
      expect(res.status).toBe(404);
    });
  });
});
