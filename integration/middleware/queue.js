// integration/middleware/queue.js
// A minimal in-memory message queue standing in for a real broker
// (RabbitMQ/Kafka) for this lab. Same enqueue/dequeue contract, so it
// could be swapped for a real broker client later without changing
// producer.js or consumer.js.

class MessageQueue {
  constructor() {
    this.messages = [];
  }

  enqueue(message) {
    this.messages.push(message);
  }

  dequeue() {
    return this.messages.shift(); // returns undefined if empty
  }

  isEmpty() {
    return this.messages.length === 0;
  }

  size() {
    return this.messages.length;
  }
}

// Export a single shared instance so producer and consumer talk to the
// same queue, just like they would through a real broker.
module.exports = new MessageQueue();
