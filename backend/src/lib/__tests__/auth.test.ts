import { describe, it, expect } from 'vitest';
import { signJwt, verifyJwt } from '../auth';

const SECRET = 'test-secret-do-not-use-in-prod';

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
