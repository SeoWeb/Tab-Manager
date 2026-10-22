/**
 * Shared duplicate-URL guard for drag-and-drop link insertion.
 *
 * Previously inlined (identically) in the tab, quickClip, and bookmark
 * branches of `useDragEnd.ts`; extracted so the "skip if the URL is already
 * in the target collection" rule has one definition.
 */

/** Minimal structural shape of a collection with links. */
interface CollectionLike {
  links?: ReadonlyArray<{ url: string }>;
}

/**
 * True when a link with exactly `url` already exists in `collection`.
 * A missing collection or missing links array counts as "not present"
 * (so the caller proceeds with the insert, matching prior behavior).
 */
export function isUrlInCollection(
  collection: CollectionLike | null | undefined,
  url: string | undefined
): boolean {
  return collection?.links?.some((link) => link.url === url) ?? false;
}
