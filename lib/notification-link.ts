export function notificationTarget(eventId: unknown, restaurantId: unknown): string | null {
  if (typeof eventId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(eventId)) return null;
  if (typeof restaurantId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(restaurantId)) return null;
  return `/r/${restaurantId}/?notification=${encodeURIComponent(eventId)}&restaurant=${restaurantId}`;
}
export function preserveNotification(ownerUrl: string, remembered: boolean): string {
  const target = new URL(ownerUrl, location.origin);
  if (target.origin !== location.origin) throw Error('Dirección de acceso inválida.');
  const query = new URLSearchParams(location.search);
  if (notificationTarget(query.get('notification'), query.get('restaurant'))) {
    target.searchParams.set('notification', query.get('notification')!);
    target.searchParams.set('restaurant', query.get('restaurant')!);
  }
  if (remembered) target.searchParams.set('remembered', '1');
  return target.pathname + target.search;
}
