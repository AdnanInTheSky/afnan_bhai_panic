const express = require('express');
const router = express.Router();
const Order = require('../models/Order');
const paystationService = require('../services/paystation');
const logger = require('../utils/logger');

// 🔒 CRITICAL: Parse raw body BEFORE express.json() consumes it
router.use('/paystation', express.raw({ type: ['application/json', 'application/x-www-form-urlencoded'] }));

router.post('/paystation', async (req, res) => {
  try {
    let payload;
    try {
      payload = JSON.parse(req.body.toString('utf8'));
    } catch {
      payload = typeof req.body === 'object' ? req.body : {};
    }

    const receivedSignature = req.headers['x-paystation-signature'] || req.headers['signature'] || payload.signature;
    logger.info('Webhook received', { invoice: payload.invoice_number, ip: req.ip });

    // 🔒 1. HMAC Signature Verification
    if (!paystationService.verifyWebhookSignature(payload, receivedSignature)) {
      logger.error('INVALID SIGNATURE', { ip: req.ip });
      return res.status(200).send('Invalid signature'); // 200 stops retries
    }

    const { invoice_number, status_code, trx_status, trx_id, payment_amount } = payload;
    if (!invoice_number) return res.status(200).send('Missing invoice_number');

    // 🔒 2. Idempotency Check
    const order = await Order.findOne({ invoiceNumber: invoice_number });
    if (!order) {
      logger.warn('Order not found', { invoice_number });
      return res.status(200).send('Order not found');
    }

    if (order.status !== 'pending') {
      logger.info('Idempotency hit', { invoice_number, status: order.status });
      return res.status(200).send('Already processed');
    }

    // 🔒 3. Secure Status Update
    const isSuccess = status_code === '200' || trx_status === 'successful' || trx_status === 'Success';
    order.status = isSuccess ? 'paid' : 'failed';
    order.gatewayTransactionId = trx_id || invoice_number;
    order.paymentAmount = payment_amount ? parseFloat(payment_amount) : order.totalAmount;
    order.paymentMethod = payload.payment_method || 'unknown';
    order.webhookMetadata = {
      statusCode: status_code,
      trxStatus: trx_status,
      processedAt: new Date().toISOString(),
      ip: req.ip
    };

    await order.save();
    logger.info('Order updated', { invoice_number, status: order.status });
    return res.status(200).send('Processed');

  } catch (error) {
    logger.error('Webhook processing error', error);
    return res.status(200).send('Error logged');
  }
});

module.exports = router;