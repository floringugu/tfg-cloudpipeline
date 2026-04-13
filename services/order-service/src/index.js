const express = require('express');
const { InfluxDB, Point } = require('@influxdata/influxdb-client');

const app = express();
const PORT = 3001;

const influx = new InfluxDB({
  url: process.env.INFLUXDB_URL || 'http://influxdb.monitoring.svc.cluster.local:8086',
  token: process.env.INFLUXDB_TOKEN || ''
});
const writeApi = influx.getWriteApi('tfg', 'metrics', 's', { flushInterval: 1000 });

function writeMetric(endpoint) {
  const point = new Point('http_requests')
    .tag('service', 'order-service')
    .tag('endpoint', endpoint)
    .intField('count', 1);
  writeApi.writePoint(point);
  writeApi.flush();
}

app.get('/health', (req, res) => {
  writeMetric('/health');
  res.json({ status: 'ok' });
});

app.get('/orders', (req, res) => {
  writeMetric('/orders');
  res.json([
    { id: 1, userId: 1, product: 'Laptop', amount: 999.99 },
    { id: 2, userId: 2, product: 'Monitor', amount: 299.99 }
  ]);
});

app.listen(PORT, () => {
  console.log(`Order Service corriendo en puerto ${PORT}`);
});
