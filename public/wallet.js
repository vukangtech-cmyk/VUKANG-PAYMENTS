"use strict";

/* Wallet layer: connects to an EIP-1193 wallet (MetaMask), makes sure it is on the project's
   local chain, and signs contract calls in the user's own wallet. The server never sees a
   private key. Uses the ethers library served from /vendor. */

const Wallet = (() => {
  const S = { cfg: null, address: null, info: null, signer: null, contract: null, wrongNetwork: false };
  const handlers = { session: [], info: [] };
  const STORE_KEY = "vukang-wallet-autoconnect";

  const eth = () => window.ethereum;
  const emit = (kind) => handlers[kind].forEach((fn) => { try { fn(); } catch (_e) { /* a listener must not break the wallet */ } });
  const remember = (on) => { try { on ? localStorage.setItem(STORE_KEY, "1") : localStorage.removeItem(STORE_KEY); } catch (_e) { /* storage may be blocked */ } };
  const remembered = () => { try { return localStorage.getItem(STORE_KEY) === "1"; } catch (_e) { return false; } };

  // Contract has two `transfer` forms (ERC-20 and memo), so the memo form is named in full.
  const SIGNATURES = { transfer: "transfer(address,uint256,string)" };

  const REVERT_TEXT = {
    NotOwner: () => "Only the treasury (admin) wallet can do this.",
    NotAuditor: () => "Only the audit desk or treasury wallet can do this.",
    InvalidRecipient: () => "Recipient is not valid.",
    InvalidAmount: () => "Amount must be greater than zero.",
    InvalidMemo: () => "Memo is too long (maximum 80 bytes).",
    InsufficientBalance: (a) => `Insufficient balance: available ${a[0]}, required ${a[1]}.`,
    AccountFrozen: () => "One of the accounts is frozen by the audit desk.",
    SelfTransfer: () => "Sender and recipient must be different accounts.",
    UnknownRecord: () => "That record does not exist.",
    AlreadyFlagged: () => "That record is already flagged."
  };

  function friendly(error) {
    const code = error && (error.code ?? error.info?.error?.code);
    if (code === "ACTION_REJECTED" || code === 4001) return "You cancelled the request in your wallet.";
    const name = error?.revert?.name;
    if (name && REVERT_TEXT[name]) return REVERT_TEXT[name](Array.from(error.revert.args || []).map(String));
    const message = (error && (error.shortMessage || error.message)) || "";
    if (/nonce/i.test(message)) {
      return "Your wallet's transaction counter is out of step with the local chain. In MetaMask, open Settings, Advanced, then Clear activity tab data, and try again.";
    }
    if (/insufficient funds/i.test(message)) return "This wallet has no test ETH to pay for gas. Use Get demo VKC to receive some.";
    return message || "The wallet could not complete the request.";
  }

  async function loadConfig() {
    if (S.cfg) return S.cfg;
    const res = await fetch("/api/config");
    if (!res.ok) throw new Error("Cannot read the chain settings from the server.");
    S.cfg = await res.json();
    return S.cfg;
  }

  async function ensureNetwork() {
    const cfg = await loadConfig();
    const current = await eth().request({ method: "eth_chainId" });
    if (String(current).toLowerCase() === cfg.chainIdHex) {
      S.wrongNetwork = false;
      return;
    }
    try {
      await eth().request({ method: "wallet_switchEthereumChain", params: [{ chainId: cfg.chainIdHex }] });
    } catch (error) {
      const unknownChain = error && (error.code === 4902 || error.data?.originalError?.code === 4902 || /unrecognized chain|not added/i.test(error.message || ""));
      if (!unknownChain) throw new Error(friendly(error));
      try {
        await eth().request({
          method: "wallet_addEthereumChain",
          params: [{
            chainId: cfg.chainIdHex,
            chainName: cfg.networkName,
            nativeCurrency: { name: "Test Ether", symbol: "ETH", decimals: 18 },
            rpcUrls: [cfg.rpcUrl]
          }]
        });
      } catch (addError) {
        throw new Error(friendly(addError));
      }
    }
    S.wrongNetwork = false;
  }

  async function refresh() {
    if (!S.address) return null;
    const res = await fetch(`/api/wallet/${S.address}`);
    if (res.ok) S.info = await res.json();
    emit("info");
    return S.info;
  }

  async function bind(address) {
    const cfg = await loadConfig();
    const provider = new ethers.BrowserProvider(eth());
    S.signer = await provider.getSigner(address);
    S.address = ethers.getAddress(address);
    S.contract = new ethers.Contract(cfg.contract, cfg.abi, S.signer);
    await refresh();
  }

  function clear() {
    S.address = null;
    S.info = null;
    S.signer = null;
    S.contract = null;
  }

  function listen() {
    if (listen.done || !eth() || !eth().on) return;
    listen.done = true;
    eth().on("accountsChanged", async (accounts) => {
      if (!accounts || !accounts.length) clear();
      else { try { await bind(accounts[0]); } catch (_e) { clear(); } }
      emit("session");
    });
    eth().on("chainChanged", async (chainId) => {
      const cfg = await loadConfig();
      S.wrongNetwork = String(chainId).toLowerCase() !== cfg.chainIdHex;
      if (!S.wrongNetwork && S.address) { try { await bind(S.address); } catch (_e) { /* keep state */ } }
      emit("session");
    });
  }

  async function connect() {
    if (!eth()) throw new Error("No wallet found. Install MetaMask, then reload this page.");
    await loadConfig();
    let accounts;
    try {
      accounts = await eth().request({ method: "eth_requestAccounts" });
    } catch (error) {
      throw new Error(friendly(error));
    }
    if (!accounts || !accounts[0]) throw new Error("The wallet did not share an account.");
    await ensureNetwork();
    await bind(accounts[0]);
    remember(true);
    listen();
    emit("session");
  }

  // Quietly restore a previous connection without opening a wallet prompt.
  async function autoReconnect() {
    if (!eth() || !remembered()) return;
    try {
      await loadConfig();
      const accounts = await eth().request({ method: "eth_accounts" });
      if (!accounts || !accounts[0]) return;
      const current = await eth().request({ method: "eth_chainId" });
      S.wrongNetwork = String(current).toLowerCase() !== S.cfg.chainIdHex;
      if (!S.wrongNetwork) await bind(accounts[0]);
      else S.address = ethers.getAddress(accounts[0]);
      listen();
      emit("session");
    } catch (_e) { /* stay disconnected */ }
  }

  // A wallet cannot be disconnected by a page; this forgets it here and stops using it.
  function disconnect() {
    clear();
    remember(false);
    emit("session");
  }

  async function send(name, args) {
    if (!S.contract) throw new Error("Connect your wallet first.");
    await ensureNetwork();
    const fn = S.contract[SIGNATURES[name] || name];
    try {
      await fn.staticCall(...args); // dry run first, so a rejection explains itself before any prompt
    } catch (error) {
      throw new Error(friendly(error));
    }
    let receipt;
    try {
      const tx = await fn(...args);
      receipt = await tx.wait();
    } catch (error) {
      throw new Error(friendly(error));
    }
    let id = null;
    for (const log of receipt.logs) {
      try {
        const parsed = S.contract.interface.parseLog(log);
        if (parsed && parsed.name === "Recorded") id = Number(parsed.args.id);
      } catch (_e) { /* a log from another contract */ }
    }
    await refresh();
    return { id, blockNumber: receipt.blockNumber, transactionHash: receipt.hash };
  }

  async function faucet() {
    if (!S.address) throw new Error("Connect your wallet first.");
    const res = await fetch("/api/faucet", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address: S.address })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "The faucet could not send VKC.");
    await refresh();
    return data;
  }

  async function addToken() {
    const cfg = await loadConfig();
    try {
      await eth().request({
        method: "wallet_watchAsset",
        params: { type: "ERC20", options: { address: cfg.contract, symbol: cfg.asset.symbol, decimals: cfg.asset.decimals } }
      });
    } catch (error) {
      throw new Error(friendly(error));
    }
  }

  return {
    get available() { return Boolean(eth()); },
    get cfg() { return S.cfg; },
    get address() { return S.address; },
    get info() { return S.info; },
    get wrongNetwork() { return S.wrongNetwork; },
    on(kind, fn) { handlers[kind].push(fn); },
    loadConfig, connect, disconnect, autoReconnect, ensureNetwork, send, refresh, faucet, addToken
  };
})();
