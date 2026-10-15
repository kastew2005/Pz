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
    const boot = async () => {
      try {
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
    void boot();

    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      navigator.serviceWorker.register('/sw.js').catch((error) => {
        console.warn('[Мёртвый Город] Service Worker недоступен:', error);
      });
    }
    return () => { alive = false; dispose?.(); };
  }, []);

  return <div ref={ref} className="mz-host" />;
}
