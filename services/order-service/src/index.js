const express = require('express');
const app = express();
const PORT = 3001;
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});
app.get('/orders', (req, res) => {
  res.json([
    { id: 1, userId: 1, product: 'Laptop', amount: 999.99 },
    { id: 2, userId: 2, product: 'Monitor', amount: 299.99 }
  ]);
});
app.listen(PORT, () => {
  console.log(`Order Service corriendo en puerto ${PORT}`);
});
