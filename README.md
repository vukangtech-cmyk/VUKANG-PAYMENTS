# Blockchain-Based Digital Asset Transaction Verification and Monitoring

A local academic prototype that records **simulated transaction metadata** on a Hardhat blockchain, verifies records by ID, and displays event-based history in a browser dashboard. It does **not** transfer tokens, custody assets, or provide production security.

## Requirements

- Node.js 20 or newer (the project was prepared in a Node 24 environment)
- npm
- Terminal access

## Project locations

```text
blockchain-asset-monitor/
├── contracts/AssetTransactionRegistry.sol  # on-chain transaction registry
├── scripts/deploy.js                       # deploys contract to local chain
├── test/AssetTransactionRegistry.test.js   # smart-contract tests
├── backend/server.js                       # local-only API and static web server
├── public/index.html                       # dashboard
├── public/app.js                            # dashboard behavior
├── public/styles.css                        # dashboard styling
├── deployments/localhost.json               # generated contract address
├── hardhat.config.js
├── package.json
└── .env.example
```

## Setup and run

Open a terminal in the project folder:

```bash
cd /data/blockchain-asset-monitor
npm install
cp .env.example .env
npm run compile
npm test
```

Start the local blockchain in **Terminal 1** and leave it running:

```bash
cd /data/blockchain-asset-monitor
npm run chain
```

In **Terminal 2**, deploy the contract to that local chain:

```bash
cd /data/blockchain-asset-monitor
npm run deploy:local
```

In **Terminal 3**, start the dashboard and API:

```bash
cd /data/blockchain-asset-monitor
npm run api
```

Open `http://127.0.0.1:3000`. Enter a recipient address from the accounts printed by `npm run chain`, an asset label such as `DEMO`, and a whole-number amount. The API submits the record using Hardhat's first disposable local account. The dashboard then displays its ID, verifies it, and reads the transaction history.

## Integration map

- **Hardhat local blockchain** — JSON-RPC at `http://127.0.0.1:8545`, chain ID `31337`.
- **Solidity smart contract** — validates input and stores transaction metadata.
- **Express API** — connects the dashboard to the local node and contract.
- **Browser dashboard** — records, verifies, and monitors simulated transactions.

MetaMask is not required for this first version. The API uses a disposable account unlocked by the local Hardhat node. Do not change the RPC URL to a public network or enter real keys or real asset data.

## API endpoints

- `GET /api/health` — local chain and contract status.
- `GET /api/transactions` — newest-first event history.
- `GET /api/transactions/:id` — verifies and retrieves a record.
- `POST /api/transactions` — records `{ "to": "0x...", "asset": "DEMO", "amount": "25" }`.

## Reset the demo

Stop the Hardhat node with `Ctrl+C`. Starting `npm run chain` again creates a fresh local chain; deploy the contract again with `npm run deploy:local`. Existing local records are intentionally not persistent across a fresh chain.

## Limitations and safety

- Records are metadata demonstrations only. No token or cryptocurrency moves.
- Local chain state is temporary and resets when the Hardhat node is restarted.
- Blockchain immutability does not prove that submitted information is true; it only makes recorded data tamper-evident within this prototype.
- The API is bound to `127.0.0.1` and checks for chain ID `31337`. Keep these safeguards.
- This is not audited and is not suitable for production, public deployment, real funds, or personal/confidential information.
