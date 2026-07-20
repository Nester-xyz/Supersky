/**
 * AT Protocol record keys (TIDs): 64 bits = 53-bit microsecond timestamp +
 * 10-bit clock id, base32-sortable encoded to 13 chars. Generating them
 * client-side lets a post and its threadgate/postgate share an rkey inside a
 * single applyWrites commit, which the lexicons require.
 */
const S32_ALPHABET = '234567abcdefghijklmnopqrstuvwxyz';

/** Random per-session clock id keeps concurrent devices from colliding. */
const clockId = BigInt(Math.floor(Math.random() * 1024));

let lastTimestampMicros = 0n;

export function nextTid(): string {
  let micros = BigInt(Date.now()) * 1000n;
  // Strictly monotonic within this session so threads sort predictably.
  if (micros <= lastTimestampMicros) micros = lastTimestampMicros + 1n;
  lastTimestampMicros = micros;

  let value = (micros << 10n) | clockId;
  let out = '';
  for (let i = 0; i < 13; i++) {
    out = S32_ALPHABET[Number(value & 31n)] + out;
    value >>= 5n;
  }
  return out;
}
