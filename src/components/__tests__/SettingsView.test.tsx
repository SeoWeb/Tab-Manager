/**
 * SettingsView debug-link gating (cleanup-and-regression-tests task 2.3
 * follow-up): the "Update Favicons" link targets the debug-only
 * /favicon-migration route, which is excluded from production builds by
 * next.config.ts's conditional `pageExtensions`. The link block is gated on
 * the same build-time flag so production ships neither the route nor a dead
 * link to it.
 *
 * In jest (no build-time inlining) the flag is read at render time, so the
 * tests toggle `process.env.INCLUDE_DEBUG_ROUTES` directly.
 */
import { render, screen } from '@testing-library/react';
import SettingsView from '@/components/views/SettingsView';

jest.mock('nanoid', () => ({ nanoid: () => 'test-id' }));

jest.mock('lucide-react', () => ({
  __esModule: true,
  Menu: () => null,
  GraduationCap: () => null,
  SunIcon: () => null,
  MoonIcon: () => null,
}));

// Heavy cloud-sync children: stub — the test exercises only the link gate.
jest.mock('@/components/cloud-sync/CloudSyncSettingsPanel', () => ({
  __esModule: true,
  CloudSyncSettingsPanel: () => null,
}));
jest.mock('@/components/cloud-sync/CloudSyncMyProjectsCard', () => ({
  __esModule: true,
  CloudSyncMyProjectsCard: () => null,
}));
jest.mock('@/components/cloud-sync/CloudSyncInvitesCard', () => ({
  __esModule: true,
  CloudSyncInvitesCard: () => null,
}));

describe('SettingsView debug-link gating', () => {
  const originalFlag = process.env.INCLUDE_DEBUG_ROUTES;

  afterEach(() => {
    if (originalFlag === undefined) {
      delete process.env.INCLUDE_DEBUG_ROUTES;
    } else {
      process.env.INCLUDE_DEBUG_ROUTES = originalFlag;
    }
  });

  it('hides the favicon-migration link when INCLUDE_DEBUG_ROUTES is unset (production)', () => {
    delete process.env.INCLUDE_DEBUG_ROUTES;
    render(<SettingsView />);
    expect(
      screen.queryByRole('link', { name: 'Update Favicons' })
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Favicon Management')).not.toBeInTheDocument();
  });

  it('shows the favicon-migration link when INCLUDE_DEBUG_ROUTES=1', () => {
    process.env.INCLUDE_DEBUG_ROUTES = '1';
    render(<SettingsView />);
    const link = screen.getByRole('link', { name: 'Update Favicons' });
    expect(link).toHaveAttribute('href', '/favicon-migration');
  });

  it('hides the favicon-migration link for values other than "1"', () => {
    process.env.INCLUDE_DEBUG_ROUTES = '0';
    render(<SettingsView />);
    expect(
      screen.queryByRole('link', { name: 'Update Favicons' })
    ).not.toBeInTheDocument();
  });
});
