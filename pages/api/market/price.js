import { requireApiAuth } from "../../../lib/apiAuth";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const user = await requireApiAuth(req, res);
  if (!user) return;

  try {
    const symbol = String(req.query.symbol || "").toUpperCase().trim();

    if (!symbol) {
      return res.status(400).json({ error: "Missing symbol" });
    }

    const response = await fetch(
      `https://api.binance.com/api/v3/ticker/price?symbol=${encodeURIComponent(symbol)}`,
    );

    if (!response.ok) {
      const failText = await response.text();
      return res
        .status(400)
        .json({ error: failText || `Price request failed (${response.status})` });
    }

    const payload = await response.json();
    return res.status(200).json({
      symbol: payload.symbol,
      price: Number(payload.price || 0),
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    return res.status(500).json({
      error: error?.message || "Unable to fetch price",
    });
  }
}
