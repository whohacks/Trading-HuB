import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { apiUrl } from "../lib/apiBase";

const initialForm = {
  title: "",
  symbol: "",
  target_price: "",
  frequency_seconds: "30",
  trigger_direction: "above",
  severity: "medium",
};

function normalizeSymbol(symbol) {
  let value = String(symbol || "").toUpperCase().trim();
  if (!value) return "";
  if (value.includes(":")) value = value.split(":").pop() || value;
  value = value.replace(/\.P$/, "");
  value = value.replace(/[\/\-_]/g, "");
  value = value.replace(/\s+/g, "");
  return value;
}

function formatPrice(value, decimals = 6) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toFixed(decimals) : "-";
}

const coingeckoIdMap = {
  BTC: "bitcoin",
  ETH: "ethereum",
  BNB: "binancecoin",
  SOL: "solana",
  XRP: "ripple",
  ADA: "cardano",
  DOGE: "dogecoin",
  TRX: "tron",
  AVAX: "avalanche-2",
  DOT: "polkadot",
  LINK: "chainlink",
  MATIC: "matic-network",
  LTC: "litecoin",
  BCH: "bitcoin-cash",
};

function splitSymbol(symbol) {
  const value = normalizeSymbol(symbol);
  if (value.endsWith("USDT")) return { base: value.slice(0, -4), quote: "usd" };
  if (value.endsWith("USDC")) return { base: value.slice(0, -4), quote: "usd" };
  if (value.endsWith("USD")) return { base: value.slice(0, -3), quote: "usd" };
  if (value.endsWith("BTC")) return { base: value.slice(0, -3), quote: "btc" };
  if (value.endsWith("ETH")) return { base: value.slice(0, -3), quote: "eth" };
  return { base: value, quote: "usd" };
}

