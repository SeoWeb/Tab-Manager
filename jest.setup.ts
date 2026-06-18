// Jest setup: adds @testing-library/jest-dom matchers (toBeInTheDocument, etc.)
// and silences noisy console output from Chrome-API fallback paths under jsdom.
import '@testing-library/jest-dom';

// The tab/bookmark services log warnings/info/errors when the Chrome API is
// absent or during normal sync flows; during tests that is expected behaviour,
// so keep the output quiet.
const noop = () => {};
jest.spyOn(console, 'log').mockImplementation(noop);
jest.spyOn(console, 'warn').mockImplementation(noop);
jest.spyOn(console, 'error').mockImplementation(noop);

// `structuredClone` is a runtime global in browsers and Node 17+, but the jsdom
// test environment here does not expose it. The cloud-sync change reducer uses
// it to deep-clone state before applying remote changes. Provide a JSON-based
// fallback sufficient for the plain (Date-as-ISO-string) data in tests.
if (
  typeof (globalThis as { structuredClone?: unknown }).structuredClone ===
  'undefined'
) {
  (globalThis as { structuredClone: <T>(value: T) => T }).structuredClone = (
    value
  ) => JSON.parse(JSON.stringify(value)) as typeof value;
}

// `crypto.randomUUID` is used throughout the store actions to mint entity ids.
// It exists in browsers and modern Node, but the jsdom env here does not expose
// it on `globalThis.crypto`; provide a RFC-4122 v4-shaped fallback so tests can
// exercise the actions. (Math.random is fine here — this only runs under Jest.)
const cryptoGlobal = globalThis as unknown as {
  crypto?: { randomUUID?: () => string } & Record<string, unknown>;
};
if (typeof cryptoGlobal.crypto?.randomUUID !== 'function') {
  Object.defineProperty(globalThis, 'crypto', {
    value: {
      ...cryptoGlobal.crypto,
      randomUUID: () =>
        'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
          const r = (Math.random() * 16) | 0;
          const v = c === 'x' ? r : (r & 0x3) | 0x8;
          return v.toString(16);
        }),
    },
    writable: true,
    configurable: true,
  });
}
