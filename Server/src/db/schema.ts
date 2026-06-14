import type { Pool } from 'pg'

export const ensureSchema = async (pool: Pool) => {
  await pool.query(`
    create table if not exists users (
      id text primary key,
      email text not null unique,
      username text not null unique,
      password_hash text not null,
      role text not null,
      created_at timestamptz not null default now()
    );

    create table if not exists sessions (
      id text primary key,
      user_id text not null references users(id) on delete cascade,
      token_hash text not null unique,
      expires_at timestamptz not null,
      created_at timestamptz not null default now()
    );

    create table if not exists instruments (
      symbol text primary key,
      company_name text not null,
      exchange text not null,
      instrument_key text not null unique,
      metadata jsonb not null default '{}'::jsonb,
      updated_at timestamptz not null default now()
    );

    create table if not exists watchlists (
      id text primary key,
      user_id text not null references users(id) on delete cascade,
      name text not null,
      is_default boolean not null default false,
      created_at timestamptz not null default now(),
      unique (user_id, name)
    );

    create table if not exists watchlist_items (
      id text primary key,
      watchlist_id text not null references watchlists(id) on delete cascade,
      symbol text not null references instruments(symbol) on delete cascade,
      sort_order integer not null,
      created_at timestamptz not null default now(),
      unique (watchlist_id, symbol)
    );

    create table if not exists portfolio_transactions (
      id text primary key,
      user_id text not null references users(id) on delete cascade,
      symbol text not null,
      side text not null,
      quantity numeric(18, 4) not null,
      price numeric(18, 4) not null,
      traded_at timestamptz not null,
      metadata jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now()
    );

    create table if not exists risk_flags (
      id text primary key,
      symbol text not null,
      company_name text not null,
      type text not null,
      detail text not null,
      since_label text not null,
      severity text not null,
      status text not null,
      metadata jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now()
    );

    create table if not exists app_settings (
      key text primary key,
      value jsonb not null,
      updated_at timestamptz not null default now()
    );

    create table if not exists broker_credentials (
      provider text primary key,
      access_token text not null,
      expires_at timestamptz,
      metadata jsonb not null default '{}'::jsonb,
      updated_at timestamptz not null default now()
    );

    create table if not exists market_ticks (
      id bigserial primary key,
      symbol text not null references instruments(symbol) on delete cascade,
      price numeric(18, 6) not null,
      volume numeric(18, 4),
      recorded_at timestamptz not null,
      payload jsonb,
      created_at timestamptz not null default now()
    );

    create table if not exists market_candles (
      id bigserial primary key,
      symbol text not null references instruments(symbol) on delete cascade,
      interval text not null,
      bucket_start timestamptz not null,
      first_trade_at timestamptz not null,
      last_trade_at timestamptz not null,
      open numeric(18, 6) not null,
      high numeric(18, 6) not null,
      low numeric(18, 6) not null,
      close numeric(18, 6) not null,
      volume numeric(18, 4) not null default 0,
      source text not null default 'broker',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (symbol, interval, bucket_start)
    );

    create index if not exists idx_sessions_user_id on sessions(user_id);
    create index if not exists idx_sessions_expires_at on sessions(expires_at);
    create index if not exists idx_watchlists_user_id on watchlists(user_id);
    create index if not exists idx_watchlist_items_watchlist_id on watchlist_items(watchlist_id, sort_order);
    create index if not exists idx_portfolio_transactions_user_id on portfolio_transactions(user_id, traded_at desc);
    create index if not exists idx_risk_flags_symbol on risk_flags(symbol);
    create index if not exists idx_market_ticks_symbol_recorded_at on market_ticks(symbol, recorded_at desc);
    create index if not exists idx_market_candles_symbol_interval_bucket on market_candles(symbol, interval, bucket_start desc);
  `)

  await pool.query(`
    alter table users add column if not exists display_name text;
    alter table users add column if not exists is_active boolean not null default true;
    alter table users add column if not exists updated_at timestamptz not null default now();
    alter table market_candles add column if not exists source text not null default 'broker';
    alter table market_candles add column if not exists created_at timestamptz not null default now();
    alter table market_candles add column if not exists updated_at timestamptz not null default now();

    create table if not exists audit_logs (
      id text primary key,
      actor_user_id text references users(id) on delete set null,
      action text not null,
      entity_type text not null,
      entity_id text,
      payload jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now()
    );

    create index if not exists idx_audit_logs_actor on audit_logs(actor_user_id, created_at desc);
    create index if not exists idx_audit_logs_entity on audit_logs(entity_type, entity_id, created_at desc);
  `)
}

export const purgeExpiredSessions = async (pool: Pool) => {
  await pool.query('delete from sessions where expires_at <= now()')
}

export const purgeMarketHistory = async (pool: Pool, retentionDays: number) => {
  await pool.query(
    `
      delete from market_ticks
      where recorded_at < now() - ($1::text || ' days')::interval
    `,
    [retentionDays],
  )
}

export const purgeStoredCandles = async (pool: Pool, retentionDays: number) => {
  await pool.query(
    `
      delete from market_candles
      where bucket_start < now() - ($1::text || ' days')::interval
    `,
    [retentionDays],
  )
}
