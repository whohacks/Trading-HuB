import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { isWithinDays, summarizeTrades } from "../lib/metrics";

function periodCards(trades) {
  const daily = summarizeTrades(trades.filter((row) => isWithinDays(row.closed_at, 1)));
  const weekly = summarizeTrades(trades.filter((row) => isWithinDays(row.closed_at, 7)));
  const monthly = summarizeTrades(trades.filter((row) => isWithinDays(row.closed_at, 30)));
  return { daily, weekly, monthly };
}

export default function AnalyticsPage({ session }) {
  const [closedTrades, setClosedTrades] = useState([]);

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from("trades")
        .select("pnl,closed_at,status")
        .eq("user_id", session.user.id)
        .eq("status", "closed");

      setClosedTrades(data || []);
    }

    load();
  }, [session.user.id]);

  const metrics = useMemo(() => periodCards(closedTrades), [closedTrades]);

  return (
    <div className="stack analytics-compact">
      <section className="panel alert-hero">
        <p className="eyebrow">Analytics</p>
        <h2>Analytics</h2>
        <p>
          Daily, weekly, and monthly performance snapshots including win rate,
          gain, wins, and losses.
        </p>
      </section>

      <section className="grid cols-3 alert-kpis">
        <article className="panel metric kpi-card">
          <p>Daily Win Rate</p>
          <strong>{metrics.daily.winRate.toFixed(2)}%</strong>
          <small>
            Gain: {metrics.daily.gain.toFixed(2)} | Trades: {metrics.daily.total}
          </small>
        </article>

        <article className="panel metric kpi-card">
          <p>Weekly Win Rate</p>
          <strong>{metrics.weekly.winRate.toFixed(2)}%</strong>
          <small>
            Gain: {metrics.weekly.gain.toFixed(2)} | Trades: {metrics.weekly.total}
          </small>
        </article>

        <article className="panel metric kpi-card">
          <p>Monthly Win Rate</p>
          <strong>{metrics.monthly.winRate.toFixed(2)}%</strong>
          <small>
            Gain: {metrics.monthly.gain.toFixed(2)} | Trades: {metrics.monthly.total}
          </small>
        </article>
      </section>

      <section className="panel">
        <h3>Price Breakdown</h3>
        <div className="table-wrap analytics-table-wrap">
          <table className="analytics-table">
            <thead>
              <tr>
                <th>Period</th>
                <th>Trades</th>
                <th>Wins</th>
                <th>Losses</th>
                <th>Win Rate</th>
                <th>Gain</th>
              </tr>
            </thead>
            <tbody>
              {["daily", "weekly", "monthly"].map((period) => {
                const row = metrics[period];
                return (
                  <tr key={period}>
                    <td>{period}</td>
                    <td>{row.total}</td>
                    <td>{row.wins}</td>
                    <td>{row.losses}</td>
                    <td>{row.winRate.toFixed(2)}%</td>
                    <td>{row.gain.toFixed(2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <style jsx>{`
        .analytics-compact :global(h2) {
          font-size: 1.15rem;
          margin-bottom: 6px;
        }

        .analytics-compact :global(h3) {
          font-size: 1rem;
          margin-bottom: 6px;
        }

        .analytics-compact :global(p) {
          font-size: 12px;
        }

        .analytics-compact :global(.metric strong) {
          font-size: 18px;
          margin-top: 6px;
        }

        .analytics-compact :global(.metric small) {
          font-size: 11px;
          margin-top: 6px;
        }

        .analytics-compact :global(.kpi-card) {
          padding: 9px;
        }

        .analytics-compact :global(table) {
          font-size: 12px;
        }

        .analytics-compact :global(th),
        .analytics-compact :global(td) {
          padding: 7px 8px;
        }

        .analytics-compact :global(.analytics-table-wrap) {
          overflow-x: visible;
        }

        .analytics-compact :global(.analytics-table) {
          min-width: 0;
          width: 100%;
          table-layout: fixed;
        }

        .analytics-compact :global(.analytics-table th),
        .analytics-compact :global(.analytics-table td) {
          white-space: normal;
          word-break: break-word;
          overflow-wrap: anywhere;
          padding: 6px 6px;
          font-size: 11px;
          line-height: 1.2;
        }
      `}</style>
    </div>
  );
}
