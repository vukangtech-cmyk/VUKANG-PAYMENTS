const fs = require("node:fs");
const path = require("node:path");
const { spawn, execSync } = require("node:child_process");
const { ethers } = require("ethers");
const ACCOUNTS = require("./accounts");

const ROOT = path.join(__dirname, "..");
const ARTIFACT = path.join(ROOT, "artifacts", "contracts", "VukangLedger.sol", "VukangLedger.json");
const DEPLOYMENT = path.join(ROOT, "deployments", "localhost.json");

const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8545";
const ALERT_THRESHOLD = BigInt(process.env.ALERT_THRESHOLD || "1000");
const LOCAL_CHAIN_ID = 31337n;
const KINDS = ["mint", "transfer"];

let provider;
let readContract;
let abi;
let accountAddresses = [];
let nodeProcess = null;
let ready = null;

// Writes are queued so two requests from the same account never race on a nonce.
let writeQueue = Promise.resolve();
function enqueue(task) {
  const run = writeQueue.then(task, task);
  writeQueue = run.catch(() => {});
  return run;
}

async function rpcReachable(p) {
  try {
    await p.getNetwork();
    return true;
  } catch (_e) {
    return false;
  }
}

function startLocalNode() {
  if (nodeProcess) return;
  console.log("No chain found on 127.0.0.1:8545 - starting a local Hardhat node.");
  nodeProcess = spawn("npx", ["hardhat", "node", "--hostname", "127.0.0.1", "--port", "8545"], {
    cwd: ROOT,
    stdio: ["ignore", "ignore", "pipe"]
  });
  nodeProcess.stderr.on("data", (d) => {
    const msg = d.toString().trim();
    if (msg) console.error("[hardhat-node]", msg);
  });
  nodeProcess.on("exit", () => {
    nodeProcess = null;
  });
}

async function waitForRpc(p, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await rpcReachable(p)) return;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("Timed out waiting for the local Hardhat chain.");
}

function stopLocalNode() {
  if (nodeProcess) nodeProcess.kill("SIGTERM");
}

async function deployIfNeeded(artifact) {
  let deployment = null;
  if (fs.existsSync(DEPLOYMENT)) {
    try {
      deployment = JSON.parse(fs.readFileSync(DEPLOYMENT, "utf8"));
    } catch (_e) {}
  }

  let needsDeploy = !deployment || deployment.chainId !== 31337 || !ethers.isAddress(deployment.address);
  if (!needsDeploy) {
    const code = await provider.getCode(deployment.address);
    needsDeploy = !code || code === "0x";
  }
  if (!needsDeploy) return deployment;

  const admin = await provider.getSigner(0);
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, admin);
  const deployed = await factory.deploy(ALERT_THRESHOLD);
  await deployed.waitForDeployment();
  const address = await deployed.getAddress();

  // Give the audit desk its role right away.
  const auditorAccount = ACCOUNTS.find((a) => a.role === "auditor");
  if (auditorAccount) {
    const tx = await deployed.setAuditor(accountAddresses[auditorAccount.index], true);
    await tx.wait();
  }

  deployment = {
    contractName: "VukangLedger",
    address,
    chainId: 31337,
    deployer: await admin.getAddress(),
    deployedAt: new Date().toISOString()
  };
  fs.mkdirSync(path.dirname(DEPLOYMENT), { recursive: true });
  fs.writeFileSync(DEPLOYMENT, JSON.stringify(deployment, null, 2) + "\n");
  console.log(`Deployed VukangLedger to ${address}`);
  return deployment;
}

async function initialize() {
  if (!fs.existsSync(ARTIFACT)) {
    console.log("Contract artifact missing - compiling...");
    execSync("npx hardhat compile", { cwd: ROOT, stdio: "inherit" });
  }
  const artifact = JSON.parse(fs.readFileSync(ARTIFACT, "utf8"));
  abi = artifact.abi;

  provider = new ethers.JsonRpcProvider(RPC_URL, undefined, { staticNetwork: false });
  if (!(await rpcReachable(provider))) {
    const host = new URL(RPC_URL).hostname;
    if (host === "127.0.0.1" || host === "localhost") {
      startLocalNode();
      await waitForRpc(provider);
    } else {
      throw new Error("Chain unreachable. Check RPC_URL.");
    }
  }

  const network = await provider.getNetwork();
  if (network.chainId !== LOCAL_CHAIN_ID) {
    throw new Error("Safety check failed: this prototype only runs on local chain ID 31337.");
  }

  accountAddresses = (await provider.send("eth_accounts", [])).map((a) => ethers.getAddress(a));
  if (accountAddresses.length < ACCOUNTS.length) {
    throw new Error("The local node must expose at least 10 unlocked accounts.");
  }

  const deployment = await deployIfNeeded(artifact);
  readContract = new ethers.Contract(deployment.address, abi, provider);

  const count = await readContract.getRecordCount();
  if (count === 0n && process.env.AUTO_SEED !== "false") {
    await require("./seed").seed(api);
    console.log("Loaded demo data.");
  }
  console.log(`Connected to chain ${network.chainId}, contract ${deployment.address}`);
}

