const mongoose = require('mongoose');
require('dotenv').config();
const Conversation = require('./models/Conversation');
const Message = require('./models/Message');
(async () => {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/gtext');
  const conversations = await Conversation.find({ type: 'direct' }).lean();
  const staleConversationIds = conversations
    .filter((c) => {
      const entries = c.wrappedKeys && c.wrappedKeys instanceof Map ? Object.fromEntries(c.wrappedKeys) : (c.wrappedKeys || {});
      return Object.values(entries).some((v) => !v || /^(t|a)-key$/i.test(v) || v === 'test-iv' || v.length < 16);
    })
    .map((c) => String(c._id));

  if (staleConversationIds.length) {
    const staleObjectIds = staleConversationIds.map((id) => new mongoose.Types.ObjectId(id));
    await Message.deleteMany({ conversation: { $in: staleObjectIds } });
    await Conversation.deleteMany({ _id: { $in: staleObjectIds } });
  }

  const staleMessages = await Message.find({
    $or: [
      { ciphertext: 'hello-from-tester' },
      { iv: 'test-iv' },
      { ciphertext: /^hello-from-/i },
    ],
  }).select('_id');

  if (staleMessages.length) {
    await Message.deleteMany({ _id: { $in: staleMessages.map((m) => m._id) } });
  }

  console.log(JSON.stringify({ staleConversationIds, staleMessageCount: staleMessages.length }, null, 2));
  await mongoose.disconnect();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
