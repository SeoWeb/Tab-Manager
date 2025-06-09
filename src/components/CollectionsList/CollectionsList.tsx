import React from 'react';
import { useAppStore } from '@/stores/appStore';
import CollectionComponent from '@/components/Collection';
import { Collection as CollectionType } from '@/types';

const CollectionsList: React.FC = () => {
 const activeProjectId = useAppStore((state) => state.activeProjectId);
 const projects = useAppStore((state) => state.projects);

 const activeProject = projects.find(p => p.id === activeProjectId);

 if (!activeProject) {
 return <p className="text-center text-gray-500 py-4">Select a project to see collections.</p>;
 }

 const collections = activeProject.collections;

 if (!collections || collections.length ===0) {
 return <p className="text-center text-gray-500 py-4">No collections in this project.</p>;
 }

 return (
 <div className="space-y-4 p-4">
 {collections.map((collection: CollectionType) => (
 <CollectionComponent key={collection.id} collection={collection} />
 ))}
 </div>
 );
};

export default CollectionsList;
