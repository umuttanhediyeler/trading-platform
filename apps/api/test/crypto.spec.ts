import { randomBytes } from 'crypto';
import { decryptSecret, encryptSecret } from '../src/common/crypto';

describe('AES-256-GCM credential encryption', () => {
  const key = randomBytes(32).toString('hex');

  it('round-trips a secret', () => {
    const secret = 'PKTEST1234567890alpaca-key';
    const encrypted = encryptSecret(secret, key);
    expect(encrypted).not.toContain(secret);
    expect(decryptSecret(encrypted, key)).toBe(secret);
  });

  it('produces different ciphertexts for the same plaintext (random IV)', () => {
    const a = encryptSecret('same-secret', key);
    const b = encryptSecret('same-secret', key);
    expect(a).not.toBe(b);
  });

  it('rejects tampered ciphertext (GCM auth tag)', () => {
    const encrypted = encryptSecret('secret', key);
    const [iv, tag, data] = encrypted.split('.');
    const tampered = Buffer.from(data, 'base64');
    tampered[0] ^= 0xff;
    expect(() =>
      decryptSecret(`${iv}.${tag}.${tampered.toString('base64')}`, key),
    ).toThrow();
  });

  it('rejects wrong-size keys', () => {
    expect(() => encryptSecret('secret', 'deadbeef')).toThrow(
      /32 bytes hex/,
    );
  });
});
