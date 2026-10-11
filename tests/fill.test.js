import test from 'node:test';
import assert from 'node:assert/strict';
import { fillOtp, readPageAccount } from '../lib/fill.js';

class Input {
  constructor(value = '', maxLength = -1) { this._value = value; this.maxLength = maxLength; this.events = []; this.parentElement = parent; this.type = 'text'; }
  set value(value) { this._value = value; }
  get value() { return this._value; }
  getClientRects() { return this.hidden ? [] : [1]; }
  dispatchEvent(event) { this.events.push(event.type); }
}
const parent = {};
globalThis.HTMLInputElement = Input;
globalThis.location = { origin: 'https://example.com' };
let fields;
globalThis.document = { querySelectorAll: () => fields };
test('single and segmented OTP fields receive events without submitting', () => {
  fields = [new Input()]; assert.equal(fillOtp('123456', location.origin).filled, true);
  assert.equal(fields[0].value, '123456'); assert.deepEqual(fields[0].events, ['input','change']);
  fields = Array.from({ length: 6 }, () => new Input('', 1));
  assert.equal(fillOtp('123456', location.origin).filled, true);
  assert.equal(fields.map(field => field.value).join(''), '123456');
});
test('fill preserves existing values, rejects ambiguity and checks navigation', () => {
  fields = [new Input('user-code')]; assert.ok(fillOtp('123456', location.origin).error); assert.equal(fields[0].value, 'user-code');
  fields = [new Input(), new Input()]; assert.ok(fillOtp('123456', location.origin).error);
  fields = [new Input()]; assert.ok(fillOtp('123456', 'https://another.example').error); assert.equal(fields[0].value, '');
  fields[0].hidden = true; assert.ok(fillOtp('123456', location.origin).error);
});
test('account inspection reads only displayed email identifiers', () => {
  const shown = new Input('Demo@Example.com'); const hidden = new Input('hidden@example.com'); hidden.hidden = true;
  fields = [shown, hidden, new Input('not-an-email')];
  assert.deepEqual(readPageAccount(), ['demo@example.com']);
});
