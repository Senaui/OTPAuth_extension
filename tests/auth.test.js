import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { authenticator } from 'otplib';
import { isMicrosoftLogin, validAccount, steps, setInputValue } from '../src/login.js';
import { generateTotpWithPeriod, normalizeSecret, getItem, setTOTP } from '../src/lib.js';

const data = {};
let handler;
globalThis.chrome = {
  runtime: { id: 'extension', onMessage: { addListener: fn => { handler = fn; } } },
  storage: { local: {
    setAccessLevel: async () => {},
    get: (keys, callback) => callback(data),
    set: (values, callback) => { Object.assign(data, values); callback(); },
  } },
};
await import('../src/background.js');
const sender = { id: 'extension', frameId: 0, url: 'https://login.microsoftonline.com/common/login' };
function request(message, source = sender) {
  return new Promise(resolve => handler({ type: 'GET_LOGIN_STEP', ...message }, source, resolve));
}

test('exact HTTPS Microsoft origins only', () => {
  for (const host of ['login.live.com', 'login.microsoftonline.com', 'login.microsoft.com']) {
    assert.equal(isMicrosoftLogin(`https://${host}/common`), true);
  }
  for (const url of ['http://login.live.com/', 'https://login.live.com.evil.test/', 'https://evil.test/?login.microsoftonline.com', 'invalid']) {
    assert.equal(isMicrosoftLogin(url), false);
  }
  assert.equal(validAccount({ username: 'person@example.com' }), true);
  assert.equal(validAccount({ username: '' }), false);
});

test('RFC 6238 SHA1 test vector and independent custom periods', () => {
  const options = authenticator.options;
  authenticator.options = { epoch: 59000, digits: 8 };
  try {
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    assert.equal(generateTotpWithPeriod(secret, 30), '94287082');
    assert.notEqual(generateTotpWithPeriod(secret, 60), '94287082');
    assert.equal(generateTotpWithPeriod(secret, 30), '94287082');
  } finally { authenticator.options = options; }
  assert.equal(normalizeSecret('jbsw y3dp ehpk 3pxp'), 'JBSWY3DPEHPK3PXP');
  assert.throws(() => normalizeSecret('123-invalid'));
});

test('storage validates secrets and propagates failures', async () => {
  await setTOTP('Work', { secret: 'jbswy3dpehpk3pxp', period: 30 });
  assert.equal(data.TOTP.Work.secret, 'JBSWY3DPEHPK3PXP');
  await assert.rejects(setTOTP('__proto__', 'JBSWY3DPEHPK3PXP'));
  chrome.runtime.lastError = { message: 'storage failed' };
  await assert.rejects(getItem('TOTP'));
  delete chrome.runtime.lastError;
});

test('worker releases only the requested step for the configured account', async () => {
  data.microsoftAccount = { username: 'person@example.com', password: 'test-password', tokenLabel: 'Work', enabled: true, autoSubmit: false };
  assert.equal((await request({ step: 'username' })).value, 'person@example.com');
  assert.equal((await request({ step: 'password', username: 'PERSON@example.com' })).value, 'test-password');
  assert.equal((await request({ step: 'password', username: 'other@example.com' })).enabled, false);
  assert.equal((await request({ step: 'totp' })).enabled, false);
  assert.ok((await request({ step: 'password' }, { ...sender, frameId: 1 })).error);
  assert.ok((await request({ step: 'username' }, { ...sender, url: 'https://evil.test' })).error);
  data.microsoftAccount.enabled = false;
  assert.equal((await request({ step: 'username' })).enabled, false);
});

test('content fills delayed stages once and preserves user input', async () => {
  class Event { constructor(type) { this.type = type; } }
  class Input {
    constructor() { this._value = ''; this.isConnected = true; this.events = []; }
    get value() { return this._value; }
    set value(value) { this._value = value; }
    getClientRects() { return [1]; }
    dispatchEvent(event) { this.events.push(event.type); }
  }
  const field = new Input();
  field.ownerDocument = { defaultView: { HTMLInputElement: Input, Event } };
  let stage = 'username';
  let observer;
  let calls = 0;
  let clicks = 0;
  const tasks = [];
  const doc = {
    documentElement: {},
    querySelectorAll: selector => selector.includes('displayName') ? [{ textContent: 'person@example.com' }]
      : selector === steps.find(([name]) => name === stage)[1] ? [field] : [],
    querySelector: selector => selector.includes('Error') ? null : { getClientRects: () => [1], click: () => { clicks++; } },
  };
  const win = {}; win.top = win;
  const context = vm.createContext({ window: win, document: doc, location: { href: sender.url },
    isMicrosoftLogin, steps, setInputValue, WeakSet,
    MutationObserver: class { constructor(fn) { observer = fn; } observe() {} },
    setTimeout: fn => { tasks.push(fn); return tasks.length; }, clearTimeout: () => {},
    chrome: { runtime: { sendMessage: async () => { calls++; return { enabled: true, value: 'saved', autoSubmit: true }; } },
      storage: { onChanged: { addListener() {} } } },
  });
  const source = (await readFile(new URL('../src/content.js', import.meta.url), 'utf8')).replace(/^import[^\n]+\n/, '');
  vm.runInContext(source, context);
  await tasks.shift()();
  assert.equal(field.value, 'saved');
  assert.deepEqual(field.events, ['input', 'change']);
  assert.equal(clicks, 1);
  observer(); await tasks.pop()();
  assert.equal(calls, 1);
  // A new field represents Microsoft's next dynamically rendered page.
  stage = 'password';
  const next = new Input(); next.ownerDocument = field.ownerDocument;
  doc.querySelectorAll = selector => selector.includes('displayName') ? [{ textContent: 'person@example.com' }]
    : selector === steps[1][1] ? [next] : [];
  next.value = 'user-entered';
  observer(); await tasks.pop()();
  assert.equal(next.value, 'user-entered');
  assert.equal(calls, 1);
  stage = 'totp';
  const code = new Input(); code.ownerDocument = field.ownerDocument;
  let prompt = 'Enter the code sent to your phone';
  doc.querySelectorAll = selector => selector.includes('Description')
    ? [{ textContent: prompt, getClientRects: () => [1] }]
    : selector.includes('displayName') ? [{ textContent: 'person@example.com' }]
    : selector === steps[0][1] ? [code] : [];
  observer(); await tasks.pop()();
  assert.equal(calls, 1, 'SMS prompts must not receive authenticator codes');
  prompt = 'Enter the code from your authenticator app';
  observer(); await tasks.pop()();
  assert.equal(code.value, 'saved');
  assert.equal(calls, 2);
});
