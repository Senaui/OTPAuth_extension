import { LitElement, html, css } from "lit";
import { setTOTP, removeTOTP, getAllTOTP, getSecondsRemaining, generateTotpWithPeriod } from "./lib";

class ConfirmDelete extends LitElement {
  static properties = {
    label: { type: String },  // optional, for display or event detail
    confirming: { state: true }
  };

  constructor() {
    super();
    this.label = "";
    this.confirming = false;
  }

  static styles = css`
    button { padding: 6px 10px; border: 0; border-radius: 10px; cursor: pointer; }
    .warn    { background: #f59e0b; color: #111; }
    .danger  { background: #ef4444; color: #fff; }
    .secondary { background: #e5e7eb; color: #111; }
    .actions { display: flex; gap: 6px; }
  `;

  _startConfirm() {
    this.confirming = true;
  }
  _cancel() {
    this.confirming = false;
  }
  _confirm() {
    this.confirming = false;
    this.dispatchEvent(new CustomEvent("confirm", {
      detail: { label: this.label },
      bubbles: true,
      composed: true
    }));
  }

  render() {
    return this.confirming
      ? html`
          <div class="actions">
            <button class="danger" @click=${this._confirm}>Confirm</button>
            <button class="secondary" @click=${this._cancel}>Cancel</button>
          </div>
        `
      : html`
          <button class="warn" @click=${this._startConfirm}>Delete</button>
        `;
  }
}
customElements.define("confirm-delete", ConfirmDelete);

class TokenItem extends LitElement {
  static properties = {
    label: { type: String },
    value: { attribute: false }, // string or {secret, period, url}
    secondsRemaining: { type: Number },
    period: { type: Number },
    otp: { state: true },
  };
  constructor() {
    super();
    this.label = "";
    this.value = "";
    this.secondsRemaining = 0;
    this.period = 30;
    this.otp = "";
  }
  static styles = css`
    :host { display: list-item; list-style: none; }
    .row { display: flex; align-items: center; justify-content: space-between; padding: 6px 0; border-bottom: 1px dashed #e5e7eb; }
    .left { display: grid; gap: 2px; }
    strong { font-weight: 600; }
    .muted { color: #6b7280; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  `;
  /** Normalize to the real secret string */
  get secretString() {
    return typeof this.value === "string" ? this.value : (this.value?.secret ?? "");
  }

  get periodValue() {
    const fromValue = typeof this.value === "object" ? Number(this.value?.period) : NaN;
    const fromProp = Number(this.period);
    return Number.isFinite(fromValue) && fromValue > 0 ? fromValue : (Number.isFinite(fromProp) && fromProp > 0 ? fromProp : 30);
  }

  _updateOtp() {
    const secret = this.secretString;
    if (!secret) {
      this.otp = "";
      return;
    }
    this.otp = generateTotpWithPeriod(secret, this.periodValue);
  }

  updated(changedProperties) {
    if (changedProperties.has("value")) {
      this._updateOtp();
    }

    if (changedProperties.has("secondsRemaining")) {
      const prev = changedProperties.get("secondsRemaining");
      const cur = this.secondsRemaining;
      // First render (prev undefined) or rollover (e.g. 1 -> 30)
      if (prev === undefined || (typeof prev === "number" && cur > prev)) {
        this._updateOtp();
      }
    }
  }
  _handleConfirm = () => {
    this.dispatchEvent(new CustomEvent("remove", {
      detail: { label: this.label },
      bubbles: true, composed: true
    }));
  };
  
  render() {
    return html`
      <li class="row">
        <div class="left">
          <div><strong>${this.label}</strong></div>
          <div class="muted"><code>${this.otp || "—"}</code></div>
        </div>
        <confirm-delete .label=${this.label} @confirm=${this._handleConfirm}></confirm-delete>
      </li>
    `;
  }
}
customElements.define("token-item", TokenItem);

