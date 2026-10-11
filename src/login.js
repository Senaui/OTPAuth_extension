export const microsoftHosts = ['login.microsoftonline.com', 'login.live.com', 'login.microsoft.com'];
export function isMicrosoftLogin(url) {
  try { const p = new URL(url); return p.protocol === 'https:' && microsoftHosts.includes(p.hostname); }
  catch { return false; }
}
export function validAccount(account) {
  return !!account && typeof account.username === 'string' && /^[^\s@]+@[^\s@]+$/.test(account.username);
}
export const steps = [
  ['totp', '#idTxtBx_SAOTCC_OTC, input[name="otc"]'],
  ['password', '#i0118, input[name="passwd"]'],
  ['username', '#i0116, input[name="loginfmt"]'],
];
export function setInputValue(field, value) {
  const win = field.ownerDocument.defaultView;
  Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value').set.call(field, value);
  for (const type of ['input', 'change']) field.dispatchEvent(new win.Event(type, { bubbles: true }));
}
