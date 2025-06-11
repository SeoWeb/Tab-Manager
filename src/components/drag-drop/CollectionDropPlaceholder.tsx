import React from 'react';

interface CollectionDropPlaceholderProps {
  isVisible: boolean;
}

export function CollectionDropPlaceholder({
  isVisible,
}: CollectionDropPlaceholderProps) {
  if (!isVisible) return null;

  return (
    <div className='h-1 mx-2 my-2 relative'>
      <div className='h-full bg-blue-500 rounded-full animate-pulse shadow-lg'>
        <div className='absolute inset-0 bg-gradient-to-r from-blue-400 to-blue-600 rounded-full'></div>
        <div className='absolute -left-1 -right-1 -top-0.5 -bottom-0.5 bg-blue-300 rounded-full opacity-50 animate-ping'></div>
      </div>
    </div>
  );
}
