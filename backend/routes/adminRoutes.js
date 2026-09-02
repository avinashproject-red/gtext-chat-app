const express = require('express');
const User = require('../models/User');
const Message = require('../models/Message');
const Conversation = require('../models/Conversation');
const Report = require('../models/Report');
const { auth, adminOnly, publicUser } = require('../middleware/auth');

const router = express.Router();

router.use(auth, adminOnly);

router.get('/stats', async (_req, res) => {
  const [users, online, blocked, conversations, messages, reports] = await Promise.all([
    User.countDocuments(),
    User.countDocuments({ isOnline: true }),
    User.countDocuments({ isBlocked: true }),
    Conversation.countDocuments(),
    Message.countDocuments(),
    Report.countDocuments({ status: 'open' }),
  ]);

  res.json({
    stats: { users, online, blocked, conversations, messages, openReports: reports },
  });
});

router.get('/users', async (req, res) => {
  const q = (req.query.q || '').trim();
  const filter = q
    ? { $or: [{ username: { $regex: q, $options: 'i' } }, { email: { $regex: q, $options: 'i' } }] }
    : {};
  const users = await User.find(filter).select('-password').sort({ createdAt: -1 }).limit(100);
  res.json({ users: users.map(publicUser) });
});

router.patch('/users/:id/block', async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ message: 'User not found' });
  if (user.role === 'admin') return res.status(400).json({ message: 'Cannot block an admin' });
  user.isBlocked = Boolean(req.body.blocked);
  if (user.isBlocked) user.isOnline = false;
  await user.save();
  res.json({ user: publicUser(user) });
});

router.get('/reports', async (_req, res) => {
  const reports = await Report.find()
    .populate('reporter', 'username email')
    .populate('targetUser', 'username email isBlocked')
    .sort({ createdAt: -1 })
    .limit(100);
  res.json({ reports });
});

router.patch('/reports/:id', async (req, res) => {
  const report = await Report.findByIdAndUpdate(
    req.params.id,
    { status: req.body.status || 'reviewed' },
    { new: true }
  );
  if (!report) return res.status(404).json({ message: 'Report not found' });
  res.json({ report });
});

router.get('/activity', async (_req, res) => {
  const recentUsers = await User.find().select('-password').sort({ createdAt: -1 }).limit(8);
  const recentMessages = await Message.find()
    .populate('sender', 'username')
    .sort({ createdAt: -1 })
    .limit(12);
  res.json({
    recentUsers: recentUsers.map(publicUser),
    recentMessages: recentMessages.map((m) => ({
      id: m._id,
      type: m.type,
      status: m.status,
      sender: m.sender?.username,
      createdAt: m.createdAt,
    })),
  });
});

module.exports = router;
