import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FetchRejectedError, isPublicAddress, safeFetch } from './safe-fetch';

const strict = { maxBytes: 1024, timeoutMs: 2000, allowPrivate: false };

async function code(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'ok';
  } catch (error) {
    return error instanceof FetchRejectedError ? error.code : String(error);
  }
}

describe('isPublicAddress', () => {
  it.each([
    ['8.8.8.8', true],
    ['2a00:1450:4001:80b::200e', true],
    ['127.0.0.1', false],
    ['10.1.2.3', false],
    ['172.16.0.1', false],
    ['192.168.1.1', false],
    ['169.254.169.254', false],
    ['100.64.0.1', false],
    ['0.0.0.0', false],
    ['::1', false],
    ['fd00::1', false],
    ['fe80::1', false],
    ['::ffff:127.0.0.1', false],
    ['224.0.0.1', false],
  ])('%s → %s', (address, expected) => {
    expect(isPublicAddress(address)).toBe(expected);
  });
});

describe('safeFetch', () => {
  it('refuses private targets, odd schemes, credentials and ports', async () => {
    expect(await code(safeFetch('http://127.0.0.1/', strict))).toBe('url.privateAddress');
    expect(await code(safeFetch('http://0x7f000001/', strict))).toBe('url.privateAddress');
    expect(await code(safeFetch('http://[::1]/', strict))).toBe('url.privateAddress');
    expect(await code(safeFetch('http://169.254.169.254/latest/meta-data', strict))).toBe(
      'url.privateAddress',
    );
    expect(await code(safeFetch('http://localhost/', strict))).toBe('url.privateAddress');
    expect(await code(safeFetch('file:///etc/passwd', strict))).toBe('url.invalid');
    expect(await code(safeFetch('http://user:pass@example.com/', strict))).toBe('url.invalid');
    expect(await code(safeFetch('http://example.com:6379/', strict))).toBe('url.invalid');
    expect(await code(safeFetch('not a url', strict))).toBe('url.invalid');
  });

  describe('against a local server (private hosts allowed, as in tests)', () => {
    let server: Server;
    let base: string;
    beforeAll(async () => {
      server = createServer((request, response) => {
        if (request.url === '/small') return response.end('hello');
        if (request.url === '/big') return response.end(Buffer.alloc(4096));
        if (request.url === '/chunked') {
          response.write(Buffer.alloc(800));
          response.write(Buffer.alloc(800));
          return response.end();
        }
        if (request.url === '/loop') {
          response.writeHead(302, { location: '/loop' });
          return response.end();
        }
        if (request.url === '/hop') {
          response.writeHead(301, { location: '/small' });
          return response.end();
        }
        if (request.url === '/slow') return;
        response.writeHead(404).end();
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });
    afterAll(() => {
      server.closeAllConnections();
      server.close();
    });
    const relaxed = { ...strict, allowPrivate: true };

    it('downloads, follows a few redirects and enforces limits', async () => {
      expect((await safeFetch(`${base}/small`, relaxed)).body.toString()).toBe('hello');
      expect((await safeFetch(`${base}/hop`, relaxed)).body.toString()).toBe('hello');
      expect(await code(safeFetch(`${base}/big`, relaxed))).toBe('url.tooLarge');
      expect(await code(safeFetch(`${base}/chunked`, relaxed))).toBe('url.tooLarge');
      expect(await code(safeFetch(`${base}/loop`, relaxed))).toBe('url.tooManyRedirects');
      expect(await code(safeFetch(`${base}/missing`, relaxed))).toBe('url.httpError');
      expect(await code(safeFetch(`${base}/slow`, { ...relaxed, timeoutMs: 300 }))).toBe(
        'url.timeout',
      );
    });
  });
});
