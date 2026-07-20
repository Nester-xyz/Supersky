import { AtpAgent } from '@atproto/api';

/**
 * Bluesky's hosted video pipeline. Uploads are authorized with short-lived
 * service-auth tokens minted by the user's own PDS: one scoped to the video
 * service for the quota check, one scoped to `uploadBlob` (audience = the PDS
 * itself, since the service forwards the finished blob there on your behalf).
 */
const VIDEO_SERVICE = 'https://video.bsky.app';
const VIDEO_SERVICE_DID = 'did:web:video.bsky.app';

async function mintServiceToken(
  agent: AtpAgent,
  aud: string,
  lxm: string,
  expSeconds?: number,
): Promise<string> {
  const { data } = await agent.com.atproto.server.getServiceAuth({
    aud,
    lxm,
    exp: expSeconds,
  });
  return data.token;
}

/**
 * Verify the account may upload today, then mint the token the popup uses to
 * POST the file straight to video.bsky.app (the file itself never crosses
 * extension messaging).
 */
export async function beginVideoUpload(agent: AtpAgent): Promise<{ token: string }> {
  const limitsToken = await mintServiceToken(
    agent,
    VIDEO_SERVICE_DID,
    'app.bsky.video.getUploadLimits',
  );
  const videoAgent = new AtpAgent({ service: VIDEO_SERVICE });
  const { data: limits } = await videoAgent.app.bsky.video.getUploadLimits(
    {},
    { headers: { Authorization: `Bearer ${limitsToken}` } },
  );
  if (!limits.canUpload) {
    throw new Error(uploadLimitMessage(limits.error, limits.message));
  }

  const pdsHost = new URL(agent.dispatchUrl).host;
  const token = await mintServiceToken(
    agent,
    `did:web:${pdsHost}`,
    'com.atproto.repo.uploadBlob',
    Math.floor(Date.now() / 1000) + 30 * 60,
  );
  return { token };
}

/**
 * Turn the video service's terse refusal codes into a clear, actionable
 * sentence. Falls back to the service's own message, then a generic one.
 */
function uploadLimitMessage(error?: string, message?: string): string {
  switch (error) {
    case 'unconfirmed_email':
      return 'Bluesky requires a confirmed email address before you can upload videos. Confirm your email in the Bluesky app under Settings → Account, then try again.';
    case 'account_deactivated':
    case 'account_takedown':
      return 'This account can’t upload videos right now because of its status on Bluesky.';
    default:
      // A message that already reads like a full sentence is worth showing;
      // a bare code is not.
      if (message && /\s/.test(message.trim())) return message;
      return 'You’ve reached Bluesky’s video upload limit for now. Please try again later.';
  }
}
