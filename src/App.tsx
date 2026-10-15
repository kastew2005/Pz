import { useEffect, useRef } from 'react';

function showBootError(error: unknown, retry: () => void) {
  const screen = document.getElementById('boot-screen');
  if (!screen) return;
  screen.style.display = 'flex';
  screen.innerHTML = '';
  const panel = document.createElement('div');
  panel.className = 'boot-panel';
  const title = document.createElement('h1');
  title.textContent = 'НЕ УДАЛОСЬ ЗАПУСТИТЬ ИГРУ';
  const message = document.createElement('p');
  message.textContent = error instanceof Error ? error.message : String(error || 'Неизвестная ошибка');
  const button = document.createElement('button');
  button.textContent = 'ПОВТОРИТЬ ЗАПУСК';
  button.addEventListener('click', retry);
  panel.append(title, message, button);
  screen.appendChild(panel);
}

export default function App() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let dispose: (() => void) | undefined;
    let alive = true;
    const setBootMessage = (message: string) => {
      const screen = document.getElementById('boot-screen');
      const p = screen?.querySelector('p');
      if (p) p.textContent = message;
    };
    const boot = async () => {
      try {
        setBootMessage('Загрузка модулей…');
        // Let the browser paint the loading screen before generating the world.
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        if (!alive) return;
        setBootMessage('Подготовка игрового мира…');
        const module = await import('./game/game.js');
        if (!alive || !ref.current) return;
        dispose = module.createGame(ref.current);
        const screen = document.getElementById('boot-screen');
        if (screen) screen.style.display = 'none';
      } catch (error) {
        console.error('[Мёртвый Город] Ошибка запуска:', error);
        showBootError(error, () => window.location.reload());
      }
    };
    const onWindowError = (event: ErrorEvent) => {
      console.error('[Мёртвый Город] Ошибка JavaScript:', event.error || event.message);
      showBootError(event.error || event.message, () => window.location.reload());
    };
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      console.error('[Мёртвый Город] Необработанная ошибка:', event.reason);
      showBootError(event.reason, () => window.location.reload());
    };
    window.addEventListener('error', onWindowError);
    window.addEventListener('unhandledrejection', onUnhandledRejection);
    void boot();

    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      // Relative registration also works when hosted under a repository subpath.
      const swUrl = new URL('sw.js', document.baseURI);
      navigator.serviceWorker.register(swUrl.href, { updateViaCache: 'none' }).then((registration) => {
        void registration.update().catch(() => {});
      }).catch((error) => {
        console.warn('[Мёртвый Город] Service Worker недоступен:', error);
      });
    }
    return () => {
      alive = false;
      window.removeEventListener('error', onWindowError);
      window.removeEventListener('unhandledrejection', onUnhandledRejection);
      dispose?.();
    };
  }, []);

  return <div ref={ref} className="mz-host" />;
}