function ensureReady() {
  if (!ready) {
    ready = initialize().catch((err) => {
      ready = null;
      throw err;
    });
  }
  return ready;
}

// ------------------------------------------------------------------ helpers

function accountMeta(address) {
  const i = accountAddresses.findIndex((a) => a.toLowerCase() === String(address).toLowerCase());
  return i >= 0 && ACCOUNTS[i] ? ACCOUNTS[i] : null;
}

function labelFor(address) {
  if (address === ethers.ZeroAddress) return "Mint";
  const meta = accountMeta(address);
  return meta ? meta.label : null;
}

function resolveAddress(value) {
  if (typeof value === "number" || (typeof value === "string" && /^\d{1,2}$/.test(value))) {
    const i = Number(value);
    if (ACCOUNTS[i]) return accountAddresses[i];
  }
  if (typeof value === "string" && ethers.isAddress(value)) return ethers.getAddress(value);
  return null;
}

function offchainHash(r) {
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint256", "uint8", "address", "address", "uint256", "string", "uint256", "uint256", "bytes32"],
      [r.id, r.kindIndex, r.from, r.to, r.amount, r.memo, r.timestamp, r.blockNumber, r.prevHash]
    )
  );
}

function normalize(r) {
  const base = {
    id: Number(r.id),
    kindIndex: Number(r.kind),
    from: r.from,
    to: r.to,
    amount: r.amount.toString(),
    memo: r.memo,
    timestamp: Number(r.timestamp),
    blockNumber: Number(r.blockNumber),
    prevHash: r.prevHash,
    recordHash: r.recordHash,
    flagged: r.flagged,
    flagReason: r.flagReason
  };
  return {
    id: base.id,
    kind: KINDS[base.kindIndex],
    kindIndex: base.kindIndex,
    from: base.from,
    fromLabel: labelFor(base.from),
    to: base.to,
    toLabel: labelFor(base.to),
    amount: base.amount,
    memo: base.memo,
    timestamp: base.timestamp,
    blockNumber: base.blockNumber,
    prevHash: base.prevHash,
    recordHash: base.recordHash,
    flagged: base.flagged,
    flagReason: base.flagReason
  };
}

async function transactionHashes() {
  const events = await readContract.queryFilter(readContract.filters.Recorded(), 0, "latest");
  const map = new Map();
  for (const e of events) map.set(Number(e.args.id), e.transactionHash);
  return map;
}

async function allRecords() {
  const total = Number(await readContract.getRecordCount());
  const hashes = await transactionHashes();
  const out = [];
  for (let offset = 0; offset < total; offset += 200) {
    const page = await readContract.getRecords(offset, 200);
    for (const r of page) {
      const rec = normalize(r);
      rec.transactionHash = hashes.get(rec.id) || null;
      out.push(rec);
    }
  }
  return out;
}

// Turns contract reverts into messages a person can act on.
function friendlyError(error) {
  const name = error?.revert?.name || error?.info?.error?.data?.name;
  const args = error?.revert?.args;
  switch (name) {
    case "NotOwner": return "Only the treasury (admin) account can do this.";
    case "NotAuditor": return "Only the audit desk or treasury can do this.";
    case "InvalidRecipient": return "Recipient is not valid.";
    case "InvalidAmount": return "Amount must be greater than zero.";
    case "InvalidMemo": return "Memo is too long (maximum 80 bytes).";
    case "InsufficientBalance": return `Insufficient balance: available ${args?.[0]}, required ${args?.[1]}.`;
    case "AccountFrozen": return "One of the accounts is frozen by the audit desk.";
    case "SelfTransfer": return "Sender and recipient must be different accounts.";
    case "UnknownRecord": return "That record does not exist.";
    case "AlreadyFlagged": return "That record is already flagged.";
    default: return null;
  }
}

// -------------------------------------------------------------- operations

// "transfer" exists twice on the contract (ERC-20 form and memo form), so name the memo form in full.
const METHOD_ALIASES = { transfer: "transfer(address,uint256,string)" };

async function send(signerIndex, methodName, args) {
  const method = METHOD_ALIASES[methodName] || methodName;
  return enqueue(async () => {
    const signer = await provider.getSigner(signerIndex);
    const contract = new ethers.Contract(readContract.target, abi, signer);
    // staticCall first: revert reasons are decoded cleanly and no block is mined on failure.
    await contract[method].staticCall(...args);
    const tx = await contract[method](...args);
    const receipt = await tx.wait();
    return receipt;
  });
}

function recordIdFromReceipt(receipt) {
  for (const log of receipt.logs) {
    try {
      const parsed = readContract.interface.parseLog(log);
      if (parsed && parsed.name === "Recorded") return Number(parsed.args.id);
    } catch (_e) {}
  }
  return null;
}

const api = {
  ensureReady,
  stopLocalNode,
  get accounts() { return ACCOUNTS; },
  get addresses() { return accountAddresses; },
  get contract() { return readContract; },
  get abi() { return abi; },
  get provider() { return provider; },
  KINDS,
  ALERT_THRESHOLD,
  accountMeta,
  labelFor,
  resolveAddress,
  offchainHash,
  normalize,
  allRecords,
  friendlyError,
  send,
  recordIdFromReceipt
};

module.exports = api;
