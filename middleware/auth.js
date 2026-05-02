const requireAuth = (req, res, next) => {
  if (req.session && req.session.isAdmin) {
    return next();
  }
  return res.status(401).json({ success: false, message: 'Unauthorized. Please login.' });
};

module.exports = { requireAuth };