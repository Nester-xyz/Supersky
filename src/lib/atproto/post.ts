import {
  BlobRef,
  RichText,
  type $Typed,
  type AppBskyEmbedExternal,
  type AppBskyEmbedGallery,
  type AppBskyEmbedImages,
  type AppBskyEmbedVideo,
  type AppBskyFeedPost,
  type AtpAgent,
  type ComAtprotoRepoApplyWrites,
} from '@atproto/api';
import { base64ToBytes } from '../encoding';
import { gifEmbedDescription } from '../gifs';
import { isDefaultInteraction, threadgateAllowRules } from '../interaction';
import { MAX_GRAPHEMES } from '../text';
import { nextTid } from '../tid';
import { postWebUrl } from '../urls';
import type { AttachedGif } from '../gifs';
import type {
  ComposerImagePayload,
  ComposerVideoPayload,
  LinkCardData,
  PublishRequest,
  PublishResult,
} from '../types';

/** Up to 4 images ride the classic embed; 5+ promote to the gallery embed. */
const LEGACY_IMAGES_EMBED_MAX = 4;
const MAX_IMAGES = 10;

type MediaEmbed =
  | $Typed<AppBskyEmbedImages.Main>
  | $Typed<AppBskyEmbedGallery.Main>
  | $Typed<AppBskyEmbedVideo.Main>
  | $Typed<AppBskyEmbedExternal.Main>;

export async function publishPost(agent: AtpAgent, request: PublishRequest): Promise<PublishResult> {
  const text = request.text.trim();
  const hasMedia =
    request.images.length > 0 || Boolean(request.video) || Boolean(request.gif);
  if (!text && !hasMedia) {
    throw new Error('Write something (or add an image, video, or GIF) first.');
  }

  const richText = new RichText({ text });
  await richText.detectFacets(agent); // resolves mentions + links into facets

  if (richText.graphemeLength > MAX_GRAPHEMES) {
    throw new Error(`Posts can be at most ${MAX_GRAPHEMES} characters.`);
  }

  const did = agent.session?.did;
  if (!did) throw new Error('You’re signed out. Open the popup and sign in first.');

  let embed: MediaEmbed | undefined;
  if (request.images.length > 0) {
    embed = await buildImagesEmbed(agent, request.images.slice(0, MAX_IMAGES));
  } else if (request.video) {
    embed = buildVideoEmbed(request.video, did);
  } else if (request.gif) {
    embed = await buildGifEmbed(agent, request.gif);
  } else if (request.card) {
    embed = await buildExternalEmbed(agent, request.card);
  }

  // The post plus its threadgate/postgate land in one atomic commit, sharing
  // the post's rkey as the lexicons require.
  const rkey = nextTid();
  const uri = `at://${did}/app.bsky.feed.post/${rkey}`;
  const createdAt = new Date().toISOString();

  const record: AppBskyFeedPost.Record = {
    $type: 'app.bsky.feed.post',
    createdAt,
    text: richText.text,
    facets: richText.facets,
    langs: request.langs?.length ? request.langs.slice(0, 3) : undefined,
    embed,
  };

  const writes: $Typed<ComAtprotoRepoApplyWrites.Create>[] = [
    {
      $type: 'com.atproto.repo.applyWrites#create',
      collection: 'app.bsky.feed.post',
      rkey,
      value: record,
    },
  ];

  const interaction = request.interaction;
  if (interaction && !isDefaultInteraction(interaction)) {
    const allow = threadgateAllowRules(interaction);
    if (allow !== undefined) {
      writes.push({
        $type: 'com.atproto.repo.applyWrites#create',
        collection: 'app.bsky.feed.threadgate',
        rkey,
        value: {
          $type: 'app.bsky.feed.threadgate',
          post: uri,
          createdAt,
          allow,
          hiddenReplies: [],
        },
      });
    }
    if (!interaction.quotesEnabled) {
      writes.push({
        $type: 'com.atproto.repo.applyWrites#create',
        collection: 'app.bsky.feed.postgate',
        rkey,
        value: {
          $type: 'app.bsky.feed.postgate',
          post: uri,
          createdAt,
          embeddingRules: [{ $type: 'app.bsky.feed.postgate#disableRule' }],
          detachedEmbeddingUris: [],
        },
      });
    }
  }

  const response = await agent.com.atproto.repo.applyWrites({ repo: did, writes });
  const first = response.data.results?.[0];
  const cid = first && 'cid' in first && typeof first.cid === 'string' ? first.cid : '';

  const actor = agent.session?.handle ?? did;
  return { uri, cid, webUrl: postWebUrl(actor, uri), handle: actor };
}

