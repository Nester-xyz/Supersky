/**
 * Normalize user input into a login identifier: strips a leading "@" and
 * expands bare names ("alice") to the default handle ("alice.bsky.social").
 * Full handles, emails, and DIDs pass through untouched.
 */
export function normalizeIdentifier(raw: string): string {
  const id = raw.trim().replace(/^@+/, '');
  if (!id || id.includes('@') || id.includes('.') || id.startsWith('did:')) return id;
  return `${id}.bsky.social`;
}
