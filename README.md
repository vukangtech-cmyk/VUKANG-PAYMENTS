# Vukang Payments

**Design and Development of a Blockchain-Based Digital Asset Transaction Verification and Monitoring System**

An academic prototype. A real smart contract runs on a local Ethereum-compatible blockchain (Hardhat). Digital assets (VKC) are issued and transferred on that chain with balances the contract enforces. Users sign their own transactions in MetaMask. Every transaction can be verified, traced, monitored and reported on.

> Research problem: how can blockchain technology support transparent verification, traceability and monitoring of digital asset transactions?

## What it does

| Contribution | How the prototype delivers it |
| --- | --- |
| Transaction verification | Each record stores a keccak256 hash of its own data plus the hash of the record before it. A record is checked four ways: by the contract, by an independent recalculation on the server, by its link to the previous record, and by the timestamp of the block that holds it. Lookup works by record ID, transaction hash or record hash. |
| Transaction history management | Every issue and transfer is an on-chain record with sender, recipient, amount, memo, time and block. The dashboard filters by type, account, review status and text. |
| Reporting | Totals, volume per hour or day, per-account sent, received and net, flagged records, CSV export and a print layout. |
| Monitoring | The contract flags any transfer at or above a configurable threshold. The audit desk can flag a record by hand and freeze accounts. |
| Wallet signing | Users connect MetaMask and sign payments themselves. The server never holds their keys. |

Transfers are real as far as the chain is concerned: balances change, an overdraft is rejected by the contract, a frozen account cannot send or receive, and records cannot be altered or deleted through the contract. VKC is a teaching asset with no monetary value.

## Quick start

Requires Node.js 20 or newer.

```bash
npm install
npm test        # 20 contract tests
npm start       # starts the chain if needed, deploys the contract, loads demo data
```

Open <http://127.0.0.1:3000>. The first start loads demo data, which takes up to a minute. The page shows "Loading chain settings" until it is ready.

Without a wallet, the dashboard runs in **demo mode**: the server signs for ten built-in demo accounts, so everything can be tried straight away.

## Use it with MetaMask

