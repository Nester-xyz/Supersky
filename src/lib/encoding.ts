export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Split a data: URL into its mime type and raw base64 payload. */
export function dataUrlToParts(dataUrl: string): { mime: string; base64: string } {
  const comma = dataUrl.indexOf(',');
  const header = dataUrl.slice(0, comma);
  const base64 = dataUrl.slice(comma + 1);
  const mime = header.match(/^data:([^;]+);base64$/)?.[1] ?? 'application/octet-stream';
  return { mime, base64 };
}
