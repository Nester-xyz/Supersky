/**
 * GIF search via Bluesky's own GIF proxy (gifs.bsky.app), the same service the
 * official app uses. The proxy fronts Klipy but normalizes responses to the
 * Tenor schema, so media formats arrive as { url, dims } records. Declared in
 * host_permissions so both the popup (search) and background (thumb upload)
 * may call it.
 */

const GIF_SERVICE = 'https://gifs.bsky.app';
const PAGE_SIZE = 30;

interface GifMediaFormat {
  url: string;
  dims: [number, number];
  size?: number;
}

/** One result from the proxy, in Tenor's shape. */
export interface GifResult {
  id: string;
  title: string;
  content_description: string;
  url: string;
  media_formats: Partial<
    Record<'preview' | 'gif' | 'tinygif' | 'mp4' | 'webm', GifMediaFormat>
  >;
}

export interface GifPage {
  next: string | null;
  results: GifResult[];
}

/**
 * A picked GIF, flattened to what composing and drafts need. `embedUri` is the
 * exact external-embed URI bsky.app recognizes as a playable GIF; `previewUrl`
 * is a small animated preview routed through Bluesky's CDN proxy.
 */
export interface AttachedGif {
  id: string;
  embedUri: string;
  title: string;
  /** User-provided alt text; empty means "describe with the title". */
  alt: string;
  previewUrl: string;
  /** Small still/animated thumb used for the embed's thumbnail blob. */
  thumbUrl: string;
  width: number;
  height: number;
}

function baseParams(): URLSearchParams {
  const params = new URLSearchParams();
  params.set('client_key', 'supersky');
  params.set('limit', String(PAGE_SIZE));
  params.set('contentfilter', 'low');
  const region = navigator.language?.split('-')[1];
  if (region) params.set('locale', region.toLowerCase());
  return params;
}

/** Featured GIFs when `query` is empty, search results otherwise. */
export async function fetchGifs(query: string, pos?: string | null): Promise<GifPage> {
  const params = baseParams();
  const trimmed = query.trim();
  if (trimmed) params.set('q', trimmed);
  if (pos) params.set('pos', pos);
  const endpoint = trimmed ? 'search' : 'featured';
  const response = await fetch(`${GIF_SERVICE}/klipy/v2/${endpoint}?${params.toString()}`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`GIF search is unavailable right now (HTTP ${response.status}).`);
  }
  const body = (await response.json().catch(() => null)) as {
    next?: unknown;
    results?: unknown;
  } | null;
  const results = Array.isArray(body?.results) ? (body.results as GifResult[]) : [];
  return {
    next: typeof body?.next === 'string' && body.next ? body.next : null,
    results: results.filter((gif) => Boolean(gif?.media_formats?.gif?.url)),
  };
}

/** Route a provider CDN URL through Bluesky's GIF proxy hosts. */
export function proxiedGifUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'media.tenor.com') parsed.hostname = 't.gifs.bsky.app';
    else if (parsed.hostname === 'static.klipy.com') parsed.hostname = 'k.gifs.bsky.app';
    return parsed.href;
  } catch {
    return url;
  }
}

/**
 * Klipy encodes the format in the filename slug (Tenor encodes it in the URL
 * id), so playable-format slugs must travel along in the query string for
 * clients to swap formats at render time.
 */
function fileSlug(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const filename = url.split('/').pop();
  if (!filename) return undefined;
  const dot = filename.lastIndexOf('.');
  return dot > 0 ? filename.slice(0, dot) : undefined;
}

/** Flatten a search result into the attachable shape the composer keeps. */
export function toAttachedGif(gif: GifResult): AttachedGif {
  const full = gif.media_formats.gif;
  if (!full) throw new Error('This GIF is missing its full-size format.');
  const [width, height] = full.dims;

  const params = new URLSearchParams();
  params.set('hh', String(height));
  params.set('ww', String(width));
  try {
    if (new URL(full.url).hostname === 'static.klipy.com') {
      const mp4 = fileSlug(gif.media_formats.mp4?.url);
      const webm = fileSlug(gif.media_formats.webm?.url);
      if (mp4) params.set('mp4', mp4);
      if (webm) params.set('webm', webm);
    }
  } catch {
    // Unparseable URL: ship without format hints.
  }

  const preview = gif.media_formats.tinygif ?? gif.media_formats.preview ?? full;
  const thumb = gif.media_formats.preview ?? preview;
  return {
    id: gif.id,
    embedUri: `${full.url}?${params.toString()}`,
    title: gif.content_description || gif.title || 'Animated GIF',
    alt: '',
    previewUrl: proxiedGifUrl(preview.url),
    thumbUrl: proxiedGifUrl(thumb.url),
    width,
    height,
  };
}

/**
 * The embed description doubles as alt text. The official app distinguishes
 * user-written alt ("Alt: ") from the provider's default ("ALT: "), and other
 * clients parse that convention back out.
 */
export function gifEmbedDescription(gif: AttachedGif): string {
  const alt = gif.alt.trim();
  return alt ? `Alt: ${alt}` : `ALT: ${gif.title}`;
}
