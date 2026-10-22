import fs from 'fs';
import path from 'path';

const nextConfigPath = path.join(__dirname, '..', '..', '..', 'next.config.ts');

// The debug-route gate lives in next.config.ts's conditional `pageExtensions`:
// `page.debug.tsx` files under src/app only resolve to routes while
// `debug.tsx` is a listed extension, so a flag-unset build excludes them.
async function loadNextConfig(): Promise<{ pageExtensions: string[] }> {
  jest.resetModules();
  const mod = (await import(nextConfigPath)) as {
    default: { pageExtensions: string[] };
  };
  return mod.default;
}

describe('next.config pageExtensions debug gate', () => {
  const originalFlag = process.env.INCLUDE_DEBUG_ROUTES;

  afterEach(() => {
    if (originalFlag === undefined) {
      delete process.env.INCLUDE_DEBUG_ROUTES;
    } else {
      process.env.INCLUDE_DEBUG_ROUTES = originalFlag;
    }
  });

  it('excludes debug routes when INCLUDE_DEBUG_ROUTES is unset (production)', async () => {
    delete process.env.INCLUDE_DEBUG_ROUTES;
    const { pageExtensions } = await loadNextConfig();
    expect(pageExtensions).not.toContain('debug.tsx');
  });

  it('excludes debug routes for values other than "1"', async () => {
    process.env.INCLUDE_DEBUG_ROUTES = '0';
    const { pageExtensions } = await loadNextConfig();
    expect(pageExtensions).not.toContain('debug.tsx');
  });

  it('includes debug routes when INCLUDE_DEBUG_ROUTES=1, keeping default extensions', async () => {
    process.env.INCLUDE_DEBUG_ROUTES = '1';
    const { pageExtensions } = await loadNextConfig();
    expect(pageExtensions).toContain('debug.tsx');
    for (const ext of ['tsx', 'ts', 'jsx', 'js']) {
      expect(pageExtensions).toContain(ext);
    }
  });
});

describe('debug route file placement (gate bypass guard)', () => {
  const appDir = path.join(__dirname, '..', '..', 'app');

  it('both debug pages use the gated page.debug.tsx filename', () => {
    for (const route of ['debug-favicons', 'favicon-migration']) {
      expect(fs.existsSync(path.join(appDir, route, 'page.debug.tsx'))).toBe(
        true
      );
    }
  });

  it('debug route dirs contain no ungated page.tsx that would compile into production', () => {
    for (const route of ['debug-favicons', 'favicon-migration']) {
      expect(fs.existsSync(path.join(appDir, route, 'page.tsx'))).toBe(false);
    }
  });
});
