const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  invoiceNumber: { type: String, required: true, unique: true, index: true },
  status: { type: String, enum: ['pending', 'paid', 'failed', 'shipped'], default: 'pending', index: true },
  items: [{
    productId: { type: String, required: true },
    name: { type: String, required: true },
    price: { type: Number, required: true },
    quantity: { type: Number, required: true, min: 1 }
  }],
  totalAmount: { type: Number, required: true },
  currency: { type: String, default: 'BDT' },
  customerName: { type: String, required: true },
  customerEmail: { type: String, required: true },
  customerPhone: { type: String, required: true },
  customerAddress: { type: String, required: true },
  gatewayTransactionId: String,
  paymentMethod: String,
  webhookMetadata: {
    statusCode: String,
    trxStatus: String,
    processedAt: String,
    ip: String
  }
}, { timestamps: true });

module.exports = mongoose.model('Order', orderSchema);