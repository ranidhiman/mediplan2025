const jwt = require('jsonwebtoken');

module.exports = (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    console.log('Auth check - Token present:', !!token);

    if (!token) {
      console.log('Auth failed: No token');
      return res.status(401).json({ message: 'No authentication token' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log('Auth success - User:', decoded.id);
    req.user = decoded;
    next();
  } catch (error) {
    console.log('Auth failed:', error.message);
    res.status(401).json({ message: 'Invalid token' });
  }
};