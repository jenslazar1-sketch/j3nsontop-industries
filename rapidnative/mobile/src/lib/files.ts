/* J3NSONTOP INDUSTRIES - files.ts
 *
 * The only part of the analysis path that has to touch the device. Everything
 * downstream of readApk() is plain data, which is why analyse.js can be tested
 * on a desktop.
 *
 * expo-file-system was rewritten in SDK 54 (File/Directory classes) with the old
 * call moved to the /legacy subpath, so the read below tries the new API, then
 * the old one, then legacy. That is deliberate: it keeps this file working
 * whether RapidNative pins SDK 53, 54 or later, and a wrong guess here is an
 * unhelpful "readAsStringAsync is not a function" at the exact moment the user
 * picks their first file.
 */
import * as DocumentPicker from 'expo-document-picker';

/** APKs above this are refused rather than allowed to OOM the app mid-parse. */
export const MAX_BYTES = 400 * 1024 * 1024;

/** Anything past this reads fine but is slow enough to warn about first. */
export const WARN_BYTES = 120 * 1024 * 1024;

const B64 =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/* Built once. A lookup table is roughly an order of magnitude faster than
 * indexOf() per character, which matters when the input is a 76 MB string. */
const LOOKUP = (() => {
  const t = new Uint8Array(256).fill(255);
  for (let i = 0; i < B64.length; i++) t[B64.charCodeAt(i)] = i;
  return t;
})();

/**
 * base64 -> bytes, without depending on atob (which is not guaranteed present
 * on every Hermes build) and without building intermediate strings.
 */
export function base64ToBytes(b64: string): Uint8Array {
  let len = b64.length;
  while (len > 0 && (b64[len - 1] === '=' || b64[len - 1] === '\n' || b64[len - 1] === '\r')) len--;

  // Upper bound; trimmed at the end once the real count is known.
  const out = new Uint8Array(Math.floor((len * 3) / 4) + 3);
  let o = 0;
  let acc = 0;
  let bits = 0;

  for (let i = 0; i < len; i++) {
    const v = LOOKUP[b64.charCodeAt(i)];
    if (v === 255) continue;            // whitespace / newline in wrapped base64
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 0xff;
    }
  }
  return out.subarray(0, o);
}

/** Reads a content:// or file:// URI as base64, across expo-file-system versions. */
async function readBase64(uri: string): Promise<string> {
  const attempts: Array<() => Promise<string>> = [];

  try {
    const FS: any = require('expo-file-system');
    // SDK 54+ object API
    if (FS?.File) {
      attempts.push(async () => {
        const f = new FS.File(uri);
        const r = f.base64();
        return typeof r?.then === 'function' ? await r : r;
      });
    }
    // classic API, still present in 53 and re-exported by some 54 builds
    if (typeof FS?.readAsStringAsync === 'function') {
      attempts.push(() => FS.readAsStringAsync(uri, { encoding: 'base64' }));
    }
  } catch {
    /* module shape differs; fall through to legacy */
  }

  attempts.push(async () => {
    const Legacy: any = require('expo-file-system/legacy');
    return Legacy.readAsStringAsync(uri, { encoding: 'base64' });
  });

  let last: unknown = null;
  for (const attempt of attempts) {
    try {
      const s = await attempt();
      if (typeof s === 'string' && s.length) return s;
    } catch (e) {
      last = e;
    }
  }
  throw new Error(
    'Could not read the file. ' + (last instanceof Error ? last.message : String(last ?? ''))
  );
}

export interface PickedFile {
  name: string;
  size: number;
  bytes: Uint8Array;
}

/**
 * Opens the system picker and returns the chosen APK as bytes.
 * Resolves to null if the user cancels.
 */
export async function pickApk(): Promise<PickedFile | null> {
  const res = await DocumentPicker.getDocumentAsync({
    // Android reports APKs under several types depending on the provider, and
    // some file managers report octet-stream, so accept broadly and validate
    // by magic bytes instead of trusting the MIME type.
    type: ['application/vnd.android.package-archive', 'application/zip', 'application/octet-stream', '*/*'],
    copyToCacheDirectory: true,
    multiple: false,
  });

  if (res.canceled || !res.assets?.length) return null;
  const asset = res.assets[0];

  if (typeof asset.size === 'number' && asset.size > MAX_BYTES) {
    throw new Error(
      `That file is ${(asset.size / 1048576).toFixed(0)} MB. The on-device limit is ` +
        `${MAX_BYTES / 1048576} MB — parsing it would run the app out of memory.`
    );
  }

  const b64 = await readBase64(asset.uri);
  const bytes = base64ToBytes(b64);

  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new Error(`"${asset.name}" is not a zip/APK — it does not start with the PK signature.`);
  }

  return { name: asset.name ?? 'unknown.apk', size: bytes.length, bytes };
}
