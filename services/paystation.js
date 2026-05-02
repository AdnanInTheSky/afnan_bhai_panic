const axios = require('axios');
const crypto = require('crypto');

class PayStationService {
  constructor() {
    this.merchantId = process.env.PAYSTATION_MERCHANT_ID;
    this.password = process.env.PAYSTATION_PASSWORD;
    this.apiUrl = process.env.PAYSTATION_API_URL || 'https://sandbox.paystation.com.bd/initiate-payment';
    this.webhookSecret = process.env.PAYSTATION_WEBHOOK_SECRET || process.env.PAYSTATION_PASSWORD;
  }

  async initiatePayment(orderData) {
    const payload = new URLSearchParams({
      merchantId: this.merchantId,
      password: this.password,
      invoice_number: orderData.invoiceNumber,
      payment_amount: orderData.totalAmount,
      currency: orderData.currency,
      reference: `REF-${orderData.invoiceNumber}`,
      cust_name: orderData.customerName,
      cust_phone: orderData.customerPhone,
      cust_email: orderData.customerEmail,
      cust_address: orderData.customerAddress,
      callback_url: `${process.env.BACKEND_URL}/api/webhooks/paystation`,
      checkout_items: JSON.stringify(orderData.items)
    });

    try {
      const response = await axios.post(this.apiUrl, payload.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      });

      if (response.data.status_code === '200' && response.data.payment_url) {
        return { success: true, paymentUrl: response.data.payment_url };
      }
      return { success: false, message: response.data.message || 'Payment initiation failed' };
    } catch (error) {
      console.error('PayStation API Error:', error.response?.data || error.message);
      return { success: false, message: 'Failed to connect to payment gateway' };
    }
  }

  verifyWebhookSignature(payload, receivedSignature) {
    if (!receivedSignature) return false;

    // Standard HMAC verification: sorted keys concatenated
    const stringToSign = Object.keys(payload)
      .sort()
      .map(key => String(payload[key]))
      .join('');

    const expectedSignature = crypto
      .createHmac('sha256', this.webhookSecret)
      .update(stringToSign)
      .digest('hex');

    return crypto.timingSafeEqual(
      Buffer.from(expectedSignature),
      Buffer.from(receivedSignature)
    );
  }
}

module.exports = new PayStationService();