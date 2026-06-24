const jwt = require('jsonwebtoken');

module.exports = function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }
  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    // Los tokens intermedios del reto MFA (stage: 'mfa' | 'mfa-setup') no son sesión válida
    if (payload.stage) return res.status(401).json({ error: 'Invalid token' });
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
};
