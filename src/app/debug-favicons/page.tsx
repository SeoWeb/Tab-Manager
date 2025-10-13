'use client';

import { useEffect, useState } from 'react';
import { useAppStore } from '@/stores/appStore';
import type { Link } from '@/types';
import { convertChromeFaviconUrl } from '@/lib/faviconService';

export default function DebugFaviconsPage() {
  const { projects } = useAppStore((state) => ({
    projects: state.projects,
  }));

  const [sampleLinks, setSampleLinks] = useState<Link[]>([]);

  useEffect(() => {
    // Get a sample of links from the first project and collection
    if (
      projects.length > 0 &&
      projects[0].collections &&
      projects[0].collections.length > 0
    ) {
      const firstCollection = projects[0].collections[0];
      if (firstCollection.links && firstCollection.links.length > 0) {
        // Get first 5 links
        setSampleLinks(firstCollection.links.slice(0, 5));
      }
    }
  }, [projects]);

  return (
    <div className='container mx-auto p-6'>
      <h1 className='text-2xl font-bold mb-6'>Favicon Debug Information</h1>

      <div className='mb-8'>
        <h2 className='text-xl font-semibold mb-4'>Projects Summary</h2>
        <div className='bg-gray-100 p-4 rounded'>
          <p>Total Projects: {projects.length}</p>
          <p>
            Total Collections:{' '}
            {projects.reduce((sum, p) => sum + (p.collections?.length || 0), 0)}
          </p>
          <p>
            Total Links:{' '}
            {projects.reduce(
              (sum, p) =>
                sum +
                (p.collections?.reduce(
                  (colSum, c) => colSum + (c.links?.length || 0),
                  0
                ) || 0),
              0
            )}
          </p>
        </div>
      </div>

      <div className='mb-8'>
        <h2 className='text-xl font-semibold mb-4'>Sample Links</h2>
        {sampleLinks.length === 0 ? (
          <p>No links found to display.</p>
        ) : (
          <div className='space-y-4'>
            {sampleLinks.map((link) => (
              <div key={link.id} className='border p-4 rounded'>
                <h3 className='font-semibold mb-2'>{link.title || link.url}</h3>
                <p>
                  <strong>URL:</strong> {link.url}
                </p>
                <p>
                  <strong>Favicon URL:</strong> {link.favIconUrl || 'Not set'}
                </p>
                {link.favIconUrl && (
                  <div className='mt-2'>
                    <strong>Favicon Preview:</strong>
                    <div className='flex items-center gap-2 mt-1'>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={convertChromeFaviconUrl(link.favIconUrl)}
                        alt='favicon'
                        width={32}
                        height={32}
                        className='border rounded'
                        onError={(e) => {
                          console.error(
                            'Failed to load favicon:',
                            link.favIconUrl
                          );
                          e.currentTarget.src =
                            'https://placehold.co/32x32.png';
                        }}
                      />
                      <span className='text-sm text-gray-600'>
                        {link.favIconUrl}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className='mb-8'>
        <h2 className='text-xl font-semibold mb-4'>Migration Status</h2>
        <div className='bg-blue-50 p-4 rounded'>
          <p className='mb-2'>
            Check the browser console for migration status.
          </p>
          <button
            onClick={() => {
              if (
                typeof chrome !== 'undefined' &&
                chrome.storage &&
                chrome.storage.local
              ) {
                chrome.storage.local.get(
                  ['favicon-migration-complete'],
                  (result) => {
                    console.log(
                      'Migration complete:',
                      result['favicon-migration-complete']
                    );
                  }
                );
              }
            }}
            className='bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600'
          >
            Check Migration Status
          </button>
        </div>
      </div>
    </div>
  );
}
