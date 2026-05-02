const axios = require('axios');
const crypto = require('crypto');

class PayStationService {
  constructor() {
    // Load credentials from environment variables (NEVER hardcode)
    this.merchantId = process.env.PAYSTATION_MERCHANT_ID;
    this.password = process.env.PAYSTATION_PASSWORD;
    this.webhookSecret = process.env.PAYSTATION_WEBHOOK_SECRET || process.env.PAYSTATION_PASSWORD;
    
    // API endpoints (sandbox vs production)
    this.baseUrl = process.env.PAYSTATION_BASE_URL || 'https://sandbox.paystation.com.bd';
    this.initiateUrl = `${this.baseUrl}/initiate-payment`;
    this.statusUrl = `${this.baseUrl}/transaction-status`;
  }

  /**
   * Generate HMAC-SHA256 signature for PayStation requests
   * @param {Object} params - Request parameters (excluding signature)
   * @param {string} secret - Secret key for HMAC
   * @returns {string} Hex-encoded signature
   */
  generateSignature(params, secret) {
    // PayStation expects parameters sorted alphabetically, then concatenated
    const sortedKeys = Object.keys(params).sort();
    const stringToSign = sortedKeys
      .map(key => String(params[key]))
      .join('');
    
    return crypto
      .createHmac('sha256', secret)
      .update(stringToSign)
      .digest('hex');
  }

  /**
   * Verify HMAC signature from PayStation webhook
   * @param {Object} payload - Webhook request body
   * @param {string} receivedSignature - Signature from request header or body
   * @returns {boolean} True if signature matches
   */
  verifyWebhookSignature(payload, receivedSignature) {
    if (!receivedSignature || !payload) {
      console.warn('⚠️ Missing signature or payload for webhook verification');
      return false;
    }

    try {
      // Create a copy without the signature field for verification
      const payloadCopy = { ...payload };
      delete payloadCopy.signature; // Remove signature if present in body

      const expectedSignature = this.generateSignature(payloadCopy, this.webhookSecret);
      
      // Use timing-safe comparison to prevent timing attacks
      return crypto.timingSafeEqual(
        Buffer.from(expectedSignature, 'hex'),
        Buffer.from(receivedSignature, 'hex')
      );
    } catch (error) {
      console.error('❌ Signature verification error:', error.message);
      return false;
    }
  }

