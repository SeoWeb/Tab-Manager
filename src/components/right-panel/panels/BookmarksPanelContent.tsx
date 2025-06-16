'use client';

import { useEffect, useState } from 'react';
import { bookmarkService } from '@/lib/bookmarkService';
import {
  Bookmark,
  Folder,
  ChevronRight,
  ChevronDown,
  GripVertical,
} from 'lucide-react';
import Image from 'next/image';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { useAppStore } from '@/stores/appStore';
import { useFavicon } from '@/hooks/useFavicon';

interface FaviconProps {
  url: string;
}

const Favicon: React.FC<FaviconProps> = ({ url }) => {
  const { favicon } = useFavicon(url);

  return (
    <Image
      src={favicon}
      alt='favicon'
      width={16}
      height={16}
      className='rounded shrink-0'
    />
  );
};

interface BookmarkNodeProps {
  node: chrome.bookmarks.BookmarkTreeNode;
  level: number;
}

const BookmarkNode: React.FC<BookmarkNodeProps> = ({ node, level }) => {
  const { favicon } = useFavicon(node?.url || '');
  const [isOpen, setIsOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [title, setTitle] = useState(node.title);
  const [children, setChildren] = useState<chrome.bookmarks.BookmarkTreeNode[]>(
    node.children || []
  );
  const [isLoading, setIsLoading] = useState(false);
  const activeProjectId = useAppStore((state) => state.activeProjectId);

  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: `bookmark-${node.id}`,
      data: {
        type: 'bookmark',
        bookmark: {
          id: node.id,
          title: node.title,
          url: node.url || '',
          favIconUrl: favicon,
        },
        projectId: activeProjectId,
      },
      disabled: !node.url || !activeProjectId, // Only enable for bookmarks (not folders) and when a project is active
    });

  const style = {
    transform: CSS.Translate.toString(transform),
  };

  const handleSave = async () => {
    await bookmarkService.updateBookmark(node.id, { title });
    setIsEditing(false);
  };

  const handleToggleOpen = async () => {
    if (!isOpen && !node.url && children.length === 0) {
      // If opening a folder and we haven't loaded children yet, fetch them
      setIsLoading(true);
      try {
        const folderChildren = await bookmarkService.getChildren(node.id);
        setChildren(folderChildren);
      } catch (error) {
        console.error('Error loading folder children:', error);
      } finally {
        setIsLoading(false);
      }
    }
    setIsOpen(!isOpen);
  };

  if (node.url) {
    // It's a bookmark
    return (
      <div
        ref={setNodeRef}
        className={`flex items-center gap-2 p-1.5 hover:bg-secondary/50 rounded-md text-xs group cursor-pointer ${
          isDragging ? 'opacity-50' : ''
        }`}
        style={{
          paddingLeft: `${level * 1.5 + 0.5}rem`,
          ...style,
        }}
      >
        {/* Drag handle - only show when project is active */}
        {activeProjectId && (
          <div
            {...listeners}
            {...attributes}
            className='cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity'
            title='Drag to collection'
          >
            <GripVertical className='h-3 w-3 text-muted-foreground' />
          </div>
        )}

        <Favicon url={node.url} />
        {isEditing ? (
          <input
            type='text'
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className='flex-grow bg-transparent'
          />
        ) : (
          <a
            href={node.url}
            target='_blank'
            rel='noopener noreferrer'
            className='truncate flex-grow'
            onClick={(e) => {
              // Don't navigate if dragging
              if (isDragging) {
                e.preventDefault();
              }
            }}
          >
            {node.title}
          </a>
        )}
        {isEditing ? (
          <button
            onClick={handleSave}
            className='text-xs px-2 py-1 bg-primary text-primary-foreground rounded'
          >
            Save
          </button>
        ) : (
          <button
            onClick={() => setIsEditing(true)}
            className='text-xs px-2 py-1 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-secondary rounded'
          >
            Edit
          </button>
        )}
      </div>
    );
  }

  // It's a folder
  return (
    <div>
      <div
        className='flex items-center gap-2 p-1.5 hover:bg-secondary/50 rounded-md text-xs cursor-pointer'
        style={{ paddingLeft: `${level * 1.5 + 0.5}rem` }}
        onClick={handleToggleOpen}
      >
        <div className='flex items-center gap-2'>
          {isLoading ? (
            <div className='h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent' />
          ) : isOpen ? (
            <ChevronDown className='h-4 w-4' />
          ) : (
            <ChevronRight className='h-4 w-4' />
          )}
          <Folder className='h-4 w-4 text-primary' />
        </div>
        {isEditing ? (
          <input
            type='text'
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            className='flex-grow bg-transparent'
          />
        ) : (
          <span className='font-semibold'>{node.title}</span>
        )}
        {isEditing ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleSave();
            }}
          >
            Save
          </button>
        ) : (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setIsEditing(true);
            }}
          >
            Edit
          </button>
        )}
      </div>
      {isOpen && children.length > 0 && (
        <div>
          {children.map((child) => (
            <BookmarkNode key={child.id} node={child} level={level + 1} />
          ))}
        </div>
      )}
    </div>
  );
};

export default function BookmarksPanelContent() {
  const [bookmarks, setBookmarks] = useState<
    chrome.bookmarks.BookmarkTreeNode[]
  >([]);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    const fetchBookmarks = async () => {
      if (searchQuery) {
        const searchResults =
          await bookmarkService.searchBookmarks(searchQuery);
        setBookmarks(searchResults);
      } else {
        // '1' is typically the Bookmarks Bar
        const topLevelBookmarks = await bookmarkService.getChildren('1');
        setBookmarks(topLevelBookmarks);
      }
    };

    fetchBookmarks();
  }, [searchQuery]);

  return (
    <div className='space-y-4'>
      <h3 className='text-lg font-semibold text-foreground flex items-center'>
        <Bookmark className='mr-2 h-5 w-5 text-primary' />
        Chrome Bookmarks
      </h3>
      <input
        type='text'
        placeholder='Search bookmarks...'
        className='w-full p-2 border rounded-md bg-background'
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
      />
      <div className='space-y-1'>
        {bookmarks.map((bookmark) => (
          <BookmarkNode key={bookmark.id} node={bookmark} level={0} />
        ))}
      </div>
    </div>
  );
}
