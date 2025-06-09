'use client';

import type { Link } from '@/types';
import { useAppStore } from '@/stores/appStore';
import { Button } from '@/components/ui/button';
import { Trash2, ExternalLink } from 'lucide-react';
import Image from 'next/image';
import { getFaviconUrl } from '@/lib/utils';

interface LinkItemProps {
  link: Link;
  projectId: string;
  collectionId: string;
}

export default function LinkItem({
  link,
  projectId,
  collectionId,
}: LinkItemProps) {
  const deleteLink = useAppStore((state) => state.deleteLink);
  const faviconUrl = getFaviconUrl(link.url);

  return (
    <div className='flex items-center gap-3 p-3 bg-background hover:bg-secondary/50 rounded-lg border border-input transition-colors duration-150 shadow-sm w-80'>
      {/* <Button variant="ghost" size="icon" className="cursor-grab h-7 w-7">
        <GripVertical className="h-4 w-4 text-muted-foreground" />
      </Button> */}
      <Image
        src={faviconUrl}
        alt='favicon'
        width={20}
        height={20}
        className='rounded shrink-0'
        onError={(e) =>
          (e.currentTarget.src = 'https://placehold.co/20x20.png')
        } // Fallback placeholder
        unoptimized // For external URLs if not configured in next.config.js
      />
      <div className='flex-1 min-w-0'>
        <a
          href={link.url}
          target='_blank'
          rel='noopener noreferrer'
          className='text-sm font-medium text-primary hover:underline truncate block'
          title={link.url}
        >
          {link.title || link.url}
        </a>
        {link.title && (
          <p className='text-xs text-muted-foreground truncate'>{link.url}</p>
        )}
      </div>
      <div className='flex items-center gap-1 shrink-0'>
        <Button
          variant='ghost'
          size='icon'
          className='h-7 w-7'
          asChild
          aria-label='Open link in new tab'
        >
          <a href={link.url} target='_blank' rel='noopener noreferrer'>
            <ExternalLink className='h-4 w-4 text-muted-foreground hover:text-primary' />
          </a>
        </Button>
        {/* <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Edit link">
          <Edit3 className="h-4 w-4 text-muted-foreground" />
        </Button> */}
        <Button
          variant='ghost'
          size='icon'
          className='h-7 w-7'
          onClick={() => deleteLink(projectId, collectionId, link.id)}
          aria-label='Delete link'
        >
          <Trash2 className='h-4 w-4 text-destructive' />
        </Button>
      </div>
    </div>
  );
}
