import { describe, expect, it } from 'vitest';
import { domainOf, extractFirstUrl, postWebUrl } from './urls';

describe('extractFirstUrl', () => {
  it('returns null when there is no URL', () => {
    expect(extractFirstUrl('just some words')).toBeNull();
    expect(extractFirstUrl('')).toBeNull();
  });

  it('finds the first URL in text', () => {
    expect(extractFirstUrl('check https://example.com and https://other.dev')).toBe(
      'https://example.com',
    );
  });

  it('strips trailing punctuation', () => {
    expect(extractFirstUrl('read https://example.com/post.')).toBe('https://example.com/post');
    expect(extractFirstUrl('what about https://example.com/a?b=c!?')).toBe(
      'https://example.com/a?b=c',
    );
  });

  it('drops an unbalanced closing paren but keeps balanced ones', () => {
    expect(extractFirstUrl('(see https://example.com/a)')).toBe('https://example.com/a');
    expect(extractFirstUrl('https://en.wikipedia.org/wiki/Sky_(disambiguation)')).toBe(
      'https://en.wikipedia.org/wiki/Sky_(disambiguation)',
    );
  });

  it('is case-insensitive on the scheme', () => {
    expect(extractFirstUrl('HTTPS://Example.com/x')).toBe('HTTPS://Example.com/x');
  });
});

describe('domainOf', () => {
  it('extracts the hostname and strips www', () => {
    expect(domainOf('https://www.example.com/a/b')).toBe('example.com');
    expect(domainOf('https://blog.example.co.uk/x')).toBe('blog.example.co.uk');
  });

  it('falls back to the input on invalid URLs', () => {
    expect(domainOf('not a url')).toBe('not a url');
  });
});

describe('postWebUrl', () => {
  it('builds the bsky.app URL from an at:// URI', () => {
    expect(
      postWebUrl('alice.bsky.social', 'at://did:plc:abc123/app.bsky.feed.post/3kxyz'),
    ).toBe('https://bsky.app/profile/alice.bsky.social/post/3kxyz');
  });
});
