const { ethers } = require("ethers");

const TZ_OFFSET_SECONDS = 3 * 3600; // East Africa Time

function bucketKey(ts, hourly) {
  const iso = new Date((ts + TZ_OFFSET_SECONDS) * 1000).toISOString();
  return hourly ? iso.slice(0, 13) + ":00" : iso.slice(0, 10);
}

function buildReport(records, { from, to } = {}) {
  const rows = records.filter((r) => (!from || r.timestamp >= from) && (!to || r.timestamp <= to));
  const transfers = rows.filter((r) => r.kind === "transfer");
  const mints = rows.filter((r) => r.kind === "mint");
  const sum = (list) => list.reduce((acc, r) => acc + BigInt(r.amount), 0n);

  const volume = sum(transfers);
  const minted = sum(mints);
  const largest = transfers.reduce((max, r) => (BigInt(r.amount) > BigInt(max?.amount || 0) ? r : max), null);

  // Hourly buckets when the data covers under two days, otherwise daily.
  const span = rows.length ? rows[rows.length - 1].timestamp - rows[0].timestamp : 0;
  const hourly = span < 48 * 3600;
  const series = new Map();
  for (const r of rows) {
    const key = bucketKey(r.timestamp, hourly);
    const bucket = series.get(key) || { period: key, transfers: 0, volume: 0n, flagged: 0 };
    if (r.kind === "transfer") {
      bucket.transfers += 1;
      bucket.volume += BigInt(r.amount);
    }
    if (r.flagged) bucket.flagged += 1;
    series.set(key, bucket);
  }

  const accounts = new Map();
  const touch = (address, label) => {
    if (address === ethers.ZeroAddress) return null;
    if (!accounts.has(address)) {
      accounts.set(address, { address, label, sent: 0n, received: 0n, sentCount: 0, receivedCount: 0 });
    }
    return accounts.get(address);
  };
  for (const r of rows) {
    const sender = touch(r.from, r.fromLabel);
    const receiver = touch(r.to, r.toLabel);
    if (sender) {
      sender.sent += BigInt(r.amount);
      sender.sentCount += 1;
    }
    if (receiver) {
      receiver.received += BigInt(r.amount);
      receiver.receivedCount += 1;
    }
  }

  return {
    period: {
      from: rows[0]?.timestamp ?? null,
      to: rows[rows.length - 1]?.timestamp ?? null
    },
    totals: {
      records: rows.length,
      transfers: transfers.length,
      mints: mints.length,
      volume: volume.toString(),
      minted: minted.toString(),
      averageTransfer: transfers.length ? (volume / BigInt(transfers.length)).toString() : "0",
      largestTransfer: largest ? { id: largest.id, amount: largest.amount } : null,
      flagged: rows.filter((r) => r.flagged).length,
      activeAccounts: accounts.size
    },
    granularity: hourly ? "hour" : "day",
    series: [...series.values()].map((b) => ({ ...b, volume: b.volume.toString() })),
    accounts: [...accounts.values()]
      .map((a) => ({
        address: a.address,
        label: a.label,
        sent: a.sent.toString(),
        received: a.received.toString(),
        net: (a.received - a.sent).toString(),
        sentCount: a.sentCount,
        receivedCount: a.receivedCount
      }))
      .sort((x, y) => Number(BigInt(y.sent) + BigInt(y.received) - BigInt(x.sent) - BigInt(x.received))),
    flagged: rows.filter((r) => r.flagged)
  };
}

// Spreadsheet apps treat cells starting with = + - @ as formulas, so memos are neutralised.
function csvCell(value) {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(records) {
  const header = [
    "id", "type", "time_eat", "from", "from_label", "to", "to_label", "amount_vkc",
    "memo", "flagged", "flag_reason", "block", "transaction_hash", "record_hash"
  ];
  const lines = [header.join(",")];
  for (const r of records) {
    const time = new Date((r.timestamp + TZ_OFFSET_SECONDS) * 1000).toISOString().replace("T", " ").slice(0, 19);
    lines.push([
      r.id, r.kind, time, r.from, r.fromLabel, r.to, r.toLabel, r.amount,
      r.memo, r.flagged ? "yes" : "no", r.flagReason, r.blockNumber, r.transactionHash, r.recordHash
    ].map(csvCell).join(","));
  }
  return lines.join("\n") + "\n";
}

module.exports = { buildReport, toCsv };
