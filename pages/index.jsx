import { useEffect, useMemo, useState } from "react";
import { apiUrl } from "../lib/apiBase";

function formatNum(value, decimals = 4) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed.toFixed(decimals) : "0.0000";
}

function pnlClass(value) {
  return Number(value || 0) >= 0 ? "pnl-positive" : "pnl-negative";
}

export default function Dashboard({ session }) {
  const [activeWallet, setActiveWallet] = useState("spot");
  const [binanceConfigured, setBinanceConfigured] = useState(false);
  const [state, setState] = useState({
    loading: false,
    error: "",
    sectionErrors: [],
    spotBalances: [],
    futuresBalances: [],
    fundingBalances: [],
    runningTrades: [],
    lastUpdated: "",
  });

  async function loadBinanceData({ silent = false } = {}) {
    if (!silent) {
      setState((prev) => ({ ...prev, loading: true, error: "" }));
    } else {
      setState((prev) => ({ ...prev, error: "" }));
    }

    try {
      const response = await fetch(apiUrl("/api/binance/account"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload?.error || "Unable to fetch Binance account data");
      }

      setState({
        loading: false,
        error: "",
        sectionErrors: payload.errors || [],
        spotBalances: payload.spotBalances || [],
        futuresBalances: payload.futuresBalances || [],
        fundingBalances: payload.fundingBalances || [],
        runningTrades: payload.runningTrades || [],
        lastUpdated: payload.serverTime || new Date().toISOString(),
      });
    } catch (error) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: error?.message || "Unable to fetch Binance account data",
      }));
    }
  }

  useEffect(() => {
    async function bootstrap() {
      const response = await fetch(apiUrl("/api/settings/flags"), {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const payload = await response.json();
      const configured = Boolean(payload?.binanceConfigured);
      setBinanceConfigured(configured);
      if (configured) {
        loadBinanceData();
      }
    }

    bootstrap();
  }, [session.access_token]);

  useEffect(() => {
    if (!binanceConfigured) return undefined;

    const id = setInterval(() => {
      loadBinanceData({ silent: true });
    }, 15000);

    return () => clearInterval(id);
  }, [binanceConfigured]);

  const topSpot = useMemo(() => state.spotBalances.slice(0, 12), [state.spotBalances]);
  const topFutures = useMemo(
    () => state.futuresBalances.slice(0, 12),
    [state.futuresBalances],
  );
  const topFunding = useMemo(
    () => state.fundingBalances.slice(0, 12),
    [state.fundingBalances],
  );

  const walletOptions = [
    { id: "spot", label: "Spot Wallet" },
    { id: "futures", label: "Futures Wallet" },
    { id: "funding", label: "Funding Wallet" },
  ];

  const summary = {
    spotAssets: state.spotBalances.length,
    futuresAssets: state.futuresBalances.length,
    fundingAssets: state.fundingBalances.length,
    runningTrades: state.runningTrades.length,
  };

  return (
    <div className="stack">
      <section className="panel alert-hero dashboard-hero">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div>
            <p className="eyebrow">Dashboard</p>
            <h2 className="dashboard-title">Portfolio Command Center</h2>
            <p>Spot, Futures, Funding, and live running trades with PnL.</p>
          </div>
          <button
            className="ghost"
            onClick={() => loadBinanceData()}
            disabled={state.loading || !binanceConfigured}
          >
            {state.loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        {!binanceConfigured ? (
          <p className="status-text">
            Add Binance API Key and Secret in Settings to load dashboard data.
          </p>
        ) : null}

        {state.error ? <p className="status-text">{state.error}</p> : null}
        {state.sectionErrors.map((err) => (
          <p key={err} className="status-text">
            {err}
          </p>
        ))}

        {state.lastUpdated ? (
          <p style={{ marginTop: 8 }}>
            Last updated: {new Date(state.lastUpdated).toLocaleString()}
          </p>
        ) : null}

        <div className="grid cols-4 alert-kpis dashboard-kpi-grid" style={{ marginTop: 14 }}>
          <article className="kpi-card dashboard-kpi-card">
            <p>Spot Assets</p>
            <strong className="kpi-value">{summary.spotAssets}</strong>
          </article>
          <article className="kpi-card dashboard-kpi-card">
            <p>Futures Assets</p>
            <strong className="kpi-value">{summary.futuresAssets}</strong>
          </article>
          <article className="kpi-card dashboard-kpi-card">
            <p>Funding Assets</p>
            <strong className="kpi-value">{summary.fundingAssets}</strong>
          </article>
          <article className="kpi-card dashboard-kpi-card">
            <p>Running Trades</p>
            <strong className="kpi-value">{summary.runningTrades}</strong>
          </article>
        </div>
      </section>

      <section className="panel">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h3>Wallet Viewer</h3>
          <div className="segmented-control">
            {walletOptions.map((opt) => (
              <button
                key={opt.id}
                className={activeWallet === opt.id ? "segment active" : "segment"}
                onClick={() => setActiveWallet(opt.id)}
                type="button"
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {activeWallet === "spot" ? (
          <>
            <div className="table-wrap desktop-only">
              <table>
                <thead>
                  <tr>
                    <th>Asset</th>
                    <th>Free</th>
                    <th>Locked</th>
                  </tr>
                </thead>
                <tbody>
                  {topSpot.map((row) => (
                    <tr key={row.asset}>
                      <td>{row.asset}</td>
                      <td>{formatNum(row.free, 6)}</td>
                      <td>{formatNum(row.locked, 6)}</td>
                    </tr>
                  ))}
                  {!topSpot.length ? (
                    <tr>
                      <td colSpan={3}>No non-zero spot balances.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            <div className="mobile-only mobile-card-list">
              {topSpot.map((row) => (
                <article className="mobile-card" key={row.asset}>
                  <h4 className="mobile-card-title">{row.asset}</h4>
                  <div className="mobile-meta">
                    <div className="mobile-meta-row">
                      <span>Free</span>
                      <span>{formatNum(row.free, 6)}</span>
                    </div>
                    <div className="mobile-meta-row">
                      <span>Locked</span>
                      <span>{formatNum(row.locked, 6)}</span>
                    </div>
                  </div>
                </article>
              ))}
              {!topSpot.length ? (
                <article className="mobile-card">
                  <p>No non-zero spot balances.</p>
                </article>
              ) : null}
            </div>
          </>
        ) : null}

        {activeWallet === "futures" ? (
          <>
            <div className="table-wrap desktop-only">
              <table>
                <thead>
                  <tr>
                    <th>Asset</th>
                    <th>Wallet Balance</th>
                    <th>Available</th>
                  </tr>
                </thead>
                <tbody>
                  {topFutures.map((row) => (
                    <tr key={row.asset}>
                      <td>{row.asset}</td>
                      <td>{formatNum(row.balance, 4)}</td>
                      <td>{formatNum(row.availableBalance, 4)}</td>
                    </tr>
                  ))}
                  {!topFutures.length ? (
                    <tr>
                      <td colSpan={3}>No non-zero futures balances.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            <div className="mobile-only mobile-card-list">
              {topFutures.map((row) => (
                <article className="mobile-card" key={row.asset}>
                  <h4 className="mobile-card-title">{row.asset}</h4>
                  <div className="mobile-meta">
                    <div className="mobile-meta-row">
                      <span>Wallet Balance</span>
                      <span>{formatNum(row.balance, 4)}</span>
                    </div>
                    <div className="mobile-meta-row">
                      <span>Available</span>
                      <span>{formatNum(row.availableBalance, 4)}</span>
                    </div>
                  </div>
                </article>
              ))}
              {!topFutures.length ? (
                <article className="mobile-card">
                  <p>No non-zero futures balances.</p>
                </article>
              ) : null}
            </div>
          </>
        ) : null}

        {activeWallet === "funding" ? (
          <>
            <div className="table-wrap desktop-only">
              <table>
                <thead>
                  <tr>
                    <th>Asset</th>
                    <th>Free</th>
                    <th>Locked</th>
                  </tr>
                </thead>
                <tbody>
                  {topFunding.map((row) => (
                    <tr key={row.asset}>
                      <td>{row.asset}</td>
                      <td>{formatNum(row.free, 6)}</td>
                      <td>{formatNum(row.locked, 6)}</td>
                    </tr>
                  ))}
                  {!topFunding.length ? (
                    <tr>
                      <td colSpan={3}>No non-zero funding balances.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            <div className="mobile-only mobile-card-list">
              {topFunding.map((row) => (
                <article className="mobile-card" key={row.asset}>
                  <h4 className="mobile-card-title">{row.asset}</h4>
                  <div className="mobile-meta">
                    <div className="mobile-meta-row">
                      <span>Free</span>
                      <span>{formatNum(row.free, 6)}</span>
                    </div>
                    <div className="mobile-meta-row">
                      <span>Locked</span>
                      <span>{formatNum(row.locked, 6)}</span>
                    </div>
                  </div>
                </article>
              ))}
              {!topFunding.length ? (
                <article className="mobile-card">
                  <p>No non-zero funding balances.</p>
                </article>
              ) : null}
            </div>
          </>
        ) : null}
      </section>

      <section className="panel running-trades-panel">
        <h3>Running Trades (Futures Positions)</h3>
        <div className="table-wrap desktop-only">
          <table>
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Side</th>
                <th>Size</th>
                <th>Entry</th>
                <th>Mark</th>
                <th>PnL</th>
              </tr>
            </thead>
            <tbody>
              {state.runningTrades.map((row) => (
                <tr key={`${row.symbol}-${row.positionSide}`}>
                  <td>{row.symbol}</td>
                  <td>{Number(row.positionAmt) > 0 ? "LONG" : "SHORT"}</td>
                  <td>{formatNum(Math.abs(Number(row.positionAmt)), 4)}</td>
                  <td>{formatNum(row.entryPrice, 4)}</td>
                  <td>{formatNum(row.markPrice, 4)}</td>
                  <td className={pnlClass(row.unRealizedProfit)}>
                    {formatNum(row.unRealizedProfit, 4)}
                  </td>
                </tr>
              ))}
              {!state.runningTrades.length ? (
                <tr>
                  <td colSpan={6}>No running futures positions.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div className="mobile-only mobile-card-list">
          {state.runningTrades.map((row) => (
            <article className="mobile-card" key={`${row.symbol}-${row.positionSide}`}>
              <h4 className="mobile-card-title">
                {row.symbol} {Number(row.positionAmt) > 0 ? "LONG" : "SHORT"}
              </h4>
              <div className="mobile-meta">
                <div className="mobile-meta-row">
                  <span>Size</span>
                  <span>{formatNum(Math.abs(Number(row.positionAmt)), 4)}</span>
                </div>
                <div className="mobile-meta-row">
                  <span>Entry</span>
                  <span>{formatNum(row.entryPrice, 4)}</span>
                </div>
                <div className="mobile-meta-row">
                  <span>Mark</span>
                  <span>{formatNum(row.markPrice, 4)}</span>
                </div>
                <div className="mobile-meta-row">
                  <span>PnL</span>
                  <span className={pnlClass(row.unRealizedProfit)}>
                    {formatNum(row.unRealizedProfit, 4)}
                  </span>
                </div>
              </div>
            </article>
          ))}
          {!state.runningTrades.length ? (
            <article className="mobile-card">
              <p>No running futures positions.</p>
            </article>
          ) : null}
        </div>
      </section>
    </div>
  );
}
