import { useEffect, useState } from 'preact/hooks';
import { signal } from '@preact/signals';
import { APP_NAME } from './config';
import { loadSavedSession } from './app/actions';
import { screen } from './app/store';
import { Debug } from './ui/Debug';
import { Progress } from './ui/Progress';
import { Review } from './ui/Review';
import { Upload } from './ui/Upload';

const hash = signal(location.hash);
addEventListener('hashchange', () => (hash.value = location.hash));

export function App() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    void loadSavedSession().finally(() => setReady(true));
  }, []);
  if (hash.value === '#debug') return <Debug />;
  if (!ready) return <div class="p-6 text-neutral-500">{APP_NAME}…</div>;
  return (
    <main class="mx-auto flex h-full max-w-3xl flex-col">
      {screen.value === 'upload' && <Upload />}
      {screen.value === 'progress' && <Progress />}
      {screen.value === 'review' && <Review />}
    </main>
  );
}
