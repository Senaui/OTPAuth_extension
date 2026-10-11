# OTPAuth

A WXT + Lit browser extension for a local, encrypted TOTP vault. Supports Chrome and Edge (Manifest V3), with account/website recommendations, QR image enrollment, and encrypted backups.

## Install the packaged extension

1. Extract the extension ZIP into a permanent folder.
2. Open `chrome://extensions` or `edge://extensions`.
3. Enable **Developer mode**, choose **Load unpacked**, and select the extracted folder containing `manifest.json`.
4. Open OTPAuth from the toolbar and create a master password of at least 12 characters. Keep it safe: there is no password recovery.

## Development

Use Node.js 22.12+ (or 24+) and pnpm 11.25.0.

```sh
corepack enable
corepack prepare pnpm@11.25.0 --activate
pnpm install --frozen-lockfile
pnpm test
pnpm build
```

If your Node distribution does not include Corepack, install pnpm with `npm install -g pnpm@11.25.0`. Load `.output/chrome-mv3/` as an unpacked extension. `pnpm dev` starts WXT development mode; `pnpm zip` creates a distributable extension ZIP.

## Enrollment and recommendations

- **Manual secret:** enter a Base32 shared secret plus an issuer/account label. A current six-digit code is not the shared secret.
- **Enrollment link:** paste a standard `otpauth://totp/...` URI and select **Read enrollment link**. Issuer, account, algorithm, digits and period are parsed automatically.
- **QR image:** upload an image of an enrollment QR. Decoding happens locally; review the decoded details before saving.
- **Website binding:** enter the exact domain where you sign in, or choose **Use current website**. Bind a Microsoft work account to `login.microsoftonline.com`, for example. Add/edit a binding when a provider uses a different sign-in host.
- Open the toolbar popup on a sign-in page. Exact website matches appear first, with known issuer suggestions for a small set of providers when no website is saved. If a visible email matches the stored account, it is ranked first among that website's tokens. Account names remain visible so you can confirm which code to use.
- **Copy** copies a freshly generated code. **Fill** inserts it into an unambiguous empty OTP field or supported segmented fields. It preserves existing values, checks that the website has not changed, and never submits the page. For unsupported fields, copy manually. Bound tokens cannot be filled on a different domain.

Supported TOTP parameters: SHA-1, SHA-256, SHA-512; 6–8 digits; 5–300 second periods. Standard 30-second, six-digit SHA-1 accounts use the defaults. Enrollment and QR data may not identify the website, so an explicit website binding is the most reliable match.

## Import and export

Under **Import & encrypted backup**:

- **Download encrypted backup** exports the whole vault as a versioned JSON file. It uses the current master password and can be imported into a different OTPAuth vault.
- Import an OTPAuth encrypted backup with its backup password; a JSON token array (`[{issuer, account, secret, website, algorithm, digits, period}]`); `{ "tokens": [...] }`; old extension JSON (`{ "TOTP": { "label": "SECRET" } }`, including object records); or one enrollment URI per line.
- Select **Preview import**, review the account list, then **Import tokens**. Import merges with existing tokens and skips matching secret/account/issuer/parameter combinations. Existing records are kept.
- If the old extension has saved plaintext tokens, **Migrate old saved tokens** previews them. After a successful encrypted save, it removes the old `TOTP` and `microsoftAccount` storage. Until migration, a banner explains that the old records remain unencrypted. Unpacked-extension migration requires keeping the same extension ID; loading this build with a new ID creates a separate vault.

HOTP, Google Authenticator `otpauth-migration` QR payloads, and proprietary vendor backups are not supported. Import limits: 2 MB and 1,000 tokens per batch. QR limits: 8 MB and 20 million pixels. Export is encrypted only; there is no plaintext export UI.

## Encryption and permissions

All token secrets and metadata are encrypted with AES-256-GCM. A password-derived key uses PBKDF2-HMAC-SHA-256 with 600,000 iterations and a random 128-bit salt. Each save has a fresh 96-bit nonce. Backups use the same authenticated, versioned format. Wrong passwords and tampering are rejected.

An unlocked key exists in extension memory and trusted `storage.session` until manual locking, five minutes after unlocking, or browser-session end. Background alarms remove expired session keys; the popup also checks expiry and clears visible tokens. Ciphertext alone is persisted in `storage.local` for new vaults. Encryption protects data at rest; it does not protect against a compromised browser/device or another process reading an unlocked session. Copied codes remain in the system clipboard until overwritten. Back up before deleting tokens or removing the extension; uninstalling deletes local extension data. This implementation has not had an independent security audit.

Permissions are limited to `storage`, `activeTab`, `scripting`, and `alarms`. There are no permanent host permissions, content scripts on every website, external requests from the extension, account sync, or stored Microsoft passwords. Website inspection/filling happens only in the tab where the user opens the popup. Storage is restricted to trusted extension contexts.

## Validation

11 automated tests cover all 18 RFC 6238 SHA-1/SHA-256/SHA-512 vectors; enrollment parsing; parameter validation; domain matching; legacy/JSON/URI imports; merge behavior; encryption and wrong passwords/tampering; fresh nonces; session expiry and persistence; storage failures and stale writes; large backup encoding; QR decoding; single/segmented OTP fields; navigation checks; preserving existing input; and visible account inspection.

The WXT production build passes. A browser preview with mocked extension APIs and disposable data verified vault creation, URI and QR enrollment, custom TOTP parameters, website/account ranking, import preview/commit, lock, wrong-password rejection, and unlock/persistence. The preview reported a successful export action, but its browser backend did not expose a download event; encrypted backup round trips are verified by automated tests.

Still verify the installed extension on Chrome/Edge: backup download/import; session alarm expiry; QR upload; and real Microsoft/other-provider code fields. Push approvals, number matching, passkeys, and passwordless prompts remain manual. No real account credentials were used during development.

## Structure

- `entrypoints/`: WXT background and Lit popup.
- `lib/tokens.js`: enrollment, validation, TOTP generation and recommendations.
- `lib/crypto.js`: authenticated encryption and backup format.
- `lib/vault.js`: persistence and session lifecycle.
- `lib/fill.js`: serialized tab inspection and code filling.
- `tests/`: behavioral, crypto, RFC-vector and QR tests.
- `wxt.config.js`: minimal extension manifest configuration.
