require("dotenv").config();
const fs = require("node:fs");
const path = require("node:path");
const { spawn, execSync } = require("node:child_process");
const express = require("express");
const { ethers } = require("ethers");

const app = express();
app.use(express.json({ limit: "10kb" }));
app.use(express.static(path.join(__dirname, "..", "public")));

const rootDir = path.join(__dirname, "..");
const rpcUrl = process.env.RPC_URL || "http://127.0.0.1:8545";
const port = Number(process.env.PORT || 3000);
const host = "0.0.0.0";
const deploymentPath = path.join(rootDir, "deployments", "localhost.json");
const abiPath = path.join(rootDir, "artifacts", "contracts", "AssetTransactionRegistry.sol", "AssetTransactionRegistry.json");

let contract;
let provider;
let signer;
let hardhatProcess = null;
let initPromise = null;

async function isRpcReachable(p) {
  try {
    await p.getNetwork();
    return true;
  } catch (_err) {
    return false;
  }
}

function startLocalHardhatNode() {
  if (hardhatProcess) return;
  console.log("Starting local Hardhat node on 127.0.0.1:8545...");
  hardhatProcess = spawn("npx", ["hardhat", "node", "--hostname", "127.0.0.1", "--port", "8545"], {
    cwd: rootDir,
    stdio: ["ignore", "pipe", "pipe"]
  });
  hardhatProcess.stdout.on("data", (d) => {
    const line = d.toString();
    if (line.includes("Started HTTP and WebSocket JSON-RPC server")) {
      console.log(line.trim().split("\n")[0]);
    }
  });
  hardhatProcess.stderr.on("data", (d) => {
    const msg = d.toString().trim();
    if (msg) console.error("[hardhat-node]", msg);
  });
  hardhatProcess.on("exit", () => {
    hardhatProcess = null;
  });
}

async function waitForRpc(p, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isRpcReachable(p)) return;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("Timed out waiting for local Hardhat chain.");
}

async function initialize() {
  if (!fs.existsSync(abiPath)) {
    console.log("Contract artifact missing. Compiling contracts...");
    execSync("npx hardhat compile", { cwd: rootDir, stdio: "inherit" });
  }

  provider = new ethers.JsonRpcProvider(rpcUrl);
  if (!(await isRpcReachable(provider))) {
    const parsed = new URL(rpcUrl);
    if (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost") {
      startLocalHardhatNode();
      await waitForRpc(provider);
    } else {
      throw new Error("Local chain is unavailable. Check RPC_URL.");
    }
  }

  const network = await provider.getNetwork();
  if (network.chainId !== 31337n) {
    throw new Error("Safety check failed: this prototype only accepts local chain ID 31337.");
  }

  const artifact = JSON.parse(fs.readFileSync(abiPath, "utf8"));

  // Hardhat's local node exposes disposable development accounts via JSON-RPC.
  // Never point this demo signer at a public network or a wallet with real funds.
  signer = await provider.getSigner(0);

  let deployment = null;
  if (fs.existsSync(deploymentPath)) {
    try {
      deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
    } catch (_ignored) {}
  }

  let needsDeploy = !deployment || deployment.chainId !== 31337 || !ethers.isAddress(deployment.address);
  if (!needsDeploy) {
    const code = await provider.getCode(deployment.address);
    if (!code || code === "0x") {
      needsDeploy = true;
    }
  }

  if (needsDeploy) {
    const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, signer);
    const deployed = await factory.deploy();
    await deployed.waitForDeployment();
    const address = await deployed.getAddress();
    fs.mkdirSync(path.dirname(deploymentPath), { recursive: true });
    deployment = {
      contractName: "AssetTransactionRegistry",
      address,
      chainId: 31337,
      deployer: await signer.getAddress(),
      deployedAt: new Date().toISOString()
    };
    fs.writeFileSync(deploymentPath, JSON.stringify(deployment, null, 2) + "\n", "utf8");
  }

  if (deployment.chainId !== 31337) {
    throw new Error("Safety check failed: this prototype only accepts local chain ID 31337.");
  }

  contract = new ethers.Contract(deployment.address, artifact.abi, signer);
  console.log(`Connected to local chain ${network.chainId}; contract ${deployment.address}`);
}