export default function AlertsPage({ session }) {
  const [form, setForm] = useState(initialForm);
  const [livePrices, setLivePrices] = useState({});
  const [liveUpdatedAt, setLiveUpdatedAt] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [settingsFlags, setSettingsFlags] = useState({
    telegramConfigured: false,
  });
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const checkingRef = useRef(false);
  const wsRefs = useRef({
    linear: null,
    spot: null,
    reconnectTimer: null,
    stopped: false,
  });
  const monitoringSymbols = useMemo(
    () =>
      Array.from(
        new Set(
          alerts
            .filter((row) => row.is_active && !row.sent_to_telegram)
            .map((row) => normalizeSymbol(row.symbol))
            .filter(Boolean),
        ),
      ),
    [alerts],
  );

  async function loadData() {
    const userId = session.user.id;
    const [{ data: alertRows }, flagsResponse] = await Promise.all([
      supabase
        .from("alerts")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false }),
      fetch(apiUrl("/api/settings/flags"), {
        headers: { Authorization: `Bearer ${session.access_token}` },
      }),
    ]);

    setAlerts(alertRows || []);
    if (flagsResponse.ok) {
      const flagsPayload = await flagsResponse.json();
      setSettingsFlags({
        telegramConfigured: Boolean(flagsPayload?.telegramConfigured),
      });
    } else {
      setSettingsFlags({ telegramConfigured: false });
    }
  }

  useEffect(() => {
    loadData();
  }, [session.user.id]);

  async function fetchCurrentPrice(symbol) {
    try {
      const response = await fetch(
        apiUrl(`/api/market/price?symbol=${encodeURIComponent(symbol)}`),
      );
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload?.error || "Failed to fetch price");
      }

      return {
        price: Number(payload.price || 0),
        source: payload.source || "unknown",
        fetchedAt: payload.fetchedAt || new Date().toISOString(),
      };
    } catch (_error) {
      const { base, quote } = splitSymbol(symbol);
      const coinId = coingeckoIdMap[base];
      if (!coinId) throw new Error("Failed to fetch price");

      const fallbackRes = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(coinId)}&vs_currencies=${encodeURIComponent(quote)}`,
      );
      const fallbackPayload = await fallbackRes.json();
      const price = Number(fallbackPayload?.[coinId]?.[quote] || 0);

      if (!fallbackRes.ok || !Number.isFinite(price) || price <= 0) {
        throw new Error("Failed to fetch price");
      }

      return {
        price,
        source: "coingecko-direct",
        fetchedAt: new Date().toISOString(),
      };
    }
  }

  async function createAlert(event) {
    event.preventDefault();
    setBusy(true);
    setStatus("");

    const symbol = normalizeSymbol(form.symbol);
    const targetPrice = Number(form.target_price);
    const frequencySeconds = Number(form.frequency_seconds || 30);

    if (!symbol || !Number.isFinite(targetPrice) || targetPrice <= 0) {
      setStatus("Enter valid symbol and target price.");
      setBusy(false);
      return;
    }

    try {
      const quote = await fetchCurrentPrice(symbol);
      const currentPrice = Number(quote?.price || 0);
      const alreadyHit =
        form.trigger_direction === "above"
          ? currentPrice >= targetPrice
          : currentPrice <= targetPrice;

      if (alreadyHit) {
        setStatus(
          `Target already hit (current: ${formatPrice(currentPrice)}). Choose a target not yet reached.`,
        );
        setBusy(false);
        return;
      }
    } catch (_error) {
      // If price provider is temporarily unavailable, still allow alert creation.
    }

    const payload = {
      user_id: session.user.id,
      title: form.title,
      message: `Price alert for ${symbol}`,
      severity: form.severity,
      symbol,
      target_price: targetPrice,
      frequency_seconds: Math.max(5, frequencySeconds),
      trigger_direction: form.trigger_direction,
      alert_type: "price",
      is_active: true,
      sent_to_telegram: false,
    };

    const { error } = await supabase.from("alerts").insert(payload);

    if (error) {
      setStatus(error.message);
      setBusy(false);
      return;
    }

    setForm(initialForm);
    setStatus("Price alert created. Monitoring started.");
    await loadData();
    setBusy(false);
  }

  async function checkPriceAlerts({ silent = false } = {}) {
    if (checkingRef.current) return;
    if (!settingsFlags.telegramConfigured) return;

    checkingRef.current = true;

    try {
      const response = await fetch(apiUrl("/api/alerts/check"), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });
      const payload = await response.json();

      if (!response.ok) {
        if (!silent) setStatus(payload?.error || "Alert check failed.");
        return;
      }

      if (Number(payload?.triggered || 0) > 0) {
        await loadData();
      } else if (!silent) {
        setStatus("Alert check completed.");
      }
    } finally {
      checkingRef.current = false;
    }
  }

  async function refreshLivePricesForAlerts() {
    const symbols = Array.from(
      new Set(
        alerts.map((row) => normalizeSymbol(row.symbol)).filter((symbol) => Boolean(symbol)),
      ),
    );
    if (!symbols.length) return;

    const entries = await Promise.all(
      symbols.map(async (symbol) => {
        try {
          const quote = await fetchCurrentPrice(symbol);
          return [symbol, { ...quote, ok: true }];
        } catch (_error) {
          return [symbol, { price: null, ok: false }];
        }
      }),
    );

    setLivePrices((prev) => {
      const next = { ...prev };
      for (const [symbol, value] of entries) next[symbol] = value;
      return next;
    });
    setLiveUpdatedAt(new Date().toISOString());
  }

  async function checkNow() {
    setStatus("Checking active alerts...");
    await checkPriceAlerts({ silent: false });
    await refreshLivePricesForAlerts();
  }

  async function deleteAlert(alertId) {
    setBusy(true);
    setStatus("");

    const { error } = await supabase
      .from("alerts")
      .delete()
      .eq("id", alertId)
      .eq("user_id", session.user.id);

    if (error) {
      setStatus(error.message);
      setBusy(false);
      return;
    }

    setStatus("Alert deleted.");
    await loadData();
    setBusy(false);
  }

  useEffect(() => {
    if (!monitoringSymbols.length) return undefined;
    refreshLivePricesForAlerts();
    const id = setInterval(refreshLivePricesForAlerts, 15000);
    return () => clearInterval(id);
  }, [monitoringSymbols.join("|")]);

  useEffect(() => {
    if (typeof WebSocket === "undefined") return undefined;
    const refs = wsRefs.current;
    refs.stopped = false;

    const updateLive = (symbol, price, source) => {
      const normalized = normalizeSymbol(symbol);
      if (!normalized || !Number.isFinite(price) || price <= 0) return;
      setLivePrices((prev) => ({
        ...prev,
        [normalized]: {
          price,
          ok: true,
          source,
          fetchedAt: new Date().toISOString(),
        },
      }));
      setLiveUpdatedAt(new Date().toISOString());
    };

    const linearSymbols = monitoringSymbols.filter(
      (symbol) => symbol.endsWith("USDT") || symbol.endsWith("USDC"),
    );
    const spotSymbols = monitoringSymbols;

    const subscribe = (ws, symbols) => {
      if (!ws || ws.readyState !== WebSocket.OPEN || !symbols.length) return;
      ws.send(
        JSON.stringify({
          op: "subscribe",
          args: symbols.map((symbol) => `tickers.${symbol}`),
        }),
      );
    };

    const connectLinear = () => {
      const ws = new WebSocket("wss://stream.bybit.com/v5/public/linear");
      refs.linear = ws;

      ws.onopen = () => subscribe(ws, linearSymbols);
      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          const topic = payload?.topic || "";
          if (!topic.startsWith("tickers.")) return;
          const symbol = topic.replace("tickers.", "");
          const price = Number(payload?.data?.lastPrice || 0);
          updateLive(symbol, price, "bybit-linear");
        } catch (_error) {
          // ignore malformed frame
        }
      };
      ws.onclose = () => {
        if (refs.stopped) return;
        if (refs.reconnectTimer) clearTimeout(refs.reconnectTimer);
        refs.reconnectTimer = setTimeout(connectLinear, 1500);
      };
    };

    const connectSpot = () => {
      const ws = new WebSocket("wss://stream.bybit.com/v5/public/spot");
      refs.spot = ws;

      ws.onopen = () => subscribe(ws, spotSymbols);
      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          const topic = payload?.topic || "";
          if (!topic.startsWith("tickers.")) return;
          const symbol = topic.replace("tickers.", "");
          const price = Number(payload?.data?.lastPrice || 0);
          updateLive(symbol, price, "bybit-spot");
        } catch (_error) {
          // ignore malformed frame
        }
      };
      ws.onclose = () => {
        if (refs.stopped) return;
        if (refs.reconnectTimer) clearTimeout(refs.reconnectTimer);
        refs.reconnectTimer = setTimeout(connectSpot, 1500);
      };
    };

    if (monitoringSymbols.length) {
      connectLinear();
      connectSpot();
    }

    return () => {
      refs.stopped = true;
      if (refs.reconnectTimer) clearTimeout(refs.reconnectTimer);
      refs.reconnectTimer = null;
      if (refs.linear && refs.linear.readyState <= 1) refs.linear.close();
      if (refs.spot && refs.spot.readyState <= 1) refs.spot.close();
      refs.linear = null;
      refs.spot = null;
    };
  }, [monitoringSymbols.join("|")]);

  const activeCount = useMemo(
    () => alerts.filter((row) => row.alert_type === "price" && row.is_active && !row.sent_to_telegram).length,
    [alerts],
  );

  const triggeredCount = useMemo(
    () => alerts.filter((row) => row.sent_to_telegram).length,
    [alerts],
  );

  const symbolsCount = useMemo(
    () => new Set(alerts.map((row) => normalizeSymbol(row.symbol)).filter(Boolean)).size,
    [alerts],
  );

  const telegramReady = Boolean(settingsFlags.telegramConfigured);

  return (
    <div className="stack">
      <section className="panel alerts-shell">
        <div className="alerts-top">
          <div>
            <p className="eyebrow">Alert Center</p>
            <h2>Price Alerts</h2>
            <p>Create alerts and monitor live prices with WebSocket updates.</p>
          </div>
          <div className="alerts-actions">
            <button className="ghost" type="button" onClick={refreshLivePricesForAlerts}>
              Refresh Prices
            </button>
            <button className="primary" type="button" onClick={checkNow} disabled={busy}>
              Check Now
            </button>
          </div>
        </div>

        <div className="alerts-stats">
          <div className="stat-card">
            <span>Active</span>
            <strong>{activeCount}</strong>
          </div>
          <div className="stat-card">
            <span>Triggered</span>
            <strong>{triggeredCount}</strong>
          </div>
          <div className="stat-card">
            <span>Symbols</span>
            <strong>{symbolsCount}</strong>
          </div>
          <div className="stat-card">
            <span>Telegram</span>
            <strong className={telegramReady ? "pnl-positive" : "pnl-negative"}>
              {telegramReady ? "Connected" : "Missing"}
            </strong>
          </div>
        </div>

        <form className="panel form-panel" onSubmit={createAlert}>
          <h3>New Alert</h3>
          <div className="form-grid">
            <label>
              Alert Name
              <input
                value={form.title}
                onChange={(e) => setForm((s) => ({ ...s, title: e.target.value }))}
                placeholder="BTC Breakout"
                required
              />
            </label>
            <label>
              Symbol
              <input
                value={form.symbol}
                onChange={(e) => setForm((s) => ({ ...s, symbol: e.target.value }))}
                placeholder="BTCUSDT"
                required
              />
            </label>
            <label>
              Target Price
              <input
                type="number"
                step="any"
                value={form.target_price}
                onChange={(e) => setForm((s) => ({ ...s, target_price: e.target.value }))}
                required
              />
            </label>
            <label>
              Trigger
              <select
                value={form.trigger_direction}
                onChange={(e) => setForm((s) => ({ ...s, trigger_direction: e.target.value }))}
              >
                <option value="above">Above or Equal</option>
                <option value="below">Below or Equal</option>
              </select>
            </label>
            <label>
              Frequency
              <select
                value={form.frequency_seconds}
                onChange={(e) => setForm((s) => ({ ...s, frequency_seconds: e.target.value }))}
              >
                <option value="5">Every 5 seconds</option>
                <option value="10">Every 10 seconds</option>
                <option value="30">Every 30 seconds</option>
                <option value="60">Every 1 minute</option>
              </select>
            </label>
            <label>
              Severity
              <select
                value={form.severity}
                onChange={(e) => setForm((s) => ({ ...s, severity: e.target.value }))}
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </label>
          </div>

          <div className="row" style={{ marginTop: 10 }}>
            <button className="primary" type="submit" disabled={busy}>
              Save Alert
            </button>
          </div>
        </form>

        {status ? <p className="status-text">{status}</p> : null}
      </section>

      <section className="panel">
        <div className="table-header">
          <h3>Alert Book</h3>
          <span className="muted-note">
            Live via Bybit WebSocket (15s fallback poll)
            {liveUpdatedAt ? ` • Last updated ${new Date(liveUpdatedAt).toLocaleTimeString()}` : ""}
          </span>
        </div>
        <div className="table-wrap desktop-only">
          <table className="table-compact alerts-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Name</th>
                <th>Symbol</th>
                <th>Target</th>
                <th>Live</th>
                <th>Delta</th>
                <th>Frequency</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {alerts.map((row) => {
                const live = row.symbol ? livePrices[normalizeSymbol(row.symbol)] : null;
                const liveValue = live?.ok ? Number(live.price) : null;
                const target = Number(row.target_price || 0);
                const delta = liveValue !== null && target ? liveValue - target : null;
                const isMonitoring = row.is_active && !row.sent_to_telegram;

                return (
                  <tr key={row.id}>
                    <td>{new Date(row.created_at).toLocaleString()}</td>
                    <td>{row.title}</td>
                    <td>{row.symbol || "-"}</td>
                    <td>{row.target_price ? `${formatPrice(row.target_price)} (${row.trigger_direction || "above"})` : "-"}</td>
                    <td>
                      {isMonitoring ? (
                        liveValue !== null ? (
                          <span>
                            {formatPrice(liveValue)}
                            {live?.source ? (
                              <span className="source-chip">{String(live.source).replace("coingecko-direct", "coingecko")}</span>
                            ) : null}
                          </span>
                        ) : (
                          "N/A"
                        )
                      ) : (
                        "-"
                      )}
                    </td>
                    <td>
                      {!isMonitoring || delta === null ? (
                        "-"
                      ) : (
                        <span className={delta >= 0 ? "pnl-positive" : "pnl-negative"}>{formatPrice(delta)}</span>
                      )}
                    </td>
                    <td>{row.frequency_seconds ? `${row.frequency_seconds}s` : "-"}</td>
                    <td>
                      {row.sent_to_telegram ? (
                        <span className="alert-chip hit">Triggered</span>
                      ) : row.is_active ? (
                        <span className="alert-chip live">Monitoring</span>
                      ) : (
                        <span className="alert-chip">Inactive</span>
                      )}
                    </td>
                    <td>
                      <button
                        className="ghost danger small"
                        type="button"
                        disabled={busy}
                        onClick={() => deleteAlert(row.id)}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                );
              })}
              {!alerts.length ? (
                <tr>
                  <td colSpan={9}>No alerts yet.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div className="mobile-only mobile-card-list">
          {alerts.map((row) => {
            const live = row.symbol ? livePrices[normalizeSymbol(row.symbol)] : null;
            const liveValue = live?.ok ? Number(live.price) : null;
            const target = Number(row.target_price || 0);
            const delta = liveValue !== null && target ? liveValue - target : null;
            const isMonitoring = row.is_active && !row.sent_to_telegram;

            return (
              <article className="mobile-card" key={row.id}>
                <h4 className="mobile-card-title">{row.title || "Alert"}</h4>
                <div className="mobile-meta">
                  <div className="mobile-meta-row">
                    <span>Time</span>
                    <span>{new Date(row.created_at).toLocaleString()}</span>
                  </div>
                  <div className="mobile-meta-row">
                    <span>Symbol</span>
                    <span>{row.symbol || "-"}</span>
                  </div>
                  <div className="mobile-meta-row">
                    <span>Target</span>
                    <span>
                      {row.target_price
                        ? `${formatPrice(row.target_price)} (${row.trigger_direction || "above"})`
                        : "-"}
                    </span>
                  </div>
                  <div className="mobile-meta-row">
                    <span>Live</span>
                    <span>
                      {isMonitoring ? (
                        liveValue !== null ? (
                          <>
                            {formatPrice(liveValue)}
                            {live?.source ? (
                              <span className="source-chip">{String(live.source).replace("coingecko-direct", "coingecko")}</span>
                            ) : null}
                          </>
                        ) : (
                          "N/A"
                        )
                      ) : (
                        "-"
                      )}
                    </span>
                  </div>
                  <div className="mobile-meta-row">
                    <span>Delta</span>
                    <span
                      className={
                        isMonitoring && delta !== null
                          ? delta >= 0
                            ? "pnl-positive"
                            : "pnl-negative"
                          : ""
                      }
                    >
                      {!isMonitoring || delta === null ? "-" : formatPrice(delta)}
                    </span>
                  </div>
                  <div className="mobile-meta-row">
                    <span>Frequency</span>
                    <span>{row.frequency_seconds ? `${row.frequency_seconds}s` : "-"}</span>
                  </div>
                  <div className="mobile-meta-row">
                    <span>Status</span>
                    <span>
                      {row.sent_to_telegram ? (
                        <span className="alert-chip hit">Triggered</span>
                      ) : row.is_active ? (
                        <span className="alert-chip live">Monitoring</span>
                      ) : (
                        <span className="alert-chip">Inactive</span>
                      )}
                    </span>
                  </div>
                </div>
                <button
                  className="ghost danger"
                  type="button"
                  disabled={busy}
                  onClick={() => deleteAlert(row.id)}
                >
                  Delete
                </button>
              </article>
            );
          })}
          {!alerts.length ? (
            <article className="mobile-card">
              <p>No alerts yet.</p>
            </article>
          ) : null}
        </div>
      </section>

      <style jsx>{`
        .alerts-shell {
          background: linear-gradient(140deg, rgba(20, 20, 20, 0.96), rgba(10, 10, 10, 0.92));
        }

        .alerts-top {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 12px;
        }

        .alerts-actions {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }

        .alerts-stats {
          margin-top: 12px;
          display: grid;
          gap: 10px;
          grid-template-columns: repeat(4, minmax(0, 1fr));
        }

        .stat-card {
          border: 1px solid rgba(130, 130, 130, 0.35);
          background: rgba(18, 18, 18, 0.8);
          border-radius: 12px;
          padding: 10px 12px;
        }

        .stat-card span {
          color: #a6a6a6;
          font-size: 12px;
          display: block;
          margin-bottom: 6px;
        }

        .stat-card strong {
          font-size: 22px;
          color: #f0f0f0;
        }

        .form-panel {
          margin-top: 12px;
          padding: 14px;
          border: 1px solid rgba(130, 130, 130, 0.3);
          background: rgba(16, 16, 16, 0.88);
        }

        .table-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 10px;
        }

        .alerts-table td,
        .alerts-table th {
          vertical-align: middle;
        }

        .alert-chip {
          display: inline-block;
          border: 1px solid rgba(130, 130, 130, 0.45);
          border-radius: 999px;
          padding: 4px 8px;
          font-size: 12px;
          color: #dddddd;
        }

        .alert-chip.live {
          border-color: rgba(180, 180, 180, 0.6);
          color: #e1e1e1;
        }

        .alert-chip.hit {
          border-color: rgba(160, 160, 160, 0.7);
          color: #d4d4d4;
        }

        .source-chip {
          display: inline-block;
          margin-left: 8px;
          padding: 2px 6px;
          border-radius: 999px;
          border: 1px solid rgba(130, 130, 130, 0.45);
          color: #bcbcbc;
          font-size: 11px;
          line-height: 1.2;
          vertical-align: middle;
          text-transform: lowercase;
        }

        @media (max-width: 900px) {
          .alerts-stats {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

        }

        @media (max-width: 620px) {
          .alerts-top {
            flex-direction: column;
          }

          .alerts-actions {
            width: 100%;
          }

          .alerts-actions button {
            flex: 1 1 auto;
          }

          .table-header {
            flex-direction: column;
            align-items: flex-start;
          }

        }
      `}</style>
    </div>
  );
}
