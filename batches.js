// src/api/batches.js
// Module 1: Batches — fermentation batch records for Bunius-Sense
const express = require('express');
const router = express.Router();

// Dummy in-memory data store (no DB required yet)
let batches = [
  { id: 1, wineType: 'Bignay Red', startDate: '2026-09-01', status: 'fermenting' },
  { id: 2, wineType: 'Bignay Sweet', startDate: '2026-09-10', status: 'aging' },
];
let nextId = 3;

// GET /batches → Retrieve all batches
router.get('/', (req, res) => {
  res.status(200).json(batches);
});

// GET /batches/:id → Retrieve a single batch
router.get('/:id', (req, res) => {
  const batch = batches.find(b => b.id === Number(req.params.id));
  if (!batch) return res.status(404).json({ error: 'Batch not found' });
  res.status(200).json(batch);
});

// POST /batches → Add a new batch
router.post('/', (req, res) => {
  const { wineType, startDate, status } = req.body;
  if (!wineType || !startDate) {
    return res.status(400).json({ error: 'wineType and startDate are required' });
  }
  const newBatch = { id: nextId++, wineType, startDate, status: status || 'fermenting' };
  batches.push(newBatch);
  res.status(201).json(newBatch);
});

// PUT /batches/:id → Update an existing batch
router.put('/:id', (req, res) => {
  const batch = batches.find(b => b.id === Number(req.params.id));
  if (!batch) return res.status(404).json({ error: 'Batch not found' });
  const { wineType, startDate, status } = req.body;
  if (wineType !== undefined) batch.wineType = wineType;
  if (startDate !== undefined) batch.startDate = startDate;
  if (status !== undefined) batch.status = status;
  res.status(200).json(batch);
});

// DELETE /batches/:id → Remove a batch
router.delete('/:id', (req, res) => {
  const index = batches.findIndex(b => b.id === Number(req.params.id));
  if (index === -1) return res.status(404).json({ error: 'Batch not found' });
  const deleted = batches.splice(index, 1)[0];
  res.status(200).json({ message: 'Batch deleted', batch: deleted });
});

module.exports = router;
