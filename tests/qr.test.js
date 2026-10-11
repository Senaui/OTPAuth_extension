import test from 'node:test';
import assert from 'node:assert/strict';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import { parseOtpUri } from '../lib/tokens.js';

test('local QR decoder preserves enrollment details', () => {
  const uri = 'otpauth://totp/GitHub:qr-test%40example.com?issuer=GitHub&secret=JBSWY3DPEHPK3PXP&digits=8&period=60&algorithm=SHA256';
  const { modules } = QRCode.create(uri);
  const scale = 4, margin = 4, width = (modules.size + margin * 2) * scale;
  const pixels = new Uint8ClampedArray(width * width * 4);
  for (let y = 0; y < width; y++) for (let x = 0; x < width; x++) {
    const row = Math.floor(y / scale) - margin, col = Math.floor(x / scale) - margin;
    const black = row >= 0 && col >= 0 && row < modules.size && col < modules.size && modules.data[row * modules.size + col];
    const offset = (y * width + x) * 4;
    pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = black ? 0 : 255; pixels[offset + 3] = 255;
  }
  const result = jsQR(pixels, width, width);
  assert.equal(result.data, uri);
  const token = parseOtpUri(result.data);
  assert.equal(token.account, 'qr-test@example.com'); assert.equal(token.algorithm, 'SHA256');
  assert.equal(token.digits, 8); assert.equal(token.period, 60);
});
