import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { LogOut } from "lucide-react";
import { supabase } from "../lib/supabaseClient";

const defaults = {
  exchange_api_key: "",
  exchange_api_secret: "",
  telegram_bot_token: "",
  telegram_chat_id: "",
  alerts_auto_sync: true,
};

export default function SettingsPage({ session }) {
  const router = useRouter();
  const [form, setForm] = useState(defaults);
  const [flags, setFlags] = useState({
    binanceConfigured: false,
    telegramConfigured: false,
  });
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  async function signOut() {
    await supabase.auth.signOut();
    router.push("/auth");
  }

  useEffect(() => {
    async function load() {
      const response = await fetch("/api/settings/flags", {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (!response.ok) {
        return;
      }

      const payload = await response.json();
      setFlags({
        binanceConfigured: Boolean(payload?.binanceConfigured),
        telegramConfigured: Boolean(payload?.telegramConfigured),
      });
      setForm((prev) => ({
        ...prev,
        alerts_auto_sync:
          typeof payload?.alertsAutoSync === "boolean"
            ? payload.alertsAutoSync
            : true,
      }));
    }

    load();
  }, [session.access_token]);

  async function save(event) {
    event.preventDefault();
    setBusy(true);
    setStatus("");

    const response = await fetch("/api/settings/update", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        exchange_api_key: form.exchange_api_key,
        exchange_api_secret: form.exchange_api_secret,
        telegram_bot_token: form.telegram_bot_token,
        telegram_chat_id: form.telegram_chat_id,
        alerts_auto_sync: form.alerts_auto_sync,
      }),
    });

    const payload = await response.json();
    if (!response.ok) {
      setStatus(payload?.error || "Failed to save settings.");
      setBusy(false);
      return;
    }

    setFlags({
      binanceConfigured: Boolean(payload?.binanceConfigured),
      telegramConfigured: Boolean(payload?.telegramConfigured),
    });
    setForm({
      exchange_api_key: "",
      exchange_api_secret: "",
      telegram_bot_token: "",
      telegram_chat_id: "",
      alerts_auto_sync: form.alerts_auto_sync,
    });
    setStatus("Settings saved securely.");

    setBusy(false);
  }

  return (
    <div className="stack">
      <section className="panel alert-hero">
        <p className="eyebrow">Settings</p>
        <h2>Settings</h2>
        <p>
          Add exchange API values and Telegram bot details. Secrets are now used
          only on protected server APIs.
        </p>
        <div className="grid cols-2 alert-kpis" style={{ marginTop: 12 }}>
          <article className="kpi-card">
            <p>Binance</p>
            <strong className={flags.binanceConfigured ? "kpi-value pnl-positive" : "kpi-value pnl-negative"}>
              {flags.binanceConfigured ? "Configured" : "Missing"}
            </strong>
          </article>
          <article className="kpi-card">
            <p>Telegram</p>
            <strong className={flags.telegramConfigured ? "kpi-value pnl-positive" : "kpi-value pnl-negative"}>
              {flags.telegramConfigured ? "Configured" : "Missing"}
            </strong>
          </article>
        </div>

        <form className="form-grid" onSubmit={save}>
          <label>
            Exchange API Key
            <input
              type="password"
              value={form.exchange_api_key}
              onChange={(e) =>
                setForm((s) => ({ ...s, exchange_api_key: e.target.value }))
              }
              placeholder={flags.binanceConfigured ? "Configured (enter new to replace)" : ""}
            />
          </label>

          <label>
            Exchange API Secret
            <input
              type="password"
              value={form.exchange_api_secret}
              onChange={(e) =>
                setForm((s) => ({ ...s, exchange_api_secret: e.target.value }))
              }
              placeholder={flags.binanceConfigured ? "Configured (enter new to replace)" : ""}
            />
          </label>

          <label>
            Telegram Bot Token
            <input
              type="password"
              value={form.telegram_bot_token}
              onChange={(e) =>
                setForm((s) => ({ ...s, telegram_bot_token: e.target.value }))
              }
              placeholder={flags.telegramConfigured ? "Configured (enter new to replace)" : "123456:ABC-DEF..."}
            />
          </label>

          <label>
            Telegram Chat ID
            <input
              value={form.telegram_chat_id}
              onChange={(e) =>
                setForm((s) => ({ ...s, telegram_chat_id: e.target.value }))
              }
              placeholder="-1001234567890"
            />
          </label>

          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={form.alerts_auto_sync}
              onChange={(e) =>
                setForm((s) => ({ ...s, alerts_auto_sync: e.target.checked }))
              }
            />
            Enable auto-sync for manual text alerts
          </label>

          <div className="row">
            <button className="primary" type="submit" disabled={busy}>
              Save Settings
            </button>
          </div>
        </form>

        {status ? <p className="status-text">{status}</p> : null}
      </section>

      <section className="panel">
        <h3>Account</h3>
        <p className="muted-note">Signed in as {session.user?.email}</p>
        <div className="row" style={{ marginTop: 10 }}>
          <button className="ghost danger" type="button" onClick={signOut}>
            <LogOut size={16} /> Sign out
          </button>
        </div>
      </section>
    </div>
  );
}
