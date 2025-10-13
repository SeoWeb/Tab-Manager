import { useState, useEffect } from 'react';
import { getFaviconUrl } from '@/lib/faviconService';

export function useFavicon(url: string) {
  const [favicon, setFavicon] = useState<string>('');
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
        const faviconUrl = await getFaviconUrl(url);
        setFavicon(faviconUrl);
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
