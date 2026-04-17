const express = require('express');
const { Point } = require('@influxdata/influxdb-client');

function createApp({ pool, influxWriteApi, userServiceUrl, fetchImpl = fetch } = {}) {
  const app = express();
  app.use(express.json());

  if (influxWriteApi) {
    app.use((req, res, next) => {
      const start = Date.now();
      res.on('finish', () => {
        const duration = Date.now() - start;
        const point = new Point('http_requests')
          .tag('service', 'order-service')
          .tag('endpoint', req.path)
          .tag('method', req.method)
          .tag('status', String(res.statusCode))
          .intField('count', 1)
          .floatField('duration_ms', duration);
        influxWriteApi.writePoint(point);
        influxWriteApi.flush().catch((err) => console.error('[influx]', err.message));
      });
      next();
    });
  }

  async function userExists(userId) {
    try {
      const resp = await fetchImpl(`${userServiceUrl}/users/${userId}`, {
        signal: AbortSignal.timeout(3000),
      });
      if (resp.status === 200) return true;
      if (resp.status === 404) return false;
      return null;
    } catch (err) {
      console.error('[user-check]', err.message);
      return null;
    }
  }

  app.get('/health', (req, res) => res.json({ status: 'ok', service: 'order-service' }));

  app.get('/ready', async (req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'ready' });
    } catch (err) {
      res.status(503).json({ status: 'not ready', error: err.message });
    }
  });

  app.get('/orders', async (req, res) => {
    try {
      const { rows } = await pool.query(
        'SELECT id, user_id, product, amount, created_at FROM orders ORDER BY id'
      );
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/orders/:id', async (req, res) => {
    try {
      const { rows } = await pool.query(
        'SELECT id, user_id, product, amount, created_at FROM orders WHERE id = $1',
        [req.params.id]
      );
      if (rows.length === 0) return res.status(404).json({ error: 'order not found' });
      res.json(rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/orders', async (req, res) => {
    const { user_id, product, amount } = req.body || {};
    if (!user_id || !product || amount == null) {
      return res.status(400).json({ error: 'user_id, product and amount are required' });
    }
    if (Number(amount) <= 0) {
      return res.status(400).json({ error: 'amount must be > 0' });
    }

    const exists = await userExists(user_id);
    if (exists === false) {
      return res.status(404).json({ error: `user_id ${user_id} does not exist` });
    }
    if (exists === null) {
      return res.status(503).json({ error: 'user-service unreachable, cannot validate user_id' });
    }

    try {
      const { rows } = await pool.query(
        'INSERT INTO orders (user_id, product, amount) VALUES ($1, $2, $3) RETURNING id, user_id, product, amount, created_at',
        [user_id, product, amount]
      );
      res.status(201).json(rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/orders/:id', async (req, res) => {
    try {
      const { rowCount } = await pool.query('DELETE FROM orders WHERE id = $1', [req.params.id]);
      if (rowCount === 0) return res.status(404).json({ error: 'order not found' });
      res.status(204).send();
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return app;
}

async function initSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      product TEXT NOT NULL,
      amount NUMERIC(10,2) NOT NULL CHECK (amount > 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

module.exports = { createApp, initSchema };
