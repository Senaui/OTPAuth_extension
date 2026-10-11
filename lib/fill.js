// This function is serialized by scripting.executeScript; keep it self-contained.
export function fillOtp(code, expectedOrigin) {
  if (location.origin !== expectedOrigin) return { error: 'The page changed. Reopen the popup.' };
  const visible = field => !field.disabled && !field.readOnly && field.getClientRects().length > 0;
  const selector = 'input[autocomplete="one-time-code"], input[name="otc"], #idTxtBx_SAOTCC_OTC, input[name*="otp" i], input[id*="otp" i], input[name*="totp" i], input[id*="verificationCode" i]';
  const fields = [...document.querySelectorAll(selector)].filter(field => visible(field) && !['password', 'hidden'].includes(field.type));
  const set = (field, value) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
  };
  if (fields.length === 1 && fields[0].maxLength !== 1) {
    if (fields[0].value) return { error: 'The code field already contains a value.' };
    set(fields[0], code); return { filled: true };
  }
  if (fields.length === code.length && fields.every(field => field.maxLength === 1 && !field.value
    && (field.form ? field.form === fields[0].form : field.parentElement === fields[0].parentElement))) {
    fields.forEach((field, index) => set(field, code[index])); return { filled: true };
  }
  return { error: 'No unambiguous empty code field found. Copy the code instead.' };
}

export function readPageAccount() {
  const visible = element => element.getClientRects().length > 0;
  const candidates = [...document.querySelectorAll('input[type="email"], input[name="loginfmt"], input[name="username"], #displayName, #idDiv_PWD_Username, #idDiv_SAOTCC_Username')]
    .filter(visible).map(element => element.value || element.textContent.trim());
  return [...new Set(candidates.filter(value => /^[^\s@]+@[^\s@]+$/.test(value)).map(value => value.toLowerCase()))];
}
