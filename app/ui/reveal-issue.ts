export function revealIssue(selector: string, scope: ParentNode = document) {
  requestAnimationFrame(() => {
    const target = scope.querySelector<HTMLElement>(selector);
    if (!target) return;
    target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
    target.scrollIntoView({
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
      block: 'center',
    });
  });
}
