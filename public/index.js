async function getSettings() {
  const res = await fetch("/api/settings", { cache: "no-store" });
  return res.ok ? await res.json() : {};
}

function setImgOrHide(imgEl, url) {
  if (!url) { imgEl.style.display = "none"; return; }
  imgEl.style.display = "";
  imgEl.src = url;
}

function startSlider(imgEls) {
  let i = 0;
  imgEls.forEach((el, idx) => el.classList.toggle("active", idx === 0));
  setInterval(() => {
    imgEls[i].classList.remove("active");
    i = (i + 1) % imgEls.length;
    imgEls[i].classList.add("active");
  }, 3000);
}

(async () => {
  const s = await getSettings();

  // Background image (optional)
  if (s.bg_enabled === "true") {
    document.body.style.backgroundImage = `url(/api/image/bg)`;
  } else {
    document.body.style.backgroundImage = "none";
  }

  // logo + slides (served from DB)
  setImgOrHide(document.getElementById("logo"), "/api/image/logo");
  setImgOrHide(document.getElementById("slide1"), "/api/image/slide1");
  setImgOrHide(document.getElementById("slide2"), "/api/image/slide2");
  setImgOrHide(document.getElementById("slide3"), "/api/image/slide3");

  // text
  if (s.marquee_text) document.getElementById("marqueeText").textContent = s.marquee_text;
  if (s.subtitle_text) document.getElementById("subtitle").textContent = s.subtitle_text;

  // buttons
  const loginUrl = s.login_url || "#";
  const daftarUrl = s.daftar_url || "#";

  document.getElementById("btnLogin").onclick = () => window.location.href = loginUrl;
  document.getElementById("btnDaftar").onclick = () => window.location.href = daftarUrl;

  // pills (simple list from admin, comma-separated)
  const pillsWrap = document.getElementById("pills");
  const pills = (s.pills || "").split(",").map(x => x.trim()).filter(Boolean);
  pillsWrap.innerHTML = "";
  for (const p of pills) {
    const div = document.createElement("div");
    div.className = "pill";
    div.textContent = p;
    pillsWrap.appendChild(div);
  }

  // slider
  startSlider([document.getElementById("slide1"), document.getElementById("slide2"), document.getElementById("slide3")]);
})();
