import type { LinkCardData } from '../types';

/**
 * Bluesky's own OpenGraph extractor service (the same one the official web
 * client uses). Declared in host_permissions so the background may call it.
 */
const CARDYB_ENDPOINT = 'https://cardyb.bsky.app/v1/extract?url=';

interface CardybResponse {
  error?: string;
  url?: string;
  title?: string;
  description?: string;
  image?: string;
}

export async function fetchLinkCard(url: string): Promise<LinkCardData | null> {
  let response: Response;
  try {
    response = await fetch(CARDYB_ENDPOINT + encodeURIComponent(url), {
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    return null; // metadata is a nice-to-have, never an error
  }
  if (!response.ok) return null;

  const data = (await response.json().catch(() => null)) as CardybResponse | null;
  if (!data || data.error) return null;

  const title = (data.title ?? '').trim();
  const description = (data.description ?? '').trim();
  if (!title && !description) return null;

  return {
    url: data.url || url,
    title: title || url,
    description,
    imageUrl: data.image || undefined,
  };
}
