const router = require('express').Router();
const Order = require('../models/Order');
const paystationService = require('../services/paystation');

router.post('/paystation', async (req, res) => {
  try {
    const payload = req.body;
    const receivedSignature = req.headers['x-paystation-signature'] || payload.signature;

    // 🔒 Step 1: Verify HMAC Signature
    if (!paystationService.verifyWebhookSignature(payload, receivedSignature)) {
      console.warn('⚠️ Invalid webhook signature rejected');
      return res.status(401).send('Invalid signature');
    }

    const { invoice_number, status_code, trx_id } = payload;

    // Step 2: Find Order
    const order = await Order.findOne({ invoiceNumber: invoice_number });
    if (!order) {
      console.warn(`⚠️ Webhook received for unknown invoice: ${invoice_number}`);
      return res.status(404).send('Order not found');
    }

    // 🔒 Step 3: Idempotency Check (Prevent duplicate processing)
    if (order.status !== 'pending') {
      console.log(`✅ Idempotency hit: Order ${invoice_number} already ${order.status}`);
      return res.status(200).send('OK');
    }

    // Step 4: Update Order Status
    if (status_code === '200' || payload.status === 'Success') {
      order.status = 'paid';
      order.gatewayTransactionId = trx_id || invoice_number;
      console.log(`✅ Payment successful for Order ${invoice_number}`);
    } else {
      order.status = 'failed';
      console.log(`❌ Payment failed/cancelled for Order ${invoice_number}`);
    }

    await order.save();
    res.status(200).send('Webhook processed successfully');

  } catch (error) {
    console.error('Webhook Processing Error:', error);
    res.status(200).send('Error logged'); // Always 200 to stop PayStation retries
  }
});

module.exports = router;