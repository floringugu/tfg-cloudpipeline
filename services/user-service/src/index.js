const express = require('express');
const app = express();
const PORT = 3000;

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/users', (req, res) => {
  res.json([
    { id: 1, name: 'Florin', email: 'florin@ejemplo.es' },
    { id: 2, name: 'Gugu', email: 'gugu@ejemplo.es' }
  ]);
});

app.listen(PORT, () => {
  console.log(`User Service corriendo en puerto ${PORT}`);
});
