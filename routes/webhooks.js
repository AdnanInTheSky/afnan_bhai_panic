const express = require('express');
const router = express.Router();
const Order = require('../models/Order');
const PRODUCT_CATALOG = require('../utils/productCatalog');
const paystationService = require('../services/paystation');

/**
 * POST /api/orders
 * Create new order, validate prices server-side, initiate PayStation payment
 * Request body: { cartItems: [...], customerInfo: {...} }
 * Response: { success: true, paymentUrl: '...', invoiceNumber: '...' }
 */
router.post('/', async (req, res) => {
  try {
    const { cartItems, customerInfo } = req.body;

    // --- Input Validation ---
    if (!cartItems || !Array.isArray(cartItems) || cartItems.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Cart is empty or invalid' 
      });
    }

    if (!customerInfo?.name || !customerInfo?.email || !customerInfo?.phone || !customerInfo?.address) {
      return res.status(400).json({ 
        success: false, 
        message: 'Missing required customer information' 
      });
    }

    // --- 🔒 Step 1: Validate & Calculate Total Server-Side ---
    let totalAmount = 0;
    const validatedItems = [];

    for (const item of cartItems) {
      // Look up product in backend source of truth
      const product = PRODUCT_CATALOG[item.productId];
      
      if (!product) {
        console.warn(`⚠️ Invalid product ID attempted: ${item.productId}`);
        return res.status(400).json({ 
          success: false, 
          message: `Invalid product: ${item.productId}` 
        });
      }

      // 🔐 Critical: Validate price matches catalog (prevent frontend tampering)
      if (product.price !== item.price) {
        console.warn(`⚠️ Price mismatch for ${product.name}: frontend=${item.price}, catalog=${product.price}`);
        return res.status(400).json({ 
          success: false, 
          message: `Price validation failed for ${product.name}` 
        });
      }

      // Validate quantity
      const quantity = parseInt(item.quantity) || 1;
      if (quantity < 1 || quantity > 99) {
        return res.status(400).json({ 
          success: false, 
          message: `Invalid quantity for ${product.name}` 
        });
      }

      // Build validated item object
      validatedItems.push({
        productId: product.id,
        name: product.name,
        price: product.price,  // Use catalog price, not frontend value
        quantity
      });

      totalAmount += product.price * quantity;
    }

    // --- Step 2: Generate Unique Invoice Number ---
    // Format: INV{timestamp}{random} e.g., INV1714734800ABC123
    const invoiceNumber = `INV${Date.now()}${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
    const reference = `REF-${invoiceNumber}`;

    // --- Step 3: Create Pending Order in MongoDB ---
    const order = new Order({
      invoiceNumber,
      reference,
      status: 'pending',
      items: validatedItems,
      totalAmount,
      currency: 'BDT',
      customerName: customerInfo.name.trim(),
      customerEmail: customerInfo.email.toLowerCase().trim(),
      customerPhone: customerInfo.phone.trim(),
      customerAddress: customerInfo.address.trim()
    });

    await order.save();
    console.log(`✅ Order created: ${invoiceNumber} (Amount: ৳${totalAmount})`);

    // --- Step 4: Initiate PayStation Payment ---
    const paymentResult = await paystationService.initiatePayment({
      invoiceNumber,
      reference,
      totalAmount,
      currency: 'BDT',
      items: validatedItems,
      customerName: customerInfo.name,
      customerEmail: customerInfo.email,
      customerPhone: customerInfo.phone,
      customerAddress: customerInfo.address
    });

    // --- Step 5: Handle Payment Initiation Response ---
    if (paymentResult.success && paymentResult.paymentUrl) {
      console.log(`✅ Payment link generated for ${invoiceNumber}`);
      return res.json({
        success: true,
        paymentUrl: paymentResult.paymentUrl,
        invoiceNumber,
        message: 'Redirect to payment gateway'
      });
    }

    // Payment initiation failed - update order status
    console.warn(`❌ Payment initiation failed for ${invoiceNumber}: ${paymentResult.message}`);
    order.status = 'failed';
    order.paymentError = paymentResult.message;
    await order.save();

    return res.status(400).json({
      success: false,
      message: paymentResult.message || 'Failed to initiate payment',
      invoiceNumber
    });

  } catch (error) {
    // Log full error for debugging but don't expose to client
    console.error('❌ Order creation error:', {
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      body: req.body
    });

    return res.status(500).json({
      success: false,
      message: 'Internal server error. Please try again later.'
    });
  }
});

/**
 * GET /api/orders/:invoiceNumber
 * Public endpoint to check order status (for frontend confirmation page)
 */
router.get('/:invoiceNumber', async (req, res) => {
  try {
    const { invoiceNumber } = req.params;
    
    const order = await Order.findOne({ invoiceNumber });
    
    if (!order) {
      return res.status(404).json({ 
        success: false, 
        message: 'Order not found' 
      });
    }

    // Return sanitized order data (exclude sensitive fields)
    res.json({
      success: true,
       {
        invoiceNumber: order.invoiceNumber,
        status: order.status,
        totalAmount: order.totalAmount,
        currency: order.currency,
        items: order.items.map(item => ({
          name: item.name,
          quantity: item.quantity,
          price: item.price
        })),
        createdAt: order.createdAt,
        updatedAt: order.updatedAt
      }
    });

  } catch (error) {
    console.error('❌ Order lookup error:', error.message);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to retrieve order' 
    });
  }
});

module.exports = router;