import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import type { LookupFunction } from 'node:net';
import ipaddr from 'ipaddr.js';

export type FetchRejection =
  | 'url.invalid'
  | 'url.privateAddress'
  | 'url.unreachable'
  | 'url.timeout'
  | 'url.tooLarge'
  | 'url.httpError'
  | 'url.tooManyRedirects';

export class FetchRejectedError extends Error {
  constructor(
    readonly code: FetchRejection,
    readonly status?: number,
  ) {
    super(code);
    this.name = 'FetchRejectedError';
  }
}

export interface SafeFetchOptions {
  maxBytes: number;
  timeoutMs: number;
  /** Tests only (IMPORT_ALLOW_PRIVATE_HOSTS): lets requests reach localhost fakes. */
  allowPrivate: boolean;
  accept?: string;
}

export interface SafeFetchResult {
  body: Buffer;
  contentType: string | null;
}

const MAX_REDIRECTS = 3;
const STANDARD_PORTS = new Set(['', '80', '443', '8080', '8443']);

/** Only ordinary public unicast addresses: no loopback, private, link-local, CGNAT, multicast … */
export function isPublicAddress(address: string): boolean {
  if (!ipaddr.isValid(address)) return false;
  return ipaddr.process(address).range() === 'unicast';
}

function checkedUrl(raw: string, allowPrivate: boolean): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new FetchRejectedError('url.invalid');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new FetchRejectedError('url.invalid');
  if (url.username || url.password) throw new FetchRejectedError('url.invalid');
  if (!allowPrivate && !STANDARD_PORTS.has(url.port)) throw new FetchRejectedError('url.invalid');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (ipaddr.isValid(host) && !allowPrivate && !isPublicAddress(host))
    throw new FetchRejectedError('url.privateAddress');
  return url;
}

/**
 * The address the socket connects to is the one checked here, so DNS rebinding between the
 * check and the connection is impossible. Any private address among the answers rejects the host.
 */
function guardedLookup(allowPrivate: boolean): LookupFunction {
  return (hostname, options, callback) => {
    dnsLookup(hostname, { ...options, all: true }, (error, addresses: LookupAddress[]) => {
      if (error) return callback(error, '', 0);
      if (!allowPrivate && addresses.some((entry) => !isPublicAddress(entry.address))) {
        return callback(new FetchRejectedError('url.privateAddress'), '', 0);
      }
      const first = addresses[0];
      if (!first) return callback(new FetchRejectedError('url.unreachable'), '', 0);
      if ((options as { all?: boolean }).all) {
        (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, addresses);
      } else {
        callback(null, first.address, first.family);
      }
    });
  };
}

function requestOnce(
  url: URL,
  options: SafeFetchOptions,
  signal: AbortSignal,
): Promise<{ redirect: string } | SafeFetchResult> {
  const client = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const request = client.get(
      url,
      {
        agent: false,
        lookup: guardedLookup(options.allowPrivate),
        signal,
        headers: {
          accept: options.accept ?? '*/*',
          'accept-encoding': 'identity',
          'user-agent': 'LastSizeImporter/1.0',
        },
      },
      (response) => {
        const status = response.statusCode ?? 0;
        if (status >= 300 && status < 400 && response.headers.location) {
          response.resume();
          resolve({ redirect: new URL(response.headers.location, url).toString() });
          return;
        }
        if (status < 200 || status >= 300) {
          response.resume();
          reject(new FetchRejectedError('url.httpError', status));
          return;
        }
        const declared = Number(response.headers['content-length'] ?? 0);
        if (declared > options.maxBytes) {
          response.destroy();
          reject(new FetchRejectedError('url.tooLarge'));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > options.maxBytes) {
            response.destroy();
            reject(new FetchRejectedError('url.tooLarge'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () =>
          resolve({
            body: Buffer.concat(chunks),
            contentType: response.headers['content-type'] ?? null,
          }),
        );
        response.on('error', reject);
      },
    );
    request.on('error', reject);
  });
}

/**
 * Downloads a user-supplied URL without letting it reach the server's own network:
 * http(s) only, public addresses only (checked on every redirect), size and time limits.
 */
export async function safeFetch(raw: string, options: SafeFetchOptions): Promise<SafeFetchResult> {
  const signal = AbortSignal.timeout(options.timeoutMs);
  let url = checkedUrl(raw, options.allowPrivate);
  for (let redirects = 0; ; redirects++) {
    let result: Awaited<ReturnType<typeof requestOnce>>;
    try {
      result = await requestOnce(url, options, signal);
    } catch (error) {
      if (error instanceof FetchRejectedError) throw error;
      if (signal.aborted) throw new FetchRejectedError('url.timeout');
      throw new FetchRejectedError('url.unreachable');
    }
    if (!('redirect' in result)) return result;
    if (redirects >= MAX_REDIRECTS) throw new FetchRejectedError('url.tooManyRedirects');
    url = checkedUrl(result.redirect, options.allowPrivate);
  }
}
