const statusIndicator = document.getElementById("status-indicator");
const statusChainId = document.getElementById("status-chain-id");
const statusBlock = document.getElementById("status-block");
const statusContract = document.getElementById("status-contract");
const statusSigner = document.getElementById("status-signer");
const accountPresets = document.getElementById("account-presets");

const recordForm = document.getElementById("record-form");
const toInput = document.getElementById("to-input");
const assetInput = document.getElementById("asset-input");
const amountInput = document.getElementById("amount-input");
const submitTxBtn = document.getElementById("submit-tx-btn");
const recordFeedback = document.getElementById("record-feedback");

const verifyForm = document.getElementById("verify-form");
const verifyIdInput = document.getElementById("verify-id-input");
const verifyResult = document.getElementById("verify-result");

const historyBody = document.getElementById("history-body");
const refreshHealthBtn = document.getElementById("refresh-health-btn");
const refreshHistoryBtn = document.getElementById("refresh-history-btn");

function shorten(hex) {
  if (!hex || hex.length < 14) return hex || "—";
  return `${hex.slice(0, 8)}...${hex.slice(-6)}`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function showFeedback(el, type, html) {
  el.hidden = false;
  el.className = `feedback ${type}`;
  el.innerHTML = html;
}

async function fetchHealth() {
  try {
    const res = await fetch("/api/health");
    const data = await res.json();

    if (!res.ok || !data.ok) {
      statusIndicator.textContent = data.error ? data.error : "Initializing...";
      statusIndicator.className = "value status-warn";
      return false;
    }

    statusIndicator.textContent = "Connected (Hardhat Local)";
    statusIndicator.className = "value status-ok";
    statusChainId.textContent = String(data.chainId);
    statusBlock.textContent = String(data.blockNumber ?? "—");
    statusContract.textContent = data.contract || "—";
    statusSigner.textContent = data.signer || "—";

    renderAccountPresets(data.accounts || []);
    return true;
  } catch (err) {
    statusIndicator.textContent = `Offline (${err.message})`;
    statusIndicator.className = "value status-err";
    return false;
  }
}

function renderAccountPresets(accounts) {
  if (!accounts.length) {
    accountPresets.innerHTML = "";
    return;
  }

  const candidates = accounts.slice(1, 4);
  if (!toInput.value && candidates[0]) {
    toInput.value = candidates[0];
  }

  accountPresets.innerHTML =
    `<span class="presets-label">Local test recipients:</span>` +
    candidates
      .map(
        (addr, idx) =>
          `<button type="button" class="preset-btn" data-address="${escapeHtml(addr)}">Account #${
            idx + 1
          } (${escapeHtml(shorten(addr))})</button>`
      )
      .join("");

  accountPresets.querySelectorAll(".preset-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      toInput.value = btn.dataset.address || "";
    });
  });
}

async function fetchHistory() {
  try {
    const res = await fetch("/api/transactions");
    const data = await res.json();

    if (!res.ok) {
      historyBody.innerHTML = `<tr><td colspan="7" class="empty-cell">${escapeHtml(
        data.error || "Unable to load history."
      )}</td></tr>`;
      return;
    }

    const list = data.transactions || [];
    if (list.length === 0) {
      historyBody.innerHTML =
        '<tr><td colspan="7" class="empty-cell">No simulated transactions recorded yet.</td></tr>';
      return;
    }

    historyBody.innerHTML = list
      .map(
        (tx) => `
        <tr>
          <td>
            <button type="button" class="id-link" data-verify-id="${escapeHtml(tx.id)}">#${escapeHtml(
              tx.id
            )}</button>
          </td>
          <td><strong>${escapeHtml(tx.asset)}</strong></td>
          <td>${escapeHtml(tx.amount)}</td>
          <td class="mono" title="${escapeHtml(tx.from)}">${escapeHtml(shorten(tx.from))}</td>
          <td class="mono" title="${escapeHtml(tx.to)}">${escapeHtml(shorten(tx.to))}</td>
          <td>${escapeHtml(new Date(tx.timestamp * 1000).toLocaleString())}</td>
          <td class="mono" title="${escapeHtml(tx.transactionHash)}">${escapeHtml(
            shorten(tx.transactionHash)
          )}</td>
        </tr>`
      )
      .join("");

    historyBody.querySelectorAll("[data-verify-id]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.verifyId;
        verifyIdInput.value = id;
        verifyById(id);
      });
    });
  } catch (err) {
    historyBody.innerHTML = `<tr><td colspan="7" class="empty-cell">Error loading history: ${escapeHtml(
      err.message
    )}</td></tr>`;
  }
}

async function verifyById(id) {
  verifyResult.className = "verify-result";
  verifyResult.textContent = `Verifying record #${id}...`;

  try {
    const res = await fetch(`/api/transactions/${encodeURIComponent(id)}`);
    const data = await res.json();

    if (!res.ok || !data.verified) {
      verifyResult.className = "verify-result verify-fail";
      verifyResult.innerHTML = `<strong>Not Verified:</strong> ${escapeHtml(
        data.error || `Transaction #${id} does not exist.`
      )}`;
      return;
    }

    const r = data.transaction;
    verifyResult.className = "verify-result verify-ok";
    verifyResult.innerHTML = `
      <div><strong>Verified On-Chain Record #${escapeHtml(r.id)}</strong></div>
      <dl class="verify-dl">
        <dt>Asset</dt><dd>${escapeHtml(r.asset)}</dd>
        <dt>Amount</dt><dd>${escapeHtml(r.amount)}</dd>
        <dt>From</dt><dd class="mono">${escapeHtml(r.from)}</dd>
        <dt>To</dt><dd class="mono">${escapeHtml(r.to)}</dd>
        <dt>Recorded</dt><dd>${escapeHtml(new Date(r.timestamp * 1000).toISOString())}</dd>
      </dl>
    `;
  } catch (err) {
    verifyResult.className = "verify-result verify-fail";
    verifyResult.textContent = `Verification error: ${err.message}`;
  }
}

recordForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  submitTxBtn.disabled = true;
  submitTxBtn.textContent = "Submitting...";
  recordFeedback.hidden = true;

  try {
    const res = await fetch("/api/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: toInput.value.trim(),
        asset: assetInput.value.trim(),
        amount: String(amountInput.value).trim()
      })
    });
    const data = await res.json();

    if (!res.ok) {
      showFeedback(recordFeedback, "error", escapeHtml(data.error || "Transaction failed."));
      return;
    }

    showFeedback(
      recordFeedback,
      "success",
      `Recorded transaction <strong>#${escapeHtml(data.id)}</strong> (Tx <span class="mono">${escapeHtml(
        shorten(data.transactionHash)
      )}</span>)`
    );

    verifyIdInput.value = data.id;
    await Promise.all([fetchHealth(), fetchHistory(), verifyById(data.id)]);
  } catch (err) {
    showFeedback(recordFeedback, "error", escapeHtml(err.message));
  } finally {
    submitTxBtn.disabled = false;
    submitTxBtn.textContent = "Record Transaction";
  }
});

verifyForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const id = verifyIdInput.value.trim();
  if (id) {
    verifyById(id);
  }
});

refreshHealthBtn.addEventListener("click", fetchHealth);
refreshHistoryBtn.addEventListener("click", fetchHistory);

(async function init() {
  const ok = await fetchHealth();
  await fetchHistory();
  if (!ok) {
    setTimeout(async () => {
      await fetchHealth();
      await fetchHistory();
    }, 2000);
  }
})();
