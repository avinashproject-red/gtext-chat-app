const mongoose = require('mongoose');
require('dotenv').config();
const Conversation = require('./backend/models/Conversation');
const Message = require('./backend/models/Message');
(async () => {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/gtext');
  const conversations = await Conversation.find({ type: 'direct' }).lean();
  const staleConversationIds = conversations.filter((c) => {
    const entries = c.wrappedKeys && c.wrappedKeys instanceof Map ? Object.fromEntries(c.wrappedKeys) : (c.wrappedKeys || {});
    return Object.values(entries).some((v) => !v || /^(t|a)-key$/i.test(v) || v === 'test-iv' || v.length < 16);
  }).map((c) => c._id);
  if (staleConversationIds.length) {
    await Message.deleteMany({ conversation: { $in: staleConversationIds } });
    await Conversation.deleteMany({ _id: { $in: staleConversationIds } });
  }
  const staleMessageMatches = await Message.find({ $or: [{ ciphertext: 'hello-from-tester' }, { iv: 'test-iv' }, { ciphertext: /^hello-from-/i }] }).select('_id');
  if (staleMessageMatches.length) {
    await Message.deleteMany({ _id: { $in: staleMessageMatches.map((m) => m._id) } });
  }
  console.log('stale cleanups', staleConversationIds.length, staleMessageMatches.length);
  await mongoose.disconnect();
})().catch((err) => { console.error(err); process.exit(1); });
