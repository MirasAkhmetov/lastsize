import { Writable } from 'node:stream';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { REDACTED_PATHS } from './index.js';

function captureLogger() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });
  const logger = pino({ redact: { paths: [...REDACTED_PATHS], censor: '[REDACTED]' } }, stream);
  return { logger, lines };
}

describe('logger redaction', () => {
  it('hides secrets at the top level and one level deep', () => {
    const { logger, lines } = captureLogger();
    logger.info(
      {
        password: 'p@ss',
        integration: { apiKey: 'wb-key-123', token: 'kaspi-token-456', provider: 'WILDBERRIES' },
      },
      'integration connected',
    );
    const output = lines.join('');
    expect(output).not.toContain('p@ss');
    expect(output).not.toContain('wb-key-123');
    expect(output).not.toContain('kaspi-token-456');
    expect(output).toContain('WILDBERRIES');
  });

  it('hides auth headers and cookies of requests', () => {
    const { logger, lines } = captureLogger();
    logger.info({
      req: { headers: { authorization: 'Bearer abc', cookie: 'sid=xyz', 'x-auth-token': 'tok' } },
    });
    const output = lines.join('');
    expect(output).not.toContain('Bearer abc');
    expect(output).not.toContain('sid=xyz');
    expect(output).not.toContain('"tok"');
  });
});
