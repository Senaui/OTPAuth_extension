import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeToken, parseOtpUri, generateTotp, recommendation, mergeTokens, parsePlainImport, decodeBase32 } from '../lib/tokens.js';
import { createVault, unlockVault, encryptTokens, fromBase64, toBase64 } from '../lib/crypto.js';
import { Vault } from '../lib/vault.js';

const token = normalizeToken({ issuer: 'Microsoft', account: 'test@example.com', secret: 'JBSWY3DPEHPK3PXP' });
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32(text) {
  let bits = 0, buffer = 0, result = '';
  for (const byte of new TextEncoder().encode(text)) {
    buffer = (buffer << 8) | byte; bits += 8;
    while (bits >= 5) { bits -= 5; result += alphabet[(buffer >>> bits) & 31]; }
  }
  if (bits) result += alphabet[(buffer << (5 - bits)) & 31];
  return result;
}
test('RFC 6238 vectors for SHA1, SHA256 and SHA512', async () => {
  const times = [59, 1111111109, 1111111111, 1234567890, 2000000000, 20000000000];
  const vectors = {
    SHA1: ['94287082','07081804','14050471','89005924','69279037','65353130'],
    SHA256: ['46119246','68084774','67062674','91819424','90698825','77737706'],
    SHA512: ['90693936','25091201','99943326','93441116','38618901','47863826'],
  };
  const secrets = {
    SHA1: '12345678901234567890', SHA256: '12345678901234567890123456789012',
    SHA512: '1234567890123456789012345678901234567890123456789012345678901234',
  };
  for (const algorithm of Object.keys(vectors)) {
    const record = normalizeToken({ account: 'RFC test', algorithm, secret: base32(secrets[algorithm]), digits: 8 });
    for (let i = 0; i < times.length; i++) assert.equal(await generateTotp(record, times[i] * 1000), vectors[algorithm][i]);
  }
});
test('enrollment links preserve issuer, account and TOTP parameters', () => {
  const parsed = parseOtpUri('otpauth://totp/GitHub:demo%40example.com?issuer=GitHub&secret=JBSWY3DPEHPK3PXP&digits=8&period=60&algorithm=SHA256');
  assert.equal(parsed.issuer, 'GitHub'); assert.equal(parsed.account, 'demo@example.com');
  assert.equal(parsed.period, 60); assert.equal(parsed.digits, 8); assert.equal(parsed.algorithm, 'SHA256');
  assert.throws(() => parseOtpUri('otpauth://hotp/a?secret=JBSWY3DPEHPK3PXP&counter=1'));
  assert.throws(() => parseOtpUri('otpauth://totp/A:b?issuer=B&secret=JBSWY3DPEHPK3PXP'));
  assert.throws(() => normalizeToken({ ...token, secret: '123456' }));
  assert.throws(() => normalizeToken({ ...token, period: -1 }));
  assert.throws(() => decodeBase32('JBSWY3DPEHPK3PXPZ'));
});
test('website recommendations use exact hosts and conservative issuer mappings', () => {
  assert.ok(recommendation(token, 'https://login.microsoftonline.com/common/login'));
  assert.equal(recommendation(token, 'https://login.microsoftonline.com.evil.example'), '');
  const bound = normalizeToken({ ...token, website: 'https://accounts.example.com/login' });
  assert.ok(recommendation(bound, 'https://accounts.example.com/other'));
  assert.equal(recommendation(bound, 'https://accounts.example.com.evil.test'), '');
  assert.equal(recommendation(bound, 'https://example.com'), '');
  assert.equal(recommendation(bound, 'file://accounts.example.com/test'), '');
});
test('JSON, legacy JSON and enrollment lists merge without losing accounts', () => {
  assert.equal(parsePlainImport(JSON.stringify({ TOTP: { work: token.secret } }))[0].account, 'work');
  const imported = parsePlainImport(JSON.stringify({ tokens: [token] }));
  assert.equal(mergeTokens([token], imported).added, 0);
  assert.equal(mergeTokens([token], [{ ...token, account: 'another@example.com' }]).added, 1);
  assert.equal(parsePlainImport(`otpauth://totp/a?secret=${token.secret}\notpauth://totp/b?secret=${token.secret}`).length, 2);
  assert.throws(() => parsePlainImport(JSON.stringify([token, { ...token, secret: 'bad' }])));
});
test('encrypted backup round trip, wrong password, tampering and fresh nonces', async () => {
  const { key, envelope } = await createVault('test-only-password', [token]);
  assert.equal(JSON.stringify(envelope).includes(token.secret), false);
  assert.equal(JSON.stringify(envelope).includes(token.account), false);
  assert.deepEqual((await unlockVault(envelope, 'test-only-password')).tokens, [token]);
  await assert.rejects(unlockVault(envelope, 'wrong-password'));
  const bytes = fromBase64(envelope.ciphertext); bytes[0] ^= 1;
  await assert.rejects(unlockVault({ ...envelope, ciphertext: toBase64(bytes) }, 'test-only-password'));
  const next = await encryptTokens([token], key, fromBase64(envelope.salt));
  assert.notEqual(next.iv, envelope.iv); assert.notEqual(next.ciphertext, envelope.ciphertext);
  await assert.rejects(createVault('short'));
  await assert.rejects(unlockVault({ ...envelope, iterations: 1 }, 'test-only-password'));
});
function mockApi() {
  const local = {}, session = {}; const alarms = {};
  function storage(data) { return {
    get: async keys => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, data[key]])),
    set: async values => Object.assign(data, values), remove: async keys => (Array.isArray(keys) ? keys : [keys]).forEach(key => delete data[key]),
  }; }
  return { api: { storage: { local: storage(local), session: storage(session) }, alarms: {
    create: async (name, options) => { alarms[name] = options; }, clear: async name => { delete alarms[name]; },
  } }, local, session, alarms };
}
test('vault persistence, session reopening, expiry and failed writes', async () => {
  const { api, local, session, alarms } = mockApi();
  const vault = new Vault(api); await vault.init(); await vault.open('test-only-password', true); await vault.save([token]);
  assert.ok(local.vault.ciphertext); assert.equal(local.TOTP, undefined);
  assert.ok(alarms['vault-lock']); assert.ok(session.vaultSession.key);
  const reopened = new Vault(api); await reopened.init(); assert.equal(reopened.tokens[0].secret, token.secret);
  await reopened.save([{ ...token, account: 'changed@example.com' }]);
  await assert.rejects(vault.save([]), /another window/);
  vault.envelope = reopened.envelope;
  const saved = vault.envelope;
  api.storage.local.set = async () => { throw new Error('disk full'); };
  await assert.rejects(vault.save([])); assert.equal(vault.envelope, saved); assert.equal(vault.tokens.length, 1);
  session.vaultSession.expires = Date.now() - 1;
  const expired = new Vault(api); await expired.init(); assert.equal(expired.key, null); assert.equal(session.vaultSession, undefined);
  reopened.expires = Date.now() - 1; assert.throws(() => reopened.assertOpen());
});

test('large encrypted exports encode without call-stack limits', async () => {
  const bytes = new Uint8Array(200_000); crypto.getRandomValues(bytes.subarray(0, 65536));
  assert.deepEqual(fromBase64(toBase64(bytes)), bytes);
});
