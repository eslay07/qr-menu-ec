import { useEffect, useId, useRef } from 'react';

declare global {
  interface Window {
    turnstile?: {
      render: (
        element: HTMLElement,
        options: {
          sitekey: string;
          callback: (token: string) => void;
          'expired-callback': () => void;
          theme: 'auto';
        },
      ) => string;
      remove: (id: string) => void;
    };
  }
}

export default function Turnstile({
  siteKey,
  onToken,
}: {
  siteKey?: string | null;
  onToken: (token: string) => void;
}) {
  const element = useRef<HTMLDivElement>(null);
  const widget = useRef('');
  const id = useId();
  useEffect(() => {
    if (!siteKey || !element.current) return;
    const render = () => {
      if (!window.turnstile || !element.current || widget.current) return;
      widget.current = window.turnstile.render(element.current, {
        sitekey: siteKey,
        callback: onToken,
        'expired-callback': () => onToken(''),
        theme: 'auto',
      });
    };
    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-qrmenu-turnstile]',
    );
    if (existing) render();
    else {
      const script = document.createElement('script');
      script.src =
        'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.defer = true;
      script.dataset.qrmenuTurnstile = 'true';
      script.addEventListener('load', render, { once: true });
      document.head.appendChild(script);
    }
    return () => {
      if (widget.current && window.turnstile) window.turnstile.remove(widget.current);
      widget.current = '';
    };
  }, [siteKey, onToken]);
  if (!siteKey) return null;
  return <div id={id} ref={element} aria-label="Verificación contra bots" />;
}
