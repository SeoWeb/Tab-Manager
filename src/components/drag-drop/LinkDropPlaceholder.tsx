import React from 'react';

interface LinkDropPlaceholderProps {
  isVisible: boolean;
}

export function LinkDropPlaceholder({ isVisible }: LinkDropPlaceholderProps) {
  if (!isVisible) return null;

  return (
    <div className='w-64 h-10 bg-blue-200 border-2 border-dashed border-blue-400 rounded-lg transition-all duration-200' />
  );
}
