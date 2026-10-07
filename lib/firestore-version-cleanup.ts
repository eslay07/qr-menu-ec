import { FirestoreRest, firestoreId } from './firestore-rest';

export async function cleanupCatalogVersions(db: FirestoreRest, restaurantId: string, now = new Date()) {
  const base = `restaurants/${firestoreId(restaurantId)}`;
  const manifests = await db.all<{ status: string; catalogIds?: string[] }>(`${base}/backups`, 1000);
  // A legacy staging backup may still be acquiring a version reference.
  if (manifests.some(row => row.data.status === 'staging')) return 0;
  const retained = new Set(manifests.flatMap(row => row.data.catalogIds || []));
  let removed = 0;
  for (const collection of [`${base}/catalogs`, `publicMenus/${restaurantId}/versions`]) {
    const candidates = await db.all(collection, 10000);
    for (const candidate of candidates) {
      if (Date.parse(candidate.updateTime) > now.getTime() - 30 * 86400000) continue;
      const id = candidate.path.split('/').pop()!;
      const root = await db.get(base);
      const published = await db.get(`publicMenus/${restaurantId}`);
      if (!root || retained.has(id) || [root.data.draftCatalogId, root.data.publishedCatalogId, published?.data.versionId].includes(id)) continue;
      const children = (await Promise.all(['categories', 'dishes', 'promotions'].map(name => db.all(`${candidate.path}/${name}`, 200)))).flat();
      // Pointer preconditions and deletion are one commit. Concurrent save or
      // publication fails safely rather than deleting a newly referenced version.
      await db.commit([
        { path: base, data: {}, mask: [], updateTime: root.updateTime },
        ...(published ? [{ path: published.path, data: {}, mask: [], updateTime: published.updateTime }] : []),
        ...children.map(row => ({ path: row.path, delete: true, updateTime: row.updateTime })),
        { path: candidate.path, delete: true, updateTime: candidate.updateTime },
      ]);
      removed++;
    }
  }
  return removed;
}
