import { describe, it, expect } from 'vitest';
import {
  getQuotaConfig,
  checkSyncMutationsPerRequest,
} from '../quotas';
import { quotaExceeded, payloadTooLarge } from '../response';
import type { Env } from '../../types';

function makeEnv(overrides: Record<string, string> = {}): Env {
  return overrides as unknown as Env;
}

describe('getQuotaConfig', () => {
  it('uses documented defaults when no overrides are set', () => {
    const config = getQuotaConfig(makeEnv());
    expect(config.maxProjectsPerUser).toBe(10);
    expect(config.maxMembersPerProject).toBe(50);
    expect(config.maxEntitiesPerProject).toBe(5000);
    expect(config.maxSyncMutationsPerRequest).toBe(200);
  });

  it('applies valid numeric overrides', () => {
    const config = getQuotaConfig(
      makeEnv({
        QUOTA_MAX_PROJECTS_PER_USER: '3',
        QUOTA_MAX_SYNC_MUTATIONS_PER_REQUEST: '50',
      })
    );
    expect(config.maxProjectsPerUser).toBe(3);
    expect(config.maxSyncMutationsPerRequest).toBe(50);
    // Untouched quotas keep their defaults.
    expect(config.maxMembersPerProject).toBe(50);
  });

  it('falls back to defaults for invalid overrides', () => {
    const config = getQuotaConfig(
      makeEnv({
        QUOTA_MAX_MEMBERS_PER_PROJECT: '-1',
        QUOTA_MAX_ENTITIES_PER_PROJECT: 'not-a-number',
      })
    );
    expect(config.maxMembersPerProject).toBe(50);
    expect(config.maxEntitiesPerProject).toBe(5000);
  });
});

describe('checkSyncMutationsPerRequest', () => {
  it('returns null at or below the cap', () => {
    const config = getQuotaConfig(makeEnv());
    expect(checkSyncMutationsPerRequest(0, config)).toBeNull();
    expect(checkSyncMutationsPerRequest(200, config)).toBeNull();
  });

  it('returns a 400 Response above the cap', () => {
    const config = getQuotaConfig(makeEnv());
    const result = checkSyncMutationsPerRequest(201, config);
    expect(result).not.toBeNull();
    expect(result?.status).toBe(400);
  });
});

describe('quota/body-size response helpers', () => {
  it('quotaExceeded returns a 403', () => {
    const response = quotaExceeded('too many projects');
    expect(response.status).toBe(403);
  });

  it('payloadTooLarge returns a 413 with the maxBytes detail', async () => {
    const response = payloadTooLarge(1024);
    expect(response.status).toBe(413);
    const body = (await response.json()) as {
      error: { details: { maxBytes: number } };
    };
    expect(body.error.details.maxBytes).toBe(1024);
  });
});
