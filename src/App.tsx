import { useEffect, useRef } from 'react';

function showBootError(error: unknown, retry: () => void) {
  const screen = document.getElementById('boot-screen');
  if (!screen) return;
  screen.style.display = 'flex';
  const p = screen.querySelector('p');
  if (p) p.textContent = 'Не удалось запустить игру. Подробности доступны в консоли диагностики ниже.';
  const logger = (window as Window & { __bootLog?: (...args: unknown[]) => void }).__bootLog;
  logger?.('error', 'Ошибка запуска приложения:', error);
  let button = document.getElementById('boot-retry') as HTMLButtonElement | null;
  if (!button) {
    button = document.createElement('button');
    button.id = 'boot-retry';
    button.textContent = 'ПОВТОРИТЬ ЗАПУСК';
    button.addEventListener('click', retry);
    const panel = screen.querySelector('.boot-panel');
    panel?.appendChild(button);
  }
}
export default function App() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let dispose: (() => void) | undefined;
    let alive = true;
    const logger = (window as Window & { __bootLog?: (...args: unknown[]) => void }).__bootLog;
    logger?.('info', 'React-компонент App смонтирован.');
    const setBootMessage = (message: string) => {
      logger?.('info', message);
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
        logger?.('info', 'Импорт игрового модуля: ./game/game.js');
        const module = await import('./game/game.js');
        logger?.('info', 'Игровой модуль загружен. Инициализация Canvas и мира…');
        if (!alive || !ref.current) return;
        dispose = module.createGame(ref.current);
        logger?.('info', 'createGame завершился без синхронной ошибки.');
        const screen = document.getElementById('boot-screen');
        if (screen) screen.style.display = 'none';
        (window as Window & { __bootDone?: () => void }).__bootDone?.();
      } catch (error) {
        logger?.('error', 'Ошибка в процессе boot():', error);
        console.error('[Мёртвый Город] Ошибка запуска:', error);
        showBootError(error, () => window.location.reload());
      }
    };
    const onWindowError = (event: ErrorEvent) => {
      logger?.('error', 'Ошибка JavaScript:', event.error || event.message, event.filename || '', event.lineno || '', event.colno || '');
      console.error('[Мёртвый Город] Ошибка JavaScript:', event.error || event.message);
      showBootError(event.error || event.message, () => window.location.reload());
    };
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      logger?.('error', 'Необработанная ошибка Promise:', event.reason);
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
        logger?.('warn', 'Service Worker недоступен:', error);
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
