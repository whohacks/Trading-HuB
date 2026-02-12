export function safeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function summarizeTrades(trades) {
  const total = trades.length;
  const wins = trades.filter((trade) => safeNumber(trade.pnl) > 0).length;
  const losses = trades.filter((trade) => safeNumber(trade.pnl) < 0).length;
  const gain = trades.reduce((sum, trade) => sum + safeNumber(trade.pnl), 0);
  const winRate = total ? (wins / total) * 100 : 0;

  return { total, wins, losses, gain, winRate };
}

export function byCategoryWinRate(closedTrades) {
  const grouped = closedTrades.reduce((acc, trade) => {
    const key = trade.category || "Uncategorized";
    if (!acc[key]) {
      acc[key] = { category: key, total: 0, wins: 0, gain: 0 };
    }
    acc[key].total += 1;
    if (safeNumber(trade.pnl) > 0) {
      acc[key].wins += 1;
    }
    acc[key].gain += safeNumber(trade.pnl);
    return acc;
  }, {});

  return Object.values(grouped)
    .map((row) => ({
      ...row,
      winRate: row.total ? (row.wins / row.total) * 100 : 0,
    }))
    .sort((a, b) => b.total - a.total);
}

export function isWithinDays(isoDate, days) {
  if (!isoDate) return false;
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));
  const candidate = new Date(isoDate);
  return candidate >= start && candidate <= now;
}
