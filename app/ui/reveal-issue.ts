export function revealIssue(selector: string, scope: ParentNode = document) {
  requestAnimationFrame(() => {
    const target = scope.querySelector<HTMLElement>(selector);
    if (!target) return;
    if (!target.matches('input, textarea, select, button, a[href], [tabindex]')) target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
    target.scrollIntoView({
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
      block: 'center',
    });
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches && typeof target.animate === 'function') {
      target.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(-3px)' }, { transform: 'translateX(0)' }], { duration: 280, iterations: 1 });
    }
  });
}
