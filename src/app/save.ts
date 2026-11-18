// Desktop share sheets (macOS/Windows) have no "save to disk"; only use sharing where it saves to Photos/Files.
const isMobile = () =>
  /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ||
  (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

/** How long the download's object URL stays valid. */
const DOWNLOAD_URL_TTL_MS = 10_000;

/** Hand a file to the user: the share sheet on phones/tablets ('auto'), otherwise a download. */
export async function deliverFile(blob: Blob, name: string, mode: 'auto' | 'download'): Promise<void> {
  const file = new File([blob], name, { type: blob.type });
  if (mode === 'auto' && isMobile() && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (err) {
      if ((err as DOMException).name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), DOWNLOAD_URL_TTL_MS);
}
