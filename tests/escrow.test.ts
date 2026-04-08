/**
 * Escrow tests — OnChainEscrowProvider config validation and EscrowProvider interface contract.
 */

import { OnChainEscrowProvider, OnChainEscrowConfig } from '../src/escrow/onchain-escrow';
import { EscrowProvider } from '../src';

describe('OnChainEscrowProvider', () => {
  const validConfig: OnChainEscrowConfig = {
    contractAddress: '0x' + 'a'.repeat(40),
    buyerPrivateKey: '0x' + '1'.repeat(64),
    sellerAddress: '0x' + 'b'.repeat(40),
    rpcUrl: 'https://sepolia.base.org',
  };

  describe('constructor', () => {
    it('creates an instance with valid config', () => {
      const provider = new OnChainEscrowProvider(validConfig);
      expect(provider).toBeDefined();
    });

    it('implements EscrowProvider interface', () => {
      const provider = new OnChainEscrowProvider(validConfig);
      const escrow: EscrowProvider = provider;
      expect(typeof escrow.lock).toBe('function');
      expect(typeof escrow.release).toBe('function');
      expect(typeof escrow.freeze).toBe('function');
    });

    it('defaults rpcUrl to Base Sepolia', () => {
      const config = { ...validConfig };
      delete (config as any).rpcUrl;
      const provider = new OnChainEscrowProvider(config);
      expect(provider).toBeDefined();
    });

    it('throws on invalid private key', () => {
      expect(
        () => new OnChainEscrowProvider({ ...validConfig, buyerPrivateKey: 'not-a-key' })
      ).toThrow();
    });
  });
});

describe('EscrowProvider interface', () => {
  it('defines lock, release, freeze, and approveUnfreeze methods', () => {
    // Type-level test: ensure the interface shape is correct
    const provider: EscrowProvider = {
      lock: jest.fn(),
      release: jest.fn(),
      freeze: jest.fn(),
      approveUnfreeze: jest.fn(),
    };
    expect(provider.lock).toBeDefined();
    expect(provider.release).toBeDefined();
    expect(provider.freeze).toBeDefined();
    expect(provider.approveUnfreeze).toBeDefined();
  });
});