function ensureInitialized() {
  if (!initPromise) {
    initPromise = initialize().catch((err) => {
      initPromise = null;
      throw err;
    });
  }
  return initPromise;
}

app.get("/api/health", async (_req, res) => {
  try {
    await ensureInitialized();
    const network = await provider.getNetwork();
    const blockNumber = await provider.getBlockNumber();
    const accounts = await provider.send("eth_accounts", []);
    res.json({
      ok: true,
      chainId: Number(network.chainId),
      blockNumber,
      contract: await contract.getAddress(),
      signer: await signer.getAddress(),
      accounts
    });
  } catch (_error) {
    res.status(503).json({ error: "Local chain is unavailable. Check that Hardhat node is running." });
  }
});

app.get("/api/transactions", async (_req, res) => {
  try {
    await ensureInitialized();
    const events = await contract.queryFilter(contract.filters.TransactionRecorded(), 0, "latest");
    const transactions = events.map((event) => ({
      id: event.args.id.toString(),
      from: event.args.from,
      to: event.args.to,
      asset: event.args.asset,
      amount: event.args.amount.toString(),
      timestamp: Number(event.args.timestamp),
      blockNumber: event.blockNumber,
      transactionHash: event.transactionHash
    })).reverse();
    res.json({ transactions });
  } catch (_error) {
    res.status(503).json({ error: "Could not read transaction history. Check the local chain and deployment." });
  }
});

app.get("/api/transactions/:id", async (req, res) => {
  try {
    await ensureInitialized();
    if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ error: "ID must be a whole number." });
    const id = BigInt(req.params.id);
    const exists = await contract.verifyTransaction(id);
    if (!exists) return res.status(404).json({ verified: false, error: "Transaction not found." });
    const r = await contract.getTransaction(id);
    res.json({
      verified: true,
      transaction: {
        id: r.id.toString(),
        from: r.from,
        to: r.to,
        asset: r.asset,
        amount: r.amount.toString(),
        timestamp: Number(r.timestamp)
      }
    });
  } catch (_error) {
    res.status(500).json({ error: "Could not verify transaction." });
  }
});

app.post("/api/transactions", async (req, res) => {
  try {
    await ensureInitialized();
    const { to, asset, amount } = req.body || {};
    if (typeof to !== "string" || !ethers.isAddress(to)) {
      return res.status(400).json({ error: "Recipient must be a valid blockchain address." });
    }
    if (typeof asset !== "string" || Buffer.byteLength(asset.trim(), "utf8") < 1 || Buffer.byteLength(asset.trim(), "utf8") > 32) {
      return res.status(400).json({ error: "Asset label must contain 1-32 UTF-8 bytes." });
    }
    if (typeof amount !== "string" || !/^[1-9]\d{0,77}$/.test(amount)) {
      return res.status(400).json({ error: "Amount must be a positive whole-number string (up to 78 digits)." });
    }

    const tx = await contract.recordTransaction(to, asset.trim(), BigInt(amount));
    const receipt = await tx.wait();
    let id = null;
    for (const log of receipt.logs) {
      try {
        const parsed = contract.interface.parseLog(log);
        if (parsed && parsed.name === "TransactionRecorded") id = parsed.args.id.toString();
      } catch (_ignored) {}
    }
    res.status(201).json({ id, transactionHash: receipt.hash, blockNumber: receipt.blockNumber, status: "recorded" });
  } catch (_error) {
    res.status(500).json({ error: "Transaction was not recorded. Check that the local chain is running." });
  }
});

const server = app.listen(port, host, () => {
  console.log(`Dashboard: http://${host}:${port}`);
  ensureInitialized().catch((error) => {
    console.error(error.message);
  });
});

function shutdown() {
  if (hardhatProcess) {
    hardhatProcess.kill("SIGTERM");
  }
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
