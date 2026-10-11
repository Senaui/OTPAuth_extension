import { authenticator } from "otplib";

export function generateTotp(secret) {
    const token = authenticator.generate(normalizeSecret(secret));
    return token;
}

export function generateTotpWithPeriod(secret, period = 30) {
    const step = Number(period) || 30;
    const prevOptions = authenticator.options || {};
    const prevStep = prevOptions.step;
    try {
        authenticator.options = { ...prevOptions, step };
        return authenticator.generate(normalizeSecret(secret));
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
            } else if (Object.hasOwn(result, key)) {
                resolve(result[key]);
            } else {
                resolve(null);  
            }
        });
    });
}

export function normalizeSecret(secret) {
    const normalized = String(secret).replace(/\s/g, '').toUpperCase().replace(/=+$/, '');
    if (!/^[A-Z2-7]{16,}$/.test(normalized)) throw new Error('Enter a valid Base32 secret (at least 16 characters).');
    return normalized;
}

export async function setTOTP(label, secret) {
    if (['__proto__', 'constructor', 'prototype'].includes(label)) throw new Error('Choose a different label.');
    secret = typeof secret === 'string' ? normalizeSecret(secret) : { ...secret, secret: normalizeSecret(secret.secret) };
    const existingTOTPs = (await getItem('TOTP')) || {};
    existingTOTPs[label] = secret;
    await setItem('TOTP', existingTOTPs);
}

export async function removeTOTP(label) {
    const existingTOTPs = (await getItem('TOTP')) || {};
    delete existingTOTPs[label];
    await setItem('TOTP', existingTOTPs);
}

export async function getAllTOTP() {
    const value = await getItem('TOTP');
    return value || {};
}

export async function getTOTPByLabel(label) {
    const allTOTPs = await getAllTOTP();
    return allTOTPs ? allTOTPs[label] || null : null;
}

export function getSecondsRemaining(interval = 30) {
    const now = Math.floor(Date.now() / 1000);
    const mod = now % interval;
    return mod === 0 ? interval : interval - mod;
}

