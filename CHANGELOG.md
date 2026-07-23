# Changelog

Notable user-facing changes to Supersky. Releases before 0.1.2 predate this
file; see the commit history for those.

## Unreleased

### Added

- **Notifications in the popup.** A bell in the header, wearing the same unread
  count as the toolbar badge, flips the composer into a full notifications
  inbox: likes, reposts, replies, mentions, quotes, and follows, split into
  All and Mentions exactly like the official app. Likes, reposts, and follows
  of the same post collapse into one row ("Riya and 3 others liked your post")
  with stacked avatars, and rows quote the post of yours they're reacting to.
  Follow rows offer a one-click Follow back, and the list keeps loading as
  you scroll. Opening the inbox marks everything seen so the badge clears,
  unread rows keep their tint for the visit, and clicking any row opens the
  right post or profile on bsky.app.

## 0.2.0 (2026-07-21)

### Added

- **Threads.** Chain posts in the composer with "Add to thread": every post in
  the thread gets its own row on the thread line, with its own editor, counter,
  and images. Or write past 300 characters and hit "Split into thread" to break
  the text at natural boundaries (paragraphs, then sentences, then words). The
  whole thread publishes in one atomic commit, so it can never land
  half-posted. Each post carries its own photos, and a video can go on any
  post in the thread (one per thread), so you can cross-post an X photo and
  add a video as the next post. Works in the X cross-post card too, which is a
  full mini composer. Threads save into drafts (segment images included);
  GIFs and link cards stay on the first post.
- **Reply from a banner.** Reply, mention, and quote notifications now carry a
  Reply button (Chrome). One click opens the composer in reply mode, showing
  who and what you're replying to, and the reply nests correctly under their
  post, threads included.

- **Cross-post suggestions from X.** After you publish a main post on x.com
  (never replies, quotes, threads, or community posts), a card in the corner
  offers to post it on Bluesky too. It expands into a full mini composer built
  like the popup: the tweet's text, images, and video carry over, and you can
  edit freely, adding or removing photos, swapping in a different video
  (uploaded through Bluesky's video service with live progress), building a
  thread by splitting long text or with the "+" button (each post with its own
  photos), and handing the whole thing off to the full Supersky composer, media
  and all.
  Works only while signed in, reads the post only at the moment you publish it,
  and can be turned off from the card or in settings.

- **Up to 10 images per post.** Matching Bluesky's new limit: up to 4 images
  post as the classic embed every client renders, and 5–10 use Bluesky's new
  gallery embed. Multiple images show as a horizontally scrolling strip of
  tiles with per-image alt text; more images are added from the photo button.
- **Video upload.** Attach one video (MP4, WebM, MOV, or MPEG; up to 3 minutes
  and 100 MB, Bluesky's current limits). The upload starts immediately via
  Bluesky's video service, shows uploading/processing progress on the preview,
  and pressing Post while it's still processing publishes automatically the
  moment it's ready. Includes alt text. Video is always offered; Bluesky only
  allows uploads once an account's email is confirmed, so an unconfirmed
  account that tries to upload gets a dismissible note explaining why (the rest
  of the post is untouched). Because the check runs at upload time, switching
  between accounts with different email status stays reliable.
- **GIF picker.** A searchable GIF popover backed by the same Bluesky GIF
  service (Klipy) the official app uses, with featured GIFs, infinite scroll,
  and alt text. GIFs post in the exact format bsky.app plays inline.
- **"Who can interact" settings.** The pill above the toolbar (like the
  official composer) opens quote-post and reply controls: everybody, nobody,
  or any mix of mentioned users, people you follow, your followers, and your
  lists. Rules publish atomically with the post as threadgate/postgate
  records, and the pill summarizes the current state.
- **Drafts.** Save the current post (text, images, GIF, language, and
  interaction settings) to a local drafts shelf behind the new Drafts button
  in the header, reopen or delete drafts, and the draft you opened cleans
  itself up once it's posted. Up to 20 drafts, stored on this device only.
- **Nothing is lost when the popup closes.** Clicking outside the popup
  dismisses it instantly, so the composer now autosaves everything as you go
  (text, language, images, GIF, and interaction settings) and restores it all
  the next time it opens. (Videos are the one exception: their upload session
  can't outlive the popup.)

### Changed

- **Sharper image uploads.** Images are now compressed toward Bluesky's new
  2 MB blob limit at up to 4000 px (previously 1 MB at 2000 px), and alt text
  can be 2000 characters to match the official app.
- Posts are published with `applyWrites`, so a post and its interaction
  settings land in one atomic commit.

## 0.1.2 (2026-07-19)

### Added

- **Notification banners.** Desktop toasts for Bluesky activity ("Name liked
  your post"), each linking straight to the post or profile. Bursts collapse
  into a single grouped summary, and per-account watermarks make sure nothing
  is announced twice.
- **Avatar toast icons.** Banners show the author's avatar rather than the
  generic app icon, falling back to the app icon when the image can't be
  fetched.
- **A Notifications tab in settings.** Separate toggles for the unread badge
  and for banners, a button that sends a test banner, and diagnostics that
  explain what to do when Chrome has notifications blocked.
- **Slate, a dimmer dark theme.** It lifts the canvas off near-black and
  desaturates the navy toward blue-grey. All nine accent colours work on top
  of it unchanged.

### Changed

- **The unread badge is faster and steadier.** It refreshes every 30 seconds
  (roughly every 15 in practice), keeps its count across browser restarts,
  retries after a failed request, and updates the moment the popup opens.
- **Notification settings open directly.** The settings page now jumps to the
  browser or OS notification panel instead of describing where to find it.
- **Branding is consistently "Supersky"** across the manifest, page titles,
  and the wordmark.

### Other

- Published a [privacy policy](https://nester-xyz.github.io/Supersky/privacy-policy.html)
  for the Chrome Web Store listing.
- Releases are now built and submitted to the Chrome Web Store automatically
  from a version tag. See [docs/RELEASING.md](docs/RELEASING.md).
