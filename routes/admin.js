const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const Order = require('../models/Order');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const logger = require('../utils/logger');

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { success: false, message: 'Too many login attempts. Please try again later.' }
});

router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;
    if (username !== process.env.ADMIN_USERNAME) {
      logger.warn('Failed login', { username, ip: req.ip });
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const isMatch = await bcrypt.compare(password, process.env.ADMIN_PASSWORD_HASH);
    if (!isMatch) {
      logger.warn('Failed login', { username, ip: req.ip });
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    req.session.isAdmin = true;
    req.session.user = username;
    req.session.role = 'admin';
    logger.info('Admin login successful', { username, ip: req.ip });
    res.json({ success: true, message: 'Authenticated' });
  } catch (error) {
    logger.error('Login error', error);
    res.status(500).json({ success: false, message: 'Login error' });
  }
});

router.get('/orders', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const query = status ? { status } : {};
    
    const orders = await Order.find(query)
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .select('-__v -webhookMetadata');

    const total = await Order.countDocuments(query);
    res.json({
      success: true,
       orders,
      pagination: { currentPage: parseInt(page), totalPages: Math.ceil(total / limit), totalOrders: total }
    });
  } catch (error) {
    logger.error('Admin orders fetch error', error);
    res.status(500).json({ success: false, message: 'Failed to fetch orders' });
  }
});

router.post('/logout', requireAuth, (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ success: false, message: 'Logout failed' });
    res.clearCookie('__Secure-SessionID');
    res.json({ success: true, message: 'Logged out' });
  });
});

module.exports = router;