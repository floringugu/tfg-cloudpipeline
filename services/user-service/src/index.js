const express = require('express');
const { Pool } = require('pg');
const { InfluxDB, Point } = require('@influxdata/influxdb-client');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ---------- PostgreSQL ----------
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
});

async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  console.log('[init] users table ready');
}

// ---------- InfluxDB (compatible con instrumentación anterior) ----------
const influx = new InfluxDB({
  url: process.env.INFLUXDB_URL || 'http://influxdb.monitoring.svc.cluster.local:8086',
  token: process.env.INFLUXDB_TOKEN || '',
});
const writeApi = influx.getWriteApi('tfg', 'metrics', 's', { flushInterval: 1000 });

// Middleware: captura TODAS las rutas automáticamente, mantiene measurement http_requests + count
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
    writeApi.writePoint(point);
    writeApi.flush().catch((err) => console.error('[influx] flush error', err.message));
  });
  next();
});

// ---------- Health (liveness) y Ready (readiness) ----------
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

// ---------- CRUD users ----------
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

// ---------- Bootstrap ----------
initSchema()
  .then(() => {
    app.listen(PORT, () => console.log(`User Service corriendo en puerto ${PORT}`));
  })
  .catch((err) => {
    console.error('[fatal] failed to init schema:', err);
    process.exit(1);
  });
