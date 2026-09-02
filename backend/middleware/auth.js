const jwt = require('jsonwebtoken');
const User = require('../models/User');

async function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ message: 'Authentication required' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(payload.id).select('-password');
    if (!user) {
      return res.status(401).json({ message: 'User not found' });
    }
    if (user.isBlocked) {
      return res.status(403).json({ message: 'Account is blocked' });
    }
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
}

function adminOnly(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Admin access required' });
  }
  next();
}

function signToken(user) {
  return jwt.sign(
    { id: user._id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

function publicUser(user) {
  const privateKey = user.encryptedPrivateKey ? (() => {
    try {
      const { decryptPrivateKey } = require('../utils/keyStore');
      return decryptPrivateKey(user.encryptedPrivateKey) || undefined;
    } catch {
      return undefined;
    }
  })() : undefined;

  return {
    id: user._id,
    username: user.username,
    email: user.email,
    avatar: user.avatar || '',
    role: user.role,
    publicKey: user.publicKey || '',
    privateKey,
    lastSeen: user.lastSeen,
    isOnline: user.isOnline,
    isBlocked: user.isBlocked,
    createdAt: user.createdAt,
  };
}

module.exports = { auth, adminOnly, signToken, publicUser };
