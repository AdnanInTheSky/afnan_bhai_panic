const logger = {
  info: (msg, meta = {}) => console.log(`[INFO] ${new Date().toISOString()} ${msg}`, meta),
  warn: (msg, meta = {}) => console.warn(`[WARN] ${new Date().toISOString()} ${msg}`, meta),
  error: (msg, err = {}) => console.error(`[ERROR] ${new Date().toISOString()} ${msg}`, err)
};

module.exports = logger;