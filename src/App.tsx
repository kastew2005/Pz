import { useEffect, useRef } from 'react';

export default function App() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let dispose: (() => void) | undefined;
    let alive = true;
    // @ts-ignore — игровое ядро написано на чистом JS-модулях
    import('./game/game.js').then((m: any) => {
      if (!alive || !ref.current) return;
      dispose = m.createGame(ref.current);
    });
    // PWA service worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
    return () => { alive = false; dispose?.(); };
  }, []);

  return <div ref={ref} className="mz-host" />;
}
