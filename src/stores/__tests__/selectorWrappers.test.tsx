import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import RegionBoundary from '@/components/RegionBoundary';
import {
  useAppStoreWithDefaults,
  useProjects,
} from '@/hooks/useAppStoreWithDefaults';
import { useAppStore } from '@/stores/appStore';

// `nanoid` v5 is ESM-only and cannot be parsed by jest's CJS transform when
// pulled in through the store's action modules; the tests here don't care
// about id generation, so stub it with a deterministic implementation.
jest.mock('nanoid', () => ({
  nanoid: () => 'test-id',
}));

/**
 * "Selector failures are honest" (ui-resilience spec): the selector helpers
 * must not catch and swallow selector exceptions with fallback values. A
 * throwing selector has to surface at the nearest error boundary, which
 * announces the failure and offers a Reset action that remounts the region.
 */

function ThrowingSelector() {
  useAppStoreWithDefaults(() => {
    throw new Error('boom');
  });
  return <div>never rendered</div>;
}

describe('selector wrappers + region boundaries', () => {
  it('a throwing selector surfaces at the enclosing RegionBoundary instead of silently rendering a fallback value', () => {
    render(
      <RegionBoundary name='test region'>
        <ThrowingSelector />
      </RegionBoundary>
    );

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/test region/i);
    expect(alert).toHaveTextContent('boom');
    expect(screen.getByRole('button', { name: /reset/i })).toBeInTheDocument();
    expect(screen.queryByText('never rendered')).not.toBeInTheDocument();
  });

  it('Reset remounts the region subtree so it recovers once the transient issue is gone', () => {
    let shouldThrow = true;
    let renderCount = 0;

    function ConditionalChild() {
      renderCount += 1;
      if (shouldThrow) throw new Error('transient crash');
      return <div>region content</div>;
    }

    render(
      <RegionBoundary name='right panel'>
        <ConditionalChild />
      </RegionBoundary>
    );

    expect(screen.getByRole('alert')).toHaveTextContent('transient crash');
    expect(screen.queryByText('region content')).not.toBeInTheDocument();

    // The underlying issue clears, then Reset remounts the region fresh.
    shouldThrow = false;
    fireEvent.click(screen.getByRole('button', { name: /reset/i }));

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('region content')).toBeInTheDocument();
    expect(renderCount).toBeGreaterThan(1);
  });

  it('useAppStoreWithDefaults is a live pass-through: useProjects reflects store updates', () => {
    function ProjectsProbe() {
      const projects = useProjects();
      return (
        <ul>
          {projects.map((project) => (
            <li key={project.id}>{project.name}</li>
          ))}
        </ul>
      );
    }

    render(<ProjectsProbe />);

    // The default store state (mockData) renders…
    expect(screen.getByText('Work')).toBeInTheDocument();

    // …and store updates flow through live.
    act(() => {
      useAppStore.setState({
        projects: [
          { ...useAppStore.getState().projects[0], name: 'Renamed Project' },
        ],
      });
    });

    expect(screen.getByText('Renamed Project')).toBeInTheDocument();
    expect(screen.queryByText('Work')).not.toBeInTheDocument();
  });
});
