// Lazy SDK loading and the in-memory API key. The key never leaves this module
// except in the Authorization header the SDK sends to api.anthropic.com. It is
// only persisted when the user explicitly opts in ("remember on this device").

import type Anthropic from '@anthropic-ai/sdk';

type SdkModule = typeof import('@anthropic-ai/sdk');
let sdkPromise: Promise<SdkModule> | null = null;

export function loadSdk(): Promise<SdkModule> {
  if (!sdkPromise) sdkPromise = import('@anthropic-ai/sdk');
  return sdkPromise;
}

const STORAGE_KEY = 'ais2.claudeKey';
let memoryKey: string | null = null;

export function initKey(): { key: string | null; remembered: boolean } {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      memoryKey = stored;
      return { key: stored, remembered: true };
    }
  } catch {
    // storage unavailable
  }
  return { key: null, remembered: false };
}

export function setKey(key: string | null, remember: boolean): void {
  memoryKey = key && key.trim() ? key.trim() : null;
  try {
    if (memoryKey && remember) localStorage.setItem(STORAGE_KEY, memoryKey);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // storage unavailable: the key simply stays in memory
  }
}

export function getKey(): string | null {
  return memoryKey;
}

export function forgetStoredKey(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function maskKey(key: string | null): string {
  if (!key) return '';
  return key.length > 12 ? `${key.slice(0, 7)}…${key.slice(-4)}` : '••••';
}

export async function createClient(): Promise<{ client: Anthropic; sdk: SdkModule['default'] }> {
  const key = memoryKey;
  if (!key) throw new Error('No API key set.');
  const mod = await loadSdk();
  const Sdk = mod.default;
  const client = new Sdk({
    apiKey: key,
    // Required to call the API from a browser. The key is the user's own and stays on their device.
    dangerouslyAllowBrowser: true,
    maxRetries: 1,
    timeout: 5 * 60 * 1000,
  });
  return { client, sdk: Sdk };
}