async function uploadImageBlob(agent: AtpAgent, image: ComposerImagePayload): Promise<BlobRef> {
  const bytes = base64ToBytes(image.base64);
  const upload = await agent.uploadBlob(bytes, { encoding: image.mime });
  return upload.data.blob;
}

/**
 * ≤4 images use `app.bsky.embed.images` so every client can render them; more
 * switch to `app.bsky.embed.gallery` (max 10), mirroring the official app.
 */
async function buildImagesEmbed(
  agent: AtpAgent,
  images: ComposerImagePayload[],
): Promise<$Typed<AppBskyEmbedImages.Main> | $Typed<AppBskyEmbedGallery.Main>> {
  if (images.length <= LEGACY_IMAGES_EMBED_MAX) {
    const uploaded = await Promise.all(
      images.map(async (image) => ({
        image: await uploadImageBlob(agent, image),
        alt: image.alt,
        aspectRatio: aspectRatioOf(image),
      })),
    );
    return { $type: 'app.bsky.embed.images', images: uploaded };
  }

  const items: $Typed<AppBskyEmbedGallery.Image>[] = await Promise.all(
    images.map(async (image) => ({
      $type: 'app.bsky.embed.gallery#image' as const,
      image: await uploadImageBlob(agent, image),
      alt: image.alt,
      // Unlike the classic embed, the gallery requires an aspect ratio.
      aspectRatio: aspectRatioOf(image),
    })),
  );
  return { $type: 'app.bsky.embed.gallery', items };
}

function aspectRatioOf(image: { width: number; height: number }): {
  width: number;
  height: number;
} {
  return { width: Math.max(1, Math.round(image.width)), height: Math.max(1, Math.round(image.height)) };
}

function buildVideoEmbed(
  video: ComposerVideoPayload,
  posterDid: string,
): $Typed<AppBskyEmbedVideo.Main> {
  // Blobs live in one repo: a processed video can only be posted by the
  // account whose upload session produced it.
  if (video.did !== posterDid) {
    throw new Error('Videos can only be posted by the account that uploaded them.');
  }
  const blob = BlobRef.fromJsonRef(video.blob as Parameters<typeof BlobRef.fromJsonRef>[0]);
  const width = Math.round(video.width);
  const height = Math.round(video.height);
  return {
    $type: 'app.bsky.embed.video',
    video: blob,
    alt: video.alt.trim() || undefined,
    aspectRatio: width > 0 && height > 0 ? { width, height } : undefined,
  };
}

/**
 * GIFs post as external embeds pointing at the provider's playable URL (with
 * dimensions and format hints in the query string), which bsky.app renders as
 * an autoplaying GIF. The description carries the alt text convention shared
 * with the official app.
 */
async function buildGifEmbed(
  agent: AtpAgent,
  gif: AttachedGif,
): Promise<$Typed<AppBskyEmbedExternal.Main>> {
  let thumb: BlobRef | undefined;
  try {
    const response = await fetch(gif.thumbUrl, { signal: AbortSignal.timeout(10_000) });
    if (response.ok) {
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength <= 2_000_000) {
        const mime = response.headers.get('content-type')?.split(';')[0] ?? 'image/gif';
        const upload = await agent.uploadBlob(bytes, { encoding: mime });
        thumb = upload.data.blob;
      }
    }
  } catch {
    // The GIF still posts and plays without a thumbnail.
  }
  return {
    $type: 'app.bsky.embed.external',
    external: {
      uri: gif.embedUri,
      title: gif.title,
      description: gifEmbedDescription(gif),
      thumb,
    },
  };
}

async function buildExternalEmbed(
  agent: AtpAgent,
  card: LinkCardData,
): Promise<$Typed<AppBskyEmbedExternal.Main>> {
  let thumb;
  if (card.imageUrl) {
    try {
      const response = await fetch(card.imageUrl);
      if (response.ok) {
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.byteLength <= 1_000_000) {
          const mime = response.headers.get('content-type')?.split(';')[0] ?? 'image/jpeg';
          const upload = await agent.uploadBlob(bytes, { encoding: mime });
          thumb = upload.data.blob;
        }
      }
    } catch {
      // The card still posts fine without a thumbnail.
    }
  }
  return {
    $type: 'app.bsky.embed.external',
    external: {
      uri: card.url,
      title: card.title,
      description: card.description,
      thumb,
    },
  };
}
