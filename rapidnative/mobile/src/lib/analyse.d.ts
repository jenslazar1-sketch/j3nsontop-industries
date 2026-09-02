/* Types for analyse.js. The implementation stays plain JS so it can be run and
 * tested under Node against real APKs, with no build step. */
import type { Analysis } from './store';

export declare function analyse(bytes: Uint8Array): Promise<Analysis>;
export declare function manifestFacts(doc: unknown): Analysis['facts'];
export declare function shape(zip: unknown): Analysis['shape'];
export declare function natives(zip: unknown): Promise<Analysis['libs']>;
export declare function collectCerts(zip: unknown): Promise<unknown[]>;
/** Byte count -> "2.6 MB". Re-exported from the binary engine. */
export declare function human(n: number): string;
