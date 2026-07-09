import { describe, expect, it } from 'vitest';
import { MAX_GRAPHEMES, buildShareText, graphemeLength, truncateToGraphemes } from './text';

describe('graphemeLength', () => {
  it('counts plain ASCII per character', () => {
    expect(graphemeLength('')).toBe(0);
    expect(graphemeLength('hello')).toBe(5);
  });

  it('counts emoji and combined characters as single graphemes', () => {
    expect(graphemeLength('👍')).toBe(1);
    expect(graphemeLength('👨‍👩‍👧‍👦')).toBe(1); // ZWJ family
    expect(graphemeLength('né')).toBe(2); // combining accent
  });
});

describe('truncateToGraphemes', () => {
  it('returns short text unchanged', () => {
    expect(truncateToGraphemes('short', 10)).toBe('short');
  });

  it('truncates with an ellipsis within budget', () => {
    const result = truncateToGraphemes('a'.repeat(50), 10);
    expect(result.endsWith('…')).toBe(true);
    expect(graphemeLength(result)).toBeLessThanOrEqual(10);
  });

  it('handles a zero budget', () => {
    expect(truncateToGraphemes('anything', 0)).toBe('');
  });
});

describe('buildShareText', () => {
  it('uses the URL for page and link shares', () => {
    expect(buildShareText({ kind: 'page', url: 'https://example.com' })).toBe(
      'https://example.com',
    );
    expect(buildShareText({ kind: 'link', url: 'https://example.com/x' })).toBe(
      'https://example.com/x',
    );
  });

  it('quotes a selection followed by the source URL', () => {
    const text = buildShareText({
      kind: 'selection',
      text: 'a wise quote',
      url: 'https://example.com',
    });
    expect(text).toBe('“a wise quote”\n\nhttps://example.com');
  });

  it('keeps long selections within the post limit', () => {
    const text = buildShareText({
      kind: 'selection',
      text: 'word '.repeat(200),
      url: 'https://example.com/article',
    });
    expect(graphemeLength(text)).toBeLessThanOrEqual(MAX_GRAPHEMES);
    expect(text).toContain('https://example.com/article');
  });
});
