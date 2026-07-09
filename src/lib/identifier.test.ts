import { describe, expect, it } from 'vitest';
import { normalizeIdentifier } from './identifier';

describe('normalizeIdentifier', () => {
  it('strips a leading @', () => {
    expect(normalizeIdentifier('@alice.bsky.social')).toBe('alice.bsky.social');
  });

  it('expands bare names to bsky.social handles', () => {
    expect(normalizeIdentifier('alice')).toBe('alice.bsky.social');
    expect(normalizeIdentifier('@alice ')).toBe('alice.bsky.social');
  });

  it('leaves full handles, emails, and DIDs alone', () => {
    expect(normalizeIdentifier('alice.example.com')).toBe('alice.example.com');
    expect(normalizeIdentifier('alice@example.com')).toBe('alice@example.com');
    expect(normalizeIdentifier('did:plc:abc123')).toBe('did:plc:abc123');
  });

  it('handles empty input', () => {
    expect(normalizeIdentifier('  ')).toBe('');
  });
});
