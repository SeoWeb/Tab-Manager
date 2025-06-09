import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import CollectionsList from './CollectionsList';
import { Project, Collection as CollectionType } from '@/types'; // Path to types

jest.mock('../../store/store'); // Mock the store

describe('CollectionsList Component', () => {
  const baseTime = new Date();
  const mockCollections: CollectionType[] = [
    {
      id: 'col1',
      name: 'First Collection',
      links: [],
      createdAt: baseTime,
      updatedAt: baseTime,
    },
    {
      id: 'col2',
      name: 'Second Collection',
      links: [],
      createdAt: baseTime,
      updatedAt: baseTime,
    },
  ];

  const mockProject: Project = {
    id: 'proj1',
    name: 'Test Project',
    collections: mockCollections,
    createdAt: baseTime,
    updatedAt: baseTime,
    // icon and color are optional and not directly used by CollectionsList rendering logic
  };

  // This is the component CollectionsList expects as its prop
  // It doesn't use the store directly for its own props, but its child (Collection) might if we were testing deeper.
  // However, CollectionsList itself *does* use the store to decide *which* project's collections to show.
  // The prompt says `CollectionsList project={activeProject}` is in `MainContentArea.tsx`
  // Let's re-check `src/components/main-content/CollectionsList.tsx`
  // It is: `const CollectionsList: React.FC<{ project: Project }> = ({ project }) => { ... }`
  // So it receives `project` as a prop, it does NOT use `useStore` to get the active project.
  // This simplifies the test significantly as we don't need to mock `useStore` for this component.
  // The parent `MainContentArea` is responsible for using the store and passing the correct project.

  // Corrected understanding: CollectionsList *receives* a project prop.
  // The previous plan to mock useStore for CollectionsList was based on a misunderstanding.

  it('renders collections when a project with collections is provided', () => {
    // The CollectionsList component itself is in `src/components/main-content/CollectionsList.tsx`
    // It takes a `project` prop.
    // The `Collection` component (from `src/components/Collection/Collection.tsx`) is rendered by this list.
    render(<CollectionsList project={mockProject} />);
    expect(screen.getByText('First Collection')).toBeInTheDocument();
    expect(screen.getByText('Second Collection')).toBeInTheDocument();
  });

  it('shows "no collections" message when the project has no collections', () => {
    const projectWithNoCollections: Project = {
      ...mockProject,
      collections: [],
    };
    render(<CollectionsList project={projectWithNoCollections} />);
    // The component's actual message is:
    // <p className='text-gray-500 dark:text-gray-400'>
    //   This project doesn&apos;t have any collections yet.
    // </p>
    expect(
      screen.getByText(/This project doesn't have any collections yet./i)
    ).toBeInTheDocument();
  });

  // No "no active project" test for CollectionsList itself, as it *requires* a project prop.
  // That logic is handled by its parent, MainContentArea.
  // If project prop was optional, or if CollectionsList fetched its own data, then such a test would be here.
});
