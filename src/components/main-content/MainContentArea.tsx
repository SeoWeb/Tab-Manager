import React from 'react';
import { useAppStore } from '@/stores/appStore';
import ProjectHeader from './ProjectHeader';
import CollectionsList from './CollectionsList';
// import AddCollectionButton from './AddCollectionButton'; // For later use

const MainContentArea: React.FC = () => {
  const { activeProjectId, projects } = useAppStore((state) => ({
    activeProjectId: state.activeProjectId,
    projects: state.projects,
  }));

  const activeProject = projects.find((p) => p.id === activeProjectId);

  if (!activeProject) {
    return (
      <div className='flex-1 p-6 flex flex-col items-center justify-center text-gray-500 dark:text-gray-400'>
        <h2 className='text-2xl font-semibold'>No Project Selected</h2>
        <p>Please select a project from the sidebar to view its content.</p>
        {projects.length === 0 && (
          <p className='mt-4'>
            You don&apos;t have any projects yet. Click &quot;Add Project&quot;
            to get started!
          </p>
        )}
      </div>
    );
  }

  return (
    <div className='flex-1 p-6 flex flex-col bg-white dark:bg-gray-900'>
      <ProjectHeader project={activeProject} />
      <div className='mt-6'>
        <div className='flex justify-between items-center mb-4'>
          <h2 className='text-xl font-semibold text-gray-700 dark:text-gray-200'>
            Collections
          </h2>
          {/* <AddCollectionButton projectId={activeProject.id} /> */}{' '}
          {/* For later use */}
        </div>
        <CollectionsList project={activeProject} />
      </div>
    </div>
  );
};

export default MainContentArea;
