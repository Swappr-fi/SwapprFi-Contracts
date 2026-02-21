require("@nomicfoundation/hardhat-toolbox");

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      viaIR: true,
    },
  },
  networks: {
    hardhat: {
      chainId: 31337,
      accounts: { count: 120 },
    },
    ethereum: {
      url: process.env.ETHEREUM_RPC_URL || "",
      chainId: 1,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    },
    blockdag: {
      url: process.env.RPC_URL || "https://rpc.bdagscan.com/",
      chainId: 1404,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      httpHeaders: {
        "User-Agent": "Mozilla/5.0",
      },
    },
  },
  etherscan: {
    apiKey: {
      blockdag: process.env.ETHERSCAN_API_KEY || "empty",
    },
    customChains: [
      {
        network: "blockdag",
        chainId: 1404,
        urls: {
          apiURL: "https://bdagscan.com/api",
          browserURL: "https://bdagscan.com",
        },
      },
    ],
  },
};
