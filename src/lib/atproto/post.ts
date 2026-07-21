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
import { computeRecordCid } from './cid';
import type { AttachedGif } from '../gifs';
import {
  MAX_THREAD_POSTS,
  type ComposerImagePayload,
  type ComposerVideoPayload,
  type LinkCardData,
  type PublishRequest,
  type PublishResult,
} from '../types';

/** Up to 4 images ride the classic embed; 5+ promote to the gallery embed. */
const LEGACY_IMAGES_EMBED_MAX = 4;
const MAX_IMAGES = 10;

type MediaEmbed =
  | $Typed<AppBskyEmbedImages.Main>
  | $Typed<AppBskyEmbedGallery.Main>
  | $Typed<AppBskyEmbedVideo.Main>
  | $Typed<AppBskyEmbedExternal.Main>;

interface StrongRef {
  uri: string;
  cid: string;
}

/**
 * The parent being replied to plus the thread's root, the way the official
 * app derives them: the parent's own reply.root when it has one, else the
 * parent is the root.
 */
async function resolveReplyRefs(
  agent: AtpAgent,
  uri: string,
): Promise<{ root: StrongRef; parent: StrongRef }> {
  const { data } = await agent.app.bsky.feed.getPosts({ uris: [uri] });
  const parentPost = data.posts[0];
  if (!parentPost) {
    throw new Error('The post you’re replying to is gone (deleted or blocked).');
  }
  const parent: StrongRef = { uri: parentPost.uri, cid: parentPost.cid };
  const record = parentPost.record as {
    reply?: { root?: { uri?: unknown; cid?: unknown } };
  };
  const root = record?.reply?.root;
  return {
    parent,
    root:
      root && typeof root.uri === 'string' && typeof root.cid === 'string'
        ? { uri: root.uri, cid: root.cid }
        : parent,
  };
}

/**
 * Publish a post, a reply, or a whole thread in one atomic applyWrites
 * commit. Each segment's record CID is computed locally so the next segment
 * can reference it before anything reaches the PDS; media rides on the root
 * post; the threadgate (root-only, never on replies) and postgates share
 * their post's rkey.
 */
export async function publishPost(agent: AtpAgent, request: PublishRequest): Promise<PublishResult> {
  const rootText = request.text.trim();
  const extras = (request.extraPosts ?? [])
    .map((post) => ({ text: post.text.trim(), images: post.images ?? [] }))
    .filter((post) => post.text.length > 0 || post.images.length > 0)
    .slice(0, MAX_THREAD_POSTS - 1);
  const hasMedia =
    request.images.length > 0 || Boolean(request.video) || Boolean(request.gif);
  if (!rootText && !hasMedia) {
    throw new Error('Write something (or add an image, video, or GIF) first.');
  }

  const did = agent.session?.did;
  if (!did) throw new Error('You’re signed out. Open the popup and sign in first.');

  // Facets resolve up front so a bad segment fails before anything uploads.
  const bodies = [rootText, ...extras.map((post) => post.text)];
  const richTexts: RichText[] = [];
  for (const [index, body] of bodies.entries()) {
    const richText = new RichText({ text: body });
    await richText.detectFacets(agent); // resolves mentions + links into facets
    if (richText.graphemeLength > MAX_GRAPHEMES) {
      throw new Error(
        bodies.length > 1
          ? `Post ${index + 1} of the thread is over ${MAX_GRAPHEMES} characters.`
          : `Posts can be at most ${MAX_GRAPHEMES} characters.`,
      );
    }
    richTexts.push(richText);
  }

  const replyRefs = request.replyTo ? await resolveReplyRefs(agent, request.replyTo) : null;

  // Root gets its images/GIF/card; each follow-up gets its own images. A
  // video lands on whichever post it was attached to (videoPostIndex, default
  // the root), replacing that post's other media.
  const embeds: Array<MediaEmbed | undefined> = [];
  if (request.images.length > 0) {
    embeds.push(await buildImagesEmbed(agent, request.images.slice(0, MAX_IMAGES)));
  } else if (request.gif) {
    embeds.push(await buildGifEmbed(agent, request.gif));
  } else if (request.card) {
    embeds.push(await buildExternalEmbed(agent, request.card));
  } else {
    embeds.push(undefined);
  }
  for (const post of extras) {
    embeds.push(
      post.images.length > 0
        ? await buildImagesEmbed(agent, post.images.slice(0, MAX_IMAGES))
        : undefined,
    );
  }
  if (request.video) {
    const videoIndex = Math.min(Math.max(request.videoPostIndex ?? 0, 0), embeds.length - 1);
    embeds[videoIndex] = buildVideoEmbed(request.video, did);
  }

  const langs = request.langs?.length ? request.langs.slice(0, 3) : undefined;
  const interaction = request.interaction;
  const gated = Boolean(interaction && !isDefaultInteraction(interaction));
  const writes: $Typed<ComAtprotoRepoApplyWrites.Create>[] = [];

  const startedAt = Date.now();
  let threadRoot: StrongRef | null = replyRefs?.root ?? null;
  let parentRef: StrongRef | null = replyRefs?.parent ?? null;
  let rootRef: StrongRef | null = null;

  for (const [index, richText] of richTexts.entries()) {
    const rkey = nextTid();
    const uri = `at://${did}/app.bsky.feed.post/${rkey}`;
    // A millisecond apart per segment, so ordering is never ambiguous.
    const createdAt = new Date(startedAt + index).toISOString();

    const record: AppBskyFeedPost.Record = {
      $type: 'app.bsky.feed.post',
      createdAt,
      text: richText.text,
      facets: richText.facets,
      langs,
      embed: embeds[index],
      reply:
        threadRoot && parentRef ? { root: threadRoot, parent: parentRef } : undefined,
    };

    const cid = await computeRecordCid(record);
    const ref: StrongRef = { uri, cid };
    if (index === 0) {
      rootRef = ref;
      if (!threadRoot) threadRoot = ref;
    }
    parentRef = ref;

    writes.push({
      $type: 'com.atproto.repo.applyWrites#create',
      collection: 'app.bsky.feed.post',
      rkey,
      value: record,
    });

    if (gated && interaction) {
      // Threadgates belong to the thread root and only its author may set
      // one, so replies never write it.
      const allow = threadgateAllowRules(interaction);
      if (index === 0 && !request.replyTo && allow !== undefined) {
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
  }

  await agent.com.atproto.repo.applyWrites({ repo: did, writes });

  const actor = agent.session?.handle ?? did;
  const uri = rootRef?.uri ?? '';
  return {
    uri,
    cid: rootRef?.cid ?? '',
    webUrl: postWebUrl(actor, uri),
    handle: actor,
  };
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
