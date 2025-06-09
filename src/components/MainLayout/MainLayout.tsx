import React from 'react';

interface MainLayoutProps {
  children?: React.ReactNode; // Optional: if we want to wrap children in a specific part
}

const MainLayout: React.FC<MainLayoutProps> = ({ children }) => {
  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-[var(--theme-secondary-bg)]"> {/* Overall background */}
      {/* Left Sidebar */}
      <div className="w-full md:w-64 bg-[var(--theme-accent-bg)] p-4 shrink-0"> {/* Left sidebar background */}
        <h2 className="text-lg font-semibold text-[var(--theme-text-primary)]">Left Sidebar</h2>
        <p className="text-sm text-[var(--theme-text-secondary)]">Projects List</p>
        {/* Placeholder for project items */}
      </div>

      {/* Main Content Area */}
      {/* On small screens, this will be below the left sidebar and above the right. */}
      {/* On medium+ screens, it takes up the flexible middle space. */}
      <div className="w-full md:flex-1 bg-[var(--theme-primary-bg)] p-4 overflow-y-auto">
        {/* The existing h2 and p are placeholders, actual content comes from children */}
        {/* <h2 className="text-lg font-semibold">Main Content</h2> */}
        {/* <p className="text-sm text-gray-600">Collections and Links</p> */}
        {children}
      </div>

      {/* Right Panel */}
      <div className="w-full md:w-60 bg-[var(--theme-accent-bg)] p-4 shrink-0"> {/* Right panel background */}
        <h2 className="text-lg font-semibold text-[var(--theme-text-primary)]">Right Panel</h2>
        <p className="text-sm text-[var(--theme-text-secondary)]">Open Tabs, Bookmarks, Notes</p>
        {/* Placeholder for right panel content */}
      </div>
    </div>
  );
};

export default MainLayout;
