// integration/middleware/demo.js
// Run with: node demo.js
// Demonstrates the producer publishing 3+ readings, then the consumer
// draining and evaluating them asynchronously, one at a time.

const { submitReading } = require('./producer');
const { startConsumer } = require('./consumer');

console.log('--- Producer: submitting fermentation readings ---');
submitReading(1, 'temperature', 32.5); // out of range -> ALERT
submitReading(1, 'ph', 3.6); // in range -> OK
submitReading(2, 'brix', 15.2); // out of range -> ALERT
submitReading(2, 'temperature', 24.0); // in range -> OK

console.log('\n--- Consumer: processing queue asynchronously ---');
startConsumer(300, () => {
  console.log('\nQueue drained. Demo complete.');
});
