const { Pool } = require("pg");

// Hosted Postgres (Neon, Supabase, Railway, Render…) usually gives one DATABASE_URL and requires TLS.
//   DATABASE_URL=postgres://user:pass@host:5432/db     DB_SSL=true
// Without DATABASE_URL the individual DB_* variables (Docker compose) are used, as before.
// TLS is verified by default; DB_SSL_INSECURE=true skips certificate verification (only for self-signed hosts).
const ssl = process.env.DB_SSL === "true" ? { rejectUnauthorized: process.env.DB_SSL_INSECURE !== "true" } : undefined;

const pool = new Pool(
  process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL, ssl, max: Number(process.env.DB_POOL_MAX || (process.env.VERCEL ? 3 : 10)) }
    : {
        host: process.env.DB_HOST || "db",
        port: process.env.DB_PORT || 5432,
        user: process.env.DB_USER || "tat_user",
        password: process.env.DB_PASSWORD || "tat_password",
        database: process.env.DB_NAME || "tat_agency",
        ssl,
      }
);

module.exports = pool;
