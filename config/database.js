const mongoose = require('mongoose');
const logger = require('../utils/logger');

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000
    });
    logger.info('MongoDB connected successfully');
    return mongoose.connection;
  } catch (error) {
    logger.error('MongoDB connection failed', error);
    process.exit(1);
  }
};

module.exports = connectDB;