  /**
   * Initiate payment session with PayStation BD
   * @param {Object} orderData - Order details from backend
   * @returns {Promise<Object>} Payment response with payment_url or error
   */
  async initiatePayment(orderData) {
    try {
      // Build form-data payload (PayStation expects application/x-www-form-urlencoded)
      const formData = new URLSearchParams();
      
      // Required fields per PayStation API spec
      formData.append('merchantId', this.merchantId);
      formData.append('password', this.password);
      formData.append('invoice_number', orderData.invoiceNumber);
      formData.append('currency', orderData.currency || 'BDT');
      formData.append('payment_amount', orderData.totalAmount);
      formData.append('reference', orderData.reference || `REF-${orderData.invoiceNumber}`);
      
      // Customer details
      formData.append('cust_name', orderData.customerName);
      formData.append('cust_phone', orderData.customerPhone);
      formData.append('cust_email', orderData.customerEmail);
      formData.append('cust_address', orderData.customerAddress);
      
      // Webhook callback URL (where PayStation sends payment status)
      formData.append('callback_url', `${process.env.BACKEND_URL}/api/webhooks/paystation`);
      
      // Cart items as JSON string
      formData.append('checkout_items', JSON.stringify(orderData.items));

      // Send request with correct Content-Type header
      const response = await axios.post(this.initiateUrl, formData.toString(), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        timeout: 30000 // 30 second timeout
      });

      // Parse and validate response
      const data = response.data;
      
      if (data.status_code === '200' && data.payment_url) {
        return {
          success: true,
          paymentUrl: data.payment_url,
          invoiceNumber: orderData.invoiceNumber,
          message: data.message || 'Payment link created successfully'
        };
      }
      
      // Handle API error responses
      return {
        success: false,
        message: data.message || 'Payment initiation failed',
        statusCode: data.status_code,
        invoiceNumber: orderData.invoiceNumber
      };

    } catch (error) {
      console.error('❌ PayStation initiatePayment error:', {
        message: error.message,
        response: error.response?.data,
        invoiceNumber: orderData?.invoiceNumber
      });
      
      return {
        success: false,
        message: error.response?.data?.message || 'Failed to connect to payment gateway',
        error: error.code || 'NETWORK_ERROR'
      };
    }
  }

  /**
   * Check transaction status by invoice number
   * @param {string} invoiceNumber - Unique invoice identifier
   * @returns {Promise<Object>} Transaction status data or error
   */
  async checkTransactionStatus(invoiceNumber) {
    try {
      // PayStation status endpoint expects JSON body + merchantId header
      const response = await axios.post(
        this.statusUrl,
        { invoice_number: invoiceNumber },
        {
          headers: {
            'Content-Type': 'application/json',
            'merchantId': this.merchantId
          },
          timeout: 15000
        }
      );

      const data = response.data;
      
      if (data.status_code === '200' && data.data) {
        return {
          success: true,
          data: {
            invoiceNumber: data.data.invoice_number,
            status: data.data.trx_status,
            transactionId: data.data.trx_id,
            paymentAmount: data.data.payment_amount,
            paymentMethod: data.data.payment_method,
            orderDateTime: data.data.order_date_time
          }
        };
      }
      
      return {
        success: false,
        message: data.message || 'Transaction not found',
        statusCode: data.status_code
      };

    } catch (error) {
      console.error('❌ PayStation checkTransactionStatus error:', {
        message: error.message,
        response: error.response?.data,
        invoiceNumber
      });
      
      return {
        success: false,
        message: error.response?.data?.message || 'Failed to check transaction status',
        error: error.code || 'NETWORK_ERROR'
      };
    }
  }

  /**
   * Parse and validate incoming webhook payload from PayStation
   * @param {Object} req - Express request object
   * @returns {Promise<Object>} Parsed and validated webhook data or error
   */
  async parseWebhook(req) {
    try {
      // PayStation may send webhook as form-data or JSON - handle both
      const payload = req.body;
      
      // Extract signature from header (preferred) or body
      const receivedSignature = 
        req.headers['x-paystation-signature'] || 
        req.headers['signature'] || 
        payload.signature;

      // Verify cryptographic signature FIRST (critical security step)
      if (!this.verifyWebhookSignature(payload, receivedSignature)) {
        console.warn('⚠️ Webhook signature verification FAILED');
        return {
          valid: false,
          error: 'INVALID_SIGNATURE',
          message: 'Webhook signature could not be verified'
        };
      }

      // Validate required fields
      const requiredFields = ['invoice_number', 'status_code', 'trx_status'];
      const missingFields = requiredFields.filter(field => !payload[field]);
      
      if (missingFields.length > 0) {
        return {
          valid: false,
          error: 'MISSING_FIELDS',
          message: `Missing required fields: ${missingFields.join(', ')}`
        };
      }

      // Map PayStation status codes to internal status
      const statusMap = {
        '200': 'paid',
        '201': 'paid',
        '400': 'failed',
        '401': 'failed',
        '500': 'failed'
      };

      return {
        valid: true,
        data: {
          invoiceNumber: payload.invoice_number,
          statusCode: payload.status_code,
          status: statusMap[payload.status_code] || 'unknown',
          trxStatus: payload.trx_status,
          transactionId: payload.trx_id || payload.invoice_number,
          paymentAmount: payload.payment_amount,
          paymentMethod: payload.payment_method,
          customerMobile: payload.payer_mobile_no,
          orderDateTime: payload.order_date_time,
          reference: payload.reference,
          rawPayload: payload
        }
      };

    } catch (error) {
      console.error('❌ Webhook parsing error:', error.message);
      return {
        valid: false,
        error: 'PARSE_ERROR',
        message: 'Failed to parse webhook payload'
      };
    }
  }
}

// Export singleton instance
module.exports = new PayStationService();