class TotpList extends LitElement {
  static properties = {
    items: { state: true },
    filter: { state: true },
    showForm: { state: false },
    secondsRemaining: { state: true },
    period: { state: true },
  };
  static styles = css`
  :host {
    display: flex;
    flex-direction: column;
    width: 350px;
    max-height: 560px;
    box-sizing: border-box;
    background: #fff;
  }
  .header {
    flex: 0 0 auto;
    padding: 12px;
    border-bottom: 1px solid #e5e7eb;
    background: #fff;
    position: sticky;
    top: 0;
    z-index: 1;
  }
  .title-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
  }
  .meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin: 6px 0 10px;
  }
  .countdown {
    font-size: 12px;
    color: #6b7280;
  }
  .toggle-btn {
    background: none;
    border: none;
    font-size: 25px;
    line-height: 1;
    cursor: pointer;
    color: #4f46e5;
    padding: 4px 8px;
    border-radius: 6px;
  }
  .list {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    padding: 8px 12px 12px;
  }
  form {
    display: grid;
    grid-template-columns: 1fr;
    gap: 8px;
    margin-bottom: 10px;
  }
  input {
    padding: 6px 8px;
    border: 1px solid #ccc;
    border-radius: 8px;
  }
  button {
    padding: 6px 10px;
    border: 0;
    border-radius: 10px;
    cursor: pointer;
  }
  button.primary {
    background: #4f46e5;
    color: white;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  `;


  constructor() {
    super();
    this.items = {};
    this.filter = "";
    this.showForm = false; // start hidden
    this.period = 30;
    this.secondsRemaining = getSecondsRemaining(this.period);
    this._countdownTimer = null;
  }
  connectedCallback() {
    super.connectedCallback();
    this.refresh();
    chrome.storage.onChanged.addListener(this._onStorageChange);

    // Keep countdown in sync with the current TOTP window
    this._tickCountdown();
    this._countdownTimer = setInterval(() => this._tickCountdown(), 1000);
  }
  disconnectedCallback() {
    chrome.storage.onChanged.removeListener(this._onStorageChange);
    if (this._countdownTimer) {
      clearInterval(this._countdownTimer);
      this._countdownTimer = null;
    }
    super.disconnectedCallback();
  }

  _tickCountdown() {
    this.secondsRemaining = getSecondsRemaining(this.period);
  }
  async refresh() {
    this.items = (await getAllTOTP()) || {};
  }
  _onStorageChange = (changes, area) => {
    if (area === "local" && changes.TOTP) this.refresh();
  };
  async _handleAdd(e) {
    e.preventDefault();
    const form = e.currentTarget;
    const label = form.label.value.trim();
    const secretInput = form.secret.value.trim();
    if (!label || !secretInput) return;
    // store as object so we can add metadata later
    await setTOTP(label, { secret: secretInput, period: 30, url: "" });
    form.reset();
  }
  async _remove(label) {
    await removeTOTP(label);
  }
  render() {
    const q = this.filter.toLowerCase();
    const entries = Object.entries(this.items || {}).filter(([label]) =>
      label.toLowerCase().includes(q)
    );

    return html`
    <div class="header">
      <div class="title-bar">
        <h1>TOTP Tokens</h1>
        <button class="toggle-btn" type="button" @click=${() => {this.showForm = !this.showForm}}>
          ${this.showForm ? "-" : "Add ⌄"}
        </button>
      </div>

      <div class="meta">
        <div class="countdown">Refresh in: <strong>${this.secondsRemaining}s</strong></div>
      </div>

      ${this.showForm ? html`
        <form @submit=${this._handleAdd}>
          <div class="row">
            <input name="label" placeholder="Label (e.g., example.com)" />
            <input name="secret" placeholder="Secret (base32)" />
          </div>
          <button class="primary" type="submit">Add</button>
        </form>
      ` : ""}

      <input placeholder="Filter…" @input=${e => (this.filter = e.target.value)} />
    </div>

    <div class="list">
      ${entries.length === 0
        ? html`<p class="muted">No tokens yet.</p>`
        : html`
          <ul>
            ${entries.map(([label, value]) => html`
              <token-item
                .label=${label}
                .value=${value}
                .secondsRemaining=${this.secondsRemaining}
                .period=${this.period}
                @remove=${(e) => this._remove(e.detail.label)}>
              </token-item>
            `)}
          </ul>
        `}
    </div>
  `;
  }


}
customElements.define("totp-list", TotpList);





// must remove before launching




