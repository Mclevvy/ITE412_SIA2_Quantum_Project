// integration/middleware/consumer.js
// Consumer (Alert Module): asynchronously reads reading messages off the
// queue and decides whether they require an alert. This is the
// Bunius-Sense equivalent of "Approval Module -> Approved/Rejected".

const queue = require('./queue');

// Ideal fermentation ranges per sensor type. Outside these -> ALERT.
const THRESHOLDS = {
  temperature: { min: 18, max: 30 }, // degrees Celsius
  ph: { min: 3.0, max: 4.2 },
  brix: { min: 8, max: 14 }, // sugar content
};

function evaluateReading({ sensorType, value }) {
  const range = THRESHOLDS[sensorType];
  if (!range) return 'OK'; // unknown sensor type: nothing to flag
  return value < range.min || value > range.max ? 'ALERT' : 'OK';
}

// Simulates asynchronous, background message processing: the consumer
// polls the queue on an interval rather than being called directly by
// the producer, so producing and consuming are decoupled in time.
function startConsumer(delayMs = 300, onDone) {
  const interval = setInterval(() => {
    if (queue.isEmpty()) {
      clearInterval(interval);
      if (onDone) onDone();
      return;
    }

    const message = queue.dequeue();
    const decision = evaluateReading(message);

    console.log(
      `Reading for Batch ${message.batchId} (${message.sensorType}=${message.value}) → ${decision}`
    );
  }, delayMs);

  return interval;
}

module.exports = { startConsumer, evaluateReading, THRESHOLDS };
