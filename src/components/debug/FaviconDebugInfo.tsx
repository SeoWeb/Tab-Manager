'use client';

import type { Link } from '@/types';
import { useAppStore } from '@/stores/appStore';

interface FaviconDebugInfoProps {
  link: Link;
}

export default function FaviconDebugInfo({ link }: FaviconDebugInfoProps) {
  const { projects } = useAppStore((state) => ({
    projects: state.projects,
  }));

  // Find the link in the store to compare
  let storedLink: Link | null = null;
  for (const project of projects) {
    for (const collection of project.collections || []) {
      const found = collection.links?.find((l) => l.id === link.id);
      if (found) {
        storedLink = found;
        break;
      }
    }
    if (storedLink) break;
  }

  return (
    <div className='p-2 bg-gray-100 text-xs rounded mb-2'>
      <div>
        <strong>URL:</strong> {link.url}
      </div>
      <div>
        <strong>Prop favIconUrl:</strong> {link.favIconUrl || 'null'}
      </div>
      {storedLink && (
        <div>
          <strong>Store favIconUrl:</strong> {storedLink.favIconUrl || 'null'}
        </div>
      )}
      <div>
        <strong>Link ID:</strong> {link.id}
      </div>
    </div>
  );
}
