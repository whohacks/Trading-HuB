import { Fragment, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { byCategoryWinRate, safeNumber } from "../lib/metrics";

const initialCategories = [
  "API Imported",
  "Uncategorized",
  "Scalp",
  "Intraday",
  "Swing",
  "Breakout",
  "Reversal",
  "News",
];

const localCategoryKey = "journal_trade_categories";
const localCategoryColorKey = "journal_trade_category_colors";
const defaultPalette = [
  "#4caf50",
  "#2196f3",
  "#ff9800",
  "#9c27b0",
  "#e91e63",
  "#00bcd4",
  "#8bc34a",
  "#ff5722",
  "#ffc107",
  "#607d8b",
];

function readLocalCategories() {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(localCategoryKey);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (_error) {
    return [];
  }
}

function writeLocalCategories(categories) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(localCategoryKey, JSON.stringify(categories));
  } catch (_error) {
    // ignore local storage errors
  }
}

function readLocalCategoryColors() {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(localCategoryColorKey);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_error) {
    return {};
  }
}

function writeLocalCategoryColors(colors) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(localCategoryColorKey, JSON.stringify(colors || {}));
  } catch (_error) {
    // ignore local storage errors
  }
}

function defaultCategoryColor(name) {
  const text = String(name || "");
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0;
  }
  const index = Math.abs(hash) % defaultPalette.length;
  return defaultPalette[index];
}

function buildCategoryColorMap(categories, existing) {
  const next = {};
  for (const category of categories || []) {
    next[category] = existing?.[category] || defaultCategoryColor(category);
  }
  return next;
}

