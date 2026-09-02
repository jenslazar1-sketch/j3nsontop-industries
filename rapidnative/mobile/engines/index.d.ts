/* Types for the shared engines.
 *
 * The engines themselves are ES5 UMD and stay that way (they are shared verbatim
 * with three other hosts). These declarations cover the surface the app actually
 * calls, so the screens are type-checked without touching the engine sources. */

export interface ZipEntry {
  name: string;
  usize: number;
  csize: number;
  method: number;
  offset: number;
  crc: number;
  time?: number;
  date?: number;
}

export interface SigningBlock {
  id: number;
  name: string | null;
  size: number;
  data: Uint8Array;
}

export interface Zip {
  bytes: Uint8Array;
  entries: ZipEntry[];
  comment: string;
  signing: {
    present: boolean;
    size: number;
    blocks: SigningBlock[];
    schemes: string[];
    start?: number;
    end?: number;
  };
  get(name: string): ZipEntry | null;
  has(name: string): boolean;
  read(entry: ZipEntry | string): Promise<Uint8Array>;
  readText(entry: ZipEntry | string): Promise<string>;
  raw(entry: ZipEntry | string): Uint8Array;
  locate(entry: ZipEntry | string): { start: number; end: number } | null;
}

/** A decoded binary XML document (AndroidManifest.xml). */
export interface AxmlDoc {
  root: AxmlNode;
  strings: string[];
  resIds: number[];
}

export interface AxmlNode {
  name: string;
  ns: string | null;
  attrs: AxmlAttr[];
  children: AxmlNode[];
}

export interface AxmlAttr {
  name: string;
  ns: string | null;
  type: number;
  value: number;
  raw: number;
}

export interface DexFile {
  classes: Array<{ name: string; methods?: unknown[] }>;
  strings: string[];
  header: Record<string, number>;
  [k: string]: unknown;
}

export interface ParsedCert {
  subject: string;
  issuer: string;
  serial: string;
  notBefore?: string;
  notAfter?: string;
  algorithm?: string;
  der: Uint8Array;
  scheme?: string;
  schemes?: string[];
  fp?: { sha256: string; sha1: string } | null;
}

export interface ElfInfo {
  is64: boolean;
  machine: string;
  type: string;
  needed: string[];
  soname: string | null;
  sections: Array<{ name: string; size: number; offset: number }>;
  [k: string]: unknown;
}

export interface VrBlocker {
  /** 'design' is informational — it describes 6DoF/controller assumptions
   *  rather than something that stops the app installing or starting. */
  level: 'hard' | 'shim' | 'emulator' | 'fixable' | 'design';
  title: string;
  detail: string;
}

export interface VrReport {
  isVR: boolean;
  runtime: { id: string; name: string } | null;
  engine: string | null;
  abis: string[];
  has64: boolean;
  hasArm: boolean;
  hasX86: boolean;
  features: Array<{ name: string; required: boolean }>;
  permissions: string[];
  categories: string[];
  blockers: VrBlocker[];
  notes: string[];
  libs: Array<{ abi: string; name: string; size: number }>;
}

/** Severity as tamper.js emits it. Note 'med', not 'medium'. */
export type Severity = 'critical' | 'high' | 'med' | 'low' | 'info';

export interface TamperFinding {
  sev: Severity;
  id: string;
  title: string;
  detail: string;
  evidence: string | null;
}

export interface TamperReport {
  verdict: 'INJECTED' | 'MOD PRESENT' | 'REPACKED' | 'LIKELY REPACKED' | 'MINOR SIGNALS' | 'CLEAN';
  /** 'ok' is the clean case — there is no 'clean' level. */
  level: 'critical' | 'high' | 'med' | 'low' | 'ok';
  score: number;
  maxSev: Severity;
  findings: TamperFinding[];
  schemes: string[];
  loadedLibs: Record<string, number>;
}

export interface TamperContext {
  zip: Zip;
  manifest: AxmlDoc | null;
  dexes: Array<{ name: string; size: number; dex: DexFile }>;
  certs: ParsedCert[];
}

export declare const J3Bin: {
  crc32(b: Uint8Array): number;
  inflate(b: Uint8Array): Uint8Array;
  inflateRaw(b: Uint8Array): Uint8Array;
  deflate(b: Uint8Array): Uint8Array;
  utf8(b: Uint8Array): string;
  toUtf8(s: string): Uint8Array;
  hex(b: Uint8Array, sep?: string): string;
  human(n: number): string;
  entropy(b: Uint8Array): number;
};

export declare const J3Zip: {
  open(bytes: Uint8Array): Zip;
  build(entries: unknown[], opts?: unknown): Uint8Array;
  SIG_SCHEMES: Record<number, string>;
};

export declare const J3Attrs: Record<string, unknown>;

export declare const J3Axml: {
  parseXml(bytes: Uint8Array): AxmlDoc;
  toXml(doc: AxmlDoc): string;
  encode(doc: AxmlDoc): Uint8Array;
  parseArsc(bytes: Uint8Array): unknown;
  attrValue(doc: AxmlDoc, node: AxmlNode, name: string): string | null;
  attrOf(doc: AxmlDoc, node: AxmlNode, name: string): AxmlAttr | null;
  children(node: AxmlNode, name?: string): AxmlNode[];
  find(node: AxmlNode, name: string): AxmlNode[];
  ANDROID_NS: string;
};

export declare const J3Dex: { parse(bytes: Uint8Array): DexFile };

export declare const J3Smali: {
  disassemble(dex: DexFile, codeOff: number): unknown;
  render(dis: unknown): string;
};

export declare const J3Cert: {
  parseCert(der: Uint8Array): ParsedCert;
  fingerprints(der: Uint8Array): Promise<{ sha256: string; sha1: string } | null>;
  certsFromPkcs7(der: Uint8Array): ParsedCert[];
  certsFromSigBlock(data: Uint8Array): ParsedCert[];
};

export declare const J3Elf: {
  parse(bytes: Uint8Array): ElfInfo;
  notes(info: ElfInfo): string[];
  MACHINE: Record<number, string>;
};

export declare const J3Vr: {
  scan(zip: Zip, doc: AxmlDoc | null, axml: typeof J3Axml): VrReport;
  verdict(r: VrReport): { level: string; text: string };
  relaxPlan(doc: AxmlDoc | null, axml: typeof J3Axml): unknown[];
};

export declare const J3Tamper: {
  scan(ctx: TamperContext, axml: typeof J3Axml, smali: typeof J3Smali): TamperReport;
};
