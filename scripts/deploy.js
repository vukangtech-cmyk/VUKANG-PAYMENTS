const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

async function main() {
  const network = await hre.ethers.provider.getNetwork();
  const chainId = Number(network.chainId);

  if (chainId !== 31337) {
    throw new Error(`Refusing to deploy to non-local chainId ${chainId}. Expected 31337.`);
  }

  const [deployer] = await hre.ethers.getSigners();
  const Factory = await hre.ethers.getContractFactory("AssetTransactionRegistry");
  const contract = await Factory.deploy();
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  const deploymentsDir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(deploymentsDir, { recursive: true });

  const outPath = path.join(deploymentsDir, "localhost.json");
  const payload = {
    contractName: "AssetTransactionRegistry",
    address,
    chainId,
    deployer: deployer.address,
    deployedAt: new Date().toISOString()
  };

  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2) + "\n", "utf8");
  console.log(`AssetTransactionRegistry deployed to ${address} (chainId ${chainId})`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
