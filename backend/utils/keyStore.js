const crypto = require('crypto');

function deriveKey(secret) {
  return crypto.createHash('sha256').update(String(secret || 'gtext-dev-secret')).digest();
}

function encryptPrivateKey(privateKey) {
  if (!privateKey) return '';

  const plain = typeof privateKey === 'string' ? privateKey : JSON.stringify(privateKey);
  const key = deriveKey(process.env.JWT_SECRET);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return JSON.stringify({
    iv: iv.toString('base64'),
    data: encrypted.toString('base64'),
    tag: tag.toString('base64'),
  });
}

function decryptPrivateKey(encrypted) {
  if (!encrypted) return null;

  try {
    const payload = JSON.parse(encrypted);
    const key = deriveKey(process.env.JWT_SECRET);
    const iv = Buffer.from(payload.iv, 'base64');
    const data = Buffer.from(payload.data, 'base64');
    const tag = Buffer.from(payload.tag, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);

    const out = Buffer.concat([decipher.update(data), decipher.final()]);
    const parsed = out.toString('utf8');
    return JSON.parse(parsed);
  } catch {
    return null;
  }
}

module.exports = { encryptPrivateKey, decryptPrivateKey };
