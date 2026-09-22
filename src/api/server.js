// src/api/server.js
// Entry point for the Bunius-Sense REST API (Batches & Readings modules)
const express = require('express');
const batchesRouter = require('./batches');
const readingsRouter = require('./readings');

const app = express();
app.use(express.json());

// Module 1: Batches
app.use('/batches', batchesRouter);

// Module 2: Readings
app.use('/readings', readingsRouter);

app.get('/', (req, res) => {
  res.send('Bunius-Sense API is running. Try /batches or /readings.');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Bunius-Sense API listening on http://localhost:${PORT}`);
});
