import { useState, useEffect } from 'react';
import { extractFavicon } from '@/lib/faviconService';
import { getCachedFavicon, setCachedFavicon } from '@/lib/cacheService';

export function useFavicon(url: string) {
  const [favicon, setFavicon] = useState<string>(
    'https://placehold.co/20x20.png'
  );
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchFavicon() {
      if (!url) {
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const cachedFavicon = await getCachedFavicon(url);
        if (cachedFavicon) {
          setFavicon(cachedFavicon);
          setLoading(false);
          return;
        }

        const faviconUrl = await extractFavicon(url);
        setFavicon(faviconUrl);
        await setCachedFavicon(url, faviconUrl);
      } catch (err) {
        setError('Failed to fetch favicon');
        console.error(err);
      } finally {
        setLoading(false);
      }
    }

    fetchFavicon();
  }, [url]);

  return { favicon, loading, error };
}
