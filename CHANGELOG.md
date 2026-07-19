# Changelog

Notable user-facing changes to Supersky. Releases before 0.1.2 predate this
file; see the commit history for those.

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
