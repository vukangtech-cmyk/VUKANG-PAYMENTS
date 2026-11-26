require("dotenv").config();
const path = require("node:path");
const express = require("express");
const { ethers } = require("ethers");
const chain = require("./chain");
const { buildReport, toCsv } = require("./report");

const PORT = Number(process.env.PORT || 3000);
// Demo mode lets the server sign for the built-in demo accounts, so the dashboard works
// without a wallet. Set DEMO_MODE=false and the server only reads: every write must be
// signed in the user's own wallet.
const DEMO_MODE = process.env.DEMO_MODE !== "false";
const FAUCET_AMOUNT = BigInt(process.env.FAUCET_AMOUNT || "500");
const FAUCET_MIN_BALANCE = 100n;
const FAUCET_COOLDOWN_MS = 30_000;
const RPC_PUBLIC_URL = process.env.RPC_PUBLIC_URL || "http://127.0.0.1:8545";
// Local only on purpose: the API signs with disposable development accounts.
const HOST = "127.0.0.1";

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "10kb" }));

app.use((_req, res, next) => {
  res.setHeader("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});

app.use(express.static(path.join(__dirname, "..", "public")));
app.use("/fonts", express.static(path.join(__dirname, "..", "node_modules", "@fontsource")));
// The browser signs with the user's wallet, so it needs the ethers library. Served from this
// project (not a CDN) to keep the Content-Security-Policy strict.
app.get("/vendor/ethers.umd.min.js", (_req, res) =>
  res.sendFile(path.join(__dirname, "..", "node_modules", "ethers", "dist", "ethers.umd.min.js")));

function requireDemo(_req, res, next) {
  if (DEMO_MODE) return next();
  res.status(403).json({ error: "Demo mode is off. Connect your wallet and sign this action yourself." });
}

const wrap = (fn) => async (req, res) => {
  try {
    await chain.ensureReady();
    await fn(req, res);
  } catch (error) {
    const friendly = chain.friendlyError(error);
    if (friendly) return res.status(422).json({ error: friendly });
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error(error.shortMessage || error.message);
    res.status(503).json({ error: "The local chain is not responding. Check that the server is running." });
  }
};

const fail = (status, message) => Object.assign(new Error(message), { status });

function parseMemo(value) {
  const memo = typeof value === "string" ? value.trim() : "";
  if (Buffer.byteLength(memo, "utf8") > 80) throw fail(400, "Memo is too long (maximum 80 bytes).");
  return memo;
}

function parseAmount(value) {
  const text = typeof value === "number" ? String(value) : value;
  if (typeof text !== "string" || !/^[1-9]\d{0,17}$/.test(text)) {
    throw fail(400, "Amount must be a whole number greater than zero.");
  }
  return BigInt(text);
}

function parseAccountIndex(value, name) {
  const i = Number(value);
  if (!Number.isInteger(i) || !chain.accounts[i]) throw fail(400, `${name} must be one of the listed accounts.`);
  return i;
}

// ------------------------------------------------------- wallet support

app.get("/api/config", wrap(async (_req, res) => {
  const network = await chain.provider.getNetwork();
  res.json({
    chainId: Number(network.chainId),
    chainIdHex: "0x" + network.chainId.toString(16),
    networkName: "Vukang Local (Hardhat)",
    rpcUrl: RPC_PUBLIC_URL,
    contract: await chain.contract.getAddress(),
    abi: chain.abi,
    asset: { symbol: await chain.contract.symbol(), decimals: Number(await chain.contract.decimals()) },
    demoMode: DEMO_MODE,
    faucetAmount: FAUCET_AMOUNT.toString(),
    alertThreshold: (await chain.contract.alertThreshold()).toString()
  });
}));

async function walletInfo(address) {
  const c = chain.contract;
  const [owner, balance, frozen, auditor, eth] = await Promise.all([
    // Raw RPC for the gas balance: it must never come from a short-lived provider cache.
    c.owner(), c.balanceOf(address), c.isFrozen(address), c.isAuditor(address),
    chain.provider.send("eth_getBalance", [address, "latest"]).then(BigInt)
  ]);
  const role = owner.toLowerCase() === address.toLowerCase() ? "admin" : auditor ? "auditor" : "user";
  return { address, role, balance: balance.toString(), frozen, ethBalance: ethers.formatEther(eth) };
}

app.get("/api/wallet/:address", wrap(async (req, res) => {
  if (!ethers.isAddress(req.params.address)) throw fail(400, "That is not a valid wallet address.");
  res.json(await walletInfo(ethers.getAddress(req.params.address)));
}));

// Demo faucet: gives a connected wallet a little VKC and test ETH for gas. The chain check in
// chain.js guarantees this only ever runs on the local development chain.
const lastFaucet = new Map();
app.post("/api/faucet", wrap(async (req, res) => {
  const raw = req.body?.address;
  if (typeof raw !== "string" || !ethers.isAddress(raw)) throw fail(400, "Send a valid wallet address.");
  const address = ethers.getAddress(raw);
  if (address === ethers.ZeroAddress) throw fail(400, "Send a valid wallet address.");

  const last = lastFaucet.get(address) || 0;
  if (Date.now() - last < FAUCET_COOLDOWN_MS) throw fail(429, "Wait a few seconds before asking again.");

  const info = await walletInfo(address);
  if (info.frozen) throw fail(422, "This account is frozen, so it cannot receive VKC.");
  if (BigInt(info.balance) >= FAUCET_MIN_BALANCE) {
    throw fail(422, `This wallet already holds ${info.balance} VKC. The faucet only tops up wallets below ${FAUCET_MIN_BALANCE}.`);
  }
  lastFaucet.set(address, Date.now());

  // Gas money. hardhat_setBalance exists only on the local Hardhat node.
  if (Number(info.ethBalance) < 1) {
    try {
      await chain.provider.send("hardhat_setBalance", [address, "0x" + (10n * 10n ** 18n).toString(16)]);
    } catch (_e) {
      throw fail(503, "This chain cannot fund test ETH for gas. Use the Hardhat node from npm run chain.");
    }
  }
  const receipt = await chain.send(0, "mint", [address, FAUCET_AMOUNT, "Demo faucet"]);
  res.status(201).json({ id: chain.recordIdFromReceipt(receipt), amount: FAUCET_AMOUNT.toString(), transactionHash: receipt.hash });
}));

// ------------------------------------------------------------------ status

app.get("/api/status", wrap(async (_req, res) => {
  const c = chain.contract;
  const [network, blockNumber, totalSupply, count, headHash, threshold, integrity] = await Promise.all([
    chain.provider.getNetwork(),
    chain.provider.getBlockNumber(),
    c.totalSupply(),
    c.getRecordCount(),
    c.headHash(),
    c.alertThreshold(),
    c.verifyChain()
  ]);
  res.json({
    chainId: Number(network.chainId),
    blockNumber,
    contract: await c.getAddress(),
    asset: { name: await c.name(), symbol: await c.symbol() },
    totalSupply: totalSupply.toString(),
    recordCount: Number(count),
    headHash,
    alertThreshold: threshold.toString(),
    chainIntact: integrity[0],
    firstBrokenId: Number(integrity[1])
  });
}));

app.get("/api/blocks", wrap(async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 30);
  const latest = await chain.provider.getBlockNumber();
  const numbers = [];
  for (let n = latest; n >= 0 && numbers.length < limit; n--) numbers.push(n);
  const blocks = await Promise.all(numbers.map((n) => chain.provider.getBlock(n)));
  res.json({
    blocks: blocks.map((b) => ({
      number: b.number,
      hash: b.hash,
      parentHash: b.parentHash,
      timestamp: b.timestamp,
      transactions: b.transactions.length
    }))
  });
}));

// ---------------------------------------------------------------- accounts

app.get("/api/accounts", wrap(async (_req, res) => {
  const c = chain.contract;
  const list = await Promise.all(chain.accounts.map(async (a) => {
    const address = chain.addresses[a.index];
    const [balance, frozen, auditor] = await Promise.all([c.balanceOf(address), c.isFrozen(address), c.isAuditor(address)]);
    return {
      index: a.index,
      label: a.label,
      role: a.role,
      address,
      balance: balance.toString(),
      frozen,
      auditor: auditor || a.role === "admin"
    };
  }));
  res.json({ accounts: list });
}));

app.post("/api/accounts/:index/freeze", requireDemo, wrap(async (req, res) => {
  const target = parseAccountIndex(req.params.index, "Account");
  const frozen = Boolean(req.body?.frozen);
  const actor = chain.accounts.find((a) => a.role === "auditor")?.index ?? 0;
  await chain.send(actor, "setFrozen", [chain.addresses[target], frozen]);
  res.json({ ok: true, account: target, frozen });
}));

// ----------------------------------------------------------------- records

function filterRecords(records, q) {
  let rows = records;
  if (q.kind === "mint" || q.kind === "transfer") rows = rows.filter((r) => r.kind === q.kind);
  if (q.flagged === "true") rows = rows.filter((r) => r.flagged);
  if (q.account !== undefined && q.account !== "") {
    const address = chain.resolveAddress(q.account);
    if (!address) throw fail(400, "Unknown account.");
    rows = rows.filter((r) => r.from === address || r.to === address);
  }
  if (q.q) {
    const needle = String(q.q).toLowerCase().slice(0, 100);
    rows = rows.filter((r) =>
      [r.memo, r.fromLabel, r.toLabel, String(r.id), r.amount].some((v) => v && String(v).toLowerCase().includes(needle))
    );
  }
  return rows;
}

app.get("/api/records", wrap(async (req, res) => {
  const all = await chain.allRecords();
  const rows = filterRecords(all, req.query).reverse(); // newest first
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  res.json({ total: rows.length, records: rows.slice(offset, offset + limit) });
}));

async function verifyRecord(all, record) {
  const c = chain.contract;
  const previous = record.id > 1 ? all.find((r) => r.id === record.id - 1) : null;
  const next = all.find((r) => r.id === record.id + 1) || null;
  const block = await chain.provider.getBlock(record.blockNumber);

  const checks = {
    onChainVerification: await c.verifyRecord(record.id),
    hashRecomputed: chain.offchainHash(record) === record.recordHash,
    linkedToPrevious: record.prevHash === (previous ? previous.recordHash : ethers.ZeroHash),
    blockTimeMatches: Boolean(block) && block.timestamp === record.timestamp
  };
  return {
    verified: Object.values(checks).every(Boolean),
    checks,
    record,
    previousId: previous ? previous.id : null,
    nextId: next ? next.id : null
  };
}

app.get("/api/records/:id", wrap(async (req, res) => {
  if (!/^\d{1,9}$/.test(req.params.id)) throw fail(400, "Record ID must be a whole number.");
  const all = await chain.allRecords();
  const record = all.find((r) => r.id === Number(req.params.id));
  if (!record) return res.status(404).json({ verified: false, error: "No record with that ID." });
  res.json(await verifyRecord(all, record));
}));

// Accepts a record ID, a transaction hash, or a record hash.
app.get("/api/verify", wrap(async (req, res) => {
  const query = String(req.query.q || "").trim();
  if (!query) throw fail(400, "Enter a record ID, transaction hash or record hash.");
  const all = await chain.allRecords();
  let record = null;
  if (/^\d{1,9}$/.test(query)) {
    record = all.find((r) => r.id === Number(query));
  } else if (/^0x[0-9a-fA-F]{64}$/.test(query)) {
    const lower = query.toLowerCase();
    record = all.find((r) => r.transactionHash?.toLowerCase() === lower || r.recordHash.toLowerCase() === lower);
  } else {
    throw fail(400, "Use a whole-number ID or a 0x hash of 66 characters.");
  }
  if (!record) return res.status(404).json({ verified: false, error: "Nothing on the ledger matches that value." });
  res.json(await verifyRecord(all, record));
}));

// What-if check for demonstrations: recompute the hash as if one field had been edited.
// This is a calculation only. Nothing on the chain changes.
app.post("/api/records/:id/tamper-check", wrap(async (req, res) => {
  if (!/^\d{1,9}$/.test(req.params.id)) throw fail(400, "Record ID must be a whole number.");
  const record = (await chain.allRecords()).find((r) => r.id === Number(req.params.id));
  if (!record) throw fail(404, "No record with that ID.");

  const edited = { ...record };
  if (req.body?.amount !== undefined) edited.amount = parseAmount(req.body.amount).toString();
  if (req.body?.memo !== undefined) edited.memo = parseMemo(req.body.memo);
  const recomputedHash = chain.offchainHash(edited);

  res.json({
    storedHash: record.recordHash,
    recomputedHash,
    matches: recomputedHash === record.recordHash,
    changed: { amount: edited.amount !== record.amount, memo: edited.memo !== record.memo }
  });
}));

app.post("/api/records/:id/flag", requireDemo, wrap(async (req, res) => {
  if (!/^\d{1,9}$/.test(req.params.id)) throw fail(400, "Record ID must be a whole number.");
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
  if (!reason || Buffer.byteLength(reason, "utf8") > 80) throw fail(400, "Give a reason of 1 to 80 characters.");
  const actor = chain.accounts.find((a) => a.role === "auditor")?.index ?? 0;
  await chain.send(actor, "flag", [BigInt(req.params.id), reason]);
  res.json({ ok: true });
}));

// --------------------------------------------------------------- transfers

app.post("/api/transfer", requireDemo, wrap(async (req, res) => {
  const { from, to, amount, memo } = req.body || {};
  const fromIndex = parseAccountIndex(from, "Sender");
  const recipient = chain.resolveAddress(to);
  if (!recipient) throw fail(400, "Recipient must be a listed account or a valid address.");
  const receipt = await chain.send(fromIndex, "transfer", [recipient, parseAmount(amount), parseMemo(memo)]);
  const id = chain.recordIdFromReceipt(receipt);
  const record = (await chain.allRecords()).find((r) => r.id === id);
  res.status(201).json({ id, transactionHash: receipt.hash, blockNumber: receipt.blockNumber, record });
}));

app.post("/api/mint", requireDemo, wrap(async (req, res) => {
  const { to, amount, memo } = req.body || {};
  const recipient = chain.resolveAddress(to);
  if (!recipient) throw fail(400, "Recipient must be a listed account or a valid address.");
  const receipt = await chain.send(0, "mint", [recipient, parseAmount(amount), parseMemo(memo)]);
  res.status(201).json({ id: chain.recordIdFromReceipt(receipt), transactionHash: receipt.hash, blockNumber: receipt.blockNumber });
}));

// ----------------------------------------------------------------- reports

function parseRange(query) {
  const toTs = (value, endOfDay) => {
    if (!value) return undefined;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw fail(400, "Dates must look like 2026-11-23.");
    const base = Date.parse(value + "T00:00:00Z") / 1000 - 3 * 3600; // start of day, East Africa Time
    return endOfDay ? base + 86399 : base;
  };
  return { from: toTs(query.from, false), to: toTs(query.to, true) };
}

app.get("/api/report", wrap(async (req, res) => {
  const all = await chain.allRecords();
  const report = buildReport(all, parseRange(req.query));
  const accounts = await Promise.all(report.accounts.map(async (a) => ({
    ...a,
    balance: (await chain.contract.balanceOf(a.address)).toString()
  })));
  res.json({ ...report, accounts, generatedAt: Math.floor(Date.now() / 1000) });
}));

app.get("/api/report.csv", wrap(async (req, res) => {
  const { from, to } = parseRange(req.query);
  const all = await chain.allRecords();
  const rows = all.filter((r) => (!from || r.timestamp >= from) && (!to || r.timestamp <= to));
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="vukang-ledger-report.csv"');
  res.send(toCsv(rows));
}));

app.use("/api", (_req, res) => res.status(404).json({ error: "Unknown endpoint." }));

const server = app.listen(PORT, HOST, () => {
  console.log(`Vukang Payments dashboard: http://${HOST}:${PORT}`);
  chain.ensureReady().catch((e) => console.error(e.message));
});

function shutdown() {
  chain.stopLocalNode();
  server.close(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
