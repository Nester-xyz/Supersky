import type { AtpAgent } from '@atproto/api';
import type { ActorSuggestion } from '../types';

/** Upper bound the composer's mention menu asks for. */
const DEFAULT_LIMIT = 8;

/**
 * Prefix-search accounts for the composer's @-mention menu. Personalized by the
 * signed-in account's social graph, so people you follow surface first.
 */
export async function searchActorsTypeahead(
  agent: AtpAgent,
  query: string,
  limit = DEFAULT_LIMIT,
): Promise<ActorSuggestion[]> {
  const term = query.trim();
  if (!term) return [];
  const response = await agent.app.bsky.actor.searchActorsTypeahead({
    q: term,
    limit: Math.min(Math.max(limit, 1), 20),
  });
  return response.data.actors.map((actor) => ({
    did: actor.did,
    handle: actor.handle,
    displayName: actor.displayName || undefined,
    avatar: actor.avatar || undefined,
  }));
}
