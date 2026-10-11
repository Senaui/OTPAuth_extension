import { createVault, unlockVault, encryptTokens, decryptTokens, fromBase64, toBase64 } from './crypto.js';
import { normalizeToken } from './tokens.js';
export const lockMs = 5 * 60 * 1000;
export class Vault {
  constructor(api) { this.api = api; this.key = null; this.tokens = []; this.envelope = null; this.expires = 0; }
  async init() {
    const local = await this.api.storage.local.get(['vault', 'TOTP']);
    this.envelope = local.vault ?? null;
    this.legacy = local.TOTP;
    const { vaultSession } = await this.api.storage.session.get('vaultSession');
    if (vaultSession && vaultSession.expires > Date.now() && this.envelope) {
      try {
        this.key = await crypto.subtle.importKey('raw', fromBase64(vaultSession.key), 'AES-GCM', true, ['encrypt', 'decrypt']);
        this.tokens = (await decryptTokens(this.envelope, this.key)).map(normalizeToken);
        this.expires = vaultSession.expires;
      } catch { await this.lock(); }
    } else await this.lock();
  }
  async open(password, create = false) {
    if (create && this.envelope) throw new Error('A vault already exists. Unlock it instead.');
    const result = create ? await createVault(password) : await unlockVault(this.envelope, password);
    if (create) { await this.api.storage.local.set({ vault: result.envelope }); this.envelope = result.envelope; }
    this.key = result.key; this.tokens = (result.tokens ?? []).map(normalizeToken);
    this.expires = Date.now() + lockMs;
    await this.api.storage.session.set({ vaultSession: {
      key: toBase64(new Uint8Array(await crypto.subtle.exportKey('raw', this.key))), expires: this.expires,
    } });
    await this.api.alarms.create('vault-lock', { when: this.expires });
  }
  assertOpen() {
    if (!this.key || this.expires <= Date.now()) { this.key = null; this.tokens = []; throw new Error('Vault locked. Unlock it again.'); }
  }
  async save(tokens) {
    this.assertOpen();
    const { vault: latest } = await this.api.storage.local.get('vault');
    if (latest?.ciphertext !== this.envelope.ciphertext) throw new Error('The vault changed in another window. Reopen the popup before saving.');
    const normalized = tokens.map(normalizeToken);
    const envelope = await encryptTokens(normalized, this.key, fromBase64(this.envelope.salt));
    await this.api.storage.local.set({ vault: envelope });
    this.tokens = normalized; this.envelope = envelope;
  }
  async lock() {
    this.key = null; this.tokens = []; this.expires = 0;
    await this.api.storage.session.remove('vaultSession');
    await this.api.alarms.clear('vault-lock');
  }
}
