#!/usr/bin/env node
/**
 * Upload a packaged extension to the Chrome Web Store and submit it for review.
 *
 * Uses the Chrome Web Store API v2. (v1 is deprecated and loses support on
 * 15 October 2026, so this deliberately avoids the older /chromewebstore/v1.1
 * endpoints that most marketplace actions still call.)
 *
 * Docs: https://developer.chrome.com/docs/webstore/using-api
 *
 * Required environment variables:
 *   CWS_CLIENT_ID       OAuth client ID
 *   CWS_CLIENT_SECRET   OAuth client secret
 *   CWS_REFRESH_TOKEN   OAuth refresh token (scope: .../auth/chromewebstore)
 *   CWS_PUBLISHER_ID    Publisher ID from Developer Dashboard > Publisher > Settings
 *   CWS_EXTENSION_ID    The 32-character extension ID
 *
 * Usage:
 *   node scripts/publish-cws.mjs .output/supersky-1.2.3-chrome.zip
 *   node scripts/publish-cws.mjs <zip> --dry-run        # auth + validate only
 *   node scripts/publish-cws.mjs <zip> --no-publish     # upload as draft
 *   node scripts/publish-cws.mjs <zip> --deploy-percentage 10
 */

import { readFileSync, statSync } from 'node:fs';

const API = 'https://chromewebstore.googleapis.com';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const POLL_INTERVAL_MS = 5000;
const POLL_TIMEOUT_MS = 10 * 60 * 1000;

const args = process.argv.slice(2);
const zipPath = args.find((a) => !a.startsWith('--'));
const dryRun = args.includes('--dry-run');
const noPublish = args.includes('--no-publish');
const deployPercentage = readFlagValue('--deploy-percentage');

main().catch((error) => {
  console.error(`\n✗ ${error.message}`);
  if (error.detail) console.error(error.detail);
  process.exit(1);
});

async function main() {
  if (!zipPath && !dryRun) {
    throw new Error('No zip file given. Usage: publish-cws.mjs <path-to-zip>');
  }

  const env = requireEnv([
    'CWS_CLIENT_ID',
    'CWS_CLIENT_SECRET',
    'CWS_REFRESH_TOKEN',
    'CWS_PUBLISHER_ID',
    'CWS_EXTENSION_ID',
  ]);

  // A dry run only exercises auth and the status endpoint, so the zip is optional.
  if (!dryRun) {
    const size = statSync(zipPath).size;
    console.log(`Package: ${zipPath} (${(size / 1024 / 1024).toFixed(2)} MB)`);
  }

  const itemName = `publishers/${env.CWS_PUBLISHER_ID}/items/${env.CWS_EXTENSION_ID}`;

  console.log('Requesting access token...');
  const token = await getAccessToken(env);

  console.log('Checking current item status...');
  const before = await fetchStatus(itemName, token);
  const liveVersion = before.publishedItemRevisionStatus?.distributionChannels?.[0]?.crxVersion;
  console.log(`  Live version: ${liveVersion ?? 'none'}`);
  if (before.takenDown)
    console.warn('  ⚠ This item is currently taken down for a policy violation.');
  if (before.warned) console.warn('  ⚠ This item has an unresolved policy warning.');

  if (dryRun) {
    console.log('\n✓ Dry run: credentials valid and item reachable. Nothing uploaded.');
    return;
  }

  console.log('Uploading package...');
  const upload = await uploadPackage(itemName, token, zipPath);
  console.log(`  Upload state: ${upload.uploadState}`);

  if (isPending(upload.uploadState)) {
    console.log('  Upload is processing, polling for completion...');
    await waitForUpload(itemName, token);
  } else if (!isSuccess(upload.uploadState)) {
    throw withDetail(
      new Error(`Upload failed with state ${upload.uploadState}.`),
      JSON.stringify(upload, null, 2),
    );
  }

  const uploadedVersion = upload.crxVersion ?? '(pending)';
  console.log(`  Uploaded version: ${uploadedVersion}`);

  if (noPublish) {
    console.log('\n✓ Uploaded as a draft. Submit it from the dashboard when ready.');
    return;
  }

  console.log('Submitting for review...');
  const body = { publishType: 'DEFAULT_PUBLISH' };
  if (deployPercentage !== undefined) {
    body.deployInfos = [{ deployPercentage: Number(deployPercentage) }];
  }

  const result = await api(`${API}/v2/${itemName}:publish`, token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  for (const warning of result.warningInfo?.warnings ?? []) {
    console.warn(`  ⚠ ${warning.reason}: ${warning.description}`);
  }

  console.log(`\n✓ Submitted. State: ${result.state}`);
  console.log(
    `  Track review progress: https://chrome.google.com/webstore/devconsole/${env.CWS_PUBLISHER_ID}`,
  );
}

async function getAccessToken({ CWS_CLIENT_ID, CWS_CLIENT_SECRET, CWS_REFRESH_TOKEN }) {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CWS_CLIENT_ID,
      client_secret: CWS_CLIENT_SECRET,
      refresh_token: CWS_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data.access_token) {
    throw withDetail(
      new Error(
        'Could not exchange the refresh token for an access token. ' +
          'The token may have expired (unused refresh tokens lapse after six months) ' +
          'or the client credentials may be wrong.',
      ),
      JSON.stringify(data, null, 2),
    );
  }

  return data.access_token;
}

function fetchStatus(itemName, token) {
  return api(`${API}/v2/${itemName}:fetchStatus`, token);
}

async function uploadPackage(itemName, token, path) {
  return api(`${API}/upload/v2/${itemName}:upload`, token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/zip' },
    body: readFileSync(path),
  });
}

async function waitForUpload(itemName, token) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    const status = await fetchStatus(itemName, token);
    const state = status.lastAsyncUploadState;
    console.log(`  ...${state}`);

    if (isSuccess(state)) return status;
    if (state && !isPending(state)) {
      throw withDetail(
        new Error(`Upload finished in state ${state}.`),
        JSON.stringify(status, null, 2),
      );
    }
  }

  throw new Error('Timed out waiting for the upload to finish processing.');
}

async function api(url, token, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  });

  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw withDetail(
      new Error(`${response.status} ${response.statusText} from ${url}`),
      text.slice(0, 2000),
    );
  }

  if (!response.ok) {
    const message = data.error?.message ?? `${response.status} ${response.statusText}`;
    throw withDetail(new Error(`API error: ${message}`), JSON.stringify(data, null, 2));
  }

  return data;
}

// v2 UploadState: UPLOAD_STATE_UNSPECIFIED | SUCCEEDED | IN_PROGRESS | FAILED |
// NOT_FOUND. An unknown state falls through to the error path rather than being
// treated as success.
const isSuccess = (state) => state === 'SUCCEEDED';
const isPending = (state) => state === 'IN_PROGRESS';

function requireEnv(names) {
  const missing = names.filter((name) => !process.env[name]);
  if (missing.length) {
    throw new Error(`Missing required environment variable(s): ${missing.join(', ')}`);
  }
  return Object.fromEntries(names.map((name) => [name, process.env[name]]));
}

function readFlagValue(flag) {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function withDetail(error, detail) {
  error.detail = detail;
  return error;
}
