'use client';

import { useMemo } from 'react';
import type { Link } from '@/types';
import { useAppStore } from '@/stores/appStore';
import { useShallow } from 'zustand/react/shallow';

interface FaviconDebugInfoProps {
  link: Link;
}

export default function FaviconDebugInfo({ link }: FaviconDebugInfoProps) {
  const { projects } = useAppStore(
    useShallow((state) => ({
      projects: state.projects,
    }))
  );

  // Build a map of all links across all projects and collections
  // to avoid O(N) searching for each link on every render.
  const linkMap = useMemo(() => {
    const map = new Map<string, Link>();
    for (const project of projects) {
      for (const collection of project.collections || []) {
        if (!collection.links) continue;
        for (const l of collection.links) {
          map.set(l.id, l);
        }
      }
    }
    return map;
  }, [projects]);

  // Find the link in the store to compare
  const storedLink: Link | null = linkMap.get(link.id) || null;

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
