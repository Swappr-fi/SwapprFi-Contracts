const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

// ─── Config ───
const API_URL = "https://api.bdagscan.com/v1/api/contract/verifyContract";
const COMPILER_VERSION = "v0.8.24+commit.e11b9ed9";
const BUILD_INFO_DIR = path.resolve(__dirname, "../artifacts/build-info");

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
const coder = ethers.AbiCoder.defaultAbiCoder();

const CONTRACTS = [
  {
    name: "WETH",
    source: "contracts/periphery/WETH.sol",
    contractName: "WETH",
    address: ADDRESSES.WETH,
    constructorArgs: "",
  },
  {
    name: "SwapperFactory",
    source: "contracts/core/SwapperFactory.sol",
    contractName: "SwapperFactory",
    address: ADDRESSES.FACTORY,
    constructorArgs: coder.encode(["address"], [DEV_WALLET]).slice(2),
  },
  {
    name: "SwapperRouter",
    source: "contracts/periphery/SwapperRouter.sol",
    contractName: "SwapperRouter",
    address: ADDRESSES.ROUTER,
    constructorArgs: coder.encode(["address", "address"], [ADDRESSES.FACTORY, ADDRESSES.WETH]).slice(2),
  },
  {
    name: "SwapperNFTMarketplace",
    source: "contracts/nft/SwapperNFTMarketplace.sol",
    contractName: "SwapperNFTMarketplace",
    address: ADDRESSES.NFT_MARKETPLACE,
    constructorArgs: coder.encode(["address"], [DEV_WALLET]).slice(2),
  },
  {
    name: "SwappyToken",
    source: "contracts/staking/SwappyToken.sol",
    contractName: "SwappyToken",
    address: ADDRESSES.SWAPPY_TOKEN,
    constructorArgs: coder.encode(["uint256"], [ethers.parseEther("1000000000")]).slice(2),
  },
  {
    name: "SwapperStaking",
    source: "contracts/staking/SwapperStaking.sol",
    contractName: "SwapperStaking",
    address: ADDRESSES.SWAPPER_STAKING,
    constructorArgs: "",
  },
  {
    name: "SwappyStaking",
    source: "contracts/staking/SwappyStaking.sol",
    contractName: "SwappyStaking",
    address: ADDRESSES.SWAPPY_STAKING,
    constructorArgs: coder.encode(["address"], [ADDRESSES.SWAPPY_TOKEN]).slice(2),
  },
  {
    name: "SwappySale",
    source: "contracts/sale/SwappySale.sol",
    contractName: "SwappySale",
    address: ADDRESSES.SWAPPY_SALE,
    constructorArgs: coder.encode(["address", "address"], [ADDRESSES.SWAPPY_TOKEN, DEV_WALLET]).slice(2),
  },
];

// ─── Find the build-info that contains a given source file ───
function findBuildInfo(sourceFile) {
  const files = fs.readdirSync(BUILD_INFO_DIR).filter(f => f.endsWith(".json"));
  for (const file of files) {
    const data = JSON.parse(fs.readFileSync(path.join(BUILD_INFO_DIR, file), "utf-8"));
    if (data.input.sources[sourceFile]) {
      return data;
    }
  }
  throw new Error(`No build-info found containing ${sourceFile}`);
}

// ─── Build Standard JSON Input for a specific contract ───
function buildStandardInput(buildInfo) {
  // Use the exact input from the build, but simplify outputSelection
  const input = JSON.parse(JSON.stringify(buildInfo.input));
  input.settings.outputSelection = {
    "*": {
      "*": ["abi", "evm.bytecode", "evm.deployedBytecode"],
    },
  };
  return input;
}

// ─── Verify a single contract ───
async function verifyContract(contract) {
  console.log(`\n  Verifying ${contract.name} at ${contract.address}...`);

  try {
    const buildInfo = findBuildInfo(contract.source);
    const standardInput = buildStandardInput(buildInfo);
    const contractPath = `${contract.source}:${contract.contractName}`;

    // Try Standard JSON Input format first
    console.log(`    Format: solidity-standard-json-input`);
    console.log(`    Contract: ${contractPath}`);
    if (contract.constructorArgs) {
      console.log(`    Constructor args: ${contract.constructorArgs.substring(0, 40)}...`);
    }

    const formData = new FormData();
    formData.append("contractaddress", contract.address);
    formData.append("codeformat", "solidity-standard-json-input");
    formData.append("compilerversion", COMPILER_VERSION);
    formData.append("contractname", contractPath);
    formData.append("sourceCode", JSON.stringify(standardInput));
    if (contract.constructorArgs) {
      formData.append("constructorArguements", contract.constructorArgs);
    }

    const res = await fetch(API_URL, {
      method: "POST",
      body: formData,
      headers: {
        "User-Agent": "Mozilla/5.0",
      },
    });

    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }

    if (res.ok) {
      console.log(`    ✓ ${contract.name} — ${JSON.stringify(json)}`);
      return true;
    }

    console.log(`    ✗ ${res.status} — ${JSON.stringify(json)}`);

    // If standard JSON failed, try single-file with extra params
    console.log(`    Retrying with solidity-single-file + optimizer params...`);
    return await verifySingleFile(contract);
  } catch (e) {
    console.log(`    ✗ Error: ${e.message}`);
    return false;
  }
}

// ─── Fallback: single-file with optimizer params ───
async function verifySingleFile(contract) {
  try {
    const flatPath = path.resolve(__dirname, `../verification/${contract.name}.sol`);
    if (!fs.existsSync(flatPath)) {
      console.log(`    ✗ No flattened file at ${flatPath}. Run flatten-for-verify.js first.`);
      return false;
    }
    const sourceCode = fs.readFileSync(flatPath, "utf-8");

    const formData = new FormData();
    formData.append("contractaddress", contract.address);
    formData.append("codeformat", "solidity-single-file");
    formData.append("compilerversion", COMPILER_VERSION);
    formData.append("contractname", contract.contractName);
    formData.append("sourceCode", sourceCode);
    formData.append("optimizationUsed", "1");
    formData.append("runs", "200");
    formData.append("evmVersion", "paris");
    formData.append("module", "contract");
    formData.append("licenseType", "3");
    formData.append("libraries", "{}");
    if (contract.constructorArgs) {
      formData.append("constructorArguements", contract.constructorArgs);
    }

    const res = await fetch(API_URL, {
      method: "POST",
      body: formData,
      headers: {
        "User-Agent": "Mozilla/5.0",
      },
    });

    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }

    if (res.ok) {
      console.log(`    ✓ ${contract.name} (single-file) — ${JSON.stringify(json)}`);
      return true;
    }
    console.log(`    ✗ ${res.status} (single-file) — ${JSON.stringify(json)}`);
    return false;
  } catch (e) {
    console.log(`    ✗ Single-file error: ${e.message}`);
    return false;
  }
}

// ─── Main ───
async function main() {
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║  Swapper — Verify Contracts via BDAGScan API    ║");
  console.log("╚══════════════════════════════════════════════════╝");
  console.log(`  API:      ${API_URL}`);
  console.log(`  Compiler: ${COMPILER_VERSION}`);

  let success = 0;
  let failed = 0;

  for (const contract of CONTRACTS) {
    const ok = await verifyContract(contract);
    if (ok) success++;
    else failed++;
  }

  console.log("\n────────────────────────────────────────────────");
  console.log(`  Results: ${success} verified, ${failed} failed`);
  console.log("────────────────────────────────────────────────\n");
}

main().catch(console.error);
