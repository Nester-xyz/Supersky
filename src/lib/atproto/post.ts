import {
  RichText,
  type $Typed,
  type AppBskyEmbedExternal,
  type AppBskyEmbedImages,
  type AtpAgent,
} from '@atproto/api';
import { base64ToBytes } from '../encoding';
import { MAX_GRAPHEMES } from '../text';
import { postWebUrl } from '../urls';
import type { ComposerImagePayload, LinkCardData, PublishRequest, PublishResult } from '../types';

const MAX_IMAGES = 4;

export async function publishPost(agent: AtpAgent, request: PublishRequest): Promise<PublishResult> {
  const text = request.text.trim();
  if (!text && request.images.length === 0) {
    throw new Error('Write something (or add an image) first.');
  }

  const richText = new RichText({ text });
  await richText.detectFacets(agent); // resolves mentions + links into facets

  if (richText.graphemeLength > MAX_GRAPHEMES) {
    throw new Error(`Posts can be at most ${MAX_GRAPHEMES} characters.`);
  }

  let embed: $Typed<AppBskyEmbedImages.Main> | $Typed<AppBskyEmbedExternal.Main> | undefined;
  if (request.images.length > 0) {
    embed = await buildImagesEmbed(agent, request.images.slice(0, MAX_IMAGES));
  } else if (request.card) {
    embed = await buildExternalEmbed(agent, request.card);
  }

  const response = await agent.post({
    text: richText.text,
    facets: richText.facets,
    langs: request.langs?.length ? request.langs.slice(0, 3) : undefined,
    embed,
    createdAt: new Date().toISOString(),
  });

  const actor = agent.session?.handle ?? agent.session?.did ?? '';
  return { uri: response.uri, cid: response.cid, webUrl: postWebUrl(actor, response.uri) };
}

async function buildImagesEmbed(
  agent: AtpAgent,
  images: ComposerImagePayload[],
): Promise<$Typed<AppBskyEmbedImages.Main>> {
  const uploaded = await Promise.all(
    images.map(async (image) => {
      const bytes = base64ToBytes(image.base64);
      const upload = await agent.uploadBlob(bytes, { encoding: image.mime });
      return {
        image: upload.data.blob,
        alt: image.alt,
        aspectRatio: { width: image.width, height: image.height },
      };
    }),
  );
  return { $type: 'app.bsky.embed.images', images: uploaded };
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
