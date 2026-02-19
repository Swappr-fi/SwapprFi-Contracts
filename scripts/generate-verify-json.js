const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

// ─── Config ───
const BUILD_INFO_DIR = path.resolve(__dirname, "../artifacts/build-info");
const OUT_DIR = path.resolve(__dirname, "../verification");

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

// ─── Find build-info containing a source file ───
function findBuildInfo(sourceFile) {
  const files = fs.readdirSync(BUILD_INFO_DIR).filter(f => f.endsWith(".json"));
  for (const f of files) {
    const data = JSON.parse(fs.readFileSync(path.join(BUILD_INFO_DIR, f), "utf-8"));
    if (data.input?.sources?.[sourceFile]) return data;
  }
  throw new Error(`No build-info found for ${sourceFile}`);
}

// ─── Main ───
function main() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║  Generate Standard JSON Input for BDAGScan verify   ║");
  console.log("╚══════════════════════════════════════════════════════╝\n");

  // Generate a browser console script that verifies all contracts
  let consoleScript = generateConsoleHeader();

  for (const contract of CONTRACTS) {
    process.stdout.write(`  ${contract.name}...`);
    try {
      const buildInfo = findBuildInfo(contract.source);

      // Use the exact input from build-info (same sources, same settings)
      const standardInput = JSON.parse(JSON.stringify(buildInfo.input));

      // Simplify outputSelection (verifier only needs bytecode)
      standardInput.settings.outputSelection = {
        "*": { "*": ["abi", "evm.bytecode", "evm.deployedBytecode"] },
      };

      // Save the Standard JSON Input file
      const jsonFile = `${contract.name}.standard-input.json`;
      fs.writeFileSync(
        path.join(OUT_DIR, jsonFile),
        JSON.stringify(standardInput, null, 2)
      );

      // Add to console script
      consoleScript += generateContractEntry(contract, standardInput);

      console.log(` ✓  → verification/${jsonFile}`);
    } catch (e) {
      console.log(` ✗  ${e.message}`);
    }
  }

  consoleScript += generateConsoleFooter();

  // Save the console script
  fs.writeFileSync(path.join(OUT_DIR, "verify-in-browser.js"), consoleScript);

  console.log(`\n  Browser script → verification/verify-in-browser.js`);
  console.log(`\n  Instructions:`);
  console.log(`  1. Open https://bdagscan.com/verificationContract`);
  console.log(`  2. Open DevTools → Console`);
  console.log(`  3. Paste contents of verify-in-browser.js`);
  console.log(`  4. Follow the prompts\n`);
}

function generateConsoleHeader() {
  return `// Auto-generated — paste in browser console at bdagscan.com/verificationContract
// Then click "Verify" on the form once (any data). The script captures the CSRF
// token from that request and auto-verifies all 8 contracts.
(function() {
  const API = "https://api.bdagscan.com/v1/api/contract/verifyContract";
  const COMPILER = "v0.8.24+commit.e11b9ed9";

  const contracts = [
`;
}

function generateContractEntry(contract, standardInput) {
  const inputStr = JSON.stringify(JSON.stringify(standardInput));
  return `    {
      name: ${JSON.stringify(contract.name)},
      address: ${JSON.stringify(contract.address)},
      contractPath: ${JSON.stringify(contract.source + ":" + contract.contractName)},
      constructorArgs: ${JSON.stringify(contract.constructorArgs)},
      sourceCode: ${inputStr},
    },
`;
}

function generateConsoleFooter() {
  return `  ];

  // ─── Phase 1: Intercept fetch to capture CSRF token ───
  const _origFetch = window.fetch;
  let csrfCaptured = null;
  let verifyRunning = false;

  window.fetch = async function(url, opts) {
    const urlStr = typeof url === "string" ? url : url?.url || "";

    // Capture CSRF from any request to the verify endpoint
    if (urlStr.includes("verifyContract") && opts?.headers) {
      // Extract csrf-token from headers (could be Headers object or plain object)
      let token = null;
      if (opts.headers instanceof Headers) {
        token = opts.headers.get("csrf-token");
      } else if (typeof opts.headers === "object") {
        token = opts.headers["csrf-token"] || opts.headers["Csrf-Token"] || opts.headers["CSRF-Token"];
      }

      if (token && !csrfCaptured) {
        csrfCaptured = token;
        console.log("🔑 CSRF token captured:", token.substring(0, 20) + "...");

        // Block the original form request (it would fail anyway)
        // and start our verification instead
        if (!verifyRunning) {
          verifyRunning = true;
          setTimeout(() => runVerification(token), 500);
        }

        // Return a fake "ok" response so the form doesn't show errors
        return new Response(JSON.stringify({ message: "Intercepted — running automated verification..." }), {
          status: 200, headers: { "Content-Type": "application/json" }
        });
      }

      // If we already have the token, block further form submissions
      if (csrfCaptured && urlStr.includes("verifyContract")) {
        return new Response(JSON.stringify({ message: "Verification already running..." }), {
          status: 200, headers: { "Content-Type": "application/json" }
        });
      }
    }

    return _origFetch.apply(this, arguments);
  };

  // ─── Phase 2: Verify all contracts ───
  async function runVerification(csrf) {
    console.log("\\n╔══════════════════════════════════════════════════╗");
    console.log("║  Verifying " + contracts.length + " contracts via Standard JSON Input  ║");
    console.log("║  Compiler: " + COMPILER + "              ║");
    console.log("║  Settings: optimizer(200), viaIR, evmVersion=paris║");
    console.log("╚══════════════════════════════════════════════════╝");

    let ok = 0, fail = 0;

    for (const c of contracts) {
      console.log("\\n📋 " + c.name + " at " + c.address + "...");

      const fd = new FormData();
      fd.append("contractaddress", c.address);
      fd.append("codeformat", "solidity-standard-json-input");
      fd.append("compilerversion", COMPILER);
      fd.append("contractname", c.contractPath);
      fd.append("sourceCode", c.sourceCode);
      if (c.constructorArgs) fd.append("constructorArguements", c.constructorArgs);

      try {
        const res = await _origFetch(API, {
          method: "POST",
          body: fd,
          credentials: "include",
          headers: { "csrf-token": csrf },
        });
        const json = await res.json();
        if (res.ok) {
          console.log("✅ " + c.name + " VERIFIED!", json);
          ok++;
        } else {
          console.log("❌ " + c.name + " " + res.status + ":", JSON.stringify(json));
          fail++;
        }
      } catch (e) {
        console.error("❌ " + c.name + ":", e);
        fail++;
      }

      // Delay between requests
      await new Promise(r => setTimeout(r, 2000));
    }

    console.log("\\n═══════════════════════════════════════");
    console.log("  " + ok + " verified, " + fail + " failed");
    console.log("═══════════════════════════════════════");

    // Restore original fetch
    window.fetch = _origFetch;
    console.log("\\n🔄 Original fetch restored.");
  }

  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║  ✅ Verification script loaded!                          ║");
  console.log("║                                                          ║");
  console.log("║  Now click 'Verify' on the form (any data is fine).     ║");
  console.log("║  The script will capture the CSRF token and auto-verify ║");
  console.log("║  all " + contracts.length + " contracts using Standard JSON Input.            ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
})();
`;
}

main();
