// integration/middleware/producer.js
// Producer (Reading Module): publishes fermentation sensor readings onto
// the queue for the Alert/Approval module to evaluate asynchronously.
// This is the Bunius-Sense equivalent of "Loan Module -> loan requests".

const queue = require('./queue');

function submitReading(batchId, sensorType, value) {
  const message = {
    batchId,
    sensorType,
    value,
    timestamp: new Date().toISOString(),
  };

  queue.enqueue(message);

  console.log(
    `Reading submitted: {batchId: ${batchId}, sensorType: '${sensorType}', value: ${value}}`
  );

  return message;
}

module.exports = { submitReading };
