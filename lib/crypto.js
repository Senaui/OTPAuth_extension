const iterations = 600_000;
const encoder = new TextEncoder();
const aad = encoder.encode('OTPAuth vault v1');
export function toBase64(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  return btoa(binary);
}
export function fromBase64(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new Error('Invalid backup encoding.');
  return Uint8Array.from(atob(value), char => char.charCodeAt(0));
}
export function validateEnvelope(value) {
  if (!value || value.format !== 'otpauth-vault' || value.version !== 1 || value.kdf !== 'PBKDF2-SHA256'
    || value.iterations !== iterations || fromBase64(value.salt).length !== 16
    || fromBase64(value.iv).length !== 12 || typeof value.ciphertext !== 'string'
    || value.ciphertext.length > 3_000_000 || fromBase64(value.ciphertext).length < 16) {
    throw new Error('Invalid or unsupported encrypted backup.');
  }
  return value;
}
export async function deriveKey(password, salt) {
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, material,
    { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}
export async function encryptTokens(tokens, key, salt) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, key,
    encoder.encode(JSON.stringify({ tokens })));
  return { format: 'otpauth-vault', version: 1, kdf: 'PBKDF2-SHA256', iterations,
    salt: toBase64(salt), iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(encrypted)) };
}
export async function decryptTokens(envelope, key) {
  validateEnvelope(envelope);
  try {
    const clear = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(envelope.iv), additionalData: aad }, key,
      fromBase64(envelope.ciphertext));
    const data = JSON.parse(new TextDecoder().decode(clear));
    if (!Array.isArray(data.tokens)) throw new Error();
    return data.tokens;
  } catch { throw new Error('Wrong password or damaged backup.'); }
}
export async function createVault(password, tokens = []) {
  if (password.length < 12) throw new Error('Use a master password of at least 12 characters.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(password, salt);
  return { key, envelope: await encryptTokens(tokens, key, salt) };
}
export async function unlockVault(envelope, password) {
  validateEnvelope(envelope);
  const key = await deriveKey(password, fromBase64(envelope.salt));
  const tokens = await decryptTokens(envelope, key);
  return { key, tokens };
}
