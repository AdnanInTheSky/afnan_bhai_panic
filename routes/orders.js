const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const Order = require('../models/Order');
const PRODUCT_CATALOG = require('../utils/productCatalog');
const paystationService = require('../services/paystation');
const logger = require('../utils/logger');

const orderLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 3,
  message: { success: false, message: 'Too many checkout attempts. Please wait.' }
});

router.post('/', orderLimiter, async (req, res) => {
  try {
    const { cartItems, customerInfo } = req.body;

    if (!Array.isArray(cartItems) || cartItems.length === 0) {
      return res.status(400).json({ success: false, message: 'Cart is empty' });
    }

    const requiredFields = ['name', 'email', 'phone', 'address'];
    const missing = requiredFields.filter(f => !customerInfo?.[f]);
    if (missing.length > 0) {
      return res.status(400).json({ success: false, message: `Missing: ${missing.join(', ')}` });
    }

    // 🔒 Server-Side Price Validation
    let totalAmount = 0;
    const validatedItems = [];

    for (const item of cartItems) {
      const product = PRODUCT_CATALOG[item.productId];
      if (!product) return res.status(400).json({ success: false, message: 'Invalid product' });
      if (product.price !== item.price) {
        logger.warn('Price mismatch', { productId: item.productId, sent: item.price, catalog: product.price });
        return res.status(400).json({ success: false, message: 'Price validation failed' });
      }
      const qty = Math.max(1, Math.min(99, parseInt(item.quantity) || 1));
      validatedItems.push({ productId: product.id, name: product.name, price: product.price, quantity: qty });
      totalAmount += product.price * qty;
    }

    const invoiceNumber = `INV${Date.now()}${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    
    const order = new Order({
      invoiceNumber,
      reference: `REF-${invoiceNumber}`,
      status: 'pending',
      items: validatedItems,
      totalAmount,
      currency: 'BDT',
      customerName: customerInfo.name.trim(),
      customerEmail: customerInfo.email.toLowerCase().trim(),
      customerPhone: customerInfo.phone.trim(),
      customerAddress: customerInfo.address.trim(),
      ip: req.ip
    });

    await order.save();
    logger.info('Order created', { invoiceNumber, totalAmount });

    const paymentResult = await paystationService.initiatePayment({
      invoiceNumber, totalAmount, currency: 'BDT', reference: `REF-${invoiceNumber}`,
      items: validatedItems, ...customerInfo
    });

    if (paymentResult.success) {
      return res.json({ success: true, paymentUrl: paymentResult.paymentUrl, invoiceNumber });
    }

    order.status = 'failed';
    order.paymentError = paymentResult.message;
    await order.save();
    return res.status(400).json({ success: false, message: paymentResult.message });

  } catch (error) {
    logger.error('Order creation error', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

module.exports = router;