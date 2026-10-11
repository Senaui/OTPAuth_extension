import { isMicrosoftLogin, setInputValue, steps } from './login.js';

if (window.top === window && isMicrosoftLogin(location.href)) {
  const processed = new WeakSet();
  let pending = false;
  let timer;
  const visible = element => element && !element.disabled && element.getClientRects().length > 0;
  async function fill() {
    if (pending) return;
    const match = steps.map(([step, selector]) => [step, [...document.querySelectorAll(selector)].find(visible)])
      .find(([, field]) => field && !processed.has(field));
    if (!match) return;
    const [step, field] = match;
    if (step === 'totp') {
      const prompt = [...document.querySelectorAll('#idDiv_SAOTCC_Description, #idDiv_SAOTCC_Title, #iEnterCodeDesc')]
        .filter(visible).map(element => element.textContent).join(' ');
      // SMS and email challenges can reuse the same code input IDs.
      if (!/authenticator|authentication app|verification app|認証アプリ/i.test(prompt)) return;
    }
    if (field.value) { processed.add(field); return; }
    const username = [...document.querySelectorAll('#displayName, #idDiv_PWD_Username, #idDiv_SAOTCC_Username')]
      .map(element => element.textContent.trim()).find(text => text.includes('@'))
      || document.querySelector('input[name="loginfmt"]')?.value;
    pending = true;
    try {
      const result = await chrome.runtime.sendMessage({ type: 'GET_LOGIN_STEP', step, username });
      if (result?.retry) { timer = setTimeout(fill, 1000); return; }
      if (!result?.enabled || !result.value || !field.isConnected || !visible(field) || field.value) return;
      processed.add(field);
      setInputValue(field, result.value);
      const error = document.querySelector('#usernameError, #passwordError, #idDiv_SAOTCC_Error');
      if (result.autoSubmit && !visible(error)) {
        const button = document.querySelector(step === 'totp' ? '#idSubmit_SAOTCC_Continue, #idSIButton9' : '#idSIButton9');
        if (visible(button)) { button.click(); schedule(); }
      }
    } catch { /* Disabling or reloading the extension invalidates this context. */ }
    finally { pending = false; }
  }
  function schedule() { clearTimeout(timer); timer = setTimeout(fill, 100); }
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true, attributes: true });
  schedule();
}
