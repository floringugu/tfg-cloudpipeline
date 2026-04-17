const express = require('express');
const { Point } = require('@influxdata/influxdb-client');

function createApp({ pool, influxWriteApi } = {}) {
  const app = express();
  app.use(express.json());

  if (influxWriteApi) {
    app.use((req, res, next) => {
      const start = Date.now();
      res.on('finish', () => {
        const duration = Date.now() - start;
        const point = new Point('http_requests')
          .tag('service', 'user-service')
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

  app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'user-service' });
  });

  app.get('/ready', async (req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'ready' });
    } catch (err) {
      res.status(503).json({ status: 'not ready', error: err.message });
    }
  });

  app.get('/users', async (req, res) => {
    try {
      const { rows } = await pool.query(
        'SELECT id, email, name, created_at FROM users ORDER BY id'
      );
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/users/:id', async (req, res) => {
    try {
      const { rows } = await pool.query(
        'SELECT id, email, name, created_at FROM users WHERE id = $1',
        [req.params.id]
      );
      if (rows.length === 0) return res.status(404).json({ error: 'user not found' });
      res.json(rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/users', async (req, res) => {
    const { email, name } = req.body || {};
    if (!email || !name) {
      return res.status(400).json({ error: 'email and name are required' });
    }
    try {
      const { rows } = await pool.query(
        'INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id, email, name, created_at',
        [email, name]
      );
      res.status(201).json(rows[0]);
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ error: 'email already exists' });
      }
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/users/:id', async (req, res) => {
    const { email, name } = req.body || {};
    if (!email || !name) {
      return res.status(400).json({ error: 'email and name are required' });
    }
    try {
      const { rows } = await pool.query(
        'UPDATE users SET email = $1, name = $2 WHERE id = $3 RETURNING id, email, name, created_at',
        [email, name, req.params.id]
      );
      if (rows.length === 0) return res.status(404).json({ error: 'user not found' });
      res.json(rows[0]);
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ error: 'email already exists' });
      }
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/users/:id', async (req, res) => {
    try {
      const { rowCount } = await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);
      if (rowCount === 0) return res.status(404).json({ error: 'user not found' });
      res.status(204).send();
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return app;
}

async function initSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

module.exports = { createApp, initSchema };
