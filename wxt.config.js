import { defineConfig } from 'wxt';
export default defineConfig({
  manifest: {
    name: 'OTPAuth', description: 'Encrypted TOTP vault with website recommendations, QR enrollment and portable backups.',
    permissions: ['storage', 'activeTab', 'scripting', 'alarms'], minimum_chrome_version: '102',
    icons: { 16: 'icons/icon16.png', 48: 'icons/icon48.png', 128: 'icons/icon128.png' },
  },
});
