'use client';

// src/components/sync/RelinkBookmarkFolder.tsx

import React, { useEffect, useState } from 'react';
import { Link2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAppStore } from '@/stores/appStore';
import { bookmarkService } from '@/lib/bookmarkService';
import { useToast } from '@/hooks/use-toast';

interface RelinkBookmarkFolderProps {
  /** Whether the entity being re-linked is a project or a collection. */
  kind: 'project' | 'collection';
  /** Id of the entity to re-link (project id, or collection id). */
  entityId: string;
  /** Required when `kind` is `'collection'`. */
  projectId?: string;
  /** Called after the mirror mapping has been restored. */
  onRelinked?: () => void;
}

/**
 * Re-link flow for entities whose bookmark mirror was removed (the mirrored
 * folder vanished in Chrome; see `mirrorRemoved` on Project/Collection).
 *
 * Lists only unreferenced folders under the managed root — folders already
 * mirrored by another entity are excluded so two entities can never share a
 * folder id. Selecting a folder restores the mapping by stored id (never by
 * name) and clears the mirror-removed markers.
 */
export function RelinkBookmarkFolder({
  kind,
  entityId,
  projectId,
  onRelinked,
}: RelinkBookmarkFolderProps) {
  const rootFolderId = useAppStore((state) => state.tabManagerRootFolderId);
  const projects = useAppStore((state) => state.projects);
  const [candidates, setCandidates] = useState<
    chrome.bookmarks.BookmarkTreeNode[]
  >([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string>('');
  const { toast } = useToast();

  // Folders already referenced by some entity must not be adoptable.
  const referencedFolderIds = new Set<string>();
  for (const project of projects) {
    if (project.bookmarkFolderId)
      referencedFolderIds.add(project.bookmarkFolderId);
    for (const collection of project.collections) {
      if (collection.bookmarkFolderId)
        referencedFolderIds.add(collection.bookmarkFolderId);
    }
  }

  useEffect(() => {
    let cancelled = false;
    const loadCandidates = async () => {
      if (!rootFolderId) return;
      try {
        const children = await bookmarkService.getChildren(rootFolderId);
        if (cancelled) return;
        setCandidates(children.filter((node) => !node.url));
      } catch (error) {
        console.error('Failed to load bookmark folders for re-link:', error);
      }
    };
    void loadCandidates();
    return () => {
      cancelled = true;
    };
  }, [rootFolderId]);

  const availableFolders = candidates.filter(
    (folder) => !referencedFolderIds.has(folder.id)
  );

  useEffect(() => {
    // Keep the selection valid when the candidate list changes.
    if (!availableFolders.some((f) => f.id === selectedFolderId)) {
      setSelectedFolderId(availableFolders[0]?.id ?? '');
    }
  }, [candidates.length, referencedFolderIds.size]);

  const handleRelink = () => {
    if (!selectedFolderId) return;

    const store = useAppStore.getState();
    if (kind === 'project') {
      store.updateProject(entityId, {
        bookmarkFolderId: selectedFolderId,
        mirrorRemoved: false,
        mirrorRemovedFolderId: null,
      });
    } else if (projectId) {
      store.updateCollection(projectId, entityId, {
        bookmarkFolderId: selectedFolderId,
        mirrorRemoved: false,
        mirrorRemovedFolderId: null,
      });
    } else {
      return;
    }

    toast({
      title: 'Bookmark folder re-linked',
      description: 'This item is mirrored to the selected bookmark folder.',
    });
    onRelinked?.();
  };

  if (!rootFolderId) return null;

  return (
    <div className='mt-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3'>
      <p className='text-sm font-medium text-amber-600 dark:text-amber-400'>
        Bookmark mirror removed
      </p>
      <p className='mt-1 text-xs text-muted-foreground'>
        The bookmark folder this {kind} was mirrored to no longer exists in
        Chrome. Your data is safe — pick a folder to mirror it again, or sync
        after re-creating the folder to restore the link automatically.
      </p>
      {availableFolders.length > 0 ? (
        <div className='mt-2 flex items-center gap-2'>
          <select
            value={selectedFolderId}
            onChange={(e) => setSelectedFolderId(e.target.value)}
            className='h-8 flex-1 rounded-md border border-input bg-background px-2 text-xs'
            aria-label='Bookmark folder to mirror'
          >
            {availableFolders.map((folder) => (
              <option key={folder.id} value={folder.id}>
                {folder.title || 'Untitled folder'}
              </option>
            ))}
          </select>
          <Button
            type='button'
            variant='outline'
            size='sm'
            disabled={!selectedFolderId}
            onClick={handleRelink}
          >
            <Link2 className='mr-1 h-4 w-4' />
            Re-link
          </Button>
        </div>
      ) : (
        <p className='mt-2 text-xs text-muted-foreground'>
          No unreferenced bookmark folders available yet. Re-create the folder
          in Chrome and run a bookmark sync to restore the link.
        </p>
      )}
    </div>
  );
}
