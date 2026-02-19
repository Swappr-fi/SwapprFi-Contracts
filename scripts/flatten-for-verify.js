const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

// Deployed prod addresses
const ADDRESSES = {
  WETH:             "0x9441C3b63270bcA27FC94B232e030acaCc5A597D",
  FACTORY:          "0x3a634E1CE44d1b73b27A6F57f2bFF1e9333106d4",
  ROUTER:           "0x5eaBf96f9543F0DB68d1b21C76EB482CE7adaa02",
  NFT_MARKETPLACE:  "0xE58A9ccCedFb93B67b62A5920791f3a559da3a9f",
  SWAPPY_TOKEN:     "0x47470692Ab7D24b0DB42265C18D41cE93155d477",
  SWAPPER_STAKING:  "0x14be19EB5384Da62E988b93b1ae997AA5F64fa6C",
  SWAPPY_STAKING:   "0x39BF3961E54c89329f61163fc4840E7Bb063560a",
  SWAPPY_SALE:      "0xb48569D4B7BA365e2a858CdDb29dB85279d60D7E",
};

const DEV_WALLET = "0xcbB5b1f048Be05e62894FD68A0B0ac74587cCeda";

// Contract name → source path, constructor args
const CONTRACTS = [
  {
    name: "WETH",
    source: "contracts/periphery/WETH.sol",
    address: ADDRESSES.WETH,
    constructorArgs: [],
  },
  {
    name: "SwapperFactory",
    source: "contracts/core/SwapperFactory.sol",
    address: ADDRESSES.FACTORY,
    constructorArgs: [`address: ${DEV_WALLET}`],
  },
  {
    name: "SwapperRouter",
    source: "contracts/periphery/SwapperRouter.sol",
    address: ADDRESSES.ROUTER,
    constructorArgs: [`address: ${ADDRESSES.FACTORY}`, `address: ${ADDRESSES.WETH}`],
  },
  {
    name: "SwapperNFTMarketplace",
    source: "contracts/nft/SwapperNFTMarketplace.sol",
    address: ADDRESSES.NFT_MARKETPLACE,
    constructorArgs: [`address: ${DEV_WALLET}`],
  },
  {
    name: "SwappyToken",
    source: "contracts/staking/SwappyToken.sol",
    address: ADDRESSES.SWAPPY_TOKEN,
    constructorArgs: ["uint256: 1000000000000000000000000000 (1B with 18 decimals)"],
  },
  {
    name: "SwapperStaking",
    source: "contracts/staking/SwapperStaking.sol",
    address: ADDRESSES.SWAPPER_STAKING,
    constructorArgs: [],
  },
  {
    name: "SwappyStaking",
    source: "contracts/staking/SwappyStaking.sol",
    address: ADDRESSES.SWAPPY_STAKING,
    constructorArgs: [`address: ${ADDRESSES.SWAPPY_TOKEN}`],
  },
  {
    name: "SwappySale",
    source: "contracts/sale/SwappySale.sol",
    address: ADDRESSES.SWAPPY_SALE,
    constructorArgs: [`address: ${ADDRESSES.SWAPPY_TOKEN}`, `address: ${DEV_WALLET}`],
  },
];

const outDir = path.resolve(__dirname, "../verification");

function main() {
  // Clean & create output folder
  if (fs.existsSync(outDir)) fs.rmSync(outDir, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });

  console.log("╔══════════════════════════════════════════════╗");
  console.log("║  Flatten contracts for BDAGScan verification ║");
  console.log("╚══════════════════════════════════════════════╝");
  console.log("");

  for (const contract of CONTRACTS) {
    process.stdout.write(`  Flattening ${contract.name}...`);
    try {
      const flattened = execSync(`npx hardhat flatten ${contract.source} 2>/dev/null`, {
        encoding: "utf-8",
        cwd: path.resolve(__dirname, ".."),
      });

      // Remove duplicate SPDX license identifiers (hardhat flatten issue)
      const cleaned = removeDuplicateSPDX(flattened);

      const filename = `${contract.name}.sol`;
      fs.writeFileSync(path.join(outDir, filename), cleaned);
      console.log(` ✓  → verification/${filename}`);
    } catch (e) {
      console.log(` ✗  ${e.message}`);
    }
  }

  // Write a README with instructions
  const readme = generateReadme();
  fs.writeFileSync(path.join(outDir, "README.txt"), readme);

  console.log("");
  console.log(`  Instructions → verification/README.txt`);
  console.log("");
  console.log("  Open https://bdagscan.com/verificationContract");
  console.log("  and follow the instructions in README.txt");
  console.log("");
}

function removeDuplicateSPDX(source) {
  const lines = source.split("\n");
  let seenSPDX = false;
  let seenPragma = false;

  return lines.filter((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("// SPDX-License-Identifier:")) {
      if (seenSPDX) return false;
      seenSPDX = true;
    }
    if (trimmed.startsWith("pragma solidity")) {
      if (seenPragma) return false;
      seenPragma = true;
    }
    return true;
  }).join("\n");
}

function generateReadme() {
  let text = `═══════════════════════════════════════════════
  BDAGScan Contract Verification Instructions
═══════════════════════════════════════════════

Go to: https://bdagscan.com/verificationContract

Compiler Settings (same for all contracts):
  - Compiler:        v0.8.24
  - Optimization:    Enabled, 200 runs
  - EVM Version:     default
  - Via IR:          Yes (if the form has this option)

────────────────────────────────────────────────
`;

  for (const contract of CONTRACTS) {
    text += `
Contract: ${contract.name}
  Address:    ${contract.address}
  Source:     verification/${contract.name}.sol
  Constructor Args:
`;
    if (contract.constructorArgs.length === 0) {
      text += `    (none)\n`;
    } else {
      for (const arg of contract.constructorArgs) {
        text += `    ${arg}\n`;
      }
    }
    text += `────────────────────────────────────────────────
`;
  }

  return text;
}

main();
