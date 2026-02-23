// public/index.js

async function fetchJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return null;
  return res.json();
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = value ?? "";
}

function setHrefButton(id, url) {
  const el = document.getElementById(id);
  if (!el) return;
  el.onclick = () => (window.location.href = url || "#");
}

function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function percentClass(p) {
  const n = Number(p || 0);
  if (n >= 80) return "good";   // hijau
  if (n >= 50) return "mid";    // kuning
  return "bad";                 // merah
}

function renderProviders(list) {
  const wrap = document.getElementById("providerBar");
  if (!wrap) return;

  wrap.innerHTML = "";
  for (const pv of list || []) {
    const key = pv.provider_key || pv.key || "";
    const name = pv.provider_name || pv.name || key;
    const icon = pv.icon_url || pv.icon || "";

    const item = document.createElement("div");
    item.className = "prov-item";
    item.dataset.key = key;

    item.innerHTML = `
      <button class="prov-btn" type="button" data-key="${esc(key)}" title="${esc(name)}">
        <img loading="lazy" decoding="async" src="${esc(icon)}" alt="${esc(name)}" />
        <span>${esc(name)}</span>
      </button>
    `;

    wrap.appendChild(item);
  }
}

function renderGames(list) {
  const grid = document.getElementById("gamesGrid");
  if (!grid) return;

  grid.innerHTML = "";

  for (const g of list || []) {
    const title = g.title || "";
    const img = g.image_url || "";
    const pola1 = g.pola1 || "";
    const pola2 = g.pola2 || "";
    const pola3 = g.pola3 || "";
    const jam = g.jam || "";
    const percent = Number(g.percent || 0);
    const hot = !!g.is_hot;
    const isNew = !!g.is_new;
    const label = g.label || ""; // opsional: "EKSKLUSIF"
    const pClass = percentClass(percent);

    const card = document.createElement("div");
    card.className = "game-card";
    card.innerHTML = `
      ${hot ? `<div class="badge badge-hot">HOT</div>` : ""}
      <div class="game-left">
        <div class="game-imgbox">
          ${label ? `<div class="badge badge-label">${esc(label)}</div>` : ""}
          ${isNew ? `<div class="badge badge-new">NEW</div>` : ""}
          <img loading="lazy" decoding="async" src="${esc(img)}" alt="${esc(title)}" />
        </div>
      </div>

      <div class="game-right">
        <div class="pola-title">Pola Slot:</div>
        <div class="pola-lines">
          <div class="pola-line">${esc(pola1)}</div>
          <div class="pola-line">${esc(pola2)}</div>
          <div class="pola-line">${esc(pola3)}</div>
        </div>
        <div class="jam">Jam: <span>${esc(jam)}</span></div>

        <div class="percent-wrap ${pClass}">
          <div class="percent-bar" style="width:${Math.max(0, Math.min(100, percent))}%"></div>
          <div class="percent-text">${percent}%</div>
        </div>
      </div>
    `;

    grid.appendChild(card);
  }
}

async function loadAll() {
  const settings = (await fetchJson("/api/settings")) || {};
  const providers = (await fetchJson("/api/providers")) || [];
  const games = (await fetchJson("/api/games")) || [];

  // Background (optional) -> pakai link langsung biar ringan
  if (settings.bg_url) {
    document.body.style.backgroundImage = `url(${settings.bg_url})`;
  } else {
    document.body.style.backgroundImage = "none";
  }

  // Header text
  setText("rtpUpdatedText", settings.rtp_updated_text || "");
  setText("sectionTitle", settings.section_title || "");
  setText("sukaValue", settings.suka_value || "");

  // Buttons
  setHrefButton("btnLogin", settings.login_url || "#");
  setHrefButton("btnDaftar", settings.daftar_url || "#");

  // Providers + Games
  renderProviders(providers);
  renderGames(games);

  // Provider filter (klik icon -> filter)
  const wrap = document.getElementById("providerBar");
  if (wrap) {
    wrap.onclick = (e) => {
      const btn = e.target.closest(".prov-btn");
      if (!btn) return;
      const key = btn.dataset.key || "";
      const filtered = key ? games.filter((x) => (x.provider || "") === key) : games;
      renderGames(filtered);
    };
  }
}

// Auto refresh tiap 60 menit (biar update batch per jam)
function enableHourlyReload() {
  setInterval(() => loadAll().catch(() => {}), 60 * 60 * 1000);
}

loadAll().then(enableHourlyReload).catch(console.error);
