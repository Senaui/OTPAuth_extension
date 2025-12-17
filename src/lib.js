import { authenticator } from "otplib";

export function generateTotp(secret) {
    const token = authenticator.generate(secret);
    return token;
}

export function generateTotpWithPeriod(secret, period = 30) {
    const step = Number(period) || 30;
    const prevOptions = authenticator.options || {};
    const prevStep = prevOptions.step;
    try {
        authenticator.options = { ...prevOptions, step };
        return authenticator.generate(secret);
    } finally {
        authenticator.options = { ...authenticator.options, step: prevStep ?? 30 };
    }
}

export async function setItem(key, value) {
    return new Promise((resolve, reject) => {
        chrome.storage.local.set({ [key]: value }, () => {
            if (chrome.runtime.lastError) {
                reject(chrome.runtime.lastError);
            } else {
                console.log('Item saved to storage');
                resolve();
            }
        });
    });
}

export async function getItem(key) {
    return new Promise((resolve, reject) => {
        chrome.storage.local.get([key], (result) => {
            if (chrome.runtime.lastError) {
                reject(chrome.runtime.lastError);
            } else if (result[key]) {
                resolve(result[key]);
            } else {
                resolve(null);  
            }
        });
    });
}

export async function setTOTP(label, secret) {
    console.log('Setting TOTP secret:', secret);
    const existingTOTPs = (await getItem('TOTP')) || {};
    existingTOTPs[label] = secret;
    await setItem('TOTP', existingTOTPs);
    console.log('Secret added to storage');
}

export async function removeTOTP(label) {
    console.log('Removing TOTP secret for label:', label);
    const existingTOTPs = (await getItem('TOTP')) || {};
    delete existingTOTPs[label];
    await setItem('TOTP', existingTOTPs);
    console.log('Secret removed from storage');
}

export async function getAllTOTP() {
    const value = await getItem('TOTP');
    return value || {};
}

export async function getTOTPByLabel(label) {
    const allTOTPs = await getAllTOTP();
    return allTOTPs ? allTOTPs[label] || null : null;
}

export async function alertTest() {
    alert('Test alert from lib.js');
}

export async function activate() {
    console.log('activate function called from lib.js');
}

export function getSecondsRemaining(interval = 30) {
    const now = Math.floor(Date.now() / 1000);
    const mod = now % interval;
    return mod === 0 ? interval : interval - mod;
}

export function scheduleTOTPUpdate(interval = 30, updateCallback) {
    updateCallback();
    let lastRemaining = getSecondsRemaining(interval);
    function tick() {
        const remaining = getSecondsRemaining(interval);
        console.log('Seconds remaining until next TOTP update:', remaining);
        // Detect rollover: remaining jumps upward (e.g. 1 -> 30)
        if (remaining > lastRemaining) updateCallback();
        lastRemaining = remaining;
        setTimeout(tick, 1000); // Check every 1 second
    }
    tick();
}

