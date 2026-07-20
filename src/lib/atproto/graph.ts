import type { AtpAgent } from '@atproto/api';
import type { ListSuggestion } from '../types';

/**
 * The account's own curated lists, offered as threadgate "allow replies from"
 * rules. Moderation lists are excluded: gating replies to a mute list makes
 * no sense.
 */
export async function fetchMyLists(agent: AtpAgent): Promise<ListSuggestion[]> {
  const did = agent.session?.did;
  if (!did) return [];
  const response = await agent.app.bsky.graph.getLists({ actor: did, limit: 50 });
  return response.data.lists
    .filter((list) => list.purpose === 'app.bsky.graph.defs#curatelist')
    .map((list) => ({ uri: list.uri, name: list.name, avatar: list.avatar || undefined }));
}
