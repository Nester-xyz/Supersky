import * as dagCbor from '@ipld/dag-cbor';
import { CID } from 'multiformats/cid';
import * as Hasher from 'multiformats/hashes/hasher';
import { BlobRef } from '@atproto/api';

/**
 * Computing a record's CID locally is what makes single-commit threads
 * possible: each post in the thread needs its parent's { uri, cid } before
 * anything is sent, so the refs are derived the same way the PDS will
 * (DAG-CBOR encoding, SHA-256, CIDv1 with the dag-cbor codec 0x71). The
 * approach mirrors the official client's.
 */
const sha256 = Hasher.from({
  name: 'sha2-256',
  code: 0x12,
  // The copy pins the bytes to a plain ArrayBuffer, which WebCrypto requires.
  encode: async (input) =>
    new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(input))),
});

export async function computeRecordCid(record: unknown): Promise<string> {
  // `prepareForHashing` strips undefined values and converts BlobRef
  // instances to their IPLD form; both would otherwise change the bytes and
  // produce a CID the server disagrees with.
  const prepared = prepareForHashing(record);
  const encoded = dagCbor.encode(prepared);
  const digest = await sha256.digest(encoded);
  return CID.createV1(0x71, digest).toString();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function prepareForHashing(value: any): any {
  if (value instanceof BlobRef) {
    return value.ipld();
  }

  if (Array.isArray(value)) {
    let pure = true;
    const mapped = value.map((item) => {
      const prepared = prepareForHashing(item);
      if (prepared !== item) pure = false;
      return prepared;
    });
    return pure ? value : mapped;
  }

  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    let pure = true;
    for (const key in value) {
       
      const item = value[key];
      if (item === undefined) {
        pure = false;
        continue;
      }
      const prepared = prepareForHashing(item);
      if (prepared !== item) pure = false;
      out[key] = prepared;
    }
    return pure ? value : out;
  }

  return value;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isPlainObject(value: any): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
