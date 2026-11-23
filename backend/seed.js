// Demo data for a fresh local chain. Everything here goes through the same
// contract functions that the dashboard uses; nothing is faked off-chain.
async function seed(chain) {
  const A = chain.addresses;
  const mint = (to, amount, memo) => chain.send(0, "mint", [A[to], amount, memo]);
  const pay = (from, to, amount, memo) => chain.send(from, "transfer", [A[to], amount, memo]);

  await mint(0, 100000, "Treasury reserve");
  await mint(2, 20000, "Opening float for phone shop");

  await pay(0, 3, 1500, "Salary advance");
  await pay(0, 4, 800, "Allocation: airtime stock");
  await pay(0, 5, 1200, "Allocation: marketing budget");
  await pay(0, 6, 600, "Allocation: delivery costs");
  await pay(0, 7, 450, "Allocation: student discount fund");

  await pay(2, 3, 120, "Screen repair - Infinix Hot 30");
  await pay(2, 4, 75, "Charger and cable");
  await pay(3, 2, 300, "Phone purchase deposit");
  await pay(4, 2, 150, "Airtime wholesale");
  await pay(5, 6, 90, "Poster printing");
  await pay(6, 2, 60, "Screen protector order");
  await pay(7, 3, 40, "Cashback reward");
  await pay(2, 8, 220, "Commission: phone brokerage");
  await pay(8, 9, 110, "Transport refund");
  await pay(2, 0, 2500, "Weekly settlement to treasury"); // above the threshold, so it is auto-flagged
  await pay(3, 5, 35, "Lunch contribution");
}

module.exports = { seed };
