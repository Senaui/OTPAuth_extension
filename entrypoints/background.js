export default defineBackground(() => {
  // Websites and injected scripts cannot read the vault or unlock key.
  browser.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  browser.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  browser.alarms.onAlarm.addListener(alarm => {
    if (alarm.name === 'vault-lock') browser.storage.session.remove('vaultSession');
  });
});
