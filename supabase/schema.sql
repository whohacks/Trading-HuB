-- Run this in Supabase SQL Editor

create extension if not exists "pgcrypto";

create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  exchange_api_key text,
  exchange_api_secret text,
  telegram_bot_token text,
  telegram_chat_id text,
  alerts_auto_sync boolean not null default true,
  trade_categories text[] not null default '{}',
  alert_source_api_url text,
  alert_source_api_token text,
  alert_source_auto_pull boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_settings
  add column if not exists trade_categories text[] not null default '{}';

alter table public.user_settings
  add column if not exists alert_source_api_url text;

alter table public.user_settings
  add column if not exists alert_source_api_token text;

alter table public.user_settings
  add column if not exists alert_source_auto_pull boolean not null default true;

create table if not exists public.alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  message text not null,
  severity text not null default 'medium' check (severity in ('low', 'medium', 'high')),
  alert_type text not null default 'text',
  symbol text,
  target_price numeric,
  trigger_direction text not null default 'above' check (trigger_direction in ('above', 'below')),
  frequency_seconds integer not null default 30,
  is_active boolean not null default true,
  last_checked_at timestamptz,
  triggered_at timestamptz,
  triggered_price numeric,
  sent_to_telegram boolean not null default false,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.alerts
  add column if not exists alert_type text not null default 'text';

alter table public.alerts
  add column if not exists symbol text;

alter table public.alerts
  add column if not exists target_price numeric;

alter table public.alerts
  add column if not exists trigger_direction text not null default 'above';

alter table public.alerts
  add column if not exists frequency_seconds integer not null default 30;

alter table public.alerts
  add column if not exists is_active boolean not null default true;

alter table public.alerts
  add column if not exists last_checked_at timestamptz;

alter table public.alerts
  add column if not exists triggered_at timestamptz;

alter table public.alerts
  add column if not exists triggered_price numeric;

create table if not exists public.trades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  symbol text not null,
  category text not null,
  side text not null default 'long' check (side in ('long', 'short')),
  entry_price numeric,
  exit_price numeric,
  quantity numeric,
  pnl numeric default 0,
  roi numeric,
  status text not null default 'open' check (status in ('open', 'closed')),
  notes text,
  source text not null default 'manual',
  external_ref text,
  opened_at timestamptz,
  closed_at timestamptz,
  synced boolean not null default false,
  synced_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.trades
  add column if not exists source text not null default 'manual';

alter table public.trades
  add column if not exists external_ref text;

alter table public.trades
  add column if not exists roi numeric;

create index if not exists idx_alerts_user_created on public.alerts(user_id, created_at desc);
create index if not exists idx_trades_user_created on public.trades(user_id, created_at desc);
create index if not exists idx_trades_user_status on public.trades(user_id, status);
create unique index if not exists idx_trades_user_source_external_ref
  on public.trades(user_id, source, external_ref)
  where external_ref is not null;

alter table public.user_settings enable row level security;
alter table public.alerts enable row level security;
alter table public.trades enable row level security;

create policy "user_settings_select_own" on public.user_settings
for select using (auth.uid() = user_id);

create policy "user_settings_insert_own" on public.user_settings
for insert with check (auth.uid() = user_id);

create policy "user_settings_update_own" on public.user_settings
for update using (auth.uid() = user_id);

create policy "alerts_select_own" on public.alerts
for select using (auth.uid() = user_id);

create policy "alerts_insert_own" on public.alerts
for insert with check (auth.uid() = user_id);

create policy "alerts_update_own" on public.alerts
for update using (auth.uid() = user_id);

create policy "alerts_delete_own" on public.alerts
for delete using (auth.uid() = user_id);

create policy "trades_select_own" on public.trades
for select using (auth.uid() = user_id);

create policy "trades_insert_own" on public.trades
for insert with check (auth.uid() = user_id);

create policy "trades_update_own" on public.trades
for update using (auth.uid() = user_id);

create policy "trades_delete_own" on public.trades
for delete using (auth.uid() = user_id);

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists user_settings_set_updated_at on public.user_settings;
create trigger user_settings_set_updated_at
before update on public.user_settings
for each row execute procedure public.set_updated_at();
