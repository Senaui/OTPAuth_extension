import { generateTotpWithPeriod, getItem, getTOTPByLabel, getSecondsRemaining } from './lib.js';
import { isMicrosoftLogin, validAccount } from './login.js';

const storageReady = chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });

// Generate on demand because Manifest V3 workers can be suspended.
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message.type !== 'GET_LOGIN_STEP') return;
  if (sender.id !== chrome.runtime.id || sender.frameId !== 0 || !isMicrosoftLogin(sender.url)) {
    respond({ error: 'Unsupported page' }); return;
  }
  (async () => {
    await storageReady;
    const account = await getItem('microsoftAccount');
    if (!validAccount(account) || !account.enabled) return { enabled: false };
    if (message.step !== 'username' && message.username?.toLowerCase() !== account.username.toLowerCase()) {
      return { enabled: false };
    }
    let value;
    if (message.step === 'username') value = account.username;
    else if (message.step === 'password') value = account.password;
    else if (message.step === 'totp') {
      const token = await getTOTPByLabel(account.tokenLabel);
      if (token && getSecondsRemaining(token.period || 30) < 5) return { retry: true };
      if (token) value = generateTotpWithPeriod(typeof token === 'string' ? token : token.secret, token.period || 30);
    }
    return { enabled: true, value, autoSubmit: account.autoSubmit === true };
  })().then(respond, () => respond({ error: 'Unable to load sign-in settings' }));
  return true;
});
