const axios = require('axios');
const crypto = require('crypto');
const logger = require('../utils/logger');

class PayStationService {
  constructor() {
    this.merchantId = process.env.PAYSTATION_MERCHANT_ID;
    this.password = process.env.PAYSTATION_PASSWORD;
    this.webhookSecret = process.env.PAYSTATION_WEBHOOK_SECRET || process.env.PAYSTATION_PASSWORD;
    this.baseUrl = process.env.NODE_ENV === 'production'
      ? 'https://paystation.com.bd'
      : 'https://sandbox.paystation.com.bd';
  }

  generateSignature(params, secret) {
    const sortedKeys = Object.keys(params).sort();
    const stringToSign = sortedKeys.map(key => String(params[key])).join('');
    return crypto.createHmac('sha256', secret).update(stringToSign).digest('hex');
  }

  verifyWebhookSignature(payload, receivedSignature) {
    if (!receivedSignature || !payload) return false;
    const payloadCopy = { ...payload };
    delete payloadCopy.signature;
    const expected = this.generateSignature(payloadCopy, this.webhookSecret);
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(receivedSignature, 'hex'));
  }

  async initiatePayment(orderData) {
    const params = {
      merchantId: this.merchantId,
      password: this.password,
      invoice_number: orderData.invoiceNumber,
      currency: orderData.currency || 'BDT',
      payment_amount: orderData.totalAmount,
      reference: orderData.reference || `REF-${orderData.invoiceNumber}`,
      cust_name: orderData.customerName,
      cust_phone: orderData.customerPhone,
      cust_email: orderData.customerEmail,
      cust_address: orderData.customerAddress,
      callback_url: `${process.env.BACKEND_URL}/api/webhooks/paystation`,
      checkout_items: JSON.stringify(orderData.items)
    };

    // Optional: Add signature if PayStation mandates it for initiation
    params.signature = this.generateSignature(params, this.password);

    try {
      const formData = new URLSearchParams(params);
      const response = await axios.post(`${this.baseUrl}/initiate-payment`, formData, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 30000
      });

      if (response.data.status_code === '200' && response.data.payment_url) {
        return { success: true, paymentUrl: response.data.payment_url };
      }
      return { success: false, message: response.data.message || 'Payment initiation failed' };
    } catch (error) {
      logger.error('PayStation API Error', error.response?.data || error.message);
      return { success: false, message: 'Payment gateway connection failed' };
    }
  }
}

module.exports = new PayStationService();