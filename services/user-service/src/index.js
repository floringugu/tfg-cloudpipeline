const express = require('express');
const { InfluxDB, Point } = require('@influxdata/influxdb-client');

const app = express();
const PORT = 3000;

const influx = new InfluxDB({
  url: process.env.INFLUXDB_URL || 'http://influxdb.monitoring.svc.cluster.local:8086',
  token: process.env.INFLUXDB_TOKEN || ''
});
const writeApi = influx.getWriteApi('tfg', 'metrics', 's', { flushInterval: 1000 });

function writeMetric(endpoint) {
  const point = new Point('http_requests')
    .tag('service', 'user-service')
    .tag('endpoint', endpoint)
    .intField('count', 1);
  writeApi.writePoint(point);
  writeApi.flush();
}

app.get('/health', (req, res) => {
  writeMetric('/health');
  res.json({ status: 'ok' });
});

app.get('/users', (req, res) => {
  writeMetric('/users');
  res.json([
    { id: 1, name: 'Florin', email: 'florin@ejemplo.es' },
    { id: 2, name: 'Gugu', email: 'gugu@ejemplo.es' }
  ]);
});

app.listen(PORT, () => {
  console.log(`User Service corriendo en puerto ${PORT}`);
});
