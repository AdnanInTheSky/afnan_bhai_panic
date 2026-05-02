const router = require('express').Router();
const Order = require('../models/Order');
const PRODUCT_CATALOG = require('../utils/productCatalog');
const paystationService = require('../services/paystation');

router.post('/', async (req, res) => {
  try {
    const { cartItems, customerInfo } = req.body;

    if (!cartItems || cartItems.length === 0) {
      return res.status(400).json({ success: false, message: 'Cart is empty' });
    }
    if (!customerInfo?.name || !customerInfo?.email || !customerInfo?.phone || !customerInfo?.address) {
      return res.status(400).json({ success: false, message: 'Missing customer information' });
    }

    // 🔒 Step 1: Validate & Calculate Total Server-Side
    let totalAmount = 0;
    const validatedItems = [];

    for (const item of cartItems) {
      const product = PRODUCT_CATALOG[item.productId];
      if (!product) {
        return res.status(400).json({ success: false, message: `Invalid product ID: ${item.productId}` });
      }
      // Strict price validation to prevent frontend tampering
      if (product.price !== item.price) {
        return res.status(400).json({ success: false, message: `Price mismatch for ${product.name}` });
      }

      const quantity = parseInt(item.quantity) || 1;
      if (quantity < 1) {
        return res.status(400).json({ success: false, message: `Invalid quantity for ${product.name}` });
      }

      validatedItems.push({
        productId: product.id,
        name: product.name,
        price: product.price,
        quantity
      });
      totalAmount += product.price * quantity;
    }

    // Step 2: Generate Unique Invoice Number
    const invoiceNumber = `INV${Date.now()}${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

    // Step 3: Create Pending Order in MongoDB
    const order = new Order({
      invoiceNumber,
      status: 'pending',
      items: validatedItems,
      totalAmount,
      currency: 'BDT',
      customerName: customerInfo.name,
      customerEmail: customerInfo.email,
      customerPhone: customerInfo.phone,
      customerAddress: customerInfo.address
    });

    await order.save();

    // Step 4: Initiate PayStation Payment
    const paymentResult = await paystationService.initiatePayment({
      invoiceNumber,
      totalAmount,
      currency: 'BDT',
      items: validatedItems,
      customerName: customerInfo.name,
      customerEmail: customerInfo.email,
      customerPhone: customerInfo.phone,
      customerAddress: customerInfo.address
    });

    if (paymentResult.success) {
      return res.json({ success: true, paymentUrl: paymentResult.paymentUrl, invoiceNumber });
    } else {
      order.status = 'failed';
      await order.save();
      return res.status(400).json({ success: false, message: paymentResult.message });
    }

  } catch (error) {
    console.error('Order Creation Error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

module.exports = router;