import { debugLog, isDebugLoggingEnabled } from '@/lib/debugLog';

describe('debugLog', () => {
  const ORIGINAL_ENV = process.env;
  let debugSpy: jest.SpyInstance;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.DEBUG;
    delete process.env.NEXT_PUBLIC_DEBUG;
    debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    debugSpy.mockRestore();
  });

  it('is silent when no debug flag is set', () => {
    debugLog('hello', { a: 1 });
    expect(debugSpy).not.toHaveBeenCalled();
  });

  it('is silent when DEBUG is set to something other than "1"', () => {
    process.env.DEBUG = 'true';
    debugLog('hello');
    expect(debugSpy).not.toHaveBeenCalled();
  });

  it('emits via console.debug when DEBUG=1', () => {
    process.env.DEBUG = '1';
    debugLog('hello', 42);
    expect(debugSpy).toHaveBeenCalledTimes(1);
    expect(debugSpy).toHaveBeenCalledWith('hello', 42);
  });

  it('emits via console.debug when NEXT_PUBLIC_DEBUG=1', () => {
    process.env.NEXT_PUBLIC_DEBUG = '1';
    debugLog('hello');
    expect(debugSpy).toHaveBeenCalledTimes(1);
    expect(debugSpy).toHaveBeenCalledWith('hello');
  });

  it('isDebugLoggingEnabled mirrors the flag state', () => {
    expect(isDebugLoggingEnabled()).toBe(false);
    process.env.DEBUG = '1';
    expect(isDebugLoggingEnabled()).toBe(true);
  });
});
