# Trade Execution Hub (Next.js + Supabase)

A full trading workflow web app with:
- Authentication (Supabase Auth)
- Smooth page transitions with client-side routing (no full refresh)
- Alerts page with manual + auto Telegram sync
- Alerts page with `Manual` mode and `API Auto Pull` mode (source URL/token configured in Settings)
- Journal page with trade categories and completed-trade sync
- Analytics page with daily/weekly/monthly win rate and gain
- Settings page to store exchange API keys and Telegram token/chat id
- Dashboard focused on Spot balance, Futures balance, Funding wallet, and running trades with live PnL

## 1) Supabase setup

Project:
- URL: your Supabase project URL
- Anon key: your Supabase anon key

Steps:
1. In Supabase dashboard, open **SQL Editor**.
2. Run `/Users/avatanshsharma/Documents/New project/hackathon/frontend/supabase/schema.sql`.
3. In **Authentication > Providers**, keep Email enabled.
4. In **Authentication > URL Configuration**, add your local URL:
   - `http://localhost:3000`

## 2) Frontend setup

```bash
cd /Users/avatanshsharma/Documents/New\ project/hackathon/frontend
cp .env.example .env.local
npm install
npm run dev
```

Open: [http://localhost:3000](http://localhost:3000)

## 2.1) Hybrid mode (Vercel frontend + local API)

If you deploy UI on Vercel and want API requests to hit your local/tunnel backend:

1. Expose your local backend (for example with ngrok/cloudflared).
2. Set this env in Vercel:
   - `NEXT_PUBLIC_API_BASE_URL=https://your-public-api-url`
3. On the backend server env, set:
   - `CORS_ORIGIN=https://your-vercel-domain.vercel.app`
   - `NEXT_PUBLIC_APP_URL=https://your-vercel-domain.vercel.app`
4. Redeploy frontend.

When `NEXT_PUBLIC_API_BASE_URL` is empty, frontend uses same-origin `/api/...` routes.

## 3) Telegram bot setup

1. Create a bot using [@BotFather](https://t.me/BotFather), copy bot token.
2. Send a message to your bot from your Telegram account/group.
3. Get `chat_id` by calling:
   - `https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates`
4. Save `telegram_bot_token` and `telegram_chat_id` in **Settings**.
5. Alerts page `Sync Now` or `Sync Unsynced Alerts` sends immediately.

## 4) Free Vercel auto alerts (no TradingView paid plan needed)

This app supports free automatic checks via Vercel Cron:
- Every minute Vercel calls `/api/alerts/cron`
- It checks active price alerts
- If target hits, it sends Telegram instantly and marks alert as triggered

Required Vercel env vars:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (from Supabase Project Settings > API)
- Optional hardening: `ALERTS_CRON_SECRET` (then call cron manually with `?key=...`)

Notes:
- Price source uses Binance first, then Bybit fallback (helps when Binance is region-restricted on Vercel).
- Keep Telegram bot token + chat id in app Settings (`user_settings`), per user.

## 5) TradingView webhook alerts (optional)

Use this for instant push alerts without local polling.

1. In Vercel env vars, add:
   - `TV_WEBHOOK_SECRET` (any strong random string)
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_CHAT_ID`
2. Redeploy Vercel.
3. In TradingView alert, enable **Webhook URL**:
   - `https://your-vercel-domain.vercel.app/api/tradingview/webhook`
4. Use alert message body like:

```json
{
  "secret": "YOUR_TV_WEBHOOK_SECRET",
  "symbol": "{{ticker}}",
  "price": "{{close}}",
  "time": "{{timenow}}",
  "signal": "BUY"
}
```

5. On trigger, webhook sends Telegram instantly.

## Notes
- Telegram sending is handled through authenticated backend API routes.
- TradingView webhook route is `/api/tradingview/webhook` and validates `TV_WEBHOOK_SECRET`.
- Free server auto alerts route is `/api/alerts/cron` (configured in `vercel.json`).
- Dashboard Binance panel reads Spot balances, Futures balances, Funding wallet, and Futures running positions (`/api/v3/account`, `/fapi/v2/balance`, `/sapi/v1/asset/get-funding-asset`, `/fapi/v2/positionRisk`).
- Your Binance API key should have `Enable Reading` permission.
- Binance and Telegram secrets are loaded from `user_settings` on server-side routes only.
