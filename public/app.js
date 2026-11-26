"use strict";

/* ------------------------------------------------------------------ helpers
   Nothing here uses innerHTML. Memos and labels come from users, so every
   piece of text is inserted with textContent. */

const view = document.getElementById("view");
const SYMBOL = "VKC";

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") el.className = value;
    else if (key === "text") el.textContent = value;
    else if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
    else if (key === "value" || key === "checked" || key === "disabled" || key === "selected") el[key] = value;
    else el.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return el;
}

function svg(tag, attrs = {}, ...children) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  for (const c of children.flat()) if (c) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
}

// replaceChildren() would print "null" for empty slots, so empty values are dropped first.
function fill(el, ...nodes) {
  el.replaceChildren(...nodes.flat(Infinity).filter((n) => n !== null && n !== undefined && n !== false));
}

const fmt = (n) => BigInt(n).toLocaleString("en-US");
const short = (hash, head = 8, tail = 6) => (hash ? `${hash.slice(0, head + 2)}…${hash.slice(-tail)}` : "");
const shortAddr = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const who = (label, address) =>
  Wallet.address && address && address.toLowerCase() === Wallet.address.toLowerCase() ? "You" : label || shortAddr(address);

const timeFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Africa/Dar_es_Salaam", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit"
});
const when = (ts) => timeFmt.format(new Date(ts * 1000));

