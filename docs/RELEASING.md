# Releasing Supersky

Releases are cut by pushing a git tag. CI builds the extension, attaches the zip
to a GitHub release, and submits it to the Chrome Web Store for review. No
dashboard uploads.

```bash
git tag v0.2.0
git push origin v0.2.0
```

That is the whole release process once the one-time setup below is done.

## How it works

| Tag             | GitHub release | Chrome Web Store     |
| --------------- | -------------- | -------------------- |
| `v0.2.0`        | published      | submitted for review |
| `v0.2.0-beta.1` | prerelease     | skipped              |

The tag is the single source of truth for the version. `scripts/set-version.mjs`
rewrites `package.json` during the build, and WXT reads the manifest version from
there, so `package.json` in git can lag behind without causing a mismatch. The
workflow asserts the built manifest matches the tag before it publishes anything.

Chrome rejects prerelease suffixes in a manifest version, which is why `-beta.1`
tags build and land on GitHub but never reach the store.

## One-time setup

### 1. Create Google Cloud credentials

1. Open the [Google Cloud Console](https://console.developers.google.com) and
   create a project (or pick an existing one).
2. Search for **Chrome Web Store API** and enable it.
3. Go to **OAuth consent screen**, choose **External**, and fill in app name,
   support email, and developer contact. Add your own Google account under
   **Test users** so you can use the project without waiting for verification.
4. Go to **Credentials → Create Credentials → OAuth client ID**.
   - Application type: **Web application**
   - Authorized redirect URI: `https://developers.google.com/oauthplayground`
5. Save the **client ID** and **client secret**.

Use the Google account that owns the Chrome Web Store listing. It can differ
from the account that owns the Cloud project, but the token has to come from the
owning account. That account also needs 2-step verification enabled, which the
store requires for publishing.

### 2. Get a refresh token

1. Open the [OAuth 2.0 Playground](https://developers.google.com/oauthplayground).
2. Click the gear icon, tick **Use your own OAuth credentials**, and paste the
   client ID and secret.
3. In **Input your own scopes**, enter `https://www.googleapis.com/auth/chromewebstore`.
4. Click **Authorize APIs**, sign in with the store-owning account, then click
   **Exchange authorization code for tokens**.
5. Copy the **refresh token**.

### 3. Find your IDs

- **Publisher ID**: Developer Dashboard → **Publisher → Settings**.
- **Extension ID**: the 32-character string in your extension's dashboard URL
  and store listing URL.

### 4. Add the repository secrets

Settings → Secrets and variables → Actions → **New repository secret**:

| Secret              | Value                     |
| ------------------- | ------------------------- |
| `CWS_CLIENT_ID`     | OAuth client ID           |
| `CWS_CLIENT_SECRET` | OAuth client secret       |
| `CWS_REFRESH_TOKEN` | Refresh token from step 2 |
| `CWS_PUBLISHER_ID`  | Publisher ID              |
| `CWS_EXTENSION_ID`  | Extension ID              |

### 5. Confirm it works

Run the **Keep CWS token alive** workflow manually from the Actions tab. It
authenticates and reads your item status without uploading anything. A green run
means the credentials are good.

Locally, the same check is:

```bash
export CWS_CLIENT_ID=... CWS_CLIENT_SECRET=... CWS_REFRESH_TOKEN=... \
       CWS_PUBLISHER_ID=... CWS_EXTENSION_ID=...
npm run release:check
```

## Workflows

- **`ci.yml`** — typecheck, lint, and build on every push to `main` and every PR.
- **`release.yml`** — the tag-triggered release. Also runs from the Actions tab
  via **Run workflow**, where store submission is off unless you tick the box.
  Useful for rehearsing a build without cutting a real release.
- **`cws-token-keepalive.yml`** — monthly no-op that refreshes the OAuth token.
  Google expires refresh tokens after six months of disuse, so this stops a
  release from failing on a dead token after a quiet stretch.

## Manual publishing

`scripts/publish-cws.mjs` works outside CI too:

```bash
npm run zip
node scripts/publish-cws.mjs .output/supersky-0.2.0-chrome.zip

# variations
node scripts/publish-cws.mjs <zip> --no-publish              # upload as draft only
node scripts/publish-cws.mjs <zip> --deploy-percentage 10    # staged rollout
node scripts/publish-cws.mjs --dry-run                       # auth check only
```

## Troubleshooting

**"Could not exchange the refresh token"** — the token lapsed after six months
unused, or the client credentials are wrong. Redo step 2. Check that the
keepalive workflow is enabled so this stops recurring.

**Upload fails saying the version was not increased** — the tag matches a version
already in the store. Chrome will not accept a repeat upload of the same version
number, so tag a higher one.

**"you won't be able to publish using the API until you have manually published
with the new visibility at least once"** — the store refuses API publishes after
a visibility change made in the dashboard. Publish once by hand, then the API
works again.

**A submission is stuck in review and you need to pull it** — the API supports
`cancelSubmission`, or use the dashboard.

**Deploy percentage rejected** — staged percentage rollout needs more than 10,000
seven-day active users. Drop the flag below that threshold.

## Notes on the API

This uses **Chrome Web Store API v2**. V1 is deprecated and loses support on
**15 October 2026**, which is why the pipeline calls
`chromewebstore.googleapis.com/v2/...` directly rather than using one of the
common marketplace actions, most of which still target the v1.1 endpoints.

Reference: [Use the Chrome Web Store API](https://developer.chrome.com/docs/webstore/using-api)
