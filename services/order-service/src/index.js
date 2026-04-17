const { Pool } = require('pg');
const { InfluxDB } = require('@influxdata/influxdb-client');
const { createApp, initSchema } = require('./app');

const PORT = process.env.PORT || 3001;
const USER_SERVICE_URL = process.env.USER_SERVICE_URL || 'http://user-service.default.svc.cluster.local';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
});

const influx = new InfluxDB({
  url: process.env.INFLUXDB_URL || 'http://influxdb.monitoring.svc.cluster.local:8086',
  token: process.env.INFLUXDB_TOKEN || '',
});
const writeApi = influx.getWriteApi('tfg', 'metrics', 's', { flushInterval: 1000 });

const app = createApp({
  pool,
  influxWriteApi: writeApi,
  userServiceUrl: USER_SERVICE_URL,
});

initSchema(pool)
  .then(() => {
    console.log('[init] orders table ready');
    app.listen(PORT, () => console.log(`Order Service corriendo en puerto ${PORT}`));
  })
  .catch((err) => {
    console.error('[fatal] failed to init schema:', err);
    process.exit(1);
  });
