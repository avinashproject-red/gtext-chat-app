const express = require('express');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const User = require('../models/User');
const { auth, publicUser } = require('../middleware/auth');

const router = express.Router();

function normalizeWrappedKeys(wrappedKeys) {
  if (!wrappedKeys) return {};
  if (wrappedKeys instanceof Map) return Object.fromEntries(wrappedKeys.entries());
  return { ...wrappedKeys };
}

function serializeConversation(conversation, currentUserId) {
  const obj = conversation.toObject({ virtuals: false });
  obj.id = obj._id;
  obj.participants = (conversation.participants || []).map((p) =>
    p.username ? publicUser(p) : { id: p }
  );
  obj.admins = (conversation.admins || []).map((a) => String(a._id || a));
  obj.wrappedKeys =
    conversation.wrappedKeys instanceof Map
      ? Object.fromEntries(conversation.wrappedKeys)
      : { ...(conversation.wrappedKeys || {}) };
  obj.unreadCount = conversation.unreadCount || 0;
  obj.currentUserId = String(currentUserId);
  return obj;
}

async function withUnread(conversations, userId) {
  return Promise.all(
    conversations.map(async (conversation) => {
      const unreadCount = await Message.countDocuments({
        conversation: conversation._id,
        sender: { $ne: userId },
        'readBy.user': { $ne: userId },
        type: { $ne: 'system' },
      });
      conversation.unreadCount = unreadCount;
      return conversation;
    })
  );
}

router.get('/conversations', auth, async (req, res) => {
  const conversations = await Conversation.find({ participants: req.user._id })
    .populate('participants', '-password')
    .sort({ lastMessageAt: -1 });

  const withCounts = await withUnread(conversations, req.user._id);
  res.json({ conversations: withCounts.map((c) => serializeConversation(c, req.user._id)) });
});

router.post('/direct', auth, async (req, res) => {
  const { userId, wrappedKeys } = req.body;
  if (!userId) return res.status(400).json({ message: 'userId is required' });
  if (String(userId) === String(req.user._id)) {
    return res.status(400).json({ message: 'Cannot start a chat with yourself' });
  }

  const other = await User.findById(userId);
  if (!other || other.isBlocked) {
    return res.status(404).json({ message: 'User not found' });
  }

  let conversation = await Conversation.findOne({
    type: 'direct',
    participants: { $all: [req.user._id, userId], $size: 2 },
  }).populate('participants', '-password');

  const isPlaceholderKey = (value) => !value || /^(t|a)-key$/i.test(value) || value === 'test-iv' || value.length < 16;
  const hasPlaceholderStoredMessage = async () => {
    const stale = await Message.findOne({
      conversation: conversation?._id,
      $or: [
        { ciphertext: 'hello-from-tester' },
        { iv: 'test-iv' },
        { ciphertext: { $regex: /^hello-from-/i } },
      ],
    }).select('_id');
    return !!stale;
  };

  if (!conversation) {
    conversation = await Conversation.create({
      type: 'direct',
      participants: [req.user._id, userId],
      admins: [req.user._id, userId],
      createdBy: req.user._id,
      wrappedKeys: wrappedKeys || {},
    });
    conversation = await conversation.populate('participants', '-password');
  } else if (wrappedKeys) {
    const normalizedExisting = normalizeWrappedKeys(conversation.wrappedKeys);
    const currentKey = normalizedExisting[String(req.user._id)] || conversation.wrappedKeys?.get?.(String(req.user._id));
    const shouldResetHistory =
      isPlaceholderKey(currentKey) ||
      Object.values(normalizedExisting).some(isPlaceholderKey) ||
      (await hasPlaceholderStoredMessage());
    if (shouldResetHistory) {
      await Message.deleteMany({ conversation: conversation._id });
    }
    conversation.wrappedKeys = wrappedKeys;
    conversation.lastMessageAt = new Date();
    conversation.lastMessageType = 'text';
    await conversation.save();
  }

  res.status(201).json({ conversation: serializeConversation(conversation, req.user._id) });
});

