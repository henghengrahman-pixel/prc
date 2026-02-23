const $ = (id) => document.getElementById(id);

const loginCard = $("loginCard");
const panelCard = $("panelCard");
const loginStatus = $("loginStatus");
const saveStatus = $("saveStatus");

function setStatus(el, msg, ok=true){
  el.textContent = msg;
  el.className = "status " + (ok ? "ok" : "bad");
}

function getToken(){
  return localStorage.getItem("ADMIN_TOKEN") || "";
}
function setToken(t){
  localStorage.setItem("ADMIN_TOKEN", t);
}
function clearToken(){
  localStorage.removeItem("ADMIN_TOKEN");
}

async function apiGetSettings(){
  const res = await fetch("/api/settings", { cache:"no-store" });
  return res.ok ? await res.json() : {};
}

function refreshPreviews(){
  $("prevLogo").src = "/api/image/logo?ts=" + Date.now();
  $("prev1").src = "/api/image/slide1?ts=" + Date.now();
  $("prev2").src = "/api/image/slide2?ts=" + Date.now();
  $("prev3").src = "/api/image/slide3?ts=" + Date.now();
}

async function loadForm(){
  const s = await apiGetSettings();
  for (const k of ["marquee_text","subtitle_text","login_url","daftar_url","pills"]) {
    if ($(k)) $(k).value = s[k] || "";
  }
  $("bg_enabled").checked = (s.bg_enabled === "true");
  refreshPreviews();
}

async function login(){
  const password = $("adminPass").value;
  const res = await fetch("/api/admin/login", {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({ password })
  });
  const data = await res.json().catch(()=>({}));
  if (!res.ok) {
    setStatus(loginStatus, data.error || "Login gagal", false);
    return;
  }
  setToken(data.token);
  setStatus(loginStatus, "Login sukses ✅", true);
  loginCard.style.display = "none";
  panelCard.style.display = "block";
  await loadForm();
}

async function saveSettings(){
  const token = getToken();
  if(!token){ setStatus(saveStatus, "Token admin hilang. Login ulang.", false); return; }

  const payload = {
    marquee_text: $("marquee_text").value.trim(),
    subtitle_text: $("subtitle_text").value.trim(),
    login_url: $("login_url").value.trim(),
    daftar_url: $("daftar_url").value.trim(),
    pills: $("pills").value.trim(),
    bg_enabled: $("bg_enabled").checked ? "true" : "false"
  };

  const res = await fetch("/api/admin/settings", {
    method:"POST",
    headers:{
      "Content-Type":"application/json",
      "x-admin-token": token
    },
    body: JSON.stringify(payload)
  });
  const data = await res.json().catch(()=>({}));
  if(!res.ok){
    setStatus(saveStatus, data.error || "Gagal simpan settings", false);
    return;
  }
  setStatus(saveStatus, "Settings tersimpan ✅", true);
}

async function uploadFile(inputEl, name){
  const token = getToken();
  if(!token){ setStatus(saveStatus, "Token admin hilang. Login ulang.", false); return; }
  const file = inputEl.files?.[0];
  if(!file) return;

  const fd = new FormData();
  fd.append("file", file);

  const res = await fetch("/api/admin/upload/" + encodeURIComponent(name), {
    method:"POST",
    headers:{ "x-admin-token": token },
    body: fd
  });
  const data = await res.json().catch(()=>({}));
  if(!res.ok){
    setStatus(saveStatus, data.error || ("Upload gagal: " + name), false);
    return;
  }
  setStatus(saveStatus, "Upload berhasil: " + name + " ✅", true);
  refreshPreviews();
}

function tryAutoLogin(){
  const token = getToken();
  if(token){
    // Show panel; if token expired server will reject uploads/saves
    loginCard.style.display = "none";
    panelCard.style.display = "block";
    loadForm();
  }
}

$("btnLogin").onclick = login;
$("btnSave").onclick = saveSettings;
$("btnRefresh").onclick = loadForm;
$("btnLogout").onclick = () => { clearToken(); location.reload(); };

// uploads
$("logoFile").addEventListener("change", (e) => uploadFile(e.target, "logo"));
$("slide1File").addEventListener("change", (e) => uploadFile(e.target, "slide1"));
$("slide2File").addEventListener("change", (e) => uploadFile(e.target, "slide2"));
$("slide3File").addEventListener("change", (e) => uploadFile(e.target, "slide3"));
$("bgFile").addEventListener("change", (e) => uploadFile(e.target, "bg"));

tryAutoLogin();
