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

## 3) Telegram bot setup

1. Create a bot using [@BotFather](https://t.me/BotFather), copy bot token.
2. Send a message to your bot from your Telegram account/group.
3. Get `chat_id` by calling:
   - `https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates`
4. Save `telegram_bot_token` and `telegram_chat_id` in **Settings**.
5. Alerts page `Sync Now` or `Sync Unsynced Alerts` sends immediately.

## Notes
- Telegram sending is handled through authenticated backend API routes.
- Dashboard Binance panel reads Spot balances, Futures balances, Funding wallet, and Futures running positions (`/api/v3/account`, `/fapi/v2/balance`, `/sapi/v1/asset/get-funding-asset`, `/fapi/v2/positionRisk`).
- Your Binance API key should have `Enable Reading` permission.
- Binance and Telegram secrets are loaded from `user_settings` on server-side routes only.
