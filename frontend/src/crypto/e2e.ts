function encodeUtf8(value: string): Uint8Array {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(value);
  }

  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(value, 'utf8'));
  }

  throw new Error('TextEncoder is not available in this environment.');
}

function decodeUtf8(value: ArrayBuffer | Uint8Array): string {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);

  if (typeof TextDecoder !== 'undefined') {
    return new TextDecoder().decode(bytes);
  }

  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('utf8');
  }

  throw new Error('TextDecoder is not available in this environment.');
}

function bufToB64(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);

  if (typeof btoa === 'function') {
    let binary = '';
    bytes.forEach((b) => {
      binary += String.fromCharCode(b);
    });
    return btoa(binary);
  }

  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }

  throw new Error('Base64 encoder is not available in this environment.');
}

function b64ToBuf(value: string): ArrayBuffer {
  if (typeof atob === 'function') {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  if (typeof Buffer !== 'undefined') {
    return Buffer.from(value, 'base64').buffer;
  }

  throw new Error('Base64 decoder is not available in this environment.');
}

function privateKeyStorage(email: string): string {
  return `gtext:privateKey:${email.toLowerCase()}`;
}

function requireWebCrypto(): SubtleCrypto {
  if (!window.isSecureContext || !window.crypto?.subtle) {
    throw new Error(
      'Secure encryption is unavailable. Open GText over HTTPS on this device, or use localhost on the computer.'
    );
  }
  return window.crypto.subtle;
}

export async function generateIdentityKeys(): Promise<{ publicKey: string; privateKey: JsonWebKey }> {
  const pair = await requireWebCrypto().generateKey(
    {
      name: 'RSA-OAEP',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['encrypt', 'decrypt']
  );
  const publicKey = JSON.stringify(await crypto.subtle.exportKey('jwk', pair.publicKey));
  const privateKey = await crypto.subtle.exportKey('jwk', pair.privateKey);
  return { publicKey, privateKey };
}

export function savePrivateKey(email: string, privateKey: JsonWebKey): void {
  localStorage.setItem(privateKeyStorage(email), JSON.stringify(privateKey));
}

export function loadPrivateKey(email: string): JsonWebKey | null {
  const raw = localStorage.getItem(privateKeyStorage(email));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as JsonWebKey;
  } catch {
    return null;
  }
}

export async function importPrivateKey(jwk: JsonWebKey): Promise<CryptoKey> {
  return requireWebCrypto().importKey(
    'jwk',
    jwk,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    true,
    ['decrypt']
  );
}

export async function importPublicKey(publicKey: string): Promise<CryptoKey> {
  return requireWebCrypto().importKey(
    'jwk',
    JSON.parse(publicKey),
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    true,
    ['encrypt']
  );
}

export async function generateConversationKey(): Promise<CryptoKey> {
  return requireWebCrypto().generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

export async function wrapConversationKey(aesKey: CryptoKey, publicKey: string): Promise<string> {
  const raw = await requireWebCrypto().exportKey('raw', aesKey);
  const pub = await importPublicKey(publicKey);
  const wrapped = await requireWebCrypto().encrypt({ name: 'RSA-OAEP' }, pub, raw);
  return bufToB64(wrapped);
}

export async function unwrapConversationKey(
  wrapped: string,
  privateKey: CryptoKey
): Promise<CryptoKey> {
  const raw = await requireWebCrypto().decrypt({ name: 'RSA-OAEP' }, privateKey, b64ToBuf(wrapped));
  return requireWebCrypto().importKey('raw', raw, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
}

export async function encryptPayload(
  aesKey: CryptoKey,
  plaintext: string
): Promise<{ ciphertext: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await requireWebCrypto().encrypt({ name: 'AES-GCM', iv }, aesKey, encodeUtf8(plaintext));
  return { ciphertext: bufToB64(cipher), iv: bufToB64(iv) };
}

export async function decryptPayload(aesKey: CryptoKey, ciphertext: string, iv: string): Promise<string> {
  const plain = await requireWebCrypto().decrypt(
    { name: 'AES-GCM', iv: b64ToBuf(iv) },
    aesKey,
    b64ToBuf(ciphertext)
  );
  return decodeUtf8(plain);
}

export async function ensureIdentity(email: string): Promise<{ publicKey: string; privateKey: CryptoKey }> {
  const subtle = requireWebCrypto();
  const existing = loadPrivateKey(email);
  if (existing) {
    const publicJwk = { ...existing };
    delete (publicJwk as { d?: string }).d;
    delete (publicJwk as { p?: string }).p;
    delete (publicJwk as { q?: string }).q;
    delete (publicJwk as { dp?: string }).dp;
    delete (publicJwk as { dq?: string }).dq;
    delete (publicJwk as { qi?: string }).qi;
    publicJwk.key_ops = ['encrypt'];
    return {
      publicKey: JSON.stringify(publicJwk),
      privateKey: await importPrivateKey(existing),
    };
  }

  const generated = await generateIdentityKeys();
  savePrivateKey(email, generated.privateKey);
  return {
    publicKey: generated.publicKey,
    privateKey: await subtle.importKey(
      'jwk',
      generated.privateKey,
      { name: 'RSA-OAEP', hash: 'SHA-256' },
      true,
      ['decrypt']
    ),
  };
}
