const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function normalizeSecret(value) {
  const secret = String(value ?? '').replace(/[\s-]/g, '').toUpperCase().replace(/=+$/, '');
  if (!/^[A-Z2-7]{16,1024}$/.test(secret) || [1, 3, 6].includes(secret.length % 8)) {
    throw new Error('Enter a valid Base32 shared secret, not a current verification code.');
  }
  return secret;
}
export function decodeBase32(value) {
  const secret = normalizeSecret(value);
  let bits = 0, buffer = 0;
  const bytes = [];
  for (const char of secret) {
    buffer = (buffer << 5) | alphabet.indexOf(char); bits += 5;
    if (bits >= 8) { bits -= 8; bytes.push((buffer >>> bits) & 255); }
  }
  if (bits && (buffer & ((1 << bits) - 1))) throw new Error('Invalid Base32 padding bits.');
  return new Uint8Array(bytes);
}
export function websiteHost(value) {
  if (!value?.trim()) return '';
  const input = value.trim();
  const url = new URL(input.includes('://') ? input : `https://${input}`);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || !url.hostname.includes('.')) {
    throw new Error('Enter a website domain or HTTP(S) URL.');
  }
  return url.hostname.toLowerCase();
}
export function normalizeToken(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid token record.');
  const secret = normalizeSecret(raw.secret); decodeBase32(secret);
  const period = Number(raw.period ?? 30);
  const digits = Number(raw.digits ?? 6);
  const algorithm = String(raw.algorithm ?? 'SHA1').toUpperCase().replace('-', '');
  if (!Number.isInteger(period) || period < 5 || period > 300) throw new Error('Period must be between 5 and 300 seconds.');
  if (![6, 7, 8].includes(digits)) throw new Error('Use 6, 7 or 8 digits.');
  if (!['SHA1', 'SHA256', 'SHA512'].includes(algorithm)) throw new Error('Unsupported TOTP algorithm.');
  const issuer = String(raw.issuer ?? '').trim().slice(0, 200);
  const account = String(raw.account ?? raw.label ?? '').trim().slice(0, 200);
  if (!issuer && !account) throw new Error('Enter an issuer or account name.');
  return { id: typeof raw.id === 'string' && raw.id.length < 100 ? raw.id : crypto.randomUUID(), secret,
    issuer, account, website: websiteHost(raw.website ?? raw.url ?? ''), algorithm, period, digits };
}
export function parseOtpUri(value) {
  const uri = new URL(value.trim());
  if (uri.protocol !== 'otpauth:' || uri.hostname !== 'totp') throw new Error('Only otpauth://totp enrollment links are supported.');
  const label = decodeURIComponent(uri.pathname.slice(1));
  const colon = label.indexOf(':');
  const labelIssuer = colon < 0 ? '' : label.slice(0, colon);
  const issuer = uri.searchParams.get('issuer') || labelIssuer;
  if (labelIssuer && issuer !== labelIssuer) throw new Error('The enrollment link has conflicting issuer names.');
  return normalizeToken({ secret: uri.searchParams.get('secret'), issuer,
    account: colon < 0 ? label : label.slice(colon + 1), algorithm: uri.searchParams.get('algorithm') || 'SHA1',
    digits: uri.searchParams.get('digits') || 6, period: uri.searchParams.get('period') || 30 });
}
export async function generateTotp(token, now = Date.now()) {
  const counter = BigInt(Math.floor(now / 1000 / token.period));
  const message = new Uint8Array(8);
  new DataView(message.buffer).setBigUint64(0, counter);
  const key = await crypto.subtle.importKey('raw', decodeBase32(token.secret),
    { name: 'HMAC', hash: token.algorithm.replace('SHA', 'SHA-') }, false, ['sign']);
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, message));
  const offset = digest[digest.length - 1] & 15;
  const binary = ((digest[offset] & 127) << 24) | (digest[offset + 1] << 16) | (digest[offset + 2] << 8) | digest[offset + 3];
  return String(binary % (10 ** token.digits)).padStart(token.digits, '0');
}
export function recommendation(token, url) {
  let host;
  try { const page = new URL(url); if (!['https:', 'http:'].includes(page.protocol)) return ''; host = page.hostname.toLowerCase(); }
  catch { return ''; }
  // Explicit website bindings are exact-host matches. Never suffix-match unrelated domains.
  if (token.website) return host === token.website ? 'Website match' : '';
  const issuer = token.issuer.toLowerCase().replace(/\s/g, '');
  const known = {
    microsoft: ['login.microsoftonline.com', 'login.live.com', 'login.microsoft.com'],
    google: ['accounts.google.com'], github: ['github.com'], amazon: ['www.amazon.com', 'amazon.com'],
    dropbox: ['www.dropbox.com', 'dropbox.com'], discord: ['discord.com'],
  };
  return known[issuer]?.includes(host) ? 'Suggested by issuer — verify the account' : '';
}
export function mergeTokens(current, incoming) {
  const result = [...current];
  let added = 0;
  for (const value of incoming) {
    const token = normalizeToken(value);
    if (result.some(item => item.secret === token.secret && item.account === token.account && item.issuer === token.issuer
      && item.period === token.period && item.digits === token.digits && item.algorithm === token.algorithm)) continue;
    token.id = crypto.randomUUID(); result.push(token); added++;
  }
  return { tokens: result, added };
}
export function parsePlainImport(text) {
  if (text.length > 2_000_000) throw new Error('Import is too large (maximum 2 MB).');
  const trimmed = text.trim();
  if (trimmed.startsWith('otpauth://')) return trimmed.split(/\r?\n/).filter(Boolean).map(parseOtpUri);
  const data = JSON.parse(trimmed);
  if (Array.isArray(data)) return data.map(normalizeToken);
  if (Array.isArray(data.tokens)) return data.tokens.map(normalizeToken);
  // Compatibility with this repository's old { label: secret | {secret, period, url} } format.
  const old = data.TOTP ?? data;
  return Object.entries(old).map(([account, record]) => normalizeToken(
    typeof record === 'string' ? { account, secret: record } : { ...record, account }));
}
