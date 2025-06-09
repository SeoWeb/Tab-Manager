import React from 'react';
import { Collection as CollectionType } from '../../types'; // Adjusted import path

interface CollectionProps {
  collection: CollectionType;
}

const Collection: React.FC<CollectionProps> = ({ collection }) => {
  return (
    <div className="bg-white shadow-md rounded-lg p-4 mb-4">
      <div className="font-bold text-lg mb-2">{collection.name}</div>
      <div className="text-gray-700">
        {/* Placeholder for links or other content */}
        <p>Links will be displayed here. ({collection.links.length} links)</p>
      </div>
    </div>
  );
};

export default Collection;
