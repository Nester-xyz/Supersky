/**
 * Video attachments. Bluesky videos are processed by a dedicated service
 * (video.bsky.app): the client uploads the source file with a short-lived
 * service-auth token minted by the user's PDS, the service transcodes it, and
 * the finished job hands back the blob that goes into `app.bsky.embed.video`.
 *
 * The upload runs from the popup (the file never fits through extension
 * messaging), while the background mints tokens; keep the popup open until the
 * video is ready.
 */

export const VIDEO_SERVICE = 'https://video.bsky.app';

/** Current Bluesky limits: 3-minute videos, 100 MB processed blobs. */
export const MAX_VIDEO_DURATION_S = 3 * 60;
export const MAX_VIDEO_BYTES = 100_000_000;

const ACCEPTED_VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime', 'video/mpeg'];
export const VIDEO_INPUT_ACCEPT = ACCEPTED_VIDEO_TYPES.join(',');

export function isVideoFile(file: File): boolean {
  return file.type.startsWith('video/');
}

export interface PreparedVideo {
  id: string;
  file: File;
  mime: string;
  /** Object URL for the in-popup <video> preview; revoke when discarded. */
  previewUrl: string;
  width: number;
  height: number;
  durationS: number;
  sizeBytes: number;
  alt: string;
}

/** The JSON shape video.bsky.app returns for uploads and job polling. */
export interface VideoJobStatus {
  jobId?: string;
  did?: string;
  state?: string;
  progress?: number;
  blob?: unknown;
  error?: string;
  message?: string;
}

/** Validate a picked file and probe its dimensions/duration via <video>. */
export async function prepareVideo(file: File): Promise<PreparedVideo> {
  if (!ACCEPTED_VIDEO_TYPES.includes(file.type)) {
    throw new Error('Only MP4, WebM, MOV, and MPEG videos are supported.');
  }
  if (file.size > MAX_VIDEO_BYTES) {
    throw new Error(
      `Videos can be up to ${Math.round(MAX_VIDEO_BYTES / 1_000_000)} MB. This one is ${Math.ceil(file.size / 1_000_000)} MB.`,
    );
  }

  const previewUrl = URL.createObjectURL(file);
  let meta: { width: number; height: number; durationS: number };
  try {
    meta = await probeVideo(previewUrl);
  } catch (err) {
    URL.revokeObjectURL(previewUrl);
    throw err;
  }
  if (meta.durationS > MAX_VIDEO_DURATION_S + 1) {
    URL.revokeObjectURL(previewUrl);
    throw new Error(
      `Videos can be up to 3 minutes. This one is ${formatDuration(meta.durationS)}.`,
    );
  }

  return {
    id: crypto.randomUUID(),
    file,
    mime: file.type,
    previewUrl,
    width: meta.width,
    height: meta.height,
    durationS: meta.durationS,
    sizeBytes: file.size,
    alt: '',
  };
}

export function releaseVideo(video: PreparedVideo): void {
  URL.revokeObjectURL(video.previewUrl);
}

function probeVideo(url: string): Promise<{ width: number; height: number; durationS: number }> {
  return new Promise((resolve, reject) => {
    const el = document.createElement('video');
    el.preload = 'metadata';
    el.onloadedmetadata = () => {
      resolve({
        width: el.videoWidth,
        height: el.videoHeight,
        durationS: Number.isFinite(el.duration) ? el.duration : 0,
      });
      el.src = '';
    };
    el.onerror = () => reject(new Error('Could not read this video file.'));
    el.src = url;
  });
}

export function formatDuration(seconds: number): string {
  const total = Math.round(seconds);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return mins > 0 ? `${mins}:${String(secs).padStart(2, '0')}` : `0:${String(secs).padStart(2, '0')}`;
}

const EXT_BY_MIME: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'video/mpeg': 'mpeg',
};

