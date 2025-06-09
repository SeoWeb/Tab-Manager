import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import CollectionComponent from './Collection'; // Corrected import name
import { Collection as CollectionType } from '@/types'; // Corrected import name and alias

describe('CollectionComponent', () => {
  it('renders the collection name and links placeholder', () => {
    const mockCollection: CollectionType = {
      id: 'col1',
      name: 'My Test Collection',
      links: [],
      createdAt: new Date(), // Use Date object
      updatedAt: new Date(), // Use Date object
      // Optional fields can be omitted or added as needed for specific tests
      description: 'A test collection',
      order: 0,
      minimized: false,
    };

    render(<CollectionComponent collection={mockCollection} />);

    expect(screen.getByText('My Test Collection')).toBeInTheDocument();
    // Check the placeholder text, which includes the number of links
    expect(screen.getByText('Links will be displayed here. (0 links)')).toBeInTheDocument();
  });

  it('renders the collection name and links count for a collection with links', () => {
    const mockCollectionWithLinks: CollectionType = {
      id: 'col2',
      name: 'Collection With Links',
      links: [
        { id: 'link1', url: 'http://example.com', title: 'Example Link', createdAt: new Date(), order: 0 },
        { id: 'link2', url: 'http://another-example.com', title: 'Another Example', createdAt: new Date(), order: 1 },
      ],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    render(<CollectionComponent collection={mockCollectionWithLinks} />);

    expect(screen.getByText('Collection With Links')).toBeInTheDocument();
    expect(screen.getByText('Links will be displayed here. (2 links)')).toBeInTheDocument();
  });
});
