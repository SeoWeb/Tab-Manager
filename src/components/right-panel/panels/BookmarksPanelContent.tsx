'use client';

import { useEffect, useState } from 'react';
import { bookmarkService } from '@/lib/bookmarkService';
import { Bookmark, Folder, ChevronRight, ChevronDown } from 'lucide-react';
import { extractFavicon } from '@/lib/faviconService';
import Image from 'next/image';

interface FaviconProps {
  url: string;
}

const Favicon: React.FC<FaviconProps> = ({ url }) => {
  const [faviconUrl, setFaviconUrl] = useState('/default-favicon.png');

  useEffect(() => {
    const fetchFavicon = async () => {
      const iconUrl = await extractFavicon(url);
      setFaviconUrl(iconUrl);
    };

    fetchFavicon();
  }, [url]);

  return (
    <Image
      src={faviconUrl}
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
  const [isOpen, setIsOpen] = useState(level === 0);
  const [isEditing, setIsEditing] = useState(false);
  const [title, setTitle] = useState(node.title);

  const handleSave = async () => {
    await bookmarkService.updateBookmark(node.id, { title });
    setIsEditing(false);
  };

  if (node.url) {
    // It's a bookmark
    return (
      <div
        className='flex items-center gap-2 p-1.5 hover:bg-secondary/50 rounded-md text-xs'
        style={{ paddingLeft: `${level * 1.5 + 0.5}rem` }}
      >
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
            className='truncate'
          >
            {node.title}
          </a>
        )}
        {isEditing ? (
          <button onClick={handleSave}>Save</button>
        ) : (
          <button onClick={() => setIsEditing(true)}>Edit</button>
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
      >
        <div
          onClick={() => setIsOpen(!isOpen)}
          className='flex items-center gap-2'
        >
          {isOpen ? (
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
            className='flex-grow bg-transparent'
          />
        ) : (
          <span className='font-semibold' onClick={() => setIsOpen(!isOpen)}>
            {node.title}
          </span>
        )}
        {isEditing ? (
          <button onClick={handleSave}>Save</button>
        ) : (
          <button onClick={() => setIsEditing(true)}>Edit</button>
        )}
      </div>
      {isOpen && node.children && (
        <div>
          {node.children.map((child) => (
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
