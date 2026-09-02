const express = require('express');
const bcrypt = require('bcrypt');
const User = require('../models/User');
const { auth, signToken, publicUser } = require('../middleware/auth');
const { encryptPrivateKey, decryptPrivateKey } = require('../utils/keyStore');

const router = express.Router();

// Register route
router.post('/register', async (req, res) => {
  const { username, email, password, publicKey, avatar, privateKey } = req.body;

  const cleanUsername = (username || '').trim();
  const cleanEmail = (email || '').toLowerCase().trim();

  if (!cleanUsername || !cleanEmail || !password) {
    return res.status(400).json({ message: 'Username, email, and password are required' });
  }
  if (cleanUsername.length < 3) {
    return res.status(400).json({ message: 'Username must be at least 3 characters long' });
  }
  if (password.length < 6) {
    return res.status(400).json({ message: 'Password must be at least 6 characters long' });
  }

  try {
    const existingEmail = await User.findOne({ email: cleanEmail });
    if (existingEmail) {
      return res.status(400).json({ message: 'An account with this email already exists' });
    }

    const safeUsernameRegex = new RegExp(`^${cleanUsername.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
    const existingUsername = await User.findOne({ username: safeUsernameRegex });
    if (existingUsername) {
      return res.status(400).json({ message: 'Username is already taken' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const encryptedPrivateKey = privateKey ? encryptPrivateKey(privateKey) : '';
    const user = await User.create({
      username: cleanUsername,
      email: cleanEmail,
      password: hashedPassword,
      publicKey: publicKey || '',
      encryptedPrivateKey,
      avatar: avatar || '',
    });

    const token = signToken(user);
    res.status(201).json({ token, user: publicUser(user) });
  } catch (err) {
    res.status(500).json({ message: 'Registration failed', error: err.message });
  }
});

// Login route
router.post('/login', async (req, res) => {
  const { email, password, publicKey, privateKey } = req.body;

  try {
    const user = await User.findOne({ email: (email || '').toLowerCase() });
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (user.isBlocked) return res.status(403).json({ message: 'Account is blocked' });

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) return res.status(401).json({ message: 'Invalid credentials' });

    if (publicKey) {
      user.publicKey = publicKey;
    }
    if (privateKey && !user.encryptedPrivateKey) {
      user.encryptedPrivateKey = encryptPrivateKey(privateKey);
    }
    await user.save();

    const token = signToken(user);
    const payload = publicUser(user);
    res.status(200).json({ token, user: payload });
  } catch (err) {
    res.status(500).json({ message: 'Login failed', error: err.message });
  }
});

// Get current user
router.get('/me', auth, async (req, res) => {
  res.json({ user: publicUser(req.user) });
});

// Update profile
router.put('/profile', auth, async (req, res) => {
  const { username, avatar, publicKey, privateKey } = req.body;
  try {
    if (username && username !== req.user.username) {
      const taken = await User.findOne({ username });
      if (taken) return res.status(400).json({ message: 'Username already taken' });
      req.user.username = username;
    }
    if (typeof avatar === 'string') req.user.avatar = avatar;
    if (typeof publicKey === 'string') req.user.publicKey = publicKey;
    if (privateKey) req.user.encryptedPrivateKey = encryptPrivateKey(privateKey);
    await req.user.save();
    res.json({ user: publicUser(req.user) });
  } catch (err) {
    res.status(500).json({ message: 'Profile update failed', error: err.message });
  }
});

module.exports = router;