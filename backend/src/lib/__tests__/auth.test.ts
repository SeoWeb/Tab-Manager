import { describe, it, expect } from 'vitest';
import { signJwt, verifyJwt, assertJwtSecret } from '../auth';

const SECRET = 'test-secret-do-not-use-in-prod-123456';

describe('auth JWT (signJwt / verifyJwt)', () => {
  it('verifies a token it signed and returns the payload', async () => {
    const token = await signJwt(
      { sub: 'user-1', email: 'user@example.com', display_name: 'User' },
      SECRET
    );

    const payload = await verifyJwt(token, SECRET);

    expect(payload).not.toBeNull();
    expect(payload?.sub).toBe('user-1');
    expect(payload?.email).toBe('user@example.com');
    expect(payload?.display_name).toBe('User');
  });

  it('rejects a token signed with a different secret', async () => {
    const token = await signJwt({ sub: 'user-1' }, SECRET);

    const payload = await verifyJwt(token, 'a-different-secret');

    expect(payload).toBeNull();
  });

  it('rejects a malformed token', async () => {
    const payload = await verifyJwt('not.a.valid-jwt', SECRET);

    expect(payload).toBeNull();
  });

  it('rejects an expired token', async () => {
    // exp far in the past (epoch second 1 = 1970-01-01).
    const token = await signJwt({ sub: 'user-1', exp: 1 }, SECRET);

    const payload = await verifyJwt(token, SECRET);

    expect(payload).toBeNull();
  });
});

describe('assertJwtSecret (boot validation)', () => {
  it('passes for a sufficiently long secret', () => {
    expect(() => assertJwtSecret(SECRET)).not.toThrow();
    expect(() => assertJwtSecret('a'.repeat(32))).not.toThrow();
  });

  it('throws when the secret is missing', () => {
    expect(() => assertJwtSecret(undefined)).toThrow(/JWT_SECRET/);
    expect(() => assertJwtSecret('')).toThrow(/JWT_SECRET/);
  });

  it('throws when the secret is only whitespace', () => {
    expect(() => assertJwtSecret('   ')).toThrow(/JWT_SECRET/);
  });

  it('throws when the secret is too short', () => {
    expect(() => assertJwtSecret('short')).toThrow(/JWT_SECRET/);
    expect(() => assertJwtSecret('a'.repeat(31))).toThrow(/JWT_SECRET/);
  });
});
