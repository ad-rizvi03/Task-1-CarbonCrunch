const express = require('express');
const path = require('path');
const Database = require('./src/database');
const EventService = require('./src/services/eventService');
const AggregationService = require('./src/services/aggregationService');

const app = express();
const PORT = 3000;

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Initialize database and services
let eventService;
let aggregationService;

async function initializeServices() {
  const db = await new Database().init();
  eventService = new EventService(db);
  aggregationService = new AggregationService(db);
}

initializeServices().then(() => {
  console.log('Database initialized successfully');
}).catch(error => {
  console.error('Failed to initialize database:', error);
  process.exit(1);
});

// API Routes

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Ingest event
app.post('/api/events', async (req, res) => {
  try {
    if (!eventService) {
      return res.status(503).json({ success: false, message: 'Service initializing' });
    }
    const rawEvent = req.body;
    const simulateFailure = req.query.simulate_failure === 'true';
    
    const result = await eventService.ingestEvent(rawEvent, simulateFailure);
    
    res.status(result.status).json(result);
  } catch (error) {
    console.error('Error ingesting event:', error);
    res.status(500).json({
      status: 500,
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

// Get all events (with filtering)
app.get('/api/events', (req, res) => {
  try {
    if (!eventService) {
      return res.status(503).json({ success: false, message: 'Service initializing' });
    }
    const { client_id, status, start_date, end_date } = req.query;
    const events = eventService.getEvents({ client_id, status, start_date, end_date });
    res.json({ success: true, events });
  } catch (error) {
    console.error('Error fetching events:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get aggregated data
app.get('/api/aggregations', (req, res) => {
  try {
    if (!aggregationService) {
      return res.status(503).json({ success: false, message: 'Service initializing' });
    }
    const { client_id, start_date, end_date } = req.query;
    const aggregations = aggregationService.getAggregations({ client_id, start_date, end_date });
    res.json({ success: true, aggregations });
  } catch (error) {
    console.error('Error fetching aggregations:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get statistics
app.get('/api/stats', (req, res) => {
  try {
    if (!eventService) {
      return res.status(503).json({ success: false, message: 'Service initializing' });
    }
    const stats = eventService.getStats();
    res.json({ success: true, stats });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Database initialized successfully`);
});
