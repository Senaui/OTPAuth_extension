import './style.css';
import { LitElement, html, css } from 'lit';
import jsQR from 'jsqr';
import { Vault } from '../../lib/vault.js';
import { parseOtpUri, normalizeToken, generateTotp, recommendation, parsePlainImport, mergeTokens } from '../../lib/tokens.js';
import { unlockVault } from '../../lib/crypto.js';
import { fillOtp, readPageAccount } from '../../lib/fill.js';

class OtpApp extends LitElement {
  static properties = {
    siteAccounts: { state: true }, ready: { state: true }, unlocked: { state: true }, busy: { state: true }, status: { state: true },
    tokens: { state: true }, codes: { state: true }, tab: { state: true }, filter: { state: true },
    draft: { state: true }, pendingImport: { state: true }, editing: { state: true },
  };
  static styles = css`
    :host { display:block; width:390px; max-height:590px; overflow:auto; color:#17233b;
      background:#f5f7fb; font:14px/1.45 system-ui,sans-serif; }
    * { box-sizing:border-box; } header { display:flex; justify-content:space-between; align-items:center; padding:16px 18px; background:#17233b; color:white; }
    h1 { font-size:20px; margin:0; letter-spacing:-.5px; } h2 { font-size:16px; margin:0 0 10px; }
    main { padding:16px; } p { margin:8px 0; } .muted { color:#65748a; font-size:12px; } header .muted { color:#c7d4e8; }
    button,input,select,textarea { font:inherit; } input,select,textarea { width:100%; padding:9px; border:1px solid #cbd5e1; border-radius:7px; background:white; }
    textarea { resize:vertical; min-height:64px; } label { display:grid; gap:4px; font-size:12px; font-weight:600; }
    form { display:grid; gap:10px; } button { cursor:pointer; border:1px solid #cbd5e1; border-radius:7px; padding:7px 10px; background:white; color:#17233b; }
    button.primary { color:white; background:#4058d8; border-color:#4058d8; } button:disabled { opacity:.5; cursor:wait; }
    button.danger { color:#b91c1c; } header button { background:transparent; color:white; border-color:#64748b; }
    .status { padding:9px 16px; background:#e9eefb; overflow-wrap:anywhere; } .card { border:1px solid #e0e6ef; border-radius:12px; background:white; padding:13px; margin:10px 0; }
    .card.match { border-color:#8a9bea; } .badge { color:#4058d8; font-size:11px; margin-bottom:4px; }
    .account { overflow-wrap:anywhere; } code { font:26px ui-monospace,monospace; letter-spacing:3px; color:#17233b; }
    .row { display:flex; gap:7px; align-items:center; flex-wrap:wrap; } .between { justify-content:space-between; } .grid { display:grid; grid-template-columns:repeat(3,1fr); gap:8px; }
    details { margin:12px 0; border-top:1px solid #dde4ee; padding-top:12px; } summary { cursor:pointer; font-weight:600; margin-bottom:10px; }
    .small { font-size:11px; } progress { width:100%; height:4px; accent-color:#4058d8; } .preview { max-height:120px; overflow:auto; }
    input[type=file] { font-size:12px; } a { color:#4058d8; }
  `;
  constructor() {
    super(); this.vault = new Vault(browser); this.ready = false; this.unlocked = false;
    this.busy = false; this.status = ''; this.tokens = []; this.codes = {}; this.tab = null;
    this.filter = ''; this.draft = {}; this.pendingImport = null; this.editing = null; this.siteAccounts = [];
  }
  connectedCallback() {
    super.connectedCallback(); this.start();
    this.timer = setInterval(() => this.tick(), 1000);
    browser.storage.onChanged.addListener(this.onStorage);
  }
  disconnectedCallback() {
    clearInterval(this.timer); browser.storage.onChanged.removeListener(this.onStorage); super.disconnectedCallback();
  }
  onStorage = (changes, area) => {
    if (area === 'session' && changes.vaultSession && !changes.vaultSession.newValue) {
      this.vault.key = null; this.vault.tokens = []; this.clearView();
    }
  };
  clearView() {
    this.unlocked = false; this.tokens = []; this.codes = {}; this.draft = {}; this.pendingImport = null; this.editing = null;
    // Clear file/password/URI controls as well as reactive state.
    this.shadowRoot.querySelectorAll('form').forEach(form => form.reset());
  }
  async start() {
    await this.action(async () => {
      await this.vault.init();
      [this.tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (/^https?:/.test(this.tab?.url || '')) {
        try {
          const results = await browser.scripting.executeScript({ target: { tabId: this.tab.id }, func: readPageAccount });
          this.siteAccounts = results[0]?.result || [];
        } catch { /* Browser-protected pages do not allow injection. */ }
      }
      this.sync();
    }); this.ready = true;
  }
  sync() { this.unlocked = !!this.vault.key; this.tokens = [...this.vault.tokens]; this.tick(); }
  async tick() {
    if (!this.unlocked || this.ticking) return;
    this.ticking = true;
    try {
      this.vault.assertOpen();
      const codes = Object.fromEntries(await Promise.all(this.tokens.map(async token => [token.id, await generateTotp(token)])));
      if (this.vault.key) this.codes = codes;
      this.requestUpdate();
    } catch { await this.vault.lock(); this.clearView(); this.status = 'Vault automatically locked after five minutes.'; }
    finally { this.ticking = false; }
  }
  async action(fn) {
    if (this.busy) return;
    this.busy = true; this.status = '';
    try { await fn(); } catch (error) { this.status = error.message || 'Something went wrong. Try again.'; }
    finally { this.busy = false; }
  }
  open = async event => {
    event.preventDefault(); const form = event.currentTarget; const password = form.elements.password.value;
    const create = !this.vault.envelope;
    await this.action(async () => {
      if (create && password !== form.elements.confirm.value) throw new Error('Passwords do not match.');
      await this.vault.open(password, create); form.reset(); this.sync(); this.status = create ? 'Encrypted vault created.' : 'Vault unlocked.';
    });
  };
  lock = () => this.action(async () => { await this.vault.lock(); this.clearView(); this.status = 'Vault locked.'; });
  populate(raw) { this.draft = raw; this.editing = raw.id || null; }
  add = event => {
    event.preventDefault(); const form = event.currentTarget; const f = form.elements;
    return this.action(async () => {
      const token = normalizeToken({ id: this.editing || undefined, issuer: f.issuer.value, account: f.account.value,
        secret: f.secret.value, website: f.website.value, digits: f.digits.value, period: f.period.value, algorithm: f.algorithm.value });
      const next = this.editing ? this.tokens.map(item => item.id === this.editing ? token : item)
        : mergeTokens(this.tokens, [token]).tokens;
      await this.vault.save(next); this.draft = {}; this.editing = null; form.reset();
      form.elements.period.value = '30'; form.elements.digits.value = '6'; form.elements.algorithm.value = 'SHA1';
      this.shadowRoot.querySelector('[name=enrollment]').value = ''; this.sync(); this.status = 'Token saved in your encrypted vault.';
    });
  };
  readEnrollment = event => {
    event.preventDefault(); const uri = event.currentTarget.elements.enrollment.value;
    return this.action(async () => { this.populate(parseOtpUri(uri)); this.editing = null; this.status = 'Enrollment decoded. Review the account and website, then save.'; });
  };
  scan = event => {
    const file = event.target.files[0]; event.target.value = ''; if (!file) return;
    return this.action(async () => {
      if (file.size > 8_000_000 || !file.type.startsWith('image/')) throw new Error('Choose a QR image smaller than 8 MB.');
      const image = await createImageBitmap(file);
      try {
        if (image.width * image.height > 20_000_000) throw new Error('Image is too large. Crop around the QR code.');
        const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.drawImage(image, 0, 0);
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const result = jsQR(pixels.data, pixels.width, pixels.height);
        if (!result) throw new Error('No QR code found. Try a clearer or cropped image.');
        this.vault.assertOpen(); this.populate(parseOtpUri(result.data)); this.editing = null;
        this.status = 'QR decoded locally. Review the account and website, then save.';
      } finally { image.close(); }
    });
  };
  copy(token) { return this.action(async () => {
    this.vault.assertOpen(); await navigator.clipboard.writeText(await generateTotp(token)); this.status = 'Code copied. Clipboard contents remain until overwritten.';
  }); }
  fill(token) { return this.action(async () => {
    this.vault.assertOpen();
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url || !/^https?:/.test(tab.url)) throw new Error('Open a website tab first.');
    if (new URL(tab.url).origin !== new URL(this.tab.url).origin) throw new Error('The active website changed. Reopen this popup.');
    if (token.website && !recommendation(token, tab.url)) throw new Error('This token is bound to another website. Copy it manually if needed.');
    if (token.period - Math.floor(Date.now() / 1000) % token.period < 5) throw new Error('This code is about to expire. Wait for the next code.');
    const results = await browser.scripting.executeScript({ target: { tabId: tab.id }, func: fillOtp,
      args: [await generateTotp(token), new URL(tab.url).origin] });
    if (!results[0]?.result?.filled) throw new Error(results[0]?.result?.error || 'Could not fill the code. Copy it instead.');
    this.status = 'Code filled. Review it and submit the page yourself.';
  }); }
  remove(token) { return this.action(async () => {
    if (!confirm(`Delete ${token.issuer} ${token.account}? Keep a backup or another sign-in method.`)) return;
    await this.vault.save(this.tokens.filter(item => item.id !== token.id)); this.sync(); this.status = 'Token deleted.';
  }); }
  exportVault = () => this.action(async () => {
    this.vault.assertOpen();
    const blob = new Blob([JSON.stringify(this.vault.envelope, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url;
    a.download = `otpauth-encrypted-${new Date().toISOString().slice(0, 10)}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000); this.status = 'Encrypted backup downloaded. It uses your master password.';
  });
  importFile = event => {
    const file = event.target.files[0]; event.target.value = ''; if (!file) return;
    return this.action(async () => {
      if (file.size > 2_000_000) throw new Error('Backup is too large (maximum 2 MB).');
      this.shadowRoot.querySelector('[name=importText]').value = await file.text(); this.status = 'File loaded. Preview before importing.';
    });
  };
  previewImport = event => {
    event.preventDefault(); const form = event.currentTarget;
    return this.action(async () => {
      this.vault.assertOpen(); this.pendingImport = null; this.importLegacy = false;
      const text = form.elements.importText.value.trim();
      if (text.length > 2_000_000) throw new Error('Backup is too large.');
      let parsed; try { parsed = JSON.parse(text); } catch { /* Enrollment URI list. */ }
      const tokens = parsed?.format === 'otpauth-vault'
        ? (await unlockVault(parsed, form.elements.importPassword.value)).tokens.map(normalizeToken) : parsePlainImport(text);
      if (!tokens.length || tokens.length > 1000) throw new Error('Import must contain 1–1000 tokens.');
      this.vault.assertOpen(); this.pendingImport = tokens; form.elements.importPassword.value = ''; this.status = 'Review the import below. Existing tokens will be kept.';
    });
  };
  previewLegacy = () => this.action(async () => {
    this.pendingImport = parsePlainImport(JSON.stringify(this.vault.legacy)); this.importLegacy = true;
    this.status = 'Review the old tokens. Importing encrypts them and removes the old plaintext storage.';
  });
  commitImport = () => this.action(async () => {
    const merged = mergeTokens(this.tokens, this.pendingImport);
    await this.vault.save(merged.tokens);
    if (this.importLegacy) { await browser.storage.local.remove(['TOTP', 'microsoftAccount']); this.vault.legacy = null; }
    this.pendingImport = null; this.importLegacy = false; this.shadowRoot.querySelector('form.import')?.reset();
    this.sync(); this.status = `Imported ${merged.added} new tokens. Duplicates skipped.`;
  });
  render() {
    const host = (() => { try { return new URL(this.tab?.url).hostname; } catch { return ''; } })();
    const score = token => recommendation(token, this.tab?.url) ? (this.siteAccounts.includes(token.account.toLowerCase()) ? 2 : 1) : 0;
    const entries = [...this.tokens].sort((a, b) => score(b) - score(a))
      .filter(token => `${token.issuer} ${token.account} ${token.website}`.toLowerCase().includes(this.filter.toLowerCase()));
    return html`
      <header><div><h1>OTPAuth</h1><div class="muted">Your codes. Your encrypted vault.</div></div>
        ${this.unlocked ? html`<button @click=${this.lock} ?disabled=${this.busy}>Lock</button>` : ''}</header>
      ${this.status ? html`<div class="status" role="status">${this.status}</div>` : ''}
      <main>
      ${!this.ready ? html`<p>Opening vault…</p>` : !this.unlocked ? html`
        <h2>${this.vault.envelope ? 'Unlock your vault' : 'Create your vault'}</h2>
        <p class="muted">Codes and account details are encrypted on this device. Your password cannot be recovered. Keep an encrypted backup.</p>
        <form @submit=${this.open}>
          <label>Master password<input name="password" type="password" required autocomplete=${this.vault.envelope ? 'current-password' : 'new-password'} minlength=${this.vault.envelope ? 1 : 12}></label>
          ${!this.vault.envelope ? html`<label>Confirm password<input name="confirm" type="password" required autocomplete="new-password" minlength="12"></label>` : ''}
          <button class="primary" ?disabled=${this.busy}>${this.busy ? 'Working…' : this.vault.envelope ? 'Unlock' : 'Create encrypted vault'}</button>
        </form>` : html`
        ${this.vault.legacy ? html`<p class="status">Old tokens are still stored without encryption. Use “Migrate old saved tokens” under Import & encrypted backup.</p>` : ''}
        <div class="row between"><h2>Your authenticators</h2><span class="muted">${this.tokens.length} tokens</span></div>
        <p class="muted">${host ? `Suggested for ${host}. Verify the account before using a code.` : 'Open a website to see matching tokens.'} Locks five minutes after unlock.</p>
        <input aria-label="Search tokens" placeholder="Search issuer, account or website" @input=${e => { this.filter = e.target.value; }}>
        ${entries.length ? entries.map(token => {
          const match = recommendation(token, this.tab?.url); const remaining = token.period - Math.floor(Date.now() / 1000) % token.period;
          return html`<article class="card ${match ? 'match' : ''}">
            ${match ? html`<div class="badge">${score(token) === 2 ? 'Website and displayed account match' : match}</div>` : ''}
            <strong>${token.issuer || 'Authenticator'}</strong><div class="account">${token.account}</div>
            <div class="muted">${token.website || 'No website binding'}</div>
            <div class="row between"><code>${this.codes[token.id] || '••••••'}</code><span class="muted">${remaining}s</span></div>
            <progress max=${token.period} value=${remaining} aria-label="Code validity"></progress>
            <div class="row"><button @click=${() => this.copy(token)} ?disabled=${this.busy}>Copy</button>
              <button @click=${() => this.fill(token)} ?disabled=${this.busy || !host || (!!token.website && !match)}>Fill</button>
              <button @click=${() => { this.populate(token); this.shadowRoot.querySelector('details.add').open = true; }} ?disabled=${this.busy}>Edit</button>
              <button class="danger" @click=${() => this.remove(token)} ?disabled=${this.busy}>Delete</button></div>
          </article>`;
        }) : html`<p class="muted">${this.tokens.length ? 'No matching tokens.' : 'Add an authenticator below to get started.'}</p>`}
        <details class="add"><summary>${this.editing ? 'Edit authenticator' : 'Add authenticator'}</summary>
          <form @submit=${this.readEnrollment}><label>Enrollment link (otpauth://totp)<textarea name="enrollment" placeholder="Paste an enrollment URI"></textarea></label>
            <button type="submit" ?disabled=${this.busy}>Read enrollment link</button></form>
          <label>Or upload a QR image<input type="file" accept="image/*" @change=${this.scan} ?disabled=${this.busy}></label>
          <p class="muted">QR images stay on this device. HOTP and Google migration QR payloads are not supported.</p>
          <form @submit=${this.add}>
            <label>Issuer<input name="issuer" placeholder="e.g. Microsoft" .value=${this.draft.issuer || ''}></label>
            <label>Account<input name="account" placeholder="e.g. you@example.com" .value=${this.draft.account || ''}></label>
            <label>Base32 shared secret<input name="secret" type="password" required autocomplete="off" .value=${this.draft.secret || ''}></label>
            <label>Website domain (optional)<input name="website" placeholder="e.g. login.microsoftonline.com" .value=${this.draft.website || ''}></label>
            ${host ? html`<button type="button" @click=${() => { this.shadowRoot.querySelector('[name=website]').value = host; }}>Use current website</button>` : ''}
            <div class="grid"><label>Digits<select name="digits" .value=${String(this.draft.digits || 6)}><option>6</option><option>7</option><option>8</option></select></label>
              <label>Period (s)<input name="period" type="number" min="5" max="300" required .value=${String(this.draft.period || 30)}></label>
              <label>Algorithm<select name="algorithm" .value=${this.draft.algorithm || 'SHA1'}><option>SHA1</option><option>SHA256</option><option>SHA512</option></select></label></div>
            <button class="primary" ?disabled=${this.busy}>${this.editing ? 'Save changes' : 'Save authenticator'}</button>
            ${this.editing ? html`<button type="button" @click=${() => { this.draft = {}; this.editing = null; }}>Cancel edit</button>` : ''}
          </form>
        </details>
        <details><summary>Import & encrypted backup</summary>
          <button @click=${this.exportVault} ?disabled=${this.busy}>Download encrypted backup</button>
          <p class="muted">Imports merge into this vault. Supported: OTPAuth encrypted backups, JSON token arrays, old extension JSON, and one otpauth enrollment link per line.</p>
          ${this.vault.legacy ? html`<button @click=${this.previewLegacy} ?disabled=${this.busy}>Migrate old saved tokens</button>` : ''}
          <label>Import file<input type="file" accept=".json,.txt" @change=${this.importFile} ?disabled=${this.busy}></label>
          <form class="import" @submit=${this.previewImport}>
            <label>Or paste an import<textarea name="importText" required></textarea></label>
            <label>Backup password (encrypted imports only)<input name="importPassword" type="password" autocomplete="off"></label>
            <button ?disabled=${this.busy}>Preview import</button>
          </form>
          ${this.pendingImport ? html`<div class="card"><strong>${this.pendingImport.length} tokens ready</strong>
            <div class="preview">${this.pendingImport.map(token => html`<div>${token.issuer} · ${token.account}</div>`)}</div>
            <div class="row"><button class="primary" @click=${this.commitImport} ?disabled=${this.busy}>Import tokens</button>
              <button @click=${() => { this.pendingImport = null; }}>Cancel</button></div></div>` : ''}
        </details>`}
      </main>`;
  }
}
customElements.define('otp-app', OtpApp);
