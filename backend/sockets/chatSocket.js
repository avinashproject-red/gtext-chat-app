const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');

const onlineUsers = new Map();

function userRoom(userId) {
  return `user:${userId}`;
}

function conversationRoom(conversationId) {
  return `conversation:${conversationId}`;
}

function serializeMessage(message) {
  const obj = message.toObject ? message.toObject() : message;
  return {
    id: obj._id,
    conversation: obj.conversation,
    sender: obj.sender,
    ciphertext: obj.ciphertext,
    iv: obj.iv,
    type: obj.type,
    media: obj.media,
    status: obj.status,
    deliveredTo: obj.deliveredTo,
    readBy: obj.readBy,
    createdAt: obj.createdAt,
  };
}

async function setPresence(io, userId, isOnline) {
  await User.findByIdAndUpdate(userId, { isOnline, lastSeen: new Date() });
  io.emit('presence:update', { userId: String(userId), isOnline, lastSeen: new Date() });
}

function registerChatSocket(io) {
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.query?.token;
      if (!token) return next(new Error('Authentication required'));
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(payload.id);
      if (!user) return next(new Error('User not found'));
      if (user.isBlocked) return next(new Error('Account is blocked'));
      socket.user = user;
      next();
    } catch (err) {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', async (socket) => {
    const userId = String(socket.user._id);
    const sockets = onlineUsers.get(userId) || new Set();
    sockets.add(socket.id);
    onlineUsers.set(userId, sockets);

    socket.join(userRoom(userId));
    const conversations = await Conversation.find({ participants: userId }).select('_id');
    conversations.forEach((c) => socket.join(conversationRoom(c._id)));

    if (sockets.size === 1) {
      await setPresence(io, userId, true);
    }

    socket.emit('ready', { userId });

    socket.on('conversation:join', (conversationId) => {
      if (conversationId) socket.join(conversationRoom(conversationId));
    });

    socket.on('message:send', async (payload, ack) => {
      try {
        const { conversationId, ciphertext, iv, type = 'text', media, clientId } = payload || {};
        const conversation = await Conversation.findOne({
          _id: conversationId,
          participants: userId,
        });
        if (!conversation) throw new Error('Conversation not found');

        const message = await Message.create({
          conversation: conversation._id,
          sender: userId,
          ciphertext: ciphertext || '',
          iv: iv || '',
          type,
          media: media || undefined,
          status: 'sent',
        });

        conversation.lastMessageAt = new Date();
        conversation.lastMessageType = type;
        await conversation.save();

        const populated = await message.populate('sender', 'username avatar');
        const serialized = { ...serializeMessage(populated), clientId };

        io.to(conversationRoom(conversation._id)).emit('message:new', serialized);

        conversation.participants.forEach((participantId) => {
          const pid = String(participantId);
          if (pid !== userId) {
            io.to(userRoom(pid)).emit('notification:new', {
              title: conversation.type === 'group' ? conversation.name : socket.user.username,
              body: type === 'text' ? 'New encrypted message' : `Sent a ${type}`,
              conversationId: String(conversation._id),
            });
          }
        });

        if (typeof ack === 'function') ack({ ok: true, message: serialized });
      } catch (err) {
        if (typeof ack === 'function') ack({ ok: false, error: err.message });
      }
    });

    socket.on('message:delivered', async ({ conversationId, messageIds = [] }) => {
      if (!conversationId || !messageIds.length) return;
      await Message.updateMany(
        {
          _id: { $in: messageIds },
          conversation: conversationId,
          sender: { $ne: userId },
          deliveredTo: { $ne: userId },
        },
        { $addToSet: { deliveredTo: userId }, $set: { status: 'delivered' } }
      );
      io.to(conversationRoom(conversationId)).emit('message:status', {
        conversationId,
        messageIds,
        status: 'delivered',
        userId,
      });
    });

    socket.on('message:read', async ({ conversationId, messageIds = [] }) => {
      if (!conversationId) return;
      const filter = {
        conversation: conversationId,
        sender: { $ne: userId },
        'readBy.user': { $ne: userId },
      };
      if (messageIds.length) filter._id = { $in: messageIds };

      const messages = await Message.find(filter).select('_id');
      const ids = messages.map((m) => m._id);
      if (!ids.length) return;

      await Message.updateMany(
        { _id: { $in: ids } },
        {
          $addToSet: { readBy: { user: userId, at: new Date() } },
          $set: { status: 'read' },
        }
      );

      io.to(conversationRoom(conversationId)).emit('message:status', {
        conversationId,
        messageIds: ids,
        status: 'read',
        userId,
      });
    });

    socket.on('typing:start', ({ conversationId }) => {
      socket.to(conversationRoom(conversationId)).emit('typing', {
        conversationId,
        userId,
        username: socket.user.username,
        typing: true,
      });
    });

    socket.on('typing:stop', ({ conversationId }) => {
      socket.to(conversationRoom(conversationId)).emit('typing', {
        conversationId,
        userId,
        username: socket.user.username,
        typing: false,
      });
    });

    socket.on('disconnect', async () => {
      const remaining = onlineUsers.get(userId);
      if (remaining) {
        remaining.delete(socket.id);
        if (remaining.size === 0) {
          onlineUsers.delete(userId);
          await setPresence(io, userId, false);
        } else {
          onlineUsers.set(userId, remaining);
        }
      }
    });
  });
}

module.exports = registerChatSocket;
