require('dotenv').config();
const express = require('express');
const morgan = require('morgan');
const path = require('path');
const connectDB = require('./config/database');
const applySecurity = require('./middleware/security');
const logger = require('./utils/logger');

const app = express();

// Connect Database
connectDB();

// Apply Security Middleware (CORS, Helmet, Sessions, Rate Limit)
applySecurity(app);

// HTTP Logging
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// 🔒 MOUNT WEBHOOK ROUTES BEFORE JSON PARSER TO PRESERVE RAW BODY
app.use('/api/webhooks', require('./routes/webhooks'));

// Standard Body Parsing (applies to all routes EXCEPT webhooks)
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// Static Frontend Serving
app.use(express.static(path.join(__dirname, '../frontend'), {
  maxAge: '1d',
  etag: true,
  lastModified: true
}));

// API Routes
app.use('/api/orders', require('./routes/orders'));
app.use('/api/admin', require('./routes/admin'));

// Health Check
app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// SPA Fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// Global Error Handler
app.use((err, req, res, next) => {
  logger.error('Unhandled error', err);
  const statusCode = err.statusCode || 500;
  const message = process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message;
  res.status(statusCode).json({ success: false, message });
});

// Start Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`, { env: process.env.NODE_ENV });
});