// src/api/readings.js
// Module 2: Readings — fermentation sensor readings for Bunius-Sense
const express = require('express');
const router = express.Router();

// Dummy in-memory data store (no DB required yet)
let readings = [
  { id: 1, batchId: 1, temperature: 28.5, ph: 3.8, brix: 12.0, timestamp: '2026-09-22T08:00:00Z' },
];
let nextId = 2;

// GET /readings → Retrieve all readings
router.get('/', (req, res) => {
  res.status(200).json(readings);
});

// GET /readings/:id → Retrieve a single reading
router.get('/:id', (req, res) => {
  const reading = readings.find(r => r.id === Number(req.params.id));
  if (!reading) return res.status(404).json({ error: 'Reading not found' });
  res.status(200).json(reading);
});

// POST /readings → Add a new reading
router.post('/', (req, res) => {
  const { batchId, temperature, ph, brix, timestamp } = req.body;
  if (batchId === undefined || temperature === undefined) {
    return res.status(400).json({ error: 'batchId and temperature are required' });
  }
  const newReading = {
    id: nextId++,
    batchId,
    temperature,
    ph: ph ?? null,
    brix: brix ?? null,
    timestamp: timestamp || new Date().toISOString(),
  };
  readings.push(newReading);
  res.status(201).json(newReading);
});

// PUT /readings/:id → Update an existing reading
router.put('/:id', (req, res) => {
  const reading = readings.find(r => r.id === Number(req.params.id));
  if (!reading) return res.status(404).json({ error: 'Reading not found' });
  const { temperature, ph, brix, timestamp } = req.body;
  if (temperature !== undefined) reading.temperature = temperature;
  if (ph !== undefined) reading.ph = ph;
  if (brix !== undefined) reading.brix = brix;
  if (timestamp !== undefined) reading.timestamp = timestamp;
  res.status(200).json(reading);
});

// DELETE /readings/:id → Remove a reading
router.delete('/:id', (req, res) => {
  const index = readings.findIndex(r => r.id === Number(req.params.id));
  if (index === -1) return res.status(404).json({ error: 'Reading not found' });
  const deleted = readings.splice(index, 1)[0];
  res.status(200).json({ message: 'Reading deleted', reading: deleted });
});

module.exports = router;
