const byId = (id) => document.getElementById(id);
const shorten = (value) => value ? `${value.slice(0, 6)}…${value.slice(-4)}` : "—";

async function request(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

async function loadHealth() {
  try {
    const data = await request("/api/health");
    byId("connection").textContent = "Local blockchain connected";
    byId("chain-detail").textContent = `· chain ${data.chainId} · block ${data.blockNumber} · demo signer ${shorten(data.signer)}`;
    byId("connection").parentElement.querySelector(".status-dot").style.background = "#34845d";
  } catch (error) {
    byId("connection").textContent = "Local chain unavailable";
    byId("chain-detail").textContent = error.message;
    byId("connection").parentElement.querySelector(".status-dot").style.background = "#bd5148";
  }
}

async function loadHistory() {
  const body = byId("history");
  try {
    const { transactions } = await request("/api/transactions");
    body.replaceChildren();
    if (!transactions.length) {
      const row = body.insertRow();
      const cell = row.insertCell(); cell.colSpan = 6; cell.className = "muted"; cell.textContent = "No transactions recorded yet.";
      return;
    }
    for (const tx of transactions) {
      const row = body.insertRow();
      const values = [tx.id, tx.asset, tx.amount, shorten(tx.from), shorten(tx.to), new Date(tx.timestamp * 1000).toLocaleString()];
      values.forEach((value, index) => {
        const cell = row.insertCell();
        cell.textContent = value;
        if (index === 3 || index === 4) { cell.className = "address"; cell.title = index === 3 ? tx.from : tx.to; }
      });
    }
  } catch (error) {
    body.replaceChildren();
    const row = body.insertRow();
    const cell = row.insertCell(); cell.colSpan = 6; cell.className = "muted"; cell.textContent = error.message;
  }
}

byId("transaction-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = byId("form-message");
  message.className = "message"; message.textContent = "Submitting to local chain…";
  try {
    const data = await request("/api/transactions", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: byId("to").value.trim(), asset: byId("asset").value.trim(), amount: byId("amount").value.trim() })
    });
    message.className = "message success";
    message.textContent = `Recorded transaction #${data.id} · ${data.transactionHash.slice(0, 12)}…`;
    byId("transaction-form").reset(); byId("asset").value = "DEMO";
    await loadHealth(); await loadHistory();
  } catch (error) {
    message.className = "message error"; message.textContent = error.message;
  }
});

byId("verify-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const result = byId("verify-result");
  result.className = "message"; result.textContent = "Checking blockchain record…";
  try {
    const data = await request(`/api/transactions/${encodeURIComponent(byId("verify-id").value.trim())}`);
    result.className = "message success";
    result.textContent = `Verified: transaction #${data.transaction.id} · ${data.transaction.asset} · amount ${data.transaction.amount}`;
  } catch (error) {
    result.className = "message error"; result.textContent = error.message;
  }
});

byId("refresh").addEventListener("click", async () => { await loadHealth(); await loadHistory(); });
loadHealth(); loadHistory();
