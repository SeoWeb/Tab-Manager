import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import CollectionsList from './CollectionsList'; // Path to the component being tested
import { Project, Collection as CollectionType, Link } from '@/types'; // Adjusted import for Collection type

// No need to mock useAppStore for this component as it receives props directly

describe('CollectionsList (main-content)', () => {
  const mockLinks: Link[] = [
    { id: 'link1', url: 'http://link1.com', title: 'Link 1', createdAt: new Date(), order: 0 },
  ];

  const mockCollections: CollectionType[] = [
    { id: 'col1', name: 'Collection Alpha', links: mockLinks, createdAt: new Date(), updatedAt: new Date(), order: 0 },
    { id: 'col2', name: 'Collection Beta', links: [], createdAt: new Date(), updatedAt: new Date(), order: 1 },
  ];

  const mockProject: Project = {
    id: 'proj1',
    name: 'Test Project',
    collections: mockCollections,
    icon: '🚀',
    color: '#FFFFFF',
    createdAt: new Date(),
    updatedAt: new Date(),
    description: 'A test project',
    // bookmarkFolderId is optional
  };

  it('renders a list of collections when a project has collections', () => {
    render(<CollectionsList project={mockProject} />);

    // Check if collection names are rendered (via CollectionComponent)
    expect(screen.getByText('Collection Alpha')).toBeInTheDocument();
    expect(screen.getByText('Collection Beta')).toBeInTheDocument();

    // Check if link placeholders from CollectionComponent are rendered
    // For "Collection Alpha" which has 1 link
    expect(screen.getByText('Links will be displayed here. (1 links)')).toBeInTheDocument();
    // For "Collection Beta" which has 0 links
    expect(screen.getByText('Links will be displayed here. (0 links)')).toBeInTheDocument();
  });

  it('renders "This project has no collections yet." when the project has no collections', () => {
    const projectWithNoCollections: Project = { ...mockProject, collections: [] };

    render(<CollectionsList project={projectWithNoCollections} />);

    expect(screen.getByText('This project has no collections yet.')).toBeInTheDocument();
  });

  // The case for "no active project" is handled by MainContentArea, which would not render CollectionsList.
  // Therefore, a specific test for that case is not applicable here as CollectionsList expects a valid project prop.
});
