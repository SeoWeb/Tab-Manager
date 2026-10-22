import { isUrlInCollection } from '../urlInCollection';

describe('isUrlInCollection', () => {
  const collection = {
    links: [{ url: 'https://example.com/a' }, { url: 'https://example.com/b' }],
  };

  it('returns true when the URL exists in the collection', () => {
    expect(isUrlInCollection(collection, 'https://example.com/a')).toBe(true);
  });

  it('returns false when the URL is absent', () => {
    expect(isUrlInCollection(collection, 'https://example.com/c')).toBe(false);
  });

  it('matches exact URLs only (no substring matches)', () => {
    expect(isUrlInCollection(collection, 'https://example.com/ab')).toBe(false);
    expect(isUrlInCollection(collection, 'https://example.com/a?utm=x')).toBe(
      false
    );
  });

  it('treats a missing collection as "not present"', () => {
    expect(isUrlInCollection(undefined, 'https://example.com/a')).toBe(false);
    expect(isUrlInCollection(null, 'https://example.com/a')).toBe(false);
  });

  it('treats a collection without links as "not present"', () => {
    expect(isUrlInCollection({}, 'https://example.com/a')).toBe(false);
    expect(isUrlInCollection({ links: [] }, 'https://example.com/a')).toBe(
      false
    );
  });

  it('handles an undefined URL without throwing', () => {
    expect(isUrlInCollection(collection, undefined)).toBe(false);
  });
});
