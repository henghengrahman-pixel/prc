import express from "express";
import multer from "multer";
import pg from "pg";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;

// ====== ENV (set in Railway Variables) ======
const DATABASE_URL = process.env.DATABASE_URL;              // Railway Postgres plugin provides this
const ADMIN_PASSWORD = (process.env.ADMIN_PASSWORD || "").trim(); // set your admin password
const ADMIN_TOKEN_TTL_MIN = parseInt(process.env.ADMIN_TOKEN_TTL_MIN || "120", 10);

if (!DATABASE_URL) {
  console.error("Missing DATABASE_URL. Add Railway Postgres plugin and set DATABASE_URL.");
}
if (!ADMIN_PASSWORD) {
  console.warn("ADMIN_PASSWORD is empty. Set ADMIN_PASSWORD in Railway Variables.");
}

// ====== DB ======
const { Pool } = pg;
const pool = new Pool({
  connectionString: DATABASE_URL,
  // Railway Postgres usually requires SSL. This keeps it compatible.
  ssl: process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: false },
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS site_images (
      name TEXT PRIMARY KEY,
      content_type TEXT NOT NULL,
      data BYTEA NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS site_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

// ====== Auth (simple token in memory) ======
const tokenStore = new Map(); // token -> expiresAt (ms)

function issueToken() {
  const token = crypto.randomBytes(24).toString("hex");
  const expiresAt = Date.now() + ADMIN_TOKEN_TTL_MIN * 60 * 1000;
  tokenStore.set(token, expiresAt);
  return { token, expiresAt };
}

function isTokenValid(token) {
  if (!token) return false;
  const exp = tokenStore.get(token);
  if (!exp) return false;
  if (Date.now() > exp) {
    tokenStore.delete(token);
    return false;
  }
  return true;
}

function requireAdmin(req, res, next) {
  const token = req.get("x-admin-token");
  if (!isTokenValid(token)) return res.status(401).json({ error: "Unauthorized" });
  next();
}

// ====== App ======
const app = express();
app.use(express.json({ limit: "2mb" })); // settings payloads only
app.use(express.static(path.join(__dirname, "public")));

// Upload handler (stores binary in DB)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB per image
});

// ====== Public APIs ======
app.get("/api/settings", async (req, res) => {
  try {
    const r = await pool.query(`SELECT key, value FROM site_settings`);
    const out = {};
    for (const row of r.rows) out[row.key] = row.value;
    res.json(out);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to read settings" });
  }
});

// Return image binary by name (logo, slide1, slide2, slide3, bg)
app.get("/api/image/:name", async (req, res) => {
  const name = req.params.name;
  try {
    const r = await pool.query(`SELECT content_type, data FROM site_images WHERE name=$1`, [name]);
    if (r.rowCount === 0) return res.status(404).send("Not found");
    res.setHeader("Content-Type", r.rows[0].content_type);
    res.setHeader("Cache-Control", "no-store");
    res.send(r.rows[0].data);
  } catch (e) {
    console.error(e);
    res.status(500).send("Failed");
  }
});

// ====== Admin APIs ======
app.post("/api/admin/login", (req, res) => {
  const { password } = req.body || {};
  if ((password || "").trim() !== ADMIN_PASSWORD) return res.status(401).json({ error: "Wrong password" });
  const { token, expiresAt } = issueToken();
  res.json({ token, expiresAt });
});

app.post("/api/admin/settings", requireAdmin, async (req, res) => {
  // Accept any string key/value pairs
  const body = req.body || {};
  const entries = Object.entries(body).filter(([k, v]) => typeof k === "string" && (typeof v === "string" || typeof v === "number" || typeof v === "boolean"));
  try {
    await pool.query("BEGIN");
    for (const [key, raw] of entries) {
      const value = String(raw);
      await pool.query(
        `INSERT INTO site_settings(key, value, updated_at)
         VALUES($1,$2,NOW())
         ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()`,
        [key, value]
      );
    }
    await pool.query("COMMIT");
    res.json({ ok: true });
  } catch (e) {
    await pool.query("ROLLBACK");
    console.error(e);
    res.status(500).json({ error: "Failed to save settings" });
  }
});

app.post("/api/admin/upload/:name", requireAdmin, upload.single("file"), async (req, res) => {
  const name = req.params.name;
  const f = req.file;
  if (!f) return res.status(400).json({ error: "No file" });

  // very small allow-list
  const allowed = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
  if (!allowed.has(f.mimetype)) return res.status(400).json({ error: "Only png/jpg/webp/gif" });

  try {
    await pool.query(
      `INSERT INTO site_images(name, content_type, data, updated_at)
       VALUES($1,$2,$3,NOW())
       ON CONFLICT (name) DO UPDATE SET content_type=EXCLUDED.content_type, data=EXCLUDED.data, updated_at=NOW()`,
      [name, f.mimetype, f.buffer]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to upload image" });
  }
});

// health
app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true });
  } catch {
    res.status(500).json({ ok: false });
  }
});

// ====== Start ======
initDb()
  .then(() => {
    app.listen(PORT, () => console.log("Server running on port", PORT));
  })
  .catch((e) => {
    console.error("DB init failed:", e);
    app.listen(PORT, () => console.log("Server running (DB init failed) on port", PORT));
  });
