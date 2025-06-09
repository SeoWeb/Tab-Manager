import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import Collection from './Collection';
import { Collection as CollectionType } from '../../types';

describe('Collection Component', () => {
  it('renders the collection name and link count placeholder', () => {
    const mockCollectionData: CollectionType = {
      id: 'test-col-1',
      name: 'My Test Collection',
      links: [],
      // Add other required fields from CollectionType if necessary
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    render(<Collection collection={mockCollectionData} />);

    expect(screen.getByText('My Test Collection')).toBeInTheDocument();
    expect(screen.getByText('Links will be displayed here. (0 links)')).toBeInTheDocument();
  });

  it('renders the collection name and correct link count', () => {
    const mockCollectionData: CollectionType = {
      id: 'test-col-2',
      name: 'Another Collection',
      links: [
        { id: 'link1', url: 'http://example.com', createdAt: new Date() },
        { id: 'link2', url: 'http://example.org', createdAt: new Date() },
      ],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    render(<Collection collection={mockCollectionData} />);

    expect(screen.getByText('Another Collection')).toBeInTheDocument();
    expect(screen.getByText('Links will be displayed here. (2 links)')).toBeInTheDocument();
  });
});
