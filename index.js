import express from "express";
import pg from "pg";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import cron from "node-cron";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;

// ====== ENV (Railway Variables) ======
const DATABASE_URL = process.env.DATABASE_URL;
const ADMIN_PASSWORD = (process.env.ADMIN_PASSWORD || "").trim();
const ADMIN_TOKEN_TTL_MIN = parseInt(process.env.ADMIN_TOKEN_TTL_MIN || "120", 10);

// snapshot settings
const SNAPSHOT_SIZE = parseInt(process.env.SNAPSHOT_SIZE || "12", 10);
const SNAPSHOT_TTL_HOURS = parseInt(process.env.SNAPSHOT_TTL_HOURS || "2", 10);
const SNAPSHOT_CRON = (process.env.SNAPSHOT_CRON || "0 * * * *").trim();

if (!DATABASE_URL) console.warn("⚠️ Missing DATABASE_URL");
if (!ADMIN_PASSWORD) console.warn("⚠️ Missing ADMIN_PASSWORD");

// ====== DB ======
const { Pool } = pg;
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: false },
});

function nowIdDateIndo() {
  const d = new Date();
  const days = ["Minggu","Senin","Selasa","Rabu","Kamis","Jumat","Sabtu"];
  const months = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
  const day = days[d.getDay()];
  const date = String(d.getDate()).padStart(2, "0");
  const month = months[d.getMonth()];
  const year = d.getFullYear();
  return `${day}, ${date} ${month} ${year}`;
}

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS site_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS providers (
      provider_key TEXT PRIMARY KEY,
      provider_name TEXT NOT NULL,
      icon_url TEXT NOT NULL,
      order_no INT NOT NULL DEFAULT 0,
      enabled BOOLEAN NOT NULL DEFAULT true,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS pool_games (
      id SERIAL PRIMARY KEY,
      provider TEXT NOT NULL,
      title TEXT NOT NULL,
      image_url TEXT NOT NULL,
      label TEXT DEFAULT '',
      pola1 TEXT DEFAULT '',
      pola2 TEXT DEFAULT '',
      pola3 TEXT DEFAULT '',
      jam TEXT DEFAULT '',
      percent INT NOT NULL DEFAULT 0,
      is_hot BOOLEAN NOT NULL DEFAULT false,
      is_new BOOLEAN NOT NULL DEFAULT false,
      enabled BOOLEAN NOT NULL DEFAULT true,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS game_snapshots (
      id SERIAL PRIMARY KEY,
      provider TEXT NOT NULL,
      title TEXT NOT NULL,
      image_url TEXT NOT NULL,
      label TEXT DEFAULT '',
      pola1 TEXT DEFAULT '',
      pola2 TEXT DEFAULT '',
      pola3 TEXT DEFAULT '',
      jam TEXT DEFAULT '',
      percent INT NOT NULL DEFAULT 0,
      is_hot BOOLEAN NOT NULL DEFAULT false,
      is_new BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_snapshots_created ON game_snapshots(created_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_pool_provider ON pool_games(provider);`);

  const defaults = {
    marquee_text: "Selamat datang.",
    subtitle_text: "Konten bisa kamu atur dari halaman admin.",
    login_url: "#",
    daftar_url: "#",
    section_title: "PRAGMATIC PLAY SLOT LIVE RTP",
    suka_value: "5.9",
    rtp_updated_text: `Update RTP: ${nowIdDateIndo()}`,
    bg_url: "",
  };

  await pool.query("BEGIN");
  try {
    for (const [k, v] of Object.entries(defaults)) {
      await pool.query(
        `INSERT INTO site_settings(key,value,updated_at)
         VALUES($1,$2,NOW())
         ON CONFLICT (key) DO NOTHING`,
        [k, String(v)]
      );
    }
    await pool.query("COMMIT");
  } catch (e) {
    await pool.query("ROLLBACK");
    throw e;
  }
}

// ====== Auth (simple token in memory) ======
const tokenStore = new Map();

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

// ====== Helpers ======
function clampInt(n, min, max, fallback = 0) {
  const x = Number.parseInt(n, 10);
  if (Number.isNaN(x)) return fallback;
  return Math.max(min, Math.min(max, x));
}

function pickRandom(arr, n) {
  const a = [...arr];
  const out = [];
  while (a.length && out.length < n) out.push(a.splice(Math.floor(Math.random() * a.length), 1)[0]);
  return out;
}

async function setSetting(key, value) {
  await pool.query(
    `INSERT INTO site_settings(key,value,updated_at)
     VALUES($1,$2,NOW())
     ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()`,
    [key, String(value)]
  );
}

// ====== Snapshot generator ======
async function generateSnapshot() {
  const r = await pool.query(`SELECT * FROM pool_games WHERE enabled=true ORDER BY updated_at DESC`);
  const poolList = r.rows || [];
  if (poolList.length === 0) {
    console.log("⚠️ No pool games. Skip snapshot.");
    return { ok: false, reason: "no_pool" };
  }

  const chosen = pickRandom(poolList, Math.max(1, SNAPSHOT_SIZE));

  await pool.query("BEGIN");
  try {
    for (const g of chosen) {
      await pool.query(
        `INSERT INTO game_snapshots(provider,title,image_url,label,pola1,pola2,pola3,jam,percent,is_hot,is_new,created_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())`,
        [
          g.provider, g.title, g.image_url,
          g.label || "", g.pola1 || "", g.pola2 || "", g.pola3 || "",
          g.jam || "", clampInt(g.percent, 0, 100, 0),
          !!g.is_hot, !!g.is_new
        ]
      );
    }

    await setSetting("rtp_updated_text", `Update RTP: ${nowIdDateIndo()}`);
    await pool.query(`DELETE FROM game_snapshots WHERE created_at < NOW() - INTERVAL '7 days'`);
    await pool.query("COMMIT");

    console.log("✅ Snapshot generated:", chosen.length, "items");
    return { ok: true, count: chosen.length };
  } catch (e) {
    await pool.query("ROLLBACK");
    console.error("❌ Snapshot failed:", e);
    return { ok: false, error: "snapshot_failed" };
  }
}

// ====== App ======
const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

// ====== Public APIs ======
app.get("/api/settings", async (_req, res) => {
  try {
    const r = await pool.query(`SELECT key,value FROM site_settings`);
    const out = {};
    for (const row of r.rows) out[row.key] = row.value;
    res.json(out);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to read settings" });
  }
});

app.get("/api/providers", async (_req, res) => {
  try {
    const r = await pool.query(
      `SELECT provider_key, provider_name, icon_url, order_no
       FROM providers
       WHERE enabled=true
       ORDER BY order_no ASC, provider_name ASC`
    );
    res.json(r.rows || []);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to read providers" });
  }
});

app.get("/api/games", async (_req, res) => {
  try {
    const r = await pool.query(
      `SELECT provider,title,image_url,label,pola1,pola2,pola3,jam,percent,is_hot,is_new,created_at
       FROM game_snapshots
       WHERE created_at >= NOW() - ($1 || ' hours')::interval
       ORDER BY created_at DESC
       LIMIT $2`,
      [String(SNAPSHOT_TTL_HOURS), Math.max(1, SNAPSHOT_SIZE)]
    );

    if ((r.rows || []).length === 0) {
      await generateSnapshot();
      const r2 = await pool.query(
        `SELECT provider,title,image_url,label,pola1,pola2,pola3,jam,percent,is_hot,is_new,created_at
         FROM game_snapshots
         ORDER BY created_at DESC
         LIMIT $1`,
        [Math.max(1, SNAPSHOT_SIZE)]
      );
      return res.json(r2.rows || []);
    }

    res.json(r.rows || []);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to read games" });
  }
});

app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true });
  } catch {
    res.status(500).json({ ok: false });
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
  const body = req.body || {};
  const entries = Object.entries(body).filter(
    ([k, v]) => typeof k === "string" && (typeof v === "string" || typeof v === "number" || typeof v === "boolean")
  );

  try {
    await pool.query("BEGIN");
    for (const [key, raw] of entries) {
      const value = String(raw);
      await pool.query(
        `INSERT INTO site_settings(key,value,updated_at)
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

// ====== SEED STATUS (cek data ada/tidak) ======
app.get("/api/admin/seed-status", requireAdmin, async (_req, res) => {
  try {
    const a = await pool.query(`SELECT COUNT(*)::int AS c FROM providers`);
    const b = await pool.query(`SELECT COUNT(*)::int AS c FROM pool_games`);
    const c = await pool.query(`SELECT COUNT(*)::int AS c FROM game_snapshots`);
    res.json({ providers: a.rows[0].c, pool_games: b.rows[0].c, snapshots: c.rows[0].c });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed" });
  }
});

// ====== SEED (isi data tanpa SQL editor) ======
app.post("/api/admin/seed", requireAdmin, async (_req, res) => {
  try {
    const provCount = (await pool.query(`SELECT COUNT(*)::int AS c FROM providers`)).rows[0].c;
    const poolCount = (await pool.query(`SELECT COUNT(*)::int AS c FROM pool_games`)).rows[0].c;

    await pool.query("BEGIN");

    // isi provider kalau masih kosong
    if (provCount === 0) {
      await pool.query(`
        INSERT INTO providers (provider_key, provider_name, icon_url, order_no, enabled)
        VALUES
        ('pp','PRAGMATIC','https://via.placeholder.com/64?text=PP',1,true),
        ('pg','PGSOFT','https://via.placeholder.com/64?text=PG',2,true),
        ('hb','HABANERO','https://via.placeholder.com/64?text=HB',3,true),
        ('idn','IDN','https://via.placeholder.com/64?text=IDN',4,true)
        ON CONFLICT (provider_key) DO NOTHING;
      `);
    }

    // isi pool games kalau masih kosong
    if (poolCount === 0) {
      await pool.query(`
        INSERT INTO pool_games (provider,title,image_url,label,pola1,pola2,pola3,jam,percent,is_hot,is_new,enabled)
        VALUES
        ('pp','Fantastic Freespins','https://via.placeholder.com/300?text=Game1','EKSKLUSIF','Manual 9','Manual 7','Auto 70','02:22 - 06:26',82,true,true,true),
        ('pp','Anime Mecha','https://via.placeholder.com/300?text=Game2','','Auto 30','Manual 8','Auto 50','01:10 - 03:40',67,false,true,true),
        ('pg','Mahjong Ways','https://via.placeholder.com/300?text=Game3','','Manual 6','Auto 40','Auto 70','10:00 - 12:00',74,true,false,true),
        ('hb','Hot Hot Fruit','https://via.placeholder.com/300?text=Game4','','Auto 20','Auto 50','Manual 9','14:00 - 16:00',58,false,false,true),
        ('idn','Zeus IDN','https://via.placeholder.com/300?text=Game5','','Manual 5','Manual 7','Auto 30','19:00 - 21:00',90,true,true,true);
      `);
    }

    await pool.query("COMMIT");

    // buat snapshot
    const snap = await generateSnapshot();

    res.json({ ok: true, seeded_providers: provCount === 0, seeded_pool: poolCount === 0, snapshot: snap });
  } catch (e) {
    await pool.query("ROLLBACK");
    console.error(e);
    res.status(500).json({ error: "Seed failed" });
  }
});

// ===== Providers CRUD =====
app.get("/api/admin/providers", requireAdmin, async (_req, res) => {
  try {
    const r = await pool.query(
      `SELECT provider_key, provider_name, icon_url, order_no, enabled, updated_at
       FROM providers
       ORDER BY order_no ASC, provider_name ASC`
    );
    res.json(r.rows || []);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to read providers" });
  }
});

app.post("/api/admin/providers/upsert", requireAdmin, async (req, res) => {
  const { provider_key, provider_name, icon_url, order_no, enabled } = req.body || {};
  if (!provider_key || !provider_name || !icon_url) return res.status(400).json({ error: "Missing fields" });

  try {
    await pool.query(
      `INSERT INTO providers(provider_key, provider_name, icon_url, order_no, enabled, updated_at)
       VALUES($1,$2,$3,$4,$5,NOW())
       ON CONFLICT (provider_key) DO UPDATE
         SET provider_name=EXCLUDED.provider_name,
             icon_url=EXCLUDED.icon_url,
             order_no=EXCLUDED.order_no,
             enabled=EXCLUDED.enabled,
             updated_at=NOW()`,
      [
        String(provider_key).trim(),
        String(provider_name).trim(),
        String(icon_url).trim(),
        clampInt(order_no, 0, 9999, 0),
        enabled === false ? false : true
      ]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to save provider" });
  }
});

app.post("/api/admin/providers/delete", requireAdmin, async (req, res) => {
  const { provider_key } = req.body || {};
  if (!provider_key) return res.status(400).json({ error: "Missing provider_key" });
  try {
    await pool.query(`DELETE FROM providers WHERE provider_key=$1`, [String(provider_key)]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to delete provider" });
  }
});

// ===== Pool Games CRUD =====
app.get("/api/admin/pool-games", requireAdmin, async (_req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, provider, title, image_url, label, pola1, pola2, pola3, jam, percent, is_hot, is_new, enabled, updated_at
       FROM pool_games
       ORDER BY updated_at DESC, id DESC`
    );
    res.json(r.rows || []);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to read pool games" });
  }
});

app.post("/api/admin/pool-games/upsert", requireAdmin, async (req, res) => {
  const g = req.body || {};
  const id = g.id ? clampInt(g.id, 1, 999999999, 0) : 0;

  const provider = String(g.provider || "").trim();
  const title = String(g.title || "").trim();
  const image_url = String(g.image_url || "").trim();

  if (!provider || !title || !image_url) {
    return res.status(400).json({ error: "provider/title/image_url required" });
  }

  const payload = {
    provider,
    title,
    image_url,
    label: String(g.label || "").trim(),
    pola1: String(g.pola1 || "").trim(),
    pola2: String(g.pola2 || "").trim(),
    pola3: String(g.pola3 || "").trim(),
    jam: String(g.jam || "").trim(),
    percent: clampInt(g.percent, 0, 100, 0),
    is_hot: !!g.is_hot,
    is_new: !!g.is_new,
    enabled: g.enabled === false ? false : true
  };

  try {
    if (!id) {
      await pool.query(
        `INSERT INTO pool_games(provider,title,image_url,label,pola1,pola2,pola3,jam,percent,is_hot,is_new,enabled,updated_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())`,
        [
          payload.provider, payload.title, payload.image_url, payload.label,
          payload.pola1, payload.pola2, payload.pola3,
          payload.jam, payload.percent, payload.is_hot, payload.is_new, payload.enabled
        ]
      );
    } else {
      await pool.query(
        `UPDATE pool_games SET
          provider=$1, title=$2, image_url=$3, label=$4,
          pola1=$5, pola2=$6, pola3=$7,
          jam=$8, percent=$9, is_hot=$10, is_new=$11, enabled=$12, updated_at=NOW()
         WHERE id=$13`,
        [
          payload.provider, payload.title, payload.image_url, payload.label,
          payload.pola1, payload.pola2, payload.pola3,
          payload.jam, payload.percent, payload.is_hot, payload.is_new, payload.enabled,
          id
        ]
      );
    }
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to save pool game" });
  }
});

app.post("/api/admin/pool-games/delete", requireAdmin, async (req, res) => {
  const { id } = req.body || {};
  const gid = clampInt(id, 1, 999999999, 0);
  if (!gid) return res.status(400).json({ error: "Missing id" });

  try {
    await pool.query(`DELETE FROM pool_games WHERE id=$1`, [gid]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to delete pool game" });
  }
});

app.post("/api/admin/snapshot/run", requireAdmin, async (_req, res) => {
  const result = await generateSnapshot();
  res.json(result);
});

// ====== Start + Cron ======
initDb()
  .then(async () => {
    await generateSnapshot();

    try {
      cron.schedule(SNAPSHOT_CRON, async () => {
        await generateSnapshot();
      });
      console.log("⏱️ Cron scheduled:", SNAPSHOT_CRON);
    } catch (e) {
      console.error("Cron schedule error:", e);
    }

    app.listen(PORT, () => console.log("Server running on port", PORT));
  })
  .catch((e) => {
    console.error("DB init failed:", e);
    app.listen(PORT, () => console.log("Server running (DB init failed) on port", PORT));
  });
