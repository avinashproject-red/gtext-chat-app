const express = require('express');
const User = require('../models/User');
const Report = require('../models/Report');
const { auth, publicUser } = require('../middleware/auth');

const router = express.Router();

router.get('/search', auth, async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json({ users: [] });

  const users = await User.find({
    _id: { $ne: req.user._id },
    isBlocked: false,
    $or: [
      { username: { $regex: q, $options: 'i' } },
      { email: { $regex: q, $options: 'i' } },
    ],
  })
    .select('-password')
    .limit(20);

  res.json({ users: users.map(publicUser) });
});

router.get('/:id', auth, async (req, res) => {
  const user = await User.findById(req.params.id).select('-password');
  if (!user) return res.status(404).json({ message: 'User not found' });
  res.json({ user: publicUser(user) });
});

router.post('/report', auth, async (req, res) => {
  const { targetUserId, conversationId, reason } = req.body;
  if (!targetUserId || !reason) {
    return res.status(400).json({ message: 'Target user and reason are required' });
  }
  if (String(targetUserId) === String(req.user._id)) {
    return res.status(400).json({ message: 'You cannot report yourself' });
  }

  const report = await Report.create({
    reporter: req.user._id,
    targetUser: targetUserId,
    conversation: conversationId || undefined,
    reason,
  });

  res.status(201).json({ report });
});

module.exports = router;
