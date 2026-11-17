import { useEffect, useState } from 'preact/hooks';
import { get } from 'idb-keyval';

const urls = new Map<string, string>();

/** Object URL for a blob stored in IndexedDB (cached per key). */
export function useStored(key: string): string | null {
  const [url, setUrl] = useState<string | null>(urls.get(key) ?? null);
  useEffect(() => {
    let live = true;
    if (urls.has(key)) {
      setUrl(urls.get(key)!);
      return;
    }
    void get<Blob>(key).then((b) => {
      if (!b) return;
      const u = URL.createObjectURL(b);
      urls.set(key, u);
      if (live) setUrl(u);
    });
    return () => { live = false; };
  }, [key]);
  return url;
}

export function clearStoredUrls() {
  for (const u of urls.values()) URL.revokeObjectURL(u);
  urls.clear();
}
