# Vukang Payments

**Design and Development of a Blockchain-Based Digital Asset Transaction Verification and Monitoring System**

An academic prototype. It runs a real smart contract on a local Ethereum-compatible blockchain (Hardhat). Digital assets (VKC) are issued and transferred on that chain with enforced balances, and every transaction can be verified, traced, monitored and reported on.

> Research problem: how can blockchain technology support transparent verification, traceability and monitoring of digital asset transactions?

## What it does

| Contribution | How the prototype delivers it |
| --- | --- |
| Transaction verification | Each record stores a keccak256 hash of its own data plus the hash of the record before it. A record is checked four ways: by the contract, by an independent recalculation on the server, by its link to the previous record, and by the timestamp of the block that holds it. Lookup works by record ID, transaction hash or record hash. |
| Transaction history management | Every issue and transfer is an on-chain record with sender, recipient, amount, memo, time and block. The dashboard filters by type, account, review status and text. |
| Reporting | Totals, volume per hour or day, per-account sent, received and net, flagged records, CSV export and a print layout. |
| Monitoring | The contract flags any transfer at or above a configurable threshold. The audit desk can flag a record by hand and freeze accounts. |

The transfers are real as far as the chain is concerned: balances change, an overdraft is rejected by the contract, a frozen account cannot send or receive, and records cannot be altered or deleted through the contract. VKC is a teaching asset with no monetary value.

## How the hash chain works

```
Record 1                Record 2                Record 3
prevHash = 0x00…        prevHash = hash(1)      prevHash = hash(2)
hash(1) = keccak256(    hash(2) = keccak256(    hash(3) = keccak256(
  id, kind, from, to,     id, kind, from, to,     …
  amount, memo, time,     amount, memo, time,
  block, prevHash)        block, prevHash)
```

Changing any field of any record changes its hash and breaks every link after it. The dashboard's "Try changing this record" panel shows this by recalculating a hash with an edited amount. Flags are stored beside the record but are not part of the hash, so flagging never alters the evidence.

## Architecture

```
Browser dashboard  ──HTTP──▶  Express API  ──JSON-RPC──▶  Hardhat node (chain 31337)
public/                       backend/                     VukangLedger.sol
```

- `contracts/VukangLedger.sol`: balances, mint, transfer, hash-linked records, flags, freezes, `verifyRecord`, `verifyChain`.
- `backend/`: API, chain connection, demo data, report and CSV builders.
- `public/`: dashboard with six pages (Overview, Send, Verify, History, Monitoring, Reports).
- `test/VukangLedger.test.js`: 16 contract tests.

## Run it

Requires Node.js 20 or newer.

```bash
npm install
npm test        # contract tests
npm start       # starts the chain if needed, deploys the contract, loads demo data
```

Open <http://127.0.0.1:3000>.

If you prefer to see the chain in its own terminal, run `npm run chain` first and `npm start` in a second one. The server detects the running chain and uses it.

The contract compiles with the bundled `solc` package, so no compiler download is needed.

### Settings

Copy `.env.example` to `.env` to change them.

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | Dashboard port |
| `RPC_URL` | `http://127.0.0.1:8545` | Chain endpoint (local only) |
| `ALERT_THRESHOLD` | `1000` | Transfers of this size or more are flagged on a new deployment |
| `AUTO_SEED` | `true` | Load demo accounts and transfers into an empty ledger. Set to `false` for a blank start. |

## API

| Method and path | Purpose |
| --- | --- |
| `GET /api/status` | Chain, contract, supply, record count, full-chain integrity |
| `GET /api/blocks?limit=` | Latest blocks with hashes |
| `GET /api/accounts` | Demo accounts with balances and frozen state |
| `GET /api/records` | History. Filters: `kind`, `flagged`, `account`, `q`, `limit`, `offset` |
| `GET /api/records/:id` | One record with its four verification checks |
| `GET /api/verify?q=` | Verify by ID, transaction hash or record hash |
| `POST /api/transfer` | `{ from, to, amount, memo }` |
| `POST /api/mint` | `{ to, amount, memo }` (treasury only) |
| `POST /api/records/:id/flag` | `{ reason }` (audit desk) |
| `POST /api/accounts/:index/freeze` | `{ frozen }` (audit desk) |
| `POST /api/records/:id/tamper-check` | What-if hash recalculation. Changes nothing. |
| `GET /api/report` and `/api/report.csv` | Summary and export. Optional `from` and `to` dates. |

## Limits of this prototype

- It runs on a local development chain. The chain resets when the node stops, and the server reloads demo data on the next start. A public network would need a funded wallet, which this project deliberately does not use.
- The server signs transactions with the disposable accounts that Hardhat unlocks locally. A production design would have each user sign with their own wallet, for example MetaMask.
- The API accepts requests only from the same computer and refuses any chain other than ID 31337. There is no login. Do not expose it to a network.
- A blockchain makes records tamper-evident. It does not prove that what was recorded is true.
- This is not audited and is not suitable for real funds or personal data.

## Possible next steps

Wallet signing in the browser, a public testnet deployment, per-role logins, and persistent chain storage.

## Licence

MIT
