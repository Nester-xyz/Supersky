# Chrome Web Store listing notes

Copy for the Web Store dashboard: the single-purpose description, a justification
for every permission the manifest requests, and the data-use answers. Keep this in
sync with `wxt.config.ts` whenever a permission changes.

## Single purpose

Supersky is a Bluesky client for your toolbar: compose posts (text, up to ten
images, video, GIFs, threads, and reply/quote controls), share the current page,
and receive Bluesky notification banners, without leaving the tab you are on.

## Permission justifications

| Permission         | Why it is needed                                                                                                                                                             |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `storage`          | Stores the signed-in Bluesky session(s), user settings, and saved drafts locally so the composer restores state between sessions.                                          |
| `unlimitedStorage` | Saved drafts embed their images as base64, which can exceed `storage.local`'s default 10 MB quota; this lifts that cap. No data leaves the device.                          |
| `alarms`           | Schedules the periodic poll that refreshes the unread-notification badge and delivers notification banners on a steady cadence, surviving service-worker restarts.          |
| `contextMenus`     | Adds a "Share to Bluesky" right-click item for pages, links, and selected text.                                                                                             |
| `activeTab`        | When the user explicitly shares the current page (context menu or toolbar), reads that tab's URL and title to prefill the composer. No standing access to browsing.         |
| `notifications`    | Shows desktop banners for Bluesky activity (likes, replies, mentions, follows) and the "test banner" button in settings.                                                    |

## Host permission justifications

The Bluesky app-view/PDS API (`bsky.social` and custom PDS hosts) is reached with
standard CORS-enabled requests, so it needs no host grant. The hosts below are
listed only because they are fetched directly and do **not** send CORS headers, or
because they receive uploads:

| Host                        | Why it is needed                                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `https://cardyb.bsky.app/*` | Fetches link-card preview metadata (title, description, thumbnail) for URLs pasted into the composer.         |
| `https://cdn.bsky.app/*`    | Loads author avatars to inline into notification banners; the CDN sends no CORS headers, so a grant is needed. |
| `https://gifs.bsky.app/*` and `https://*.gifs.bsky.app/*` | Powers the GIF picker (the same Klipy-backed service the official app uses) and its media CDN.  |
| `https://video.bsky.app/*`  | Uploads a selected video directly to Bluesky's video-processing service and polls the job until it is ready.  |

## Content scripts

A content script runs on `x.com` / `twitter.com`. After the user publishes a main
post there, it reads that single post (only at the moment of publishing) to offer
cross-posting it to Bluesky. It never reads replies, drafts, timelines, DMs, or any
other page content, runs only while the user is signed in to Supersky, and can be
turned off from the card or in settings.

## Remote code

None. All logic is bundled in the package; the extension loads no remote scripts and
uses no `eval`.

## Data use

- **What is collected:** the user's Bluesky login session and the content they choose
  to post or share. Settings and drafts are stored locally.
- **Where it goes:** only to the user's own Bluesky server (their PDS) and the Bluesky
  services listed above, to perform the actions the user requests. Nothing is sent to
  the developer or any third party, and nothing is sold.
- **Authentication:** session tokens are stored on the device with `storage` and used
  only to talk to Bluesky.
- Privacy policy: https://nester-xyz.github.io/Supersky/privacy-policy.html
