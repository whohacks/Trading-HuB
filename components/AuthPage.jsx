import { useState } from "react";
import { supabase } from "../lib/supabaseClient";

export default function AuthPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState("signin");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function onSubmit(event) {
    event.preventDefault();
    setLoading(true);
    setMessage("");

    const action =
      mode === "signin"
        ? supabase.auth.signInWithPassword({ email, password })
        : supabase.auth.signUp({ email, password });

    const { error } = await action;

    if (error) {
      setMessage(error.message);
    } else if (mode === "signup") {
      setMessage("Signup success. If email confirmation is enabled, verify your inbox.");
    } else {
      setMessage("Signed in successfully.");
    }

    setLoading(false);
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <p className="eyebrow">Trade Journal</p>
        <h2>{mode === "signin" ? "Sign in to Execution Hub" : "Create account"}</h2>
        <p style={{ marginBottom: 12 }}>
          Secure access to your dashboard, alerts, journal, and analytics.
        </p>

        <form onSubmit={onSubmit} className="form-grid">
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>

          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={6}
              required
            />
          </label>

          <button className="primary" type="submit" disabled={loading}>
            {loading ? "Please wait..." : mode === "signin" ? "Sign in" : "Sign up"}
          </button>
        </form>

        <button
          className="ghost"
          onClick={() => setMode((v) => (v === "signin" ? "signup" : "signin"))}
        >
          {mode === "signin"
            ? "Need an account? Sign up"
            : "Already have an account? Sign in"}
        </button>

        {message ? <p className="status-text">{message}</p> : null}
      </div>
    </div>
  );
}
