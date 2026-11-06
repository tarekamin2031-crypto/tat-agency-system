-- ============================================================
-- TAT Agency System — Database Schema
-- Modules: Users/Auth, Clients, Invoices & Expenses, Collection Center
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
    id            SERIAL PRIMARY KEY,
    name          VARCHAR(150) NOT NULL,
    email         VARCHAR(150) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role          VARCHAR(20) NOT NULL DEFAULT 'member', -- 'admin' | 'member'
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS clients (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(200) NOT NULL,
    industry        VARCHAR(150),
    country         VARCHAR(100),
    contact_name    VARCHAR(150),
    contact_phone   VARCHAR(50),
    contact_email   VARCHAR(150),
    contract_start  DATE,
    contract_end    DATE,
    contract_value  NUMERIC(14,2) DEFAULT 0,
    currency        VARCHAR(10) DEFAULT 'SAR',
    contract_status VARCHAR(20) DEFAULT 'active', -- active | paused | ended
    renewal_cycle   VARCHAR(20) DEFAULT 'monthly', -- monthly | quarterly | yearly | once
    notes           TEXT,
    created_by      INTEGER REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invoices (
    id           SERIAL PRIMARY KEY,
    client_id    INTEGER REFERENCES clients(id) ON DELETE SET NULL,
    number       VARCHAR(30) NOT NULL,
    description  TEXT,
    amount       NUMERIC(14,2) NOT NULL DEFAULT 0,
    currency     VARCHAR(10) NOT NULL DEFAULT 'SAR',
    issue_date   DATE NOT NULL DEFAULT CURRENT_DATE,
    due_date     DATE,
    status       VARCHAR(20) NOT NULL DEFAULT 'draft', -- draft | sent | paid | overdue
    created_by   INTEGER REFERENCES users(id),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS expenses (
    id          SERIAL PRIMARY KEY,
    category    VARCHAR(100) NOT NULL,
    description TEXT,
    amount      NUMERIC(14,2) NOT NULL DEFAULT 0,
    currency    VARCHAR(10) NOT NULL DEFAULT 'SAR',
    date        DATE NOT NULL DEFAULT CURRENT_DATE,
    created_by  INTEGER REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Collection Center: accounts-receivable tracking per client
CREATE TABLE IF NOT EXISTS collection_entries (
    id                       SERIAL PRIMARY KEY,
    client_id                INTEGER REFERENCES clients(id) ON DELETE SET NULL,
    company_name             VARCHAR(200),
    service                  VARCHAR(200),
    expected_amount          NUMERIC(14,2) NOT NULL DEFAULT 0,
    amount_paid              NUMERIC(14,2) NOT NULL DEFAULT 0,
    currency                 VARCHAR(10) NOT NULL DEFAULT 'SAR',
    due_date                 DATE,
    account_manager_id       INTEGER REFERENCES users(id),
    follow_up_status         VARCHAR(30) NOT NULL DEFAULT 'not_contacted',
    last_follow_up_date      DATE,
    next_follow_up_date      DATE,
    last_communication_notes TEXT,
    created_by               INTEGER REFERENCES users(id),
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS collection_follow_ups (
    id                   SERIAL PRIMARY KEY,
    collection_entry_id  INTEGER NOT NULL REFERENCES collection_entries(id) ON DELETE CASCADE,
    date                 DATE NOT NULL DEFAULT CURRENT_DATE,
    method               VARCHAR(30), -- whatsapp | phone | email | meeting | other
    employee_id          INTEGER REFERENCES users(id),
    client_response      TEXT,
    notes                TEXT,
    next_follow_up_date  DATE,
    payment_amount       NUMERIC(14,2),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS collection_timeline (
    id                   SERIAL PRIMARY KEY,
    collection_entry_id  INTEGER NOT NULL REFERENCES collection_entries(id) ON DELETE CASCADE,
    date                 DATE NOT NULL DEFAULT CURRENT_DATE,
    label                VARCHAR(200) NOT NULL,
    note                 TEXT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invoices_client ON invoices(client_id);
CREATE INDEX IF NOT EXISTS idx_collection_client ON collection_entries(client_id);
CREATE INDEX IF NOT EXISTS idx_followups_entry ON collection_follow_ups(collection_entry_id);
CREATE INDEX IF NOT EXISTS idx_timeline_entry ON collection_timeline(collection_entry_id);

-- ============================================================
-- Additive migrations (safe to re-run on an existing database —
-- migrate.js re-applies this whole file on every backend startup)
-- ============================================================

-- Support for automatic monthly invoice generation
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS is_auto_generated BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS for_month DATE;
CREATE INDEX IF NOT EXISTS idx_invoices_client_for_month ON invoices(client_id, for_month);

-- The agency now operates in EGP only — update defaults for new rows.
-- (Existing rows keep whatever currency they already have.)
ALTER TABLE clients ALTER COLUMN currency SET DEFAULT 'EGP';
ALTER TABLE invoices ALTER COLUMN currency SET DEFAULT 'EGP';
ALTER TABLE expenses ALTER COLUMN currency SET DEFAULT 'EGP';
ALTER TABLE collection_entries ALTER COLUMN currency SET DEFAULT 'EGP';

-- Client ad-budget tracking: client sends an ad budget, the agency keeps
-- a commission (default 20%) and the rest goes into the ad account.
CREATE TABLE IF NOT EXISTS ad_budgets (
    id                 SERIAL PRIMARY KEY,
    client_id          INTEGER REFERENCES clients(id) ON DELETE SET NULL,
    platform           VARCHAR(50) DEFAULT 'meta', -- meta | google | tiktok | snapchat | other
    amount_received    NUMERIC(14,2) NOT NULL DEFAULT 0,
    currency           VARCHAR(10) NOT NULL DEFAULT 'EGP',
    commission_rate    NUMERIC(5,2) NOT NULL DEFAULT 20,
    commission_amount  NUMERIC(14,2) GENERATED ALWAYS AS (ROUND(amount_received * commission_rate / 100, 2)) STORED,
    net_ad_amount      NUMERIC(14,2) GENERATED ALWAYS AS (amount_received - ROUND(amount_received * commission_rate / 100, 2)) STORED,
    received_date      DATE NOT NULL DEFAULT CURRENT_DATE,
    notes              TEXT,
    created_by         INTEGER REFERENCES users(id),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ad_budgets_client ON ad_budgets(client_id);

-- ============================================================
-- Phase 4: Client Status + Services (mirrors what was manually
-- applied to production via psql — kept here so schema.sql stays
-- the single source of truth and fresh deployments match prod)
-- ============================================================

ALTER TABLE clients ADD COLUMN IF NOT EXISTS status VARCHAR(20);

UPDATE clients SET status = CASE
  WHEN contract_status = 'active' AND (contract_end IS NULL OR contract_end >= CURRENT_DATE) THEN 'Active'
  WHEN contract_status = 'active' AND contract_end < CURRENT_DATE THEN 'Expired'
  WHEN contract_status = 'paused' THEN 'Suspended'
  WHEN contract_status = 'ended' THEN 'Stopped'
  ELSE 'Active'
END
WHERE status IS NULL;

ALTER TABLE clients ALTER COLUMN status SET DEFAULT 'Active';
CREATE INDEX IF NOT EXISTS idx_clients_status ON clients(status);
CREATE INDEX IF NOT EXISTS idx_clients_contract_end ON clients(contract_end);

CREATE TABLE IF NOT EXISTS services (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(150) NOT NULL UNIQUE,
    description TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- (Fresh databases only: once services are per-agency, defaults are seeded per
-- agency by the application — see backend/src/lib/agencySeed.js.)
DO $seed$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'services' AND column_name = 'agency_id') THEN
    INSERT INTO services (name) VALUES
      ('إدارة سوشيال ميديا'),
      ('إعلانات ميتا (فيسبوك/انستجرام)'),
      ('إعلانات جوجل'),
      ('إنشاء محتوى'),
      ('تصميم جرافيك'),
      ('إنتاج فيديو'),
      ('استشارات تسويقية'),
      ('إعلانات سناب شات'),
      ('إعلانات تيك توك'),
      ('إعلانات لينكدإن'),
      ('إعلانات منصة إكس')
    ON CONFLICT (name) DO NOTHING;
  END IF;
END $seed$;

CREATE TABLE IF NOT EXISTS client_services (
    id         SERIAL PRIMARY KEY,
    client_id  INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    UNIQUE(client_id, service_id)
);

-- Optional service association on expenses/invoices, for service-level analytics
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS related_client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS related_service_id INTEGER REFERENCES services(id) ON DELETE SET NULL;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS service_id INTEGER REFERENCES services(id) ON DELETE SET NULL;

-- ============================================================
-- Bug fix: `status` (Active/Suspended/Stopped/Expired) could get out of
-- sync with `contract_status` (active/paused/ended) if a client's contract
-- status was edited before the clients.js sync fix shipped. This re-syncs
-- every client's `status` from its CURRENT contract_status + contract_end.
-- Safe to re-run any time — pure recomputation, no data loss.
-- ============================================================
UPDATE clients SET status = CASE
  WHEN contract_status = 'paused' THEN 'Suspended'
  WHEN contract_status = 'ended' THEN 'Stopped'
  WHEN contract_status = 'active' AND contract_end IS NOT NULL AND contract_end < CURRENT_DATE THEN 'Expired'
  ELSE 'Active'
END;

-- ============================================================
-- Phase 6: Financial System (cash-basis Net Profit)
-- Adds explicit paid-amount tracking on invoices so Revenue,
-- Cash Collected, and Outstanding Balance are never conflated.
-- ============================================================

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS paid_amount NUMERIC(14,2) NOT NULL DEFAULT 0;

-- One-time backfill: invoices already marked 'paid' are treated as
-- fully collected. Safe to re-run — only touches rows still at 0.
UPDATE invoices SET paid_amount = amount WHERE status = 'paid' AND paid_amount = 0;

-- ============================================================
-- Phase 7: Expense Management (name/notes separation + categories)
-- ============================================================

ALTER TABLE expenses ADD COLUMN IF NOT EXISTS name VARCHAR(200);
UPDATE expenses SET name = description WHERE name IS NULL AND description IS NOT NULL;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS notes TEXT;

-- CEO personal expenses (owner's draw) — tracked separately, excluded from
-- the company's official Net Profit calculation.
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS expense_type VARCHAR(20) NOT NULL DEFAULT 'business';
-- allowed values: 'business' | 'personal'

-- ============================================================
-- Employee salary screenshots — stored in the database itself
-- (not on disk) so they're captured by the regular pg_dump backup
-- with no extra Docker volume or file-storage setup needed.
-- ============================================================
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS screenshot_data BYTEA;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS screenshot_mime VARCHAR(50);

-- ============================================================
-- Link Collection Center entries to a specific Invoice (optional).
-- When linked, the invoice becomes the single source of truth for the
-- amount and payment status — Payment Center and Collection Center can
-- never show conflicting numbers for the same money. Entries with no
-- invoice_id keep working exactly as before (ad-hoc follow-up tracking
-- not tied to a specific invoice).
-- ============================================================
ALTER TABLE collection_entries ADD COLUMN IF NOT EXISTS invoice_id INTEGER REFERENCES invoices(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_collection_invoice ON collection_entries(invoice_id);

-- ============================================================
-- Payment receipt attachment (image or PDF) per invoice — stored in the
-- database itself, same approach as the salary screenshots, so it's
-- captured by the regular pg_dump backup with no extra file storage.
-- ============================================================
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS receipt_data BYTEA;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS receipt_mime VARCHAR(50);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS receipt_filename VARCHAR(255);

-- ============================================================
-- CEO Personal Expenses — reclassification safety net.
-- `expenses.expense_type` ('business'|'personal') has been the source of
-- truth since the CEO-expenses feature shipped. This catches any OLDER
-- rows that were only ever tagged via free-text category/name (e.g.
-- "شخصي (CEO)") without the expense_type toggle being used — reclassifies
-- them as personal so they show up correctly in the new dedicated tab.
-- Pure UPDATE, no rows added/removed, amounts/dates/IDs untouched. Safe
-- to re-run — only touches rows still marked 'business' that look personal.
-- ============================================================
UPDATE expenses SET expense_type = 'personal'
WHERE expense_type = 'business'
  AND (
    category ILIKE '%شخص%' OR category ILIKE '%CEO%' OR
    name ILIKE '%شخص%' OR name ILIKE '%CEO%' OR
    description ILIKE '%شخص%' OR description ILIKE '%CEO%'
  );

-- Fields required by the CEO Personal Expenses tab (payment method + an
-- updated_at audit column) — additive on the existing expenses table,
-- reused by company expenses too rather than creating a parallel table.
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS payment_method VARCHAR(50);
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;







-- ============================================================
-- Team management: soft-disable users instead of deleting them
-- (their id is referenced by invoices/expenses/collection rows).
-- Additive + safe to re-run; existing users stay active.
-- ============================================================
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

-- ============================================================
-- User settings + company settings (all additive / safe to re-run)
-- ============================================================
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(50);
ALTER TABLE users ADD COLUMN IF NOT EXISTS preferences JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_data BYTEA;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_mime VARCHAR(50);
-- Bumped on password change / "sign out everywhere": tokens carry the version
-- they were issued with, so older tokens stop working immediately.
ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS prev_login_at TIMESTAMPTZ;

-- Single-row table (id is always 1) holding the agency's own details.
CREATE TABLE IF NOT EXISTS company_settings (
    id                      INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    name                    VARCHAR(200) NOT NULL DEFAULT 'TAT Agency',
    tagline                 VARCHAR(200) NOT NULL DEFAULT 'Social Media Agency',
    email                   VARCHAR(150),
    phone                   VARCHAR(50),
    address                 TEXT,
    tax_number              VARCHAR(80),
    logo_data               BYTEA,
    logo_mime               VARCHAR(50),
    default_commission_rate NUMERIC(5,2) NOT NULL DEFAULT 20,
    invoice_prefix          VARCHAR(10) NOT NULL DEFAULT 'INV',
    invoice_footer          TEXT,
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
DO $seed$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'company_settings' AND column_name = 'agency_id') THEN
    INSERT INTO company_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
  END IF;
END $seed$;

-- ============================================================
-- PHASE 1 — Multi-agency (SaaS), roles & permissions, audit log
-- Additive + idempotent. Existing data becomes agency #1.
-- ============================================================
CREATE TABLE IF NOT EXISTS agencies (
    id               SERIAL PRIMARY KEY,
    name             VARCHAR(200) NOT NULL,
    slug             VARCHAR(80) UNIQUE,
    is_active        BOOLEAN NOT NULL DEFAULT true,
    max_users        INTEGER NOT NULL DEFAULT 10,
    default_language VARCHAR(5) NOT NULL DEFAULT 'ar',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO agencies (id, name, slug) VALUES (1, 'TAT Agency', 'tat') ON CONFLICT (id) DO NOTHING;
SELECT setval(pg_get_serial_sequence('agencies', 'id'), GREATEST((SELECT MAX(id) FROM agencies), 1));

ALTER TABLE users            ADD COLUMN IF NOT EXISTS agency_id INTEGER REFERENCES agencies(id) ON DELETE CASCADE;
ALTER TABLE clients          ADD COLUMN IF NOT EXISTS agency_id INTEGER REFERENCES agencies(id) ON DELETE CASCADE;
ALTER TABLE invoices         ADD COLUMN IF NOT EXISTS agency_id INTEGER REFERENCES agencies(id) ON DELETE CASCADE;
ALTER TABLE expenses         ADD COLUMN IF NOT EXISTS agency_id INTEGER REFERENCES agencies(id) ON DELETE CASCADE;
ALTER TABLE collection_entries ADD COLUMN IF NOT EXISTS agency_id INTEGER REFERENCES agencies(id) ON DELETE CASCADE;
ALTER TABLE ad_budgets       ADD COLUMN IF NOT EXISTS agency_id INTEGER REFERENCES agencies(id) ON DELETE CASCADE;
ALTER TABLE services         ADD COLUMN IF NOT EXISTS agency_id INTEGER REFERENCES agencies(id) ON DELETE CASCADE;
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS agency_id INTEGER REFERENCES agencies(id) ON DELETE CASCADE;

UPDATE users              SET agency_id = 1 WHERE agency_id IS NULL;
UPDATE clients            SET agency_id = 1 WHERE agency_id IS NULL;
UPDATE invoices           SET agency_id = 1 WHERE agency_id IS NULL;
UPDATE expenses           SET agency_id = 1 WHERE agency_id IS NULL;
UPDATE collection_entries SET agency_id = 1 WHERE agency_id IS NULL;
UPDATE ad_budgets         SET agency_id = 1 WHERE agency_id IS NULL;
UPDATE services           SET agency_id = 1 WHERE agency_id IS NULL;
UPDATE company_settings   SET agency_id = 1 WHERE agency_id IS NULL;

-- users.agency_id stays nullable (platform owners may belong to no agency).
ALTER TABLE clients            ALTER COLUMN agency_id SET NOT NULL;
ALTER TABLE invoices           ALTER COLUMN agency_id SET NOT NULL;
ALTER TABLE expenses           ALTER COLUMN agency_id SET NOT NULL;
ALTER TABLE collection_entries ALTER COLUMN agency_id SET NOT NULL;
ALTER TABLE ad_budgets         ALTER COLUMN agency_id SET NOT NULL;
ALTER TABLE services           ALTER COLUMN agency_id SET NOT NULL;
ALTER TABLE company_settings   ALTER COLUMN agency_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_agency      ON users(agency_id);
CREATE INDEX IF NOT EXISTS idx_clients_agency    ON clients(agency_id);
CREATE INDEX IF NOT EXISTS idx_invoices_agency   ON invoices(agency_id);
CREATE INDEX IF NOT EXISTS idx_expenses_agency   ON expenses(agency_id);
CREATE INDEX IF NOT EXISTS idx_collection_agency ON collection_entries(agency_id);
CREATE INDEX IF NOT EXISTS idx_ad_budgets_agency ON ad_budgets(agency_id);
CREATE INDEX IF NOT EXISTS idx_services_agency   ON services(agency_id);

-- Service names are unique per agency (not globally).
ALTER TABLE services DROP CONSTRAINT IF EXISTS services_name_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_services_agency_name ON services(agency_id, name);

-- Company settings: one row per agency.
ALTER TABLE company_settings DROP CONSTRAINT IF EXISTS company_settings_id_check;
CREATE SEQUENCE IF NOT EXISTS company_settings_id_seq;
SELECT setval('company_settings_id_seq', GREATEST((SELECT COALESCE(MAX(id), 1) FROM company_settings), 1));
ALTER TABLE company_settings ALTER COLUMN id SET DEFAULT nextval('company_settings_id_seq');
CREATE UNIQUE INDEX IF NOT EXISTS uq_company_settings_agency ON company_settings(agency_id);
INSERT INTO company_settings (agency_id) SELECT a.id FROM agencies a WHERE NOT EXISTS (SELECT 1 FROM company_settings c WHERE c.agency_id = a.id);

-- Roles (permissions stored as {module: [actions]}), assigned per user.
CREATE TABLE IF NOT EXISTS roles (
    id          SERIAL PRIMARY KEY,
    agency_id   INTEGER NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
    key         VARCHAR(50) NOT NULL,
    name        VARCHAR(100) NOT NULL,
    description TEXT,
    is_system   BOOLEAN NOT NULL DEFAULT false,
    permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (agency_id, key)
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS role_id INTEGER REFERENCES roles(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_platform_admin BOOLEAN NOT NULL DEFAULT false;

-- Audit log: who did what, with before/after snapshots.
CREATE TABLE IF NOT EXISTS audit_logs (
    id          BIGSERIAL PRIMARY KEY,
    agency_id   INTEGER REFERENCES agencies(id) ON DELETE SET NULL,
    user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    user_name   VARCHAR(150),
    user_email  VARCHAR(150),
    action      VARCHAR(60) NOT NULL,
    entity      VARCHAR(60),
    entity_id   VARCHAR(60),
    summary     TEXT,
    before_data JSONB,
    after_data  JSONB,
    ip          VARCHAR(64),
    user_agent  VARCHAR(300),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_agency_time ON audit_logs(agency_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_user_time   ON audit_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_entity      ON audit_logs(entity, entity_id);

-- ============================================================
-- PHASE 3: email, password reset, webhooks (additive / safe to re-run)
-- ============================================================

-- SMTP settings. agency_id NULL = the platform-wide default; an agency row overrides it.
CREATE TABLE IF NOT EXISTS email_settings (
    id             SERIAL PRIMARY KEY,
    agency_id      INTEGER REFERENCES agencies(id) ON DELETE CASCADE,
    enabled        BOOLEAN NOT NULL DEFAULT false,
    host           VARCHAR(200),
    port           INTEGER NOT NULL DEFAULT 587,
    secure         BOOLEAN NOT NULL DEFAULT false,
    username       VARCHAR(200),
    password_enc   TEXT,
    from_name      VARCHAR(150),
    from_email     VARCHAR(200),
    reply_to       VARCHAR(200),
    notify_payment BOOLEAN NOT NULL DEFAULT false,
    notify_overdue BOOLEAN NOT NULL DEFAULT false,
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_email_settings_agency ON email_settings ((COALESCE(agency_id, 0)));

-- Every email the system tries to send (also the retry queue).
CREATE TABLE IF NOT EXISTS email_log (
    id              BIGSERIAL PRIMARY KEY,
    agency_id       INTEGER REFERENCES agencies(id) ON DELETE SET NULL,
    to_email        VARCHAR(200) NOT NULL,
    subject         VARCHAR(300) NOT NULL,
    template        VARCHAR(50),
    lang            VARCHAR(5),
    body_html       TEXT,
    body_text       TEXT,
    status          VARCHAR(10) NOT NULL DEFAULT 'queued',   -- queued | sent | failed
    attempts        INTEGER NOT NULL DEFAULT 0,
    error           TEXT,
    next_attempt_at TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    sent_at         TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_email_log_agency ON email_log(agency_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_log_queue  ON email_log(status, next_attempt_at);

-- One-time password reset / invite links (only a hash of the token is stored).
CREATE TABLE IF NOT EXISTS password_resets (
    id         SERIAL PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at    TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Outbound webhooks (per agency) and their delivery log / retry queue.
CREATE TABLE IF NOT EXISTS webhook_endpoints (
    id          SERIAL PRIMARY KEY,
    agency_id   INTEGER NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
    url         TEXT NOT NULL,
    description VARCHAR(200),
    secret      VARCHAR(100) NOT NULL,
    events      TEXT[] NOT NULL DEFAULT '{}',
    is_active   BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_webhook_endpoints_agency ON webhook_endpoints(agency_id);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
    id              BIGSERIAL PRIMARY KEY,
    endpoint_id     INTEGER NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
    agency_id       INTEGER NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
    event           VARCHAR(60) NOT NULL,
    payload         JSONB NOT NULL,
    status          VARCHAR(10) NOT NULL DEFAULT 'pending',   -- pending | success | failed
    attempts        INTEGER NOT NULL DEFAULT 0,
    response_status INTEGER,
    response_body   TEXT,
    error           TEXT,
    next_attempt_at TIMESTAMPTZ DEFAULT now(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    delivered_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_queue    ON webhook_deliveries(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_endpoint ON webhook_deliveries(endpoint_id, created_at DESC);

-- "Already announced" markers so daily jobs (overdue / renewal) fire once per entity.
CREATE TABLE IF NOT EXISTS event_marks (
    agency_id  INTEGER NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
    key        VARCHAR(120) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (agency_id, key)
);

-- Webhooks: GET/POST, optional message template, and a "kind" so the UI can re-open presets (e.g. Telegram).
ALTER TABLE webhook_endpoints ADD COLUMN IF NOT EXISTS method VARCHAR(4) NOT NULL DEFAULT 'POST';
ALTER TABLE webhook_endpoints ADD COLUMN IF NOT EXISTS message_template TEXT;
ALTER TABLE webhook_endpoints ADD COLUMN IF NOT EXISTS kind VARCHAR(12) NOT NULL DEFAULT 'custom';

-- Marketing site: contact / demo requests from the public landing page.
CREATE TABLE IF NOT EXISTS leads (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(150) NOT NULL,
    email       VARCHAR(200) NOT NULL,
    phone       VARCHAR(50),
    company     VARCHAR(200),
    team_size   VARCHAR(30),
    interest    VARCHAR(30),
    message     TEXT,
    lang        VARCHAR(5),
    status      VARCHAR(12) NOT NULL DEFAULT 'new',   -- new | contacted | closed
    notes       TEXT,
    ip          VARCHAR(64),
    user_agent  VARCHAR(300),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_leads_status_time ON leads(status, created_at DESC);
