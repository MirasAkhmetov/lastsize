import { describe, expect, it } from 'vitest';
import { isValidBinIin } from './bin-iin.js';

describe('isValidBinIin', () => {
  it.each(['971240001315', '990340005977', '940140000385', '051140004354'])(
    'accepts the real BIN %s',
    (bin) => {
      expect(isValidBinIin(bin)).toBe(true);
    },
  );

  it('rejects a single mistyped digit', () => {
    expect(isValidBinIin('971240001316')).toBe(false);
    expect(isValidBinIin('971240011315')).toBe(false);
  });

  it.each(['', '12345', '97124000131', '9712400013150', '97124000131a', '9712 4000 1315'])(
    'rejects %j',
    (value) => {
      expect(isValidBinIin(value)).toBe(false);
    },
  );
});
