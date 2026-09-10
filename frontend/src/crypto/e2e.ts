function encodeUtf8(value: string): Uint8Array {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(value);
  }

  if (typeof Buffer !== 'undefined') {
    const bytes = Buffer.from(value, 'utf8');
    const copy = new Uint8Array(bytes.length);
    copy.set(bytes);
    return copy;
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

/**
 * Derives a strong AES-GCM wrapping key iteratively from the user's plaintext password.
 */
async function derivePasswordWrappingKey(password: string, saltAsBase64: string): Promise<CryptoKey> {
  const passwordKey = await requireWebCrypto().importKey(
    'raw',
    encodeUtf8(password) as BufferSource,
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );
  return requireWebCrypto().deriveKey(
    {
      name: 'PBKDF2',
      salt: b64ToBuf(saltAsBase64),
      iterations: 100000,
      hash: 'SHA-256',
    },
    passwordKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Derives a safe key derivation salt deterministically from the user's email 
 * so it's consistent across devices without needing a server trip first.
 */
async function getEmailSalt(email: string): Promise<string> {
  const hash = await requireWebCrypto().digest('SHA-256', encodeUtf8(`gtext_salt_${email.toLowerCase()}`) as BufferSource);
  return bufToB64(hash);
}

/**
 * Encrypts the raw JWK JSON string with a key derived from the user's password.
 */
export async function wrapDeviceIdentityKey(privateKeyJwk: JsonWebKey, password: string, email: string): Promise<string> {
  const salt = await getEmailSalt(email);
  const wrappingKey = await derivePasswordWrappingKey(password, salt);
  
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = encodeUtf8(JSON.stringify(privateKeyJwk));
  
  const ciphertext = await requireWebCrypto().encrypt(
    { name: 'AES-GCM', iv },
    wrappingKey,
    plaintext as BufferSource
  );
  
  // Format: iv:ciphertext (base64)
  return `${bufToB64(iv)}:${bufToB64(ciphertext)}`;
}

/**
 * Decrypts the string payload back to a JWK using the user's password.
 */
export async function unwrapDeviceIdentityKey(protectedPayload: string, password: string, email: string): Promise<JsonWebKey | null> {
  try {
    const [ivB64, cipherB64] = protectedPayload.split(':');
    if (!ivB64 || !cipherB64) return null;
    
    const salt = await getEmailSalt(email);
    const wrappingKey = await derivePasswordWrappingKey(password, salt);
    
    const plaintext = await requireWebCrypto().decrypt(
      { name: 'AES-GCM', iv: b64ToBuf(ivB64) },
      wrappingKey,
      b64ToBuf(cipherB64)
    );
    
    return JSON.parse(decodeUtf8(plaintext)) as JsonWebKey;
  } catch (err) {
    console.error('Failed to unwrap identity key', err);
    return null;
  }
}

export async function encryptPayload(
  aesKey: CryptoKey,
  plaintext: string
): Promise<{ ciphertext: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await requireWebCrypto().encrypt({ name: 'AES-GCM', iv }, aesKey, encodeUtf8(plaintext) as BufferSource);
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