1. Install the [MetaMask](https://metamask.io/download/) browser extension and create a wallet.
2. Start the project (`npm start`) and open the dashboard.
3. Select **Connect wallet** in the left panel. MetaMask asks to connect, then asks to add the network **Vukang Local (Hardhat)**. Approve both. The details, if you ever need them:

   | Setting | Value |
   | --- | --- |
   | Network name | Vukang Local (Hardhat) |
   | RPC URL | `http://127.0.0.1:8545` |
   | Chain ID | `31337` |
   | Currency symbol | ETH |

4. Select **Get demo VKC**. The local faucet sends your wallet 500 VKC and test ETH to pay gas. It only works on the local chain and only for wallets holding fewer than 100 VKC.
5. Open **Send**, choose a recipient, enter an amount and a memo, and confirm in MetaMask. The record appears in History and can be checked on the Verify page.
6. Select **Add VKC to wallet** so MetaMask shows your VKC balance.

### Roles

The contract gives three roles. The dashboard reads your role from the chain and turns off actions you may not take.

| Role | Who | Can do |
| --- | --- | --- |
| Treasury | The account that deployed the contract (Hardhat account #0) | Issue VKC, set auditors and the alert threshold, plus everything an auditor can do |
| Audit desk | Hardhat account #1 | Flag records, freeze and unfreeze accounts |
| User | Any other wallet | Send and receive VKC |

To act as Treasury or Audit desk, import that account into MetaMask. Run `npm run chain` to see the list of accounts and their private keys. These keys are published in the Hardhat documentation and anyone can use them, so use them only on this local chain and never on a real network.

### Common problems

- **"Nonce too high" or a transaction that never confirms.** The local chain restarts from block 0, but MetaMask remembers the old one. In MetaMask open Settings, Advanced, then **Clear activity tab data**.
- **"No test ETH to pay for gas".** Select Get demo VKC, which also funds gas.
- **The page says Wrong network.** Select Switch network and approve it in MetaMask.

## How the hash chain works

```
Record 1                Record 2                Record 3
prevHash = 0x00…        prevHash = hash(1)      prevHash = hash(2)
hash(1) = keccak256(    hash(2) = keccak256(    hash(3) = keccak256(
  id, kind, from, to,     id, kind, from, to,     …
  amount, memo, time,     amount, memo, time,
  block, prevHash)        block, prevHash)
```

Changing any field of any record changes its hash and breaks every link after it. The Verify page's "Try changing this record" panel shows this by recalculating a hash with an edited amount. Flags are stored beside the record but are not part of the hash, so flagging never alters the evidence.

## Architecture

```
Browser dashboard ──HTTP──▶ Express API ──JSON-RPC──▶ Hardhat node (chain 31337)
public/ + MetaMask          backend/                  VukangLedger.sol
      └────────── signed transactions, sent through MetaMask ───────────┘
```

- `contracts/VukangLedger.sol`: balances, mint, transfer, hash-linked records, flags, freezes, `verifyRecord`, `verifyChain`.
- `backend/`: read API, demo-mode signing, faucet, report and CSV builders.
- `public/`: dashboard (`app.js`) and wallet layer (`wallet.js`). The ethers library is served from this project, not a CDN.
- `test/VukangLedger.test.js`: 20 contract tests.

### Wallet compatibility

VKC implements the parts of ERC-20 that wallets need to show and send it: `name`, `symbol`, `decimals`, `totalSupply`, `balanceOf`, `transfer(to, amount)` and the `Transfer` event. It also has a `transfer(to, amount, memo)` form that attaches a memo. `approve` and `transferFrom` are left out on purpose, because this prototype has no use for allowances.

## Settings

Copy `.env.example` to `.env` to change them.

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | Dashboard port |
| `RPC_URL` | `http://127.0.0.1:8545` | Chain endpoint (local only) |
| `ALERT_THRESHOLD` | `1000` | Transfers of this size or more are flagged on a new deployment |
| `AUTO_SEED` | `true` | Load demo transfers into an empty ledger. Set to `false` for a blank start. |
| `DEMO_MODE` | `true` | `true`: the server signs for the demo accounts. `false`: the server only reads, and every write must be signed in MetaMask. |
| `FAUCET_AMOUNT` | `500` | VKC sent by the faucet |

If you prefer to see the chain in its own terminal, run `npm run chain` first and `npm start` in a second one. The server detects the running chain and uses it. The contract compiles with the bundled `solc` package, so no compiler download is needed.

## API

| Method and path | Purpose |
| --- | --- |
| `GET /api/config` | Chain ID, contract address, ABI, demo mode (used by the wallet layer) |
| `GET /api/wallet/:address` | Role, VKC balance, frozen state and ETH balance of any address |
| `POST /api/faucet` | `{ address }` sends demo VKC and test ETH |
| `GET /api/status` | Chain, contract, supply, record count, full-chain integrity |
| `GET /api/blocks?limit=` | Latest blocks with hashes |
| `GET /api/accounts` | Demo accounts with balances and frozen state |
| `GET /api/records` | History. Filters: `kind`, `flagged`, `account`, `q`, `limit`, `offset` |
| `GET /api/records/:id` | One record with its four verification checks |
| `GET /api/verify?q=` | Verify by ID, transaction hash or record hash |
| `POST /api/records/:id/tamper-check` | What-if hash recalculation. Changes nothing. |
| `GET /api/report` and `/api/report.csv` | Summary and export. Optional `from` and `to` dates. |
| `POST /api/transfer`, `/api/mint`, `/api/records/:id/flag`, `/api/accounts/:index/freeze` | Demo-mode writes. Refused when `DEMO_MODE=false`. |

## How it was tested

- 20 automated contract tests (`npm test`): balances, rejections, hash links, flags, freezes, roles and the wallet-facing interface.
- The API was exercised against a running chain, including a wallet that holds its own private key signing real transactions.
- The dashboard was driven in a browser with a test wallet that behaves like MetaMask: it starts on the wrong network, adds the network, signs with its own key, and can cancel a request. This covers every wallet flow in the dashboard. It is **not** the MetaMask extension itself, so try the steps above with the real extension before you demonstrate the project.

## Limits of this prototype

- It runs on a local development chain. The chain resets when the node stops, and the server reloads demo data on the next start. A public network would need a funded wallet and a deployment, which this project deliberately does not do.
- In demo mode the server signs with disposable accounts that Hardhat unlocks locally. Turn demo mode off to require MetaMask for every write.
- The API accepts requests only from the same computer, refuses any chain other than ID 31337, and has no login. Do not expose it to a network. The faucet would let anyone mint VKC.
- A blockchain makes records tamper-evident. It does not prove that what was recorded is true.
- This is not audited and is not suitable for real funds or personal data.

## Possible next steps

A public testnet deployment, per-role logins, persistent chain storage, and allowances (`approve` and `transferFrom`).

## Licence

Boost Software License 1.0. See the `LICENSE` file.