router.post('/groups', auth, async (req, res) => {
  const { name, participantIds = [], wrappedKeys, avatar } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ message: 'Group name is required' });
  }

  const uniqueIds = [...new Set([String(req.user._id), ...participantIds.map(String)])];
  const users = await User.find({ _id: { $in: uniqueIds }, isBlocked: false });
  if (users.length < 2) {
    return res.status(400).json({ message: 'A group needs at least two members' });
  }

  const conversation = await Conversation.create({
    type: 'group',
    name: name.trim(),
    avatar: avatar || '',
    participants: users.map((u) => u._id),
    admins: [req.user._id],
    createdBy: req.user._id,
    wrappedKeys: wrappedKeys || {},
  });

  await conversation.populate('participants', '-password');
  res.status(201).json({ conversation: serializeConversation(conversation, req.user._id) });
});

router.get('/conversations/:id', auth, async (req, res) => {
  const conversation = await Conversation.findOne({
    _id: req.params.id,
    participants: req.user._id,
  }).populate('participants', '-password');

  if (!conversation) return res.status(404).json({ message: 'Conversation not found' });
  res.json({ conversation: serializeConversation(conversation, req.user._id) });
});

router.get('/conversations/:id/messages', auth, async (req, res) => {
  const conversation = await Conversation.findOne({
    _id: req.params.id,
    participants: req.user._id,
  });
  if (!conversation) return res.status(404).json({ message: 'Conversation not found' });

  const limit = Math.min(Number(req.query.limit) || 50, 100);
  const before = req.query.before;
  const filter = { conversation: conversation._id };
  if (before) filter.createdAt = { $lt: new Date(before) };

  const messages = await Message.find(filter)
    .populate('sender', 'username avatar')
    .sort({ createdAt: -1 })
    .limit(limit);

  res.json({ messages: messages.reverse() });
});

router.post('/conversations/:id/members', auth, async (req, res) => {
  const { userId, wrappedKey } = req.body;
  const conversation = await Conversation.findById(req.params.id);
  if (!conversation || conversation.type !== 'group') {
    return res.status(404).json({ message: 'Group not found' });
  }
  if (!conversation.admins.map(String).includes(String(req.user._id))) {
    return res.status(403).json({ message: 'Only group admins can add members' });
  }

  const user = await User.findById(userId);
  if (!user) return res.status(404).json({ message: 'User not found' });
  if (conversation.participants.map(String).includes(String(userId))) {
    return res.status(400).json({ message: 'User is already in the group' });
  }

  conversation.participants.push(userId);
  if (wrappedKey) conversation.wrappedKeys.set(String(userId), wrappedKey);
  await conversation.save();
  await conversation.populate('participants', '-password');

  await Message.create({
    conversation: conversation._id,
    sender: req.user._id,
    type: 'system',
    ciphertext: `${req.user.username} added ${user.username}`,
    status: 'read',
  });

  res.json({ conversation: serializeConversation(conversation, req.user._id) });
});

router.delete('/conversations/:id/members/:userId', auth, async (req, res) => {
  const conversation = await Conversation.findById(req.params.id);
  if (!conversation || conversation.type !== 'group') {
    return res.status(404).json({ message: 'Group not found' });
  }

  const isAdmin = conversation.admins.map(String).includes(String(req.user._id));
  const isSelf = String(req.params.userId) === String(req.user._id);
  if (!isAdmin && !isSelf) {
    return res.status(403).json({ message: 'Not allowed to remove this member' });
  }

  conversation.participants = conversation.participants.filter(
    (id) => String(id) !== String(req.params.userId)
  );
  conversation.admins = conversation.admins.filter(
    (id) => String(id) !== String(req.params.userId)
  );
  conversation.wrappedKeys.delete(String(req.params.userId));
  await conversation.save();
  await conversation.populate('participants', '-password');

  res.json({ conversation: serializeConversation(conversation, req.user._id) });
});

router.patch('/conversations/:id/admins/:userId', auth, async (req, res) => {
  const conversation = await Conversation.findById(req.params.id);
  if (!conversation || conversation.type !== 'group') {
    return res.status(404).json({ message: 'Group not found' });
  }
  if (!conversation.admins.map(String).includes(String(req.user._id))) {
    return res.status(403).json({ message: 'Only group admins can promote members' });
  }
  if (!conversation.participants.map(String).includes(String(req.params.userId))) {
    return res.status(400).json({ message: 'User is not in this group' });
  }
  if (!conversation.admins.map(String).includes(String(req.params.userId))) {
    conversation.admins.push(req.params.userId);
    await conversation.save();
  }
  await conversation.populate('participants', '-password');
  res.json({ conversation: serializeConversation(conversation, req.user._id) });
});

module.exports = router;
