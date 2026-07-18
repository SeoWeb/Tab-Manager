// Jest setup: adds @testing-library/jest-dom matchers (toBeInTheDocument, etc.)
// and silences noisy console output from Chrome-API fallback paths under jsdom.
import '@testing-library/jest-dom';
import { TextEncoder, TextDecoder } from 'util';

// `TextEncoder` / `TextDecoder` back the crypto module's byte<->string helpers.
// They are a browser/global-Node feature but the jsdom env here does not
// expose them; provide them so tests that use them can run.
const g = globalThis as unknown as {
  TextEncoder?: unknown;
  TextDecoder?: unknown;
};
if (typeof g.TextEncoder === 'undefined') g.TextEncoder = TextEncoder;
if (typeof g.TextDecoder === 'undefined') g.TextDecoder = TextDecoder;

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

// `crypto` must expose `subtle`, `getRandomValues`, and `randomUUID` for the
// cloud-sync store actions. The jsdom env here ships only a
// partial `crypto`, so back it with Node's `webcrypto` (which has all three).
import { webcrypto } from 'node:crypto';

const cryptoGlobal = globalThis as unknown as {
  crypto?: Partial<Crypto> & Record<string, unknown>;
};
if (
  !cryptoGlobal.crypto ||
  typeof cryptoGlobal.crypto.getRandomValues !== 'function' ||
  typeof cryptoGlobal.crypto.subtle?.encrypt !== 'function'
) {
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    writable: true,
    configurable: true,
  });
}