function ago(ts) {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

async function api(path, options = {}) {
  const init = { method: options.method || "GET", headers: {} };
  if (options.body !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(options.body);
  }
  let res;
  try {
    res = await fetch("/api" + path, init);
  } catch (_e) {
    throw new Error("Cannot reach the server. Start it with npm start.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok && !(res.status === 404 && data.verified === false)) {
    throw new Error(data.error || "Something went wrong. Try again.");
  }
  return Object.assign(data, { _status: res.status });
}

let toastTimer;
function toast(message, kind = "ok") {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.className = "toast show" + (kind === "bad" ? " bad" : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = "toast"), 3800);
}

const state = { accounts: [], status: null, lastBlock: null };

async function loadAccounts() {
  state.accounts = (await api("/accounts")).accounts;
  return state.accounts;
}

function chip(text, kind = "") {
  return h("span", { class: "chip " + kind, text });
}

function pageHead(title, lede, ...actions) {
  return [
    h("div", { class: "page-head" }, h("h1", { text: title }), actions.length ? h("div", { class: "actions no-print" }, actions) : null),
    lede ? h("p", { class: "lede", text: lede }) : null
  ];
}

function recordRow(r, { link = true } = {}) {
  const title = r.kind === "mint" ? `New VKC issued to ${who(r.toLabel, r.to)}` : `${who(r.fromLabel, r.from)} paid ${who(r.toLabel, r.to)}`;
  const row = h("li", { class: "row" + (link ? " clickable" : ""), tabindex: link ? "0" : null },
    h("div", { class: "title", text: title }),
    h("div", { class: "amount", text: `${fmt(r.amount)} ${SYMBOL}` }),
    h("div", { class: "sub", text: [r.memo || "No memo", when(r.timestamp)].join(", ") }),
    h("div", { class: "side" }, r.flagged ? chip(`Flagged: ${r.flagReason}`, "warn") : null)
  );
  if (link) {
    const go = () => (location.hash = `#verify/${r.id}`);
    row.addEventListener("click", go);
    row.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
  }
  return row;
}

/* ------------------------------------------------------------- chain strip */
async function chainStrip() {
  const { blocks } = await api("/blocks?limit=12");
  const ordered = [...blocks].reverse();
  const tip = ordered[ordered.length - 1];
  const isNew = state.lastBlock !== null && tip.number > state.lastBlock;
  state.lastBlock = tip.number;

  const chain = h("div", { class: "chain" });
  ordered.forEach((b, i) => {
    if (i > 0) chain.append(h("div", { class: "link", "aria-hidden": "true" }));
    const isTip = i === ordered.length - 1;
    chain.append(
      h("div", { class: "block" + (isTip ? " tip" : "") + (isTip && isNew ? " arrive" : ""), title: `Hash ${b.hash}\nParent ${b.parentHash}` },
        h("b", { text: `Block ${b.number}` }),
        h("span", { class: "mono", text: short(b.hash, 6, 4) }),
        h("small", { text: `${b.transactions} ${b.transactions === 1 ? "transaction" : "transactions"}, ${ago(b.timestamp)}` })
      )
    );
  });

  const scroll = h("div", { class: "chain-scroll" }, chain);
  requestAnimationFrame(() => (scroll.scrollLeft = scroll.scrollWidth));
  return scroll;
}

/* ---------------------------------------------------------------- overview */
async function overviewView() {
  const [status, accounts, recs] = await Promise.all([api("/status"), loadAccounts(), api("/records?limit=8")]);
  state.status = status;
  const flaggedTotal = (await api("/records?flagged=true&limit=1")).total;

  const strip = await chainStrip();
  const intact = status.chainIntact;

  fill(view, 
    ...pageHead("Ledger overview", "Every transfer is written to the blockchain and linked to the one before it. Change any record and the chain stops matching."),
    h("div", { class: "chain-wrap" },
      h("div", { class: "chain-head" },
        h("h2", { text: "Latest blocks" }),
        h("p", { text: `Local chain ${status.chainId}, contract ${shortAddr(status.contract)}` })
      ),
      strip
    ),
    h("div", { class: "actions" },
      intact
        ? chip(`Chain intact: all ${status.recordCount} records check out`, "ok")
        : chip(`Chain broken at record ${status.firstBrokenId}`, "bad")
    ),
    h("dl", { class: "facts" },
      fact("Total supply", `${fmt(status.totalSupply)} `, SYMBOL),
      fact("Records", String(status.recordCount)),
      fact("Flagged", String(flaggedTotal)),
      fact("Alert threshold", `${fmt(status.alertThreshold)} `, SYMBOL)
    ),
    h("div", { class: "two" },
      h("section", {},
        h("h2", { text: "Latest activity" }),
        recs.records.length
          ? h("ul", { class: "rows" }, recs.records.map((r) => recordRow(r)))
          : h("div", { class: "empty", text: "No records yet. Send VKC to create the first one." }),
        h("div", { class: "pager" }, h("a", { class: "btn ghost small", href: "#history", text: "See full history" }))
      ),
      h("section", {},
        h("h2", { text: "Balances" }),
        h("ul", { class: "rows" }, accounts.filter((a) => a.index !== 1).map((a) =>
          h("li", { class: "row" },
            h("div", { class: "title", text: a.label }),
            h("div", { class: "amount", text: `${fmt(a.balance)} ${SYMBOL}` }),
            h("div", { class: "sub", text: a.role === "admin" ? "Treasury" : "Account" }),
            h("div", { class: "side" }, a.frozen ? chip("Frozen", "bad") : null)
          )
        ))
      )
    )
  );
}

function fact(label, value, unit) {
  return h("div", {}, h("dt", { text: label }), h("dd", {}, value, unit ? h("small", { text: unit }) : null));
}

/* -------------------------------------------------------------------- send */
function accountOptions(accounts, { includeAuditor = true, exclude } = {}) {
  return accounts
    .filter((a) => (includeAuditor || a.role !== "auditor") && a.index !== exclude)
    .map((a) => h("option", { value: String(a.index), text: `${a.label} (${fmt(a.balance)} ${SYMBOL})` }));
}

async function sendView() {
  let accounts = await loadAccounts();
  const status = state.status || (await api("/status"));
  const threshold = BigInt(status.alertThreshold);
  let mode = "transfer";

  const tabs = h("div", { class: "tabs", role: "tablist" });
  const body = h("div");
  const side = h("div");

  const tabButton = (id, label) => h("button", {
    role: "tab", type: "button", "aria-selected": String(mode === id), text: label,
    onclick: () => { mode = id; draw(); }
  });

  function receipt(result, kind) {
    const rec = result.record;
    return h("div", { class: "panel" },
      h("h2", { text: kind === "mint" ? "VKC issued" : "Payment recorded" }),
      h("dl", { class: "detail" },
        h("dt", { text: "Record" }), h("dd", { text: `#${result.id}` }),
        h("dt", { text: "Block" }), h("dd", { text: String(result.blockNumber) }),
        h("dt", { text: "Transaction hash" }), h("dd", { class: "mono", text: result.transactionHash }),
        rec ? [h("dt", { text: "Record hash" }), h("dd", { class: "mono", text: rec.recordHash })] : null
      ),
      rec && rec.flagged ? h("p", { class: "notice warn", text: "This transfer reached the alert threshold, so the contract flagged it for review." }) : null,
      h("div", { class: "actions", style: "margin-top:18px" },
        h("a", { class: "btn", href: `#verify/${result.id}`, text: "Verify this record" }),
        h("a", { class: "btn ghost", href: "#overview", text: "See the chain" })
      )
    );
  }

  function transferForm() {
    const from = h("select", { id: "from" }, accountOptions(accounts, { includeAuditor: false }));
    from.value = "3";
    const walletMode = Boolean(Wallet.address);
    const canSign = walletMode || Boolean(Wallet.cfg && Wallet.cfg.demoMode);
    const walletFrozen = walletMode && Boolean(Wallet.info && Wallet.info.frozen);
    const fromField = walletMode
      ? h("div", { class: "static-field", id: "from-wallet" }, h("strong", { text: "Your wallet" }), h("span", { class: "mono", text: Wallet.address }))
      : from;
    const signNotice = canSign ? null : h("p", { class: "notice warn", text: "The server is in read-only mode. Connect your wallet in the left panel to send VKC." });
    const senderInfo = () => (walletMode
      ? { label: "Your wallet", balance: Wallet.info ? Wallet.info.balance : "0" }
      : accounts.find((a) => String(a.index) === from.value));
    const to = h("select", { id: "to" });
    const other = h("input", { id: "other", placeholder: "0x…", autocomplete: "off", spellcheck: "false" });
    const otherWrap = h("div", { hidden: true }, h("label", { for: "other", text: "Recipient address" }), other);
    const amount = h("input", { id: "amount", inputmode: "numeric", autocomplete: "off", placeholder: "100" });
    const memo = h("input", { id: "memo", maxlength: "80", autocomplete: "off", placeholder: "What is this payment for?" });
    const error = h("div", { class: "notice bad", hidden: true, role: "alert" });
    const submit = h("button", { class: "btn", type: "submit", text: `Send ${SYMBOL}` });
    const preview = h("div");

    function fillRecipients() {
      const keep = to.value;
      fill(to, ...accountOptions(accounts, { includeAuditor: false, exclude: walletMode ? undefined : Number(from.value) }),
        h("option", { value: "other", text: "Another address…" }));
      if ([...to.options].some((o) => o.value === keep)) to.value = keep;
      else to.selectedIndex = 0;
      otherWrap.hidden = to.value !== "other";
    }

    function update() {
      const sender = senderInfo();
      const raw = amount.value.trim();
      const valid = /^[1-9]\d{0,17}$/.test(raw);
      const value = valid ? BigInt(raw) : 0n;
      const tooMuch = valid && value > BigInt(sender.balance);
      const recipient = to.value === "other" ? other.value.trim() || "(address)" : accounts.find((a) => String(a.index) === to.value)?.label;
      otherWrap.hidden = to.value !== "other";

      amount.setAttribute("aria-invalid", String(Boolean(raw) && (!valid || tooMuch)));
      submit.disabled = !canSign || walletFrozen || !valid || tooMuch || (to.value === "other" && !/^0x[0-9a-fA-F]{40}$/.test(other.value.trim()));

      fill(preview, 
        h("h2", { text: "What will be recorded" }),
        h("dl", { class: "detail" },
          h("dt", { text: "From" }), h("dd", { text: sender.label }),
          h("dt", { text: "To" }), h("dd", { text: recipient || "" }),
          h("dt", { text: "Amount" }), h("dd", { class: "num", text: valid ? `${fmt(value)} ${SYMBOL}` : "Enter a whole number" }),
          h("dt", { text: "Balance after" }), h("dd", { class: "num", text: valid && !tooMuch ? `${fmt(BigInt(sender.balance) - value)} ${SYMBOL}` : `${fmt(sender.balance)} ${SYMBOL}` })
        ),
        walletFrozen ? h("p", { class: "notice bad", text: "Your wallet is frozen by the audit desk, so it cannot send or receive VKC." }) : null,
        tooMuch ? h("p", { class: "notice bad", text: `${sender.label} only has ${fmt(sender.balance)} ${SYMBOL}.${walletMode ? " Use Get demo VKC in the left panel." : ""}` }) : null,
        valid && !tooMuch && value >= threshold
          ? h("p", { class: "notice warn", text: `Transfers of ${fmt(threshold)} ${SYMBOL} or more are flagged automatically for review.` })
          : null
      );
    }

    const form = h("form", { class: "form", novalidate: true, onsubmit: async (e) => {
      e.preventDefault();
      error.hidden = true;
      submit.disabled = true;
      submit.textContent = walletMode ? "Waiting for your wallet" : "Recording on chain";
      try {
        let result;
        if (walletMode) {
          const toAddress = to.value === "other" ? other.value.trim() : accounts.find((a) => String(a.index) === to.value).address;
          result = await Wallet.send("transfer", [toAddress, BigInt(amount.value.trim()), memo.value.trim()]);
          if (result.id) result.record = (await api(`/records/${result.id}`)).record;
        } else {
          result = await api("/transfer", { method: "POST", body: { from: Number(from.value), to: to.value === "other" ? other.value.trim() : Number(to.value), amount: amount.value.trim(), memo: memo.value } });
        }
        toast(`Payment recorded in block ${result.blockNumber}`);
        accounts = await loadAccounts();
        const keepFrom = from.value;
        fill(from, ...accountOptions(accounts, { includeAuditor: false }));
        from.value = keepFrom;
        fill(side, receipt(result, "transfer"));
        amount.value = "";
        memo.value = "";
        fillRecipients();
      } catch (err) {
        error.textContent = err.message;
        error.hidden = false;
        toast(err.message, "bad");
      } finally {
        submit.textContent = `Send ${SYMBOL}`;
        update();
      }
    } },
      h("div", {}, h("label", { for: "from", text: "From" }), fromField),
      h("div", {}, h("label", { for: "to", text: "To" }), to),
      otherWrap,
      h("div", {}, h("label", { for: "amount", text: `Amount in ${SYMBOL}` }), amount, h("p", { class: "hint", text: "Whole numbers only. The contract checks the sender's balance." })),
      h("div", {}, h("label", { for: "memo", text: "Memo (optional)" }), memo),
      signNotice,
      error,
      h("div", { class: "actions" }, submit)
    );

    from.addEventListener("change", () => { fillRecipients(); update(); });
    [to, other, amount].forEach((el) => el.addEventListener("input", update));
    fillRecipients();
    update();
    fill(side, h("div", { class: "panel" }, preview));
    return form;
  }

  function issueForm() {
    const walletMode = Boolean(Wallet.address);
    const isAdmin = walletMode ? Boolean(Wallet.info && Wallet.info.role === "admin") : Boolean(Wallet.cfg && Wallet.cfg.demoMode);
    const adminNotice = isAdmin ? null : h("p", { class: "notice warn", text: walletMode
      ? `Only the treasury wallet can issue VKC. Your wallet is registered as ${Wallet.info ? Wallet.info.role : "a user"}.`
      : "The server is in read-only mode. Connect the treasury wallet to issue VKC." });
    const to = h("select", { id: "mint-to" }, walletMode ? h("option", { value: "me", text: "Your wallet" }) : null, accountOptions(accounts, { includeAuditor: false }));
    const amount = h("input", { id: "mint-amount", inputmode: "numeric", autocomplete: "off", placeholder: "5000" });
    const memo = h("input", { id: "mint-memo", maxlength: "80", autocomplete: "off", placeholder: "Reason for issuing" });
    const error = h("div", { class: "notice bad", hidden: true, role: "alert" });
    const submit = h("button", { class: "btn", type: "submit", text: `Issue ${SYMBOL}`, disabled: true });
    amount.addEventListener("input", () => { submit.disabled = !isAdmin || !/^[1-9]\d{0,17}$/.test(amount.value.trim()); });
    fill(side, h("div", { class: "panel" },
      h("h2", { text: "About issuing" }),
      h("p", { text: "Issuing creates new VKC and increases total supply. Only the treasury account can do it, and the contract rejects everyone else. Each issue is recorded in the chain like a transfer." }),
      h("p", { class: "muted", text: `Total supply now: ${fmt(status.totalSupply)} ${SYMBOL}` })
    ));
    return h("form", { class: "form", novalidate: true, onsubmit: async (e) => {
      e.preventDefault();
      error.hidden = true;
      submit.disabled = true;
      try {
        let result;
        if (walletMode) {
          const toAddress = to.value === "me" ? Wallet.address : accounts.find((a) => String(a.index) === to.value).address;
          result = await Wallet.send("mint", [toAddress, BigInt(amount.value.trim()), memo.value.trim()]);
        } else {
          result = await api("/mint", { method: "POST", body: { to: Number(to.value), amount: amount.value.trim(), memo: memo.value } });
        }
        toast(`Issued in block ${result.blockNumber}`);
        accounts = await loadAccounts();
        state.status = await api("/status");
        fill(side, receipt(result, "mint"));
        amount.value = "";
      } catch (err) {
        error.textContent = err.message;
        error.hidden = false;
        toast(err.message, "bad");
      }
    } },
      h("div", {}, h("label", { for: "mint-to", text: "Issue to" }), to),
      h("div", {}, h("label", { for: "mint-amount", text: `Amount in ${SYMBOL}` }), amount),
      h("div", {}, h("label", { for: "mint-memo", text: "Memo (optional)" }), memo),
      adminNotice,
      error,
      h("div", { class: "actions" }, submit)
    );
  }

  function draw() {
    fill(tabs, tabButton("transfer", "Send VKC"), tabButton("issue", "Issue VKC"));
    fill(body, mode === "transfer" ? transferForm() : issueForm());
  }

  draw();
  fill(view, 
    ...pageHead("Send VKC", "Move VKC between accounts. The contract updates both balances and records the payment on the chain."),
    tabs,
    h("div", { class: "split" }, body, side)
  );
}

/* ------------------------------------------------------------------ verify */
const CHECKS = [
  ["onChainVerification", "Contract check", "The smart contract recomputed the record's hash from the data it stores.", () => "The result matched."],
  ["hashRecomputed", "Independent hash check", "This server recalculated the hash separately.", () => "It got the same hash."],
  ["linkedToPrevious", "Chain link", "The record must point to the hash of the record before it.", (r) => (r.id === 1 ? "This is the first record, so it starts the chain." : `It points to record ${r.id - 1}.`)],
  ["blockTimeMatches", "Block time", "The time on the record must match the block that holds it.", (r) => `It matches block ${r.blockNumber}.`]
];

async function verifyView(query) {
  const input = h("input", { id: "q", value: query || "", placeholder: "Record ID, transaction hash or record hash", autocomplete: "off", spellcheck: "false" });
  const results = h("div", { "aria-live": "polite" });

  async function run(value) {
    const q = value.trim();
    if (!q) return;
    fill(results, h("p", { class: "muted", text: "Checking the chain…" }));
    try {
      const data = await api(`/verify?q=${encodeURIComponent(q)}`);
      if (data._status === 404) {
        fill(results, h("div", { class: "verdict bad" }, h("div", { class: "tick" }, h("span", { text: "!" })), h("div", {}, h("strong", { text: "Not found" }), h("p", { text: data.error }))));
        return;
      }
      fill(results, resultView(data));
    } catch (err) {
      fill(results, h("p", { class: "notice bad", role: "alert", text: err.message }));
    }
  }

  function resultView(data) {
    const r = data.record;
    return h("div", {},
      h("div", { class: "verdict " + (data.verified ? "ok" : "bad") },
        h("div", { class: "tick" }, h("span", { text: data.verified ? "✓" : "✕" })),
        h("div", {},
          h("strong", { text: data.verified ? `Record ${r.id} is verified` : `Record ${r.id} failed verification` }),
          h("p", { text: data.verified ? "The stored data matches its hash and the chain around it is unbroken." : "At least one check failed. The record may have been altered." })
        )
      ),
      h("ul", { class: "checks" }, CHECKS.map(([key, name, why, detail]) => {
        const pass = data.checks[key];
        return h("li", {},
          h("span", { class: "mark" }, chip(pass ? "Pass" : "Fail", pass ? "ok" : "bad")),
          h("b", { text: name }),
          h("span", { class: "why", text: `${why} ${pass ? detail(r) : "This check did not pass."}` })
        );
      })),
      h("section", {},
        h("h2", { text: "Record details" }),
        h("div", { class: "panel" },
          h("dl", { class: "detail" },
            h("dt", { text: "Type" }), h("dd", { text: r.kind === "mint" ? "Issue (new VKC)" : "Transfer" }),
            h("dt", { text: "From" }), h("dd", { text: r.kind === "mint" ? "Newly issued" : who(r.fromLabel, r.from) }),
            h("dt", { text: "To" }), h("dd", { text: who(r.toLabel, r.to) }),
            h("dt", { text: "Amount" }), h("dd", { class: "num", text: `${fmt(r.amount)} ${SYMBOL}` }),
            h("dt", { text: "Memo" }), h("dd", { text: r.memo || "None" }),
            h("dt", { text: "Time" }), h("dd", { text: `${when(r.timestamp)} (East Africa Time)` }),
            h("dt", { text: "Block" }), h("dd", { text: String(r.blockNumber) }),
            h("dt", { text: "Review" }), h("dd", {}, r.flagged ? chip(`Flagged: ${r.flagReason}`, "warn") : chip("Not flagged")),
            h("dt", { text: "Transaction hash" }), h("dd", { class: "mono", text: r.transactionHash || "" }),
            h("dt", { text: "Record hash" }), h("dd", { class: "mono", text: r.recordHash }),
            h("dt", { text: "Previous hash" }), h("dd", { class: "mono", text: r.prevHash })
          ),
          h("div", { class: "pager" },
            data.previousId ? h("a", { class: "btn ghost small", href: `#verify/${data.previousId}`, text: `Record ${data.previousId}` }) : null,
            data.nextId ? h("a", { class: "btn ghost small", href: `#verify/${data.nextId}`, text: `Record ${data.nextId}` }) : null
          )
        )
      ),
      tamperPanel(r)
    );
  }

  function tamperPanel(r) {
    const amount = h("input", { id: "tamper-amount", inputmode: "numeric", value: String(BigInt(r.amount) + 1n) });
    const out = h("div", { "aria-live": "polite" });
    return h("section", {},
      h("h2", { text: "Try changing this record" }),
      h("div", { class: "panel" },
        h("p", { class: "lede", style: "margin-bottom:16px", text: "Pretend someone edited the amount after the fact. Recalculate the hash and compare it with the one the chain stored. This is a calculation only. The ledger is not touched." }),
        h("div", { class: "inline" },
          h("div", {}, h("label", { for: "tamper-amount", text: "Edited amount" }), amount),
          h("div", {}, h("button", { class: "btn", type: "button", text: "Recalculate hash", onclick: async () => {
            try {
              const t = await api(`/records/${r.id}/tamper-check`, { method: "POST", body: { amount: amount.value.trim() } });
              fill(out, 
                h("p", { class: "notice " + (t.matches ? "warn" : "ok"), style: "margin-top:16px",
                  text: t.matches ? "The amount is unchanged, so the hashes match." : "The hashes no longer match, so the edit would be detected." }),
                h("dl", { class: "detail", style: "margin-top:14px" },
                  h("dt", { text: "Stored hash" }), h("dd", { class: "mono", text: t.storedHash }),
                  h("dt", { text: "Recalculated" }), h("dd", { class: "mono", text: t.recomputedHash })
                )
              );
            } catch (err) {
              fill(out, h("p", { class: "notice bad", style: "margin-top:16px", text: err.message }));
            }
          } }))
        ),
        out
      )
    );
  }

  fill(view, 
    ...pageHead("Verify a record", "Look up any record by its ID or hash. Four independent checks decide whether it can be trusted."),
    h("form", { class: "form no-print", style: "max-width:640px", onsubmit: (e) => { e.preventDefault(); location.hash = `#verify/${encodeURIComponent(input.value.trim())}`; } },
      h("div", {}, h("label", { for: "q", text: "Record ID or hash" }), input),
      h("div", { class: "actions" }, h("button", { class: "btn", type: "submit", text: "Verify" }))
    ),
    results
  );
  if (query) run(query);
}

/* ----------------------------------------------------------------- history */
async function historyView() {
  const accounts = await loadAccounts();
  const filters = { kind: "", flagged: "", account: "", q: "" };
  let offset = 0;
  const PAGE = 25;
  const tbody = h("tbody");
  const count = h("p", { class: "muted", "aria-live": "polite" });
  const more = h("button", { class: "btn ghost", type: "button", text: "Load more", onclick: () => load(false) });

  const kind = h("select", { id: "f-kind" }, h("option", { value: "", text: "All types" }), h("option", { value: "transfer", text: "Transfers" }), h("option", { value: "mint", text: "Issues" }));
  const flagged = h("select", { id: "f-flag" }, h("option", { value: "", text: "All records" }), h("option", { value: "true", text: "Flagged only" }));
  const account = h("select", { id: "f-account" }, h("option", { value: "", text: "All accounts" }), accounts.filter((a) => a.role !== "auditor").map((a) => h("option", { value: String(a.index), text: a.label })));
  const search = h("input", { id: "f-q", type: "search", placeholder: "Memo, name or amount", autocomplete: "off" });

  let debounce;
  const apply = () => {
    filters.kind = kind.value; filters.flagged = flagged.value; filters.account = account.value; filters.q = search.value.trim();
    load(true);
  };
  [kind, flagged, account].forEach((el) => el.addEventListener("change", apply));
  search.addEventListener("input", () => { clearTimeout(debounce); debounce = setTimeout(apply, 250); });

  async function load(reset) {
    if (reset) { offset = 0; fill(tbody, ); }
    const params = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
    for (const [k, v] of Object.entries(filters)) if (v) params.set(k, v);
    try {
      const data = await api(`/records?${params}`);
      for (const r of data.records) {
        const go = () => (location.hash = `#verify/${r.id}`);
        tbody.append(h("tr", { class: "clickable" + (r.flagged ? " flag" : ""), tabindex: "0", onclick: go, onkeydown: (e) => e.key === "Enter" && go() },
          h("td", { class: "num", text: `#${r.id}` }),
          h("td", { text: when(r.timestamp) }),
          h("td", {}, h("div", { text: r.kind === "mint" ? "Issue" : `${who(r.fromLabel, r.from)} to ${who(r.toLabel, r.to)}` }), h("div", { class: "muted", text: r.memo || "No memo" })),
          h("td", { class: "r", text: `${fmt(r.amount)} ${SYMBOL}` }),
          h("td", {}, r.flagged ? chip(r.flagReason, "warn") : null)
        ));
      }
      offset += data.records.length;
      count.textContent = data.total ? `Showing ${offset} of ${data.total} records` : "No records match these filters. Clear a filter to see more.";
      more.hidden = offset >= data.total;
    } catch (err) {
      count.textContent = err.message;
    }
  }

  fill(view, 
    ...pageHead("History", "Every record on the ledger, newest first. Select a row to verify it.",
      h("a", { class: "btn ghost small", href: "/api/report.csv", download: "", text: "Download CSV" })),
    h("div", { class: "inline no-print", style: "margin-bottom:18px" },
      h("div", {}, h("label", { for: "f-kind", text: "Type" }), kind),
      h("div", {}, h("label", { for: "f-flag", text: "Review" }), flagged),
      h("div", {}, h("label", { for: "f-account", text: "Account" }), account),
      h("div", {}, h("label", { for: "f-q", text: "Search" }), search)
    ),
    h("div", { class: "table-wrap" },
      h("table", {},
        h("thead", {}, h("tr", {}, h("th", { text: "ID" }), h("th", { text: "Time" }), h("th", { text: "Details" }), h("th", { class: "r", text: "Amount" }), h("th", { text: "Review" }))),
        tbody)
    ),
    h("div", { style: "margin-top:14px" }, count),
    h("div", { class: "pager" }, more)
  );
  load(true);
}

/* -------------------------------------------------------------- monitoring */
async function monitorView() {
  const [accounts, flaggedData, status] = await Promise.all([loadAccounts(), api("/records?flagged=true&limit=100"), api("/status")]);

  const walletMode = Boolean(Wallet.address);
  const canAudit = walletMode
    ? Boolean(Wallet.info && ["admin", "auditor"].includes(Wallet.info.role))
    : Boolean(Wallet.cfg && Wallet.cfg.demoMode);
  const idInput = h("input", { id: "flag-id", inputmode: "numeric", placeholder: "12" });
  const reason = h("input", { id: "flag-reason", maxlength: "80", placeholder: "Why does this need review?" });
  const flagBtn = h("button", { class: "btn", type: "submit", text: "Flag record", disabled: !canAudit });

  const flagForm = h("form", { class: "form", novalidate: true, onsubmit: async (e) => {
    e.preventDefault();
    flagBtn.disabled = true;
    try {
      if (walletMode) {
        if (!/^\d{1,9}$/.test(idInput.value.trim())) throw new Error("Record ID must be a whole number.");
        if (!reason.value.trim()) throw new Error("Give a reason of 1 to 80 characters.");
        await Wallet.send("flag", [BigInt(idInput.value.trim()), reason.value.trim()]);
      } else {
        await api(`/records/${encodeURIComponent(idInput.value.trim())}/flag`, { method: "POST", body: { reason: reason.value } });
      }
      toast(`Record ${idInput.value.trim()} flagged`);
      monitorView();
    } catch (err) {
      toast(err.message, "bad");
      flagBtn.disabled = false;
    }
  } },
    h("div", {}, h("label", { for: "flag-id", text: "Record ID" }), idInput),
    h("div", {}, h("label", { for: "flag-reason", text: "Reason" }), reason),
    h("div", { class: "actions" }, flagBtn)
  );

  const holders = accounts.filter((a) => a.role !== "auditor");

  fill(view, 
    ...pageHead("Monitoring", `The contract flags any transfer of ${fmt(status.alertThreshold)} ${SYMBOL} or more. The audit desk can also flag a record by hand or freeze an account.`),
    canAudit ? null : h("p", { class: "notice warn", text: walletMode
      ? "Your wallet has no audit rights, so flagging and freezing are turned off. Everyone can still read flagged records."
      : "The server is in read-only mode. Connect an audit wallet to flag records or freeze accounts." }),
    h("div", { class: "split" },
      h("section", {},
        h("h2", { text: `Flagged records (${flaggedData.total})` }),
        flaggedData.records.length
          ? h("ul", { class: "rows" }, flaggedData.records.map((r) => recordRow(r)))
          : h("div", { class: "empty", text: "Nothing is flagged. Large transfers will appear here automatically." })
      ),
      h("section", {},
        h("h2", { text: "Flag a record by hand" }),
        h("div", { class: "panel" }, flagForm)
      )
    ),
    h("section", {},
      h("h2", { text: "Accounts" }),
      h("ul", { class: "rows" }, holders.map((a) =>
        h("li", { class: "row" },
          h("div", { class: "title", text: a.label }),
          h("div", { class: "side" }, h("button", {
            class: "btn small " + (a.frozen ? "ghost" : "danger"), type: "button", text: a.frozen ? "Unfreeze" : "Freeze", disabled: !canAudit,
            onclick: async () => {
              try {
                if (walletMode) await Wallet.send("setFrozen", [a.address, !a.frozen]);
                else await api(`/accounts/${a.index}/freeze`, { method: "POST", body: { frozen: !a.frozen } });
                toast(`${a.label} ${a.frozen ? "unfrozen" : "frozen"}`);
                monitorView();
              } catch (err) {
                toast(err.message, "bad");
              }
            }
          })),
          h("div", { class: "sub", text: `${fmt(a.balance)} ${SYMBOL}` }),
          h("div", { class: "side" }, a.frozen ? chip("Frozen: cannot send or receive", "bad") : chip("Active", "ok"))
        )
      ))
    )
  );
}

/* ----------------------------------------------------------------- reports */
function barChart(report) {
  const data = report.series;
  if (!data.length) return h("div", { class: "empty", text: "No transfers in this period." });
  const W = 720, H = 240, padL = 8, padB = 28, padT = 14;
  const max = Math.max(...data.map((d) => Number(d.volume)), 1);
  const slot = (W - padL * 2) / data.length;
  const barW = Math.min(64, slot * 0.6);
  const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": `Volume of VKC transferred per ${report.granularity}` });
  root.append(svg("line", { x1: padL, x2: W - padL, y1: H - padB, y2: H - padB, class: "axis" }));
  data.forEach((d, i) => {
    const hgt = Math.max(3, (Number(d.volume) / max) * (H - padB - padT - 18));
    const x = padL + slot * i + (slot - barW) / 2;
    const y = H - padB - hgt;
    root.append(
      svg("rect", { x, y, width: barW, height: hgt, rx: 3, class: "bar" + (d.flagged ? " flagged" : "") }, svg("title", {}, `${d.period}: ${fmt(d.volume)} ${SYMBOL} in ${d.transfers} transfers`)),
      svg("text", { x: x + barW / 2, y: y - 6, "text-anchor": "middle" }, fmt(d.volume)),
      svg("text", { x: x + barW / 2, y: H - 8, "text-anchor": "middle" }, report.granularity === "hour" ? d.period.slice(11) : d.period.slice(5))
    );
  });
  return h("div", { class: "chart" }, root,
    h("p", { class: "hint", text: report.granularity === "hour" ? "VKC transferred per hour, East Africa Time. Amber bars include flagged transfers." : "VKC transferred per day, East Africa Time. Amber bars include flagged transfers." }));
}

async function reportView() {
  const from = h("input", { id: "r-from", type: "date" });
  const to = h("input", { id: "r-to", type: "date" });
  const out = h("div");

  async function load() {
    const params = new URLSearchParams();
    if (from.value) params.set("from", from.value);
    if (to.value) params.set("to", to.value);
    try {
      const r = await api(`/report?${params}`);
      const t = r.totals;
      fill(out, 
        h("dl", { class: "facts" },
          fact("Records", String(t.records)),
          fact("Transfers", String(t.transfers)),
          fact("Volume moved", `${fmt(t.volume)} `, SYMBOL),
          fact("Average transfer", `${fmt(t.averageTransfer)} `, SYMBOL),
          fact("Largest transfer", t.largestTransfer ? `${fmt(t.largestTransfer.amount)} ` : "None", t.largestTransfer ? SYMBOL : ""),
          fact("Flagged", String(t.flagged))
        ),
        h("section", {}, h("h2", { text: "Activity" }), barChart(r)),
        h("section", {},
          h("h2", { text: "Accounts" }),
          h("div", { class: "table-wrap" }, h("table", {},
            h("thead", {}, h("tr", {}, h("th", { text: "Account" }), h("th", { class: "r", text: "Sent" }), h("th", { class: "r", text: "Received" }), h("th", { class: "r", text: "Net" }), h("th", { class: "r", text: "Balance now" }))),
            h("tbody", {}, r.accounts.map((a) => h("tr", {},
              h("td", { text: who(a.label, a.address) }),
              h("td", { class: "r", text: `${fmt(a.sent)} (${a.sentCount})` }),
              h("td", { class: "r", text: `${fmt(a.received)} (${a.receivedCount})` }),
              h("td", { class: "r", text: (BigInt(a.net) > 0n ? "+" : "") + fmt(a.net) }),
              h("td", { class: "r", text: fmt(a.balance) })
            )))
          ))
        ),
        h("section", {},
          h("h2", { text: `Flagged records (${r.flagged.length})` }),
          r.flagged.length
            ? h("ul", { class: "rows" }, r.flagged.map((x) => recordRow(x)))
            : h("div", { class: "empty", text: "No flagged records in this period." })
        ),
        h("p", { class: "muted", style: "margin-top:32px", text: `Generated ${when(r.generatedAt)} from the on-chain records.` })
      );
    } catch (err) {
      fill(out, h("p", { class: "notice bad", role: "alert", text: err.message }));
    }
  }

  const csvLink = () => {
    const params = new URLSearchParams();
    if (from.value) params.set("from", from.value);
    if (to.value) params.set("to", to.value);
    return `/api/report.csv?${params}`;
  };

  fill(view, 
    ...pageHead("Reports", "A summary of activity on the ledger. Pick dates to narrow it down, then print it or download the records as a spreadsheet.",
      h("button", { class: "btn ghost small", type: "button", text: "Print report", onclick: () => window.print() }),
      h("button", { class: "btn small", type: "button", text: "Download CSV", onclick: () => (location.href = csvLink()) })),
    h("div", { class: "inline no-print", style: "max-width:560px" },
      h("div", {}, h("label", { for: "r-from", text: "From" }), from),
      h("div", {}, h("label", { for: "r-to", text: "To" }), to),
      h("div", {}, h("button", { class: "btn", type: "button", text: "Update report", onclick: load }))
    ),
    out
  );
  load();
}

/* ------------------------------------------------------------------ router */
const routes = { overview: overviewView, send: sendView, verify: verifyView, history: historyView, monitor: monitorView, report: reportView };

async function route() {
  const [name = "overview", ...rest] = (location.hash.slice(1) || "overview").split("/");
  const key = routes[name] ? name : "overview";
  document.querySelectorAll(".nav a").forEach((a) => {
    if (a.dataset.route === key) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  try {
    await Wallet.loadConfig().catch(() => {});
    await routes[key](decodeURIComponent(rest.join("/")));
  } catch (err) {
    fill(view, h("h1", { text: "The ledger is not responding" }), h("p", { class: "notice bad", role: "alert", text: err.message }),
      h("p", { class: "muted", text: "Check that the server is running with npm start, then reload this page." }));
  }
  window.scrollTo(0, 0);
}

async function pollStatus() {
  const dot = document.querySelector("#chain-status .dot");
  const text = document.getElementById("chain-status-text");
  try {
    const s = await api("/status");
    const changed = state.status && s.blockNumber !== state.status.blockNumber;
    state.status = s;
    if (!Wallet.cfg) Wallet.loadConfig().then(renderWalletBox).catch(() => {});
    dot.dataset.state = s.chainIntact ? "ok" : "bad";
    text.textContent = s.chainIntact ? `Chain live, block ${s.blockNumber}` : `Chain broken at record ${s.firstBrokenId}`;
    if (changed && (location.hash === "" || location.hash === "#overview")) overviewView();
  } catch (_e) {
    dot.dataset.state = "bad";
    text.textContent = "Chain unreachable";
  }
}

/* ------------------------------------------------------------- wallet panel */
const ROLE_LABEL = { admin: "Treasury", auditor: "Audit desk", user: "User" };

function renderWalletBox() {
  const box = document.getElementById("wallet-box");
  const cfg = Wallet.cfg;
  const act = (fn, done) => async (e) => {
    const button = e.currentTarget;
    button.disabled = true;
    try {
      const outcome = await fn();
      if (done) toast(typeof done === "function" ? done(outcome) : done);
    } catch (err) {
      toast(err.message, "bad");
    } finally {
      button.disabled = false;
    }
  };

  if (!cfg) {
    // Nothing to click until the chain settings are known, so a click is never lost to a re-render.
    fill(box, h("strong", { text: "Wallet" }), h("p", { text: "Loading chain settings…" }));
    return;
  }

  if (!Wallet.available) {
    fill(box,
      h("strong", { text: "Wallet" }),
      h("p", { text: "No wallet found in this browser. Install MetaMask to sign your own transactions." }),
      h("a", { href: "https://metamask.io/download/", target: "_blank", rel: "noopener noreferrer", text: "Get MetaMask" }));
    return;
  }

  if (!Wallet.address) {
    fill(box,
      h("strong", { text: "Wallet" }),
      h("p", { text: cfg && cfg.demoMode ? "Not connected. Demo accounts sign for you until you connect." : "Not connected. Connect to send VKC." }),
      h("button", { class: "btn small", type: "button", text: "Connect wallet", onclick: act(() => Wallet.connect(), "Wallet connected") }));
    return;
  }

  if (Wallet.wrongNetwork || !Wallet.info) {
    fill(box,
      h("strong", { text: "Wrong network" }),
      h("p", { text: `Switch your wallet to ${cfg ? cfg.networkName : "the project's local chain"} to continue.` }),
      h("button", { class: "btn small", type: "button", text: "Switch network", onclick: act(() => Wallet.ensureNetwork().then(() => Wallet.connect())) }));
    return;
  }

  const info = Wallet.info;
  fill(box,
    h("div", { class: "wallet-row" }, h("strong", { text: "Wallet" }), chip(ROLE_LABEL[info.role] || "User"), info.frozen ? chip("Frozen", "bad") : null),
    h("span", { class: "mono", text: shortAddr(Wallet.address), title: Wallet.address }),
    h("div", { class: "wallet-row" }, h("span", { text: "Balance" }), h("b", { text: `${fmt(info.balance)} ${SYMBOL}` })),
    h("div", { class: "wallet-row" }, h("span", { text: "Gas" }), h("span", { text: `${Number(info.ethBalance).toFixed(2)} ETH` })),
    h("div", { class: "wallet-actions" },
      cfg && cfg.faucetAmount && BigInt(info.balance) < 100n
        ? h("button", { class: "btn small", type: "button", id: "faucet", text: "Get demo VKC", onclick: act(() => Wallet.faucet(), (d) => `${d.amount} VKC sent to your wallet`) })
        : null,
      h("button", { class: "btn ghost small", type: "button", text: "Add VKC to wallet", onclick: act(() => Wallet.addToken(), "Token request sent to your wallet") }),
      h("button", { class: "btn ghost small", type: "button", text: "Disconnect", onclick: () => Wallet.disconnect() })
    ));
}

Wallet.on("session", () => { renderWalletBox(); route(); });
Wallet.on("info", renderWalletBox);

window.addEventListener("hashchange", route);
renderWalletBox();
Wallet.autoReconnect().finally(() => Wallet.loadConfig().catch(() => {}).then(() => { renderWalletBox(); route(); }));
pollStatus();
setInterval(pollStatus, 6000);