/**
 * Upload the source file to the video service with progress. Returns the
 * initial job status; the service dedupes re-uploads by returning the existing
 * job (sometimes already completed) instead of a fresh one.
 */
export function uploadVideoFile({
  video,
  did,
  token,
  onProgress,
  signal,
}: {
  video: PreparedVideo;
  did: string;
  token: string;
  onProgress: (fraction: number) => void;
  signal: AbortSignal;
}): Promise<VideoJobStatus> {
  const name = `${crypto.randomUUID().slice(0, 12)}.${EXT_BY_MIME[video.mime] ?? 'mp4'}`;
  const url = `${VIDEO_SERVICE}/xrpc/app.bsky.video.uploadVideo?did=${encodeURIComponent(did)}&name=${encodeURIComponent(name)}`;

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const abort = () => {
      xhr.abort();
      reject(new DOMException('Upload cancelled.', 'AbortError'));
    };
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener('abort', abort, { once: true });

    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    });
    xhr.onloadend = () => {
      signal.removeEventListener('abort', abort);
      if (signal.aborted) return;
      if (xhr.readyState !== 4) {
        reject(new Error('The video upload was interrupted. Please try again.'));
        return;
      }
      let body: VideoJobStatus | null = null;
      try {
        body = JSON.parse(xhr.responseText) as VideoJobStatus;
      } catch {
        // Fall through to the generic error below.
      }
      // The service answers re-uploads of known files with the existing job,
      // so any response carrying a jobId is a success path.
      if (body?.jobId) {
        resolve(body);
      } else {
        reject(new Error(friendlyVideoError(body) ?? 'Failed to upload the video.'));
      }
    };
    xhr.onerror = () => {
      signal.removeEventListener('abort', abort);
      reject(new Error('Could not reach Bluesky’s video service. Check your connection.'));
    };
    xhr.open('POST', url);
    xhr.setRequestHeader('Content-Type', video.mime);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.send(video.file);
  });
}

/**
 * Poll the processing job every 1.5s until it completes or fails, reporting
 * coarse progress. Resolves with the processed blob (as JSON, ready to embed).
 */
export async function pollVideoJob({
  jobId,
  signal,
  onProgress,
}: {
  jobId: string;
  signal: AbortSignal;
  onProgress: (progress: number | null) => void;
}): Promise<unknown> {
  let failures = 0;
  for (;;) {
    if (signal.aborted) throw new DOMException('Cancelled.', 'AbortError');
    let status: VideoJobStatus | undefined;
    try {
      const response = await fetch(
        `${VIDEO_SERVICE}/xrpc/app.bsky.video.getJobStatus?jobId=${encodeURIComponent(jobId)}`,
        { signal },
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = (await response.json()) as { jobStatus?: VideoJobStatus };
      status = body.jobStatus;
      failures = 0;
    } catch {
      if (signal.aborted) throw new DOMException('Cancelled.', 'AbortError');
      failures += 1;
      // Transient poll errors are retried on a slower cadence for a while.
      if (failures >= 20) {
        throw new Error('Lost track of the video processing job. Please try again.');
      }
      await sleep(5000, signal);
      continue;
    }

    if (status?.state === 'JOB_STATE_COMPLETED') {
      if (!status.blob) throw new Error('Processing finished but returned no video.');
      onProgress(100);
      return status.blob;
    }
    if (status?.state === 'JOB_STATE_FAILED') {
      throw new Error(friendlyVideoError(status) ?? 'Bluesky could not process this video.');
    }
    onProgress(typeof status?.progress === 'number' ? status.progress : null);
    await sleep(1500, signal);
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Cancelled.', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function friendlyVideoError(status: VideoJobStatus | null | undefined): string | null {
  const raw = status?.message || status?.error;
  if (!raw) return null;
  if (/unauthenticated|unauthorized/i.test(raw)) {
    return 'The video service rejected the upload session. Reopen the popup and try again.';
  }
  return raw;
}
