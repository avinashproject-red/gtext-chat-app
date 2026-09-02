const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

async function connectDB() {
  let uri = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/gtext';

  const tryConnect = async (targetUri) => {
    mongoose.set('strictQuery', true);
    await mongoose.connect(targetUri, { serverSelectionTimeoutMS: 8000 });
    console.log('MongoDB connected');
  };

  try {
    await tryConnect(uri);
    return;
  } catch (error) {
    const isLocalFallback = /127\.0\.0\.1|localhost/.test(uri);
    const isUnavailable =
      error?.code === 'ECONNREFUSED' ||
      error?.name === 'MongooseServerSelectionError' ||
      /ECONNREFUSED|failed to connect|connect timeout/i.test(error?.message || '');

    if (!isLocalFallback || !isUnavailable) {
      throw error;
    }

    const memoryServer = await MongoMemoryServer.create();
    const memoryUri = memoryServer.getUri();
    process.env.MONGO_URI = memoryUri;
    await tryConnect(memoryUri);
  }
}

module.exports = connectDB;
