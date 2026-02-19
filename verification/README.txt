═══════════════════════════════════════════════
  BDAGScan Contract Verification Instructions
═══════════════════════════════════════════════

Go to: https://bdagscan.com/verificationContract

Compiler Settings (same for all contracts):
  - Compiler:        v0.8.24
  - Optimization:    Enabled, 200 runs
  - EVM Version:     default
  - Via IR:          Yes (if the form has this option)

────────────────────────────────────────────────

Contract: WETH
  Address:    0x9441C3b63270bcA27FC94B232e030acaCc5A597D
  Source:     verification/WETH.sol
  Constructor Args:
    (none)
────────────────────────────────────────────────

Contract: SwapperFactory
  Address:    0x3a634E1CE44d1b73b27A6F57f2bFF1e9333106d4
  Source:     verification/SwapperFactory.sol
  Constructor Args:
    address: 0xcbB5b1f048Be05e62894FD68A0B0ac74587cCeda
────────────────────────────────────────────────

Contract: SwapperRouter
  Address:    0x5eaBf96f9543F0DB68d1b21C76EB482CE7adaa02
  Source:     verification/SwapperRouter.sol
  Constructor Args:
    address: 0x3a634E1CE44d1b73b27A6F57f2bFF1e9333106d4
    address: 0x9441C3b63270bcA27FC94B232e030acaCc5A597D
────────────────────────────────────────────────

Contract: SwapperNFTMarketplace
  Address:    0xE58A9ccCedFb93B67b62A5920791f3a559da3a9f
  Source:     verification/SwapperNFTMarketplace.sol
  Constructor Args:
    address: 0xcbB5b1f048Be05e62894FD68A0B0ac74587cCeda
────────────────────────────────────────────────

Contract: SwappyToken
  Address:    0x47470692Ab7D24b0DB42265C18D41cE93155d477
  Source:     verification/SwappyToken.sol
  Constructor Args:
    uint256: 1000000000000000000000000000 (1B with 18 decimals)
────────────────────────────────────────────────

Contract: SwapperStaking
  Address:    0x14be19EB5384Da62E988b93b1ae997AA5F64fa6C
  Source:     verification/SwapperStaking.sol
  Constructor Args:
    (none)
────────────────────────────────────────────────

Contract: SwappyStaking
  Address:    0x39BF3961E54c89329f61163fc4840E7Bb063560a
  Source:     verification/SwappyStaking.sol
  Constructor Args:
    address: 0x47470692Ab7D24b0DB42265C18D41cE93155d477
────────────────────────────────────────────────

Contract: SwappySale
  Address:    0xb48569D4B7BA365e2a858CdDb29dB85279d60D7E
  Source:     verification/SwappySale.sol
  Constructor Args:
    address: 0x47470692Ab7D24b0DB42265C18D41cE93155d477
    address: 0xcbB5b1f048Be05e62894FD68A0B0ac74587cCeda
────────────────────────────────────────────────
