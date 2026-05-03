const requireAuth = (req, res, next) => {
  if (req.session && req.session.isAdmin) return next();
  return res.status(401).json({ success: false, message: 'Authentication required' });
};

const requireAdmin = (req, res, next) => {
  if (req.session.role === 'admin') return next();
  return res.status(403).json({ success: false, message: 'Admin privileges required' });
};

module.exports = { requireAuth, requireAdmin };