function parseDateInputLocal(dateStr) {
  const [year, month, day] = String(dateStr || "")
    .split("-")
    .map((v) => Number(v));

  if (!year || !month || !day) return null;
  const date = new Date(year, month - 1, day, 0, 0, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateTime(value) {
  return value
    ? new Date(value).toLocaleString()
    : "-";
}

function buildDateWindowLabel(fromDate, toDate) {
  const from = parseDateInputLocal(fromDate);
  const to = parseDateInputLocal(toDate);
  if (!from || !to) return "";
  return `${from.toLocaleDateString()} - ${to.toLocaleDateString()}`;
}

export default function JournalPage({ session }) {
  const [trades, setTrades] = useState([]);
  const [categoryDrafts, setCategoryDrafts] = useState({});
  const [allCategories, setAllCategories] = useState(initialCategories);
  const [newCategory, setNewCategory] = useState("");
  const [newCategoryColor, setNewCategoryColor] = useState("#4caf50");
  const [categoryColors, setCategoryColors] = useState({});
  const [categoryManagerOpen, setCategoryManagerOpen] = useState(false);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [importDate, setImportDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [importToDate, setImportToDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );

  async function loadTrades() {
    const userId = session.user.id;
    const [{ data: tradeRows }, { data: settingsRow }] = await Promise.all([
      supabase
        .from("trades")
        .select("*")
        .eq("user_id", userId)
        .eq("status", "closed")
        .order("closed_at", { ascending: false, nullsFirst: false }),
      supabase
        .from("user_settings")
        .select("trade_categories")
        .eq("user_id", userId)
        .single(),
    ]);

    setTrades(tradeRows || []);

    const localCategories = readLocalCategories();
    const localColors = readLocalCategoryColors();
    const savedCategories = Array.isArray(settingsRow?.trade_categories)
      ? settingsRow.trade_categories
      : localCategories;

    const tradeDerived = Array.from(
      new Set((tradeRows || []).map((row) => row.category).filter(Boolean)),
    );

    const merged =
      savedCategories.length > 0
        ? savedCategories
        : Array.from(new Set([...initialCategories, ...tradeDerived]));

    setAllCategories(merged);
    writeLocalCategories(merged);
    const nextColorMap = buildCategoryColorMap(merged, localColors);
    setCategoryColors(nextColorMap);
    writeLocalCategoryColors(nextColorMap);

    setCategoryDrafts((prev) => {
      const next = { ...prev };
      for (const row of tradeRows || []) {
        if (!next[row.id]) {
          next[row.id] = row.category || "API Imported";
        }
      }
      return next;
    });
  }

  useEffect(() => {
    loadTrades();
  }, [session.user.id]);

  function buildImportWindow() {
    const from = parseDateInputLocal(importDate);
    const to = parseDateInputLocal(importToDate);
    if (!from || !to) return null;
    if (to < from) return null;

    const startAt = new Date(from);
    startAt.setHours(0, 0, 0, 0);

    const endAt = new Date(to);
    endAt.setHours(23, 59, 59, 999);

    return {
      startTime: startAt.getTime(),
      endTime: endAt.getTime(),
    };
  }

  async function importCompletedTradesFromApi() {
    setBusy(true);
    setStatus("");

    const windowRange = buildImportWindow();
    if (!windowRange) {
      setStatus("Select a valid from date.");
      setBusy(false);
      return;
    }

    try {
      const response = await fetch("/api/binance/completed-trades", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          startTime: windowRange.startTime,
          endTime: windowRange.endTime,
        }),
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload?.error || "Failed to fetch completed trades");
      }

      const apiTrades = payload.trades || [];
      if (!apiTrades.length) {
        setStatus("No trades found for selected range.");
        setBusy(false);
        return;
      }

      const externalRefs = apiTrades.map((row) => row.external_ref);

      const { data: existingRows } = await supabase
        .from("trades")
        .select("id,external_ref,category")
        .eq("user_id", session.user.id)
        .eq("source", "binance_futures_position_history")
        .in("external_ref", externalRefs);

      const existingByRef = new Map(
        (existingRows || []).map((row) => [row.external_ref, row]),
      );

      const normalizedRows = apiTrades.map((row) => ({
        existing: existingByRef.get(row.external_ref) || null,
        payload: {
          user_id: session.user.id,
          symbol: row.symbol,
          category:
            existingByRef.get(row.external_ref)?.category ||
            ((allCategories || []).includes("API Imported")
              ? "API Imported"
              : allCategories[0] || "Imported"),
          side: row.side || "long",
          entry_price: row.entry_price || null,
          exit_price: null,
          quantity: row.quantity || null,
          realized_pnl: row.realized_pnl ?? null,
          fee: row.fee ?? 0,
          pnl: row.pnl_net ?? row.pnl ?? 0,
          roi: row.roi,
          opened_at: null,
          closed_at: row.closed_at,
          notes:
            row.debug_components && Array.isArray(row.debug_components)
              ? JSON.stringify(
                  {
                    orderNo: row.order_no || null,
                    sourceInfo: row.info || "",
                    fills: row.debug_components,
                  },
                  null,
                  0,
                )
              : row.info || "Imported from Binance Futures API",
          status: "closed",
          synced: true,
          synced_at: new Date().toISOString(),
          source: "binance_futures_position_history",
          external_ref: row.external_ref,
        },
      }));

      const toInsert = normalizedRows
        .filter((row) => !row.existing)
        .map((row) => row.payload);
      const toUpdate = normalizedRows.filter((row) => row.existing);

      for (const row of toUpdate) {
        const { error: updateError } = await supabase
          .from("trades")
          .update(row.payload)
          .eq("id", row.existing.id)
          .eq("user_id", session.user.id);

        if (updateError) {
          throw new Error(updateError.message);
        }
      }

      if (toInsert.length) {
        const { error: insertError } = await supabase.from("trades").insert(toInsert);
        if (insertError) {
          throw new Error(insertError.message);
        }
      }

      setStatus(
        `Imported ${toInsert.length} new trade(s) and updated ${toUpdate.length} existing trade(s).`,
      );
      await loadTrades();
    } catch (error) {
      setStatus(error?.message || "Failed to import trades from API.");
    }

    setBusy(false);
  }

  async function updateTradeCategory(tradeId) {
    const nextCategory = (categoryDrafts[tradeId] || "").trim();
    if (!nextCategory) {
      setStatus("Select a category first.");
      return;
    }

    setBusy(true);
    setStatus("");

    const { error } = await supabase
      .from("trades")
      .update({ category: nextCategory })
      .eq("id", tradeId)
      .eq("user_id", session.user.id);

    if (error) {
      setStatus(error.message);
      setBusy(false);
      return;
    }

    setStatus("Trade category updated.");
    await loadTrades();
    setBusy(false);
  }

  async function removeTrade(tradeId) {
    setBusy(true);
    setStatus("");

    const { error } = await supabase
      .from("trades")
      .delete()
      .eq("id", tradeId)
      .eq("user_id", session.user.id);

    if (error) {
      setStatus(error.message);
      setBusy(false);
      return;
    }

    setStatus("Trade removed from position history.");
    await loadTrades();
    setBusy(false);
  }

  async function removeAllTrades() {
    setBusy(true);
    setStatus("");

    const { error } = await supabase
      .from("trades")
      .delete()
      .eq("user_id", session.user.id);

    if (error) {
      setStatus(error.message);
      setBusy(false);
      return;
    }

    setStatus("All trades removed from position history.");
    await loadTrades();
    setBusy(false);
  }

  async function saveAllCategories(nextCategories) {
    const { error } = await supabase.from("user_settings").upsert(
      {
        user_id: session.user.id,
        trade_categories: nextCategories,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );

    if (error) {
      const message = String(error.message || "");
      if (message.includes("trade_categories")) {
        writeLocalCategories(nextCategories);
        return;
      }
      throw new Error(message);
    }

    writeLocalCategories(nextCategories);
  }

  async function addCustomCategory() {
    const normalized = newCategory.trim();
    if (!normalized) {
      setStatus("Enter a category name.");
      return;
    }

    const exists = allCategories.some(
      (cat) => cat.toLowerCase() === normalized.toLowerCase(),
    );
    if (exists) {
      setStatus("Category already exists.");
      return;
    }

    setBusy(true);
    setStatus("");

    try {
      const next = [...allCategories, normalized];
      await saveAllCategories(next);
      setAllCategories(next);
      const nextColors = {
        ...categoryColors,
        [normalized]: newCategoryColor || defaultCategoryColor(normalized),
      };
      setCategoryColors(nextColors);
      writeLocalCategoryColors(nextColors);
      setNewCategory("");
      setNewCategoryColor("#4caf50");
      setStatus("Category added.");
    } catch (error) {
      setStatus(error.message || "Failed to add category.");
    }

    setBusy(false);
  }

  async function removeCustomCategory(categoryToRemove) {
    setBusy(true);
    setStatus("");

    try {
      const next = allCategories.filter((cat) => cat !== categoryToRemove);
      if (!next.length) {
        setStatus("At least one category must remain.");
        setBusy(false);
        return;
      }

      const fallbackCategory =
        next.includes("Uncategorized") ? "Uncategorized" : next[0];

      const { data: updatedRows, error: updateError } = await supabase
        .from("trades")
        .update({ category: fallbackCategory })
        .eq("user_id", session.user.id)
        .eq("category", categoryToRemove)
        .select("id");

      if (updateError) {
        throw new Error(updateError.message);
      }

      await saveAllCategories(next);
      setAllCategories(next);
      const nextColors = { ...categoryColors };
      delete nextColors[categoryToRemove];
      setCategoryColors(nextColors);
      writeLocalCategoryColors(nextColors);
      setStatus(
        `Removed category "${categoryToRemove}". Reassigned ${updatedRows?.length || 0} trade(s) to "${fallbackCategory}".`,
      );
      await loadTrades();
    } catch (error) {
      setStatus(error.message || "Failed to remove category.");
    }

    setBusy(false);
  }

  function updateCategoryColor(category, color) {
    const next = { ...categoryColors, [category]: color };
    setCategoryColors(next);
    writeLocalCategoryColors(next);
  }

  const closedTrades = useMemo(
    () => trades.filter((row) => row.status === "closed"),
    [trades],
  );

  const categoryRows = useMemo(
    () => byCategoryWinRate(closedTrades),
    [closedTrades],
  );

  const categoryOptions = useMemo(() => allCategories, [allCategories]);

  const summary = useMemo(() => {
    const total = trades.length;
    const winners = trades.filter((row) => safeNumber(row.pnl) > 0).length;
    const losers = trades.filter((row) => safeNumber(row.pnl) < 0).length;
    const net = trades.reduce((acc, row) => acc + safeNumber(row.pnl), 0);
    return { total, winners, losers, net };
  }, [trades]);

  return (
    <div className="stack">
      <section className="panel alert-hero">
        <div className="alert-hero-top">
          <div>
            <p className="eyebrow">Journal</p>
            <h2>Position Journal</h2>
            <p>
              Import completed Binance positions with local-time ranges and manage
              categories for performance review.
            </p>
          </div>
          <div className="user-chip">
            Import Window: {buildDateWindowLabel(importDate, importToDate)}
          </div>
        </div>

        <div
          className="grid alert-kpis"
          style={{ marginTop: 14, gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}
        >
          <article className="kpi-card">
            <p>Total Positions</p>
            <strong className="kpi-value">{summary.total}</strong>
          </article>
          <article className="kpi-card">
            <p>Winning</p>
            <strong className="kpi-value pnl-positive">{summary.winners}</strong>
          </article>
          <article className="kpi-card">
            <p>Losing</p>
            <strong className="kpi-value pnl-negative">{summary.losers}</strong>
          </article>
          <article className="kpi-card">
            <p>Net P/L</p>
            <strong className={summary.net >= 0 ? "kpi-value pnl-positive" : "kpi-value pnl-negative"}>
              {summary.net.toFixed(2)}
            </strong>
          </article>
        </div>
      </section>

      <section className="panel">
        <h3>Import Trades</h3>
        <p className="muted-note">
          Dates are treated in your local timezone and imported inclusive from
          start of `From Date` to end of `To Date`.
        </p>

        <div
          className="form-grid"
          style={{ marginTop: 12, gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}
        >
          <label>
            From Date
            <input
              type="date"
              value={importDate}
              onChange={(e) => setImportDate(e.target.value)}
            />
          </label>

          <label>
            To Date
            <input
              type="date"
              value={importToDate}
              onChange={(e) => setImportToDate(e.target.value)}
            />
          </label>

          <div className="row" style={{ alignItems: "flex-end", gridColumn: "1 / -1" }}>
            <button
              className="primary"
              type="button"
              onClick={importCompletedTradesFromApi}
              disabled={busy}
            >
              {busy ? "Importing..." : "Import Trades"}
            </button>
          </div>
        </div>

        <div className="row" style={{ marginTop: 10 }}>
          <button
            className="ghost"
            type="button"
            onClick={() => setCategoryManagerOpen((prev) => !prev)}
          >
            {categoryManagerOpen ? "Hide Category Manager" : "Category Manager"}
          </button>
        </div>

        {categoryManagerOpen ? (
          <div className="panel" style={{ marginTop: 12, padding: 12 }}>
            <div className="form-grid">
              <label>
                Add New Category
                <input
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  placeholder="e.g. Trend Continuation"
                />
              </label>
              <label>
                Color
                <input
                  type="color"
                  value={newCategoryColor}
                  onChange={(e) => setNewCategoryColor(e.target.value)}
                />
              </label>
              <div className="row" style={{ alignItems: "flex-end" }}>
                <button
                  className="ghost"
                  type="button"
                  onClick={addCustomCategory}
                  disabled={busy}
                >
                  Add New
                </button>
              </div>
            </div>

            <div className="table-wrap desktop-only" style={{ marginTop: 12 }}>
              <table>
                <thead>
                  <tr>
                    <th>Category Name</th>
                    <th>Color</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {allCategories.map((cat) => (
                    <tr key={cat}>
                      <td>
                        <span className="category-pill">
                          <span
                            className="category-dot"
                            style={{ backgroundColor: categoryColors[cat] || defaultCategoryColor(cat) }}
                          />
                          {cat}
                        </span>
                      </td>
                      <td>
                        <input
                          type="color"
                          value={categoryColors[cat] || defaultCategoryColor(cat)}
                          onChange={(e) => updateCategoryColor(cat, e.target.value)}
                        />
                      </td>
                      <td>
                        <button
                          className="ghost danger small"
                          type="button"
                          disabled={busy}
                          onClick={() => removeCustomCategory(cat)}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mobile-only mobile-card-list">
              {allCategories.map((cat) => (
                <article className="mobile-card" key={cat}>
                  <h4 className="mobile-card-title">
                    <span className="category-pill">
                      <span
                        className="category-dot"
                        style={{ backgroundColor: categoryColors[cat] || defaultCategoryColor(cat) }}
                      />
                      {cat}
                    </span>
                  </h4>
                  <label>
                    Color
                    <input
                      type="color"
                      value={categoryColors[cat] || defaultCategoryColor(cat)}
                      onChange={(e) => updateCategoryColor(cat, e.target.value)}
                    />
                  </label>
                  <button
                    className="ghost danger"
                    type="button"
                    disabled={busy}
                    onClick={() => removeCustomCategory(cat)}
                  >
                    Remove
                  </button>
                </article>
              ))}
            </div>
          </div>
        ) : null}

        {status ? <p className="status-text">{status}</p> : null}
      </section>

      <section className="panel">
        <h3>Category Win Rate</h3>
        <div className="table-wrap journal-fit-wrap">
          <table className="journal-fit-table">
            <thead>
              <tr>
                <th>Category</th>
                <th>Trades</th>
                <th>Wins</th>
                <th>Win Rate</th>
                <th>Gain</th>
              </tr>
            </thead>
            <tbody>
              {categoryRows.map((row) => (
                <tr key={row.category}>
                  <td>
                    <span className="category-pill">
                      <span
                        className="category-dot"
                        style={{
                          backgroundColor:
                            categoryColors[row.category] || defaultCategoryColor(row.category),
                        }}
                      />
                      {row.category}
                    </span>
                  </td>
                  <td>{row.total}</td>
                  <td>{row.wins}</td>
                  <td>{row.winRate.toFixed(2)}%</td>
                  <td>{row.gain.toFixed(2)}</td>
                </tr>
              ))}
              {!categoryRows.length ? (
                <tr>
                  <td colSpan={5}>No closed trades yet.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>Position History</h3>
          <button
            className="ghost danger"
            type="button"
            onClick={removeAllTrades}
            disabled={busy}
          >
            Remove All Trades
          </button>
        </div>
        <div className="table-wrap journal-table-wrap" style={{ marginTop: 12 }}>
          <table className="journal-table">
            <thead>
              <tr>
                <th>Completed Time</th>
                <th>Symbol</th>
                <th>Side</th>
                <th>Loss / Profit (USDT)</th>
                <th>Category</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((row) => {
                const profitLoss = safeNumber(row.pnl);
                return (
                  <Fragment key={row.id}>
                    <tr>
                      <td>{formatDateTime(row.closed_at || row.created_at)}</td>
                      <td>{row.symbol}</td>
                      <td>{(row.side || "long").toUpperCase()}</td>
                      <td className={profitLoss >= 0 ? "pnl-positive" : "pnl-negative"}>
                        {profitLoss.toFixed(2)}
                      </td>
                      <td>
                        <div className="category-control">
                          <span
                            className="category-dot"
                            style={{
                              backgroundColor:
                                categoryColors[
                                  categoryDrafts[row.id] || row.category || "API Imported"
                                ] || defaultCategoryColor(categoryDrafts[row.id] || row.category || "API Imported"),
                            }}
                          />
                          <select
                            value={categoryDrafts[row.id] || row.category || "API Imported"}
                            onChange={(e) =>
                              setCategoryDrafts((prev) => ({
                                ...prev,
                                [row.id]: e.target.value,
                              }))
                            }
                          >
                            {categoryOptions.map((cat) => (
                              <option key={cat} value={cat}>
                                {cat}
                              </option>
                            ))}
                          </select>
                        </div>
                      </td>
                    </tr>
                    <tr>
                      <td colSpan={5}>
                        <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                          <button
                            className="ghost small"
                            type="button"
                            disabled={busy}
                            onClick={() => updateTradeCategory(row.id)}
                          >
                            Save Category
                          </button>
                          <button
                            className="ghost danger small"
                            type="button"
                            disabled={busy}
                            onClick={() => removeTrade(row.id)}
                          >
                            Remove
                          </button>
                        </div>
                      </td>
                    </tr>
                  </Fragment>
                );
              })}

              {!trades.length ? (
                <tr>
                  <td colSpan={5}>No trades yet.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <style jsx>{`
        .journal-fit-wrap {
          overflow-x: visible;
        }

        .category-pill {
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }

        .category-dot {
          width: 10px;
          height: 10px;
          border-radius: 999px;
          border: 1px solid rgba(255, 255, 255, 0.35);
          flex: 0 0 auto;
        }

        .category-control {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          width: 100%;
        }

        .journal-fit-table {
          min-width: 0;
          width: 100%;
          table-layout: fixed;
        }

        .journal-fit-table th,
        .journal-fit-table td {
          white-space: normal;
          word-break: break-word;
          overflow-wrap: anywhere;
          padding: 6px 6px;
          font-size: 11px;
          line-height: 1.2;
          vertical-align: middle;
        }

        .journal-table-wrap {
          overflow-x: visible;
        }

        .journal-table {
          min-width: 0;
          width: 100%;
          table-layout: fixed;
        }

        .journal-table th,
        .journal-table td {
          white-space: normal;
          word-break: break-word;
          overflow-wrap: anywhere;
          padding: 6px 6px;
          font-size: 11px;
          line-height: 1.2;
          vertical-align: middle;
        }
      `}</style>
    </div>
  );
}
