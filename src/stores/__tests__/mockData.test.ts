import { INITIAL_PROJECT_ID } from '../mockData';

const FIXED_TIMESTAMP = new Date('2024-01-01T00:00:00.000Z');

/**
 * "Deterministic defaults" (spec: Hydration gate blocks on storage load):
 * two contexts initializing with no persisted data must produce identical
 * default state, including IDs. mockData.ts must therefore contain no
 * module-load randomness, so two fresh module instances are compared here.
 */
async function loadFreshMockData() {
  jest.resetModules();
  return import('@/stores/mockData');
}

describe('mockData deterministic defaults', () => {
  it('two fresh contexts produce identical default IDs', async () => {
    const moduleA = await loadFreshMockData();
    const moduleB = await loadFreshMockData();

    const projectsA = moduleA.initialProjects;
    const projectsB = moduleB.initialProjects;

    expect(projectsA[0].id).toBe(projectsB[0].id);
    expect(JSON.stringify(projectsA)).toBe(JSON.stringify(projectsB));
  });

  it('default project id equals the exported constant', async () => {
    const moduleA = await loadFreshMockData();

    expect(moduleA.INITIAL_PROJECT_ID).toBe(INITIAL_PROJECT_ID);
    expect(moduleA.initialProjects[0].id).toBe(INITIAL_PROJECT_ID);
  });

  it('default project timestamps are the fixed module timestamp', async () => {
    const moduleA = await loadFreshMockData();
    const project = moduleA.initialProjects[0];

    expect(project.createdAt.getTime()).toBe(FIXED_TIMESTAMP.getTime());
    expect(project.updatedAt.getTime()).toBe(FIXED_TIMESTAMP.getTime());
    expect(project.createdAt.toISOString()).toBe('2024-01-01T00:00:00.000Z');
  });
});
