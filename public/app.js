// =========================
// ATHENS NAV • V1.3 (Single-file app.js rewrite)
// Fixes applied:
// ✅ Near Me starts CLOSED and opens only on Near button
// ✅ No routing controls hidden in Settings (home binds only)
// ✅ Settings scroll is handled by CSS (drawerBody min-height:0 etc.)
// ✅ Account UI (login/create) placeholder with localStorage session
// =========================

const $ = (id) => document.getElementById(id);
const el = (id) => document.getElementById(id); // alias

// ---------- Storage helpers ----------
const STORE = {
  mode: "ath_nav_mode",
  fit: "ath_nav_fit",
  steps: "ath_nav_steps",
  lock: "ath_nav_lock",
  cpya: "ath_nav_cpya",
  cpyaEp: "ath_nav_cpya_ep",
  rememberLoc: "ath_nav_remember_loc",
  lastLoc: "ath_nav_last_loc" // {lat,lon,t}
};

function sGet(key, fallback = null) {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : v;
  } catch (_) {
    return fallback;
  }
}
function sSet(key, val) {
  try {
    localStorage.setItem(key, val);
  } catch (_) {}
}
function sGetBool(key, fallback) {
  const v = sGet(key, null);
  if (v == null) return fallback;
  return v === "1" || v === "true";
}
function sSetBool(key, val) {
  sSet(key, val ? "1" : "0");
}

// Athens bbox (includes Piraeus + nearby, but still Athens-only)
const ATHENS_BBOX = { south: 37.82, west: 23.57, north: 38.10, east: 23.97 };
const ATHENS_CENTER = [37.9756, 23.7347];

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}
function inBbox(lat, lon, b) {
  return lat >= b.south && lat <= b.north && lon >= b.west && lon <= b.east;
}
function formatDist(m) {
  if (m == null || !isFinite(m)) return "";
  if (m < 1000) return `${Math.round(m)} m`;
  const km = m / 1000;
  return `${km.toFixed(km < 10 ? 1 : 0)} km`;
}
function formatTime(s) {
  if (s == null || !isFinite(s)) return "";
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h <= 0) return `${m} min`;
  return `${h} h ${m} min`;
}
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));
}

// ---------- Toast ----------
let toastTimer = null;
function toast(msg, ms = 2200) {
  const t = $("toastMsg");
  const box = $("toast");
  if (!t || !box) return;
  t.textContent = msg;
  box.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => box.classList.remove("show"), ms);
}
if ($("toastClose")) $("toastClose").addEventListener("click", () => $("toast").classList.remove("show"));

// ---------- Loading bar ----------
function setLoad(p) {
  const b = $("loadBar");
  if (b) b.style.width = clamp(p, 0, 100) + "%";
}
function setLoadText(t) {
  const x = $("loadText");
  if (x) x.textContent = t;
}
setLoad(12);

// ---------- Drawer ----------
function openDrawer() {
  const o = $("overlay");
  const d = $("drawer");
  if (o) o.classList.add("show");
  if (d) d.classList.add("show");
}
function closeDrawer() {
  const o = $("overlay");
  const d = $("drawer");
  if (o) o.classList.remove("show");
  if (d) d.classList.remove("show");
}
if ($("btnMenu")) $("btnMenu").addEventListener("click", openDrawer);
if ($("btnCloseDrawer")) $("btnCloseDrawer").addEventListener("click", closeDrawer);
if ($("overlay")) $("overlay").addEventListener("click", closeDrawer);

// ---------- Switch helper ----------
function setSwitch(elm, on) {
  if (!elm) return;
  elm.classList.toggle("on", !!on);
  elm.setAttribute("aria-checked", on ? "true" : "false");
}
function getSwitch(elm) {
  if (!elm) return false;
  return elm.classList.contains("on");
}
function bindSwitch(elm, initial, onChange) {
  if (!elm) return;
  setSwitch(elm, initial);
  const toggle = () => {
    const next = !getSwitch(elm);
    setSwitch(elm, next);
    onChange?.(next);
  };
  elm.addEventListener("click", toggle);
  elm.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggle();
    }
  });
}

// ---------- Panel ----------
function showPanel(title, subtitle) {
  if ($("panelTitle")) $("panelTitle").textContent = title;
  if ($("panelSubtitle")) $("panelSubtitle").textContent = subtitle || "";
  if ($("panel")) $("panel").classList.add("show");
}
function hidePanel() {
  if ($("panel")) $("panel").classList.remove("show");
}
if ($("btnClosePanel")) $("btnClosePanel").addEventListener("click", hidePanel);

function clearPanelList() {
  if ($("panelList")) $("panelList").innerHTML = "";
}
function addPanelCard(node) {
  if ($("panelList")) $("panelList").appendChild(node);
}

function makeInfoCard(title, body) {
  const card = document.createElement("div");
  card.className = "card";
  card.innerHTML = `<div class="name">${escapeHtml(title)}</div><div class="addr">${escapeHtml(body)}</div>`;
  return card;
}

function setDockActive(id) {
  ["dockSearch", "dockRoute", "dockNear", "dockLocate", "dockClear"].forEach((x) => {
    const b = $(x);
    if (b) b.classList.remove("active");
  });
  if ($(id)) $(id).classList.add("active");
}

// ---------- Map init ----------
const map = L.map("map", {
  zoomControl: false,
  preferCanvas: true,
  zoomSnap: 0.5,
  zoomDelta: 0.5,
  minZoom: 11.5,
  maxZoom: 19
});

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap"
}).addTo(map);

setLoad(40);

const hardBounds = L.latLngBounds(
  L.latLng(ATHENS_BBOX.south, ATHENS_BBOX.west),
  L.latLng(ATHENS_BBOX.north, ATHENS_BBOX.east)
);

let athensLock = sGetBool(STORE.lock, true);

function applyAthensLock() {
  if (athensLock) {
    map.setMaxBounds(hardBounds);
    map.options.maxBoundsViscosity = 1.0;
    if (!hardBounds.contains(map.getCenter())) {
      map.panInsideBounds(hardBounds, { animate: true });
    }
    if (map.getZoom() < map.options.minZoom) map.setZoom(map.options.minZoom);
  } else {
    map.setMaxBounds(null);
    map.options.maxBoundsViscosity = 0.0;
  }
}

map.setView(ATHENS_CENTER, 12.6);
applyAthensLock();

map.on("moveend zoomend", () => {
  if (!athensLock) return;
  if (!hardBounds.contains(map.getCenter())) {
    map.panInsideBounds(hardBounds, { animate: true });
    toast("Athens-only lock.");
  }
  if (map.getZoom() < map.options.minZoom) {
    map.setZoom(map.options.minZoom);
  }
});

if ($("zoomIn")) $("zoomIn").addEventListener("click", () => map.zoomIn());
if ($("zoomOut")) $("zoomOut").addEventListener("click", () => map.zoomOut());

setLoad(55);

// ---------- State: markers & routing ----------
let userLatLng = null;
let userMarker = null;

let destMarker = null;
let selectedResult = null;

let searchMarkers = [];
let routingControl = null;
let routingLine = null;

let routeMode = sGet(STORE.mode, "driving"); // driving | walking | cycling
let autoFit = sGetBool(STORE.fit, true);
let showSteps = sGetBool(STORE.steps, true);

function clearSearchMarkers() {
  for (const m of searchMarkers) map.removeLayer(m);
  searchMarkers = [];
  selectedResult = null;
}
function clearDestination() {
  if (destMarker) {
    map.removeLayer(destMarker);
    destMarker = null;
  }
}
function clearRoute() {
  if (routingControl) {
    try {
      map.removeControl(routingControl);
    } catch {}
    routingControl = null;
  }
  if (routingLine) {
    try {
      map.removeLayer(routingLine);
    } catch {}
    routingLine = null;
  }
}

function hardReset() {
  clearRoute();
  clearSearchMarkers();
  clearDestination();
  clearPanelList();
  showPanel("Ready", "Tap the map to drop a pin • or Search • then Route.");
  addPanelCard(makeInfoCard("Tip", "Tap Near only when needed. Routing controls are on the home screen."));
  toast("Cleared.");
}

if ($("dockClear")) $("dockClear").addEventListener("click", () => {
  setDockActive("dockClear");
  hardReset();
  setDockActive("dockSearch");
});
if ($("btnHardReset")) $("btnHardReset").addEventListener("click", () => {
  hardReset();
  closeDrawer();
});

// ---------- Destination: Tap / click ----------
function setDestination(lat, lon, name = "Dropped pin") {
  if (athensLock && !inBbox(lat, lon, ATHENS_BBOX)) {
    toast("Outside Athens lock.");
    return;
  }
  selectedResult = { name, lat, lon, display: name };

  clearDestination();
  destMarker = L.marker([lat, lon], { title: name }).addTo(map).bindPopup(`<b>${escapeHtml(name)}</b>`);
  destMarker.openPopup();

  showPanel("Destination set", `${lat.toFixed(6)}, ${lon.toFixed(6)} • Tap Route`);
  renderSelectedCard(selectedResult);

  if (autoFit) {
    const b = L.latLngBounds([[lat, lon]]);
    if (userLatLng) b.extend(userLatLng);
    map.fitBounds(b.pad(0.22), { animate: true });
  } else {
    map.panTo([lat, lon], { animate: true });
  }
}

let dragging = false;
map.on("dragstart", () => (dragging = true));
map.on("dragend", () => setTimeout(() => (dragging = false), 60));

map.on("click", (e) => {
  if (dragging) return;
  setDestination(e.latlng.lat, e.latlng.lng, "Dropped pin");
});

// ---------- Location: request immediately + persist ----------
let rememberLoc = sGetBool(STORE.rememberLoc, true);

function saveLastLoc(lat, lon) {
  if (!rememberLoc) return;
  try {
    sSet(STORE.lastLoc, JSON.stringify({ lat, lon, t: Date.now() }));
  } catch (_) {}
}

function loadLastLoc() {
  try {
    const raw = sGet(STORE.lastLoc, null);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || !isFinite(obj.lat) || !isFinite(obj.lon)) return null;
    return obj;
  } catch (_) {
    return null;
  }
}

function updateUserMarker(lat, lon) {
  userLatLng = L.latLng(lat, lon);

  if (!userMarker) {
    userMarker = L.circleMarker(userLatLng, {
      radius: 8,
      weight: 2,
      opacity: 1,
      fillOpacity: 0.9
    }).addTo(map);
  } else {
    userMarker.setLatLng(userLatLng);
  }
}

async function requestLocation({ silent = false } = {}) {
  if (!navigator.geolocation) {
    if (!silent) toast("Geolocation not supported.");
    return;
  }

  setLoadText("Requesting location permission…");

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;

        updateUserMarker(lat, lon);
        saveLastLoc(lat, lon);

        if (athensLock && !hardBounds.contains(userLatLng)) {
          toast("Your GPS is outside Athens lock.");
        }

        map.setView(userLatLng, Math.max(map.getZoom(), 14), { animate: true });

        if (!silent) toast("Location updated.");
        resolve(true);
      },
      () => {
        if (!silent) toast("Location failed. Enable permission/GPS.");
        resolve(false);
      },
      { enableHighAccuracy: true, timeout: 9000, maximumAge: 5000 }
    );
  });
}

function locateBtn() {
  setDockActive("dockLocate");
  requestLocation().finally(() => setDockActive("dockSearch"));
}
if ($("dockLocate")) $("dockLocate").addEventListener("click", locateBtn);

// Restore last location immediately
const last = loadLastLoc();
if (last && rememberLoc) {
  updateUserMarker(last.lat, last.lon);
  map.setView([last.lat, last.lon], 14, { animate: false });
  showPanel("Ready", "Location restored • Tap map to pin or search.");
} else {
  showPanel("Ready", "Locating you… then tap map to pin or search.");
}
// Always ask on load (silently)
setTimeout(() => {
  requestLocation({ silent: true });
}, 350);

// ---------- Search suggestions (50+ curated Athens) ----------
const SUGGESTIONS = [
  { t: "Acropolis of Athens", m: "Ancient citadel • Parthenon", tag: "Landmark" },
  { t: "Parthenon", m: "Temple on the Acropolis", tag: "Landmark" },
  { t: "Acropolis Museum", m: "Modern museum near Acropolis", tag: "Museum" },
  { t: "Syntagma Square", m: "Central square • Parliament", tag: "Square" },
  { t: "Monastiraki Square", m: "Flea market • old town vibe", tag: "Square" },
  { t: "Plaka", m: "Historic neighborhood under Acropolis", tag: "Area" },
  { t: "Anafiotika", m: "Cycladic-style alleyways", tag: "Area" },
  { t: "Psyrri", m: "Bars • street art • nightlife", tag: "Area" },
  { t: "Kolonaki", m: "Upscale cafés • boutiques", tag: "Area" },
  { t: "Exarchia", m: "Student area • cafés • culture", tag: "Area" },
  { t: "Koukaki", m: "Food • local Athens feel", tag: "Area" },
  { t: "Gazi", m: "Nightlife • Technopolis", tag: "Area" },
  { t: "Stavros Niarchos Foundation Cultural Center", m: "Park • library • opera", tag: "Culture" },
  { t: "National Archaeological Museum", m: "Top museum of antiquities", tag: "Museum" },
  { t: "Benaki Museum", m: "Greek culture & art collections", tag: "Museum" },
  { t: "Technopolis City of Athens", m: "Events • concerts at Gazi", tag: "Culture" },
  { t: "Lycabettus Hill", m: "Viewpoint over Athens", tag: "View" },
  { t: "Philopappos Hill", m: "Walk • views • near Acropolis", tag: "View" },
  { t: "Panathenaic Stadium", m: "Marble stadium • Olympic history", tag: "Landmark" },
  { t: "Temple of Olympian Zeus", m: "Ancient temple ruins", tag: "Landmark" },
  { t: "Hadrian's Arch", m: "Roman arch near Zeus temple", tag: "Landmark" },
  { t: "Odeon of Herodes Atticus", m: "Ancient theater for events", tag: "Landmark" },
  { t: "Ancient Agora of Athens", m: "Classical marketplace ruins", tag: "Landmark" },
  { t: "Roman Agora", m: "Market ruins in Plaka area", tag: "Landmark" },

  { t: "Piraeus Port", m: "Main port • ferries", tag: "Transport" },
  { t: "Athens International Airport (ATH)", m: "Eleftherios Venizelos", tag: "Transport" },
  { t: "Larissa Station", m: "Main railway station", tag: "Transport" },
  { t: "Omonia Square", m: "Metro hub • central Athens", tag: "Square" },

  { t: "Lidl", m: "Supermarket chain • affordability", tag: "Shop" },
  { t: "Sklavenitis", m: "Greek supermarket chain", tag: "Shop" },
  { t: "AB Vassilopoulos", m: "Supermarket • wide selection", tag: "Shop" },
  { t: "Public (electronics & books)", m: "Devices • books • gifts", tag: "Shop" },
  { t: "Jumbo", m: "Home goods • toys • bargains", tag: "Shop" },
  { t: "IKEA Athens", m: "Furniture • home solutions", tag: "Shop" },

  { t: "Alimos Marina", m: "Marina • seaside walks", tag: "Coast" },
  { t: "Flisvos Marina", m: "Marina • cafés • sea", tag: "Coast" },
  { t: "Stavros Niarchos Park", m: "Seaside park at SNFCC", tag: "Coast" },
  { t: "Glyfada", m: "Shops • beachy vibe", tag: "Coast" },
  { t: "Vouliagmeni Lake", m: "Thermal lake • swimming", tag: "Coast" },

  { t: "Evangelismos Hospital", m: "Major hospital near center", tag: "Health" },
  { t: "Laiko General Hospital", m: "Large hospital • Goudi area", tag: "Health" },
  { t: "Attikon University Hospital", m: "Major hospital in Haidari", tag: "Health" },

  { t: "National and Kapodistrian University of Athens", m: "Main university • center", tag: "Uni" },
  { t: "National Technical University of Athens (NTUA)", m: "Polytechnic • Zografou", tag: "Uni" },

  { t: "Pangrati", m: "Trendy food & cafés", tag: "Food" },
  { t: "Petralona", m: "Tavernas • local", tag: "Food" },
  { t: "Kifisia", m: "North suburbs • shops & cafés", tag: "Food" },

  { t: "pharmacy near me", m: "Scan nearby pharmacies", tag: "Near" },
  { t: "atm near me", m: "Scan nearby ATMs", tag: "Near" },
  { t: "supermarket near me", m: "Scan nearby supermarkets", tag: "Near" },
  { t: "cafe near me", m: "Scan nearby cafés", tag: "Near" },
  { t: "restaurant near me", m: "Scan nearby restaurants", tag: "Near" },
  { t: "gas station near me", m: "Scan nearby fuel stations", tag: "Near" },
  { t: "hospital near me", m: "Scan nearby hospitals", tag: "Near" },
  { t: "parking near me", m: "Scan nearby parking", tag: "Near" },

  { t: "Pedion tou Areos", m: "Large city park", tag: "Park" },
  { t: "National Garden Athens", m: "Park near Syntagma", tag: "Park" },
  { t: "Kerameikos", m: "Ancient cemetery • area", tag: "Landmark" },
  { t: "Kallithea", m: "Urban area near SNFCC", tag: "Area" },
  { t: "Nea Smyrni", m: "Square • cafés • local", tag: "Area" },
  { t: "Zografou", m: "Student area near NTUA", tag: "Area" },
  { t: "Marousi", m: "North Athens • malls", tag: "Area" }
];

const PLACEHOLDERS = [
  "Search in Athens (e.g., Acropolis, Syntagma, Lidl)…",
  "Try: ‘pharmacy near me’ or ‘atm near me’…",
  "Try: ‘Plaka’, ‘Monastiraki’, ‘Lycabettus Hill’…",
  "Paste coords: 37.9756, 23.7347",
  "Try: ‘Stavros Niarchos’ or ‘Acropolis Museum’…"
];

let phIdx = 0;
function rotatePlaceholder() {
  const q = $("q");
  if (!q) return;
  phIdx = (phIdx + 1) % PLACEHOLDERS.length;
  q.placeholder = PLACEHOLDERS[phIdx];
}
setInterval(rotatePlaceholder, 6500);

// Suggest UI
let suggActive = -1;

function showSuggest() {
  if ($("suggest")) $("suggest").classList.add("show");
}
function hideSuggest() {
  if ($("suggest")) $("suggest").classList.remove("show");
  suggActive = -1;
  const list = $("suggestList");
  if (!list) return;
  [...list.querySelectorAll(".sItem")].forEach((x) => x.classList.remove("active"));
}

function scoreSuggestion(q, t, m) {
  if (t.startsWith(q)) return 100;
  if (t.includes(q)) return 70;
  const parts = q.split(/\s+/).filter(Boolean);
  let hit = 0;
  for (const p of parts) {
    if (t.includes(p)) hit += 18;
    else if (m.includes(p)) hit += 8;
  }
  return hit;
}

function filterSuggestions(q) {
  const s = (q || "").trim().toLowerCase();
  if (!s) return [];
  return SUGGESTIONS
    .map((x) => ({ ...x, _score: scoreSuggestion(s, x.t.toLowerCase(), (x.m || "").toLowerCase()) }))
    .filter((x) => x._score > 0)
    .sort((a, b) => b._score - a._score);
}

function renderSuggest(items) {
  const list = $("suggestList");
  if (!list) return;
  list.innerHTML = "";
  const frag = document.createDocumentFragment();

  items.slice(0, 10).forEach((it, idx) => {
    const row = document.createElement("div");
    row.className = "sItem";
    row.dataset.idx = String(idx);
    row.innerHTML = `
      <div class="sTxt">
        <div class="t">${escapeHtml(it.t)}</div>
        <div class="m">${escapeHtml(it.m || "")}</div>
      </div>
      <div class="sTag">${escapeHtml(it.tag || "Idea")}</div>
    `;
    row.addEventListener("click", () => {
      $("q").value = it.t;
      hideSuggest();
      doSearch();
    });
    frag.appendChild(row);
  });

  list.appendChild(frag);
  if (items.length) showSuggest();
  else hideSuggest();
}

if ($("q")) {
  $("q").addEventListener("input", () => {
    const items = filterSuggestions($("q").value);
    renderSuggest(items);
  });
  $("q").addEventListener("focus", () => {
    const items = filterSuggestions($("q").value);
    if (items.length) renderSuggest(items);
  });
  $("q").addEventListener("keydown", (e) => {
    const suggest = $("suggest");
    const list = $("suggestList");
    if (!suggest || !list) return;
    if (!suggest.classList.contains("show")) return;

    const items = [...list.querySelectorAll(".sItem")];
    if (!items.length) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      suggActive = clamp(suggActive + 1, 0, items.length - 1);
      items.forEach((x) => x.classList.remove("active"));
      items[suggActive].classList.add("active");
      items[suggActive].scrollIntoView({ block: "nearest" });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      suggActive = clamp(suggActive - 1, -1, items.length - 1);
      items.forEach((x) => x.classList.remove("active"));
      if (suggActive >= 0) {
        items[suggActive].classList.add("active");
        items[suggActive].scrollIntoView({ block: "nearest" });
      }
    } else if (e.key === "Enter") {
      if (suggActive >= 0) {
        e.preventDefault();
        const txt = items[suggActive].querySelector(".t")?.textContent || "";
        $("q").value = txt;
        hideSuggest();
        doSearch();
      } else {
        hideSuggest();
      }
    } else if (e.key === "Escape") {
      hideSuggest();
    }
  });
}

document.addEventListener("click", (e) => {
  if (e.target.closest(".searchWrap")) return;
  hideSuggest();
});

// ---------- Near Me: OPEN ONLY when Near button is pressed ----------
const nearPanel = $("nearPanel");
const nearHandle = $("nearHandle");

const NEAR_STATE = { closed: "closed", open: "open" };
let nearState = NEAR_STATE.closed;

function measureNearHeights() {
  if (!nearPanel) return { panelH: 0, peek: 64 };
  const rect = nearPanel.getBoundingClientRect();
  const panelH = rect.height;
  const peek = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--nearPeek")) || 64;
  return { panelH, peek };
}

function currentNearY() {
  if (!nearPanel) return 0;
  const v = getComputedStyle(nearPanel).getPropertyValue("--nearY").trim();
  const n = parseFloat(v.replace("px", ""));
  return isFinite(n) ? n : 0;
}

function setNearState(state) {
  if (!nearPanel) return;
  nearState = state;

  const { panelH } = measureNearHeights();
  let y;

  if (state === NEAR_STATE.open) {
    y = 0;
    if ($("nearSub")) $("nearSub").textContent = "Drag down to close • Tap a place to select";
  } else {
    // fully off-screen
    y = panelH + 24;
    if ($("nearSub")) $("nearSub").textContent = "Closed";
  }

  nearPanel.style.setProperty("--nearY", `${y}px`);
}

// Start fully closed on load
setTimeout(() => setNearState(NEAR_STATE.closed), 0);

// Dock Near toggles open/closed
if ($("dockNear")) {
  $("dockNear").addEventListener("click", () => {
    setDockActive("dockNear");
    if (nearState === NEAR_STATE.open) setNearState(NEAR_STATE.closed);
    else setNearState(NEAR_STATE.open);
  });
}

// X closes
if ($("nearClose")) {
  $("nearClose").addEventListener("click", (e) => {
    e.stopPropagation();
    setNearState(NEAR_STATE.closed);
    toast("Near Me closed.");
  });
}

// Handle click toggles too
if (nearHandle) {
  nearHandle.addEventListener("click", (e) => {
    if (e.target.closest("#nearClose")) return;
    if (nearState === NEAR_STATE.open) setNearState(NEAR_STATE.closed);
    else setNearState(NEAR_STATE.open);
  });
}

// Drag (snap open/closed only)
let drag = { active: false, startY: 0, startOffset: 0, panelH: 0 };

function beginDrag(clientY) {
  if (!nearPanel) return;
  const m = measureNearHeights();
  drag = {
    active: true,
    startY: clientY,
    startOffset: currentNearY(),
    panelH: m.panelH
  };
  nearPanel.classList.add("dragging");
}

function moveDrag(clientY) {
  if (!drag.active || !nearPanel) return;
  const dy = clientY - drag.startY;
  let next = drag.startOffset + dy;
  next = clamp(next, 0, drag.panelH + 24);
  nearPanel.style.setProperty("--nearY", `${next}px`);
}

function endDrag() {
  if (!drag.active || !nearPanel) return;
  drag.active = false;
  nearPanel.classList.remove("dragging");

  const y = currentNearY();
  const closedY = drag.panelH + 24;

  // If pulled down enough -> close
  if (y > closedY * 0.35) setNearState(NEAR_STATE.closed);
  else setNearState(NEAR_STATE.open);
}

if (nearHandle) {
  nearHandle.addEventListener("pointerdown", (e) => {
    nearHandle.setPointerCapture?.(e.pointerId);
    beginDrag(e.clientY);
  });
  nearHandle.addEventListener("pointermove", (e) => moveDrag(e.clientY));
  nearHandle.addEventListener("pointerup", endDrag);
  nearHandle.addEventListener("pointercancel", endDrag);
}

// ---------- Search (CPYA → Nominatim, Athens-only bbox) ----------
function normalizeQuery(q) {
  return (q || "").trim();
}
function likelyCoords(q) {
  const s = q.replace(/\s+/g, " ").trim();
  const m = s.match(/^(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = parseFloat(m[1]);
  const lon = parseFloat(m[2]);
  if (!isFinite(lat) || !isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

function cpyaEnabled() {
  return getSwitch($("swCPYA"));
}

async function tryCPYA(q) {
  if (!cpyaEnabled()) return null;

  const custom = normalizeQuery($("cpyaEndpoint")?.value);
  const endpoints = [];
  if (custom) endpoints.push(custom);
  endpoints.push("/api/where", "/where", "/search");

  const variants = [
    (ep) => `${ep}?q=${encodeURIComponent(q)}`,
    (ep) => `${ep}?query=${encodeURIComponent(q)}`,
    (ep) => `${ep}?text=${encodeURIComponent(q)}`
  ];

  for (const ep of endpoints) {
    for (const v of variants) {
      const url = v(ep);
      try {
        const res = await fetch(url, { headers: { Accept: "application/json" } });
        if (!res.ok) continue;
        const data = await res.json();
        const parsed = parseCPYAResponse(data);
        if (parsed && parsed.length) return parsed;
      } catch (_) {}
    }
  }
  return null;
}

function parseCPYAResponse(data) {
  if (!data) return null;
  if (Array.isArray(data)) {
    return data
      .map((x) => ({
        name: x.name || x.display_name || x.title || "Result",
        lat: Number(x.lat ?? x.latitude ?? x.coordinates?.[0]),
        lon: Number(x.lon ?? x.lng ?? x.longitude ?? x.coordinates?.[1]),
        display: x.display_name || x.address || x.name || x.title || "",
        tags: x.tags || x.category || x.type || null
      }))
      .filter((x) => isFinite(x.lat) && isFinite(x.lon));
  }
  if (Array.isArray(data.results)) return parseCPYAResponse(data.results);

  const lat = Number(data.lat ?? data.latitude ?? data.coordinates?.[0]);
  const lon = Number(data.lon ?? data.lng ?? data.longitude ?? data.coordinates?.[1]);
  if (isFinite(lat) && isFinite(lon)) {
    return [
      {
        name: data.name || data.display_name || data.title || "Result",
        lat,
        lon,
        display: data.display_name || data.address || "",
        tags: data.tags || data.category || data.type || null
      }
    ];
  }
  return null;
}

async function nominatimSearch(q) {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format", "json");
  url.searchParams.set("q", q);
  url.searchParams.set("limit", "8");
  url.searchParams.set("bounded", "1");
  url.searchParams.set(
    "viewbox",
    `${ATHENS_BBOX.west},${ATHENS_BBOX.north},${ATHENS_BBOX.east},${ATHENS_BBOX.south}`
  );
  url.searchParams.set("addressdetails", "1");

  const res = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "User-Agent": "athens-nav (educational)"
    }
  });
  if (!res.ok) throw new Error("Search failed");
  const arr = await res.json();
  return (arr || [])
    .map((x) => ({
      name: x.display_name?.split(",")[0] || "Result",
      lat: Number(x.lat),
      lon: Number(x.lon),
      display: x.display_name || "",
      tags: x.type || x.class || null
    }))
    .filter((x) => isFinite(x.lat) && isFinite(x.lon));
}

// ---------- “AI Overview” ----------
function aiOverviewForPlace(name, display = "", tags = null) {
  const n = (name || "").toLowerCase();
  const d = (display || "").toLowerCase();
  const t = String(tags || "").toLowerCase();

  if (n.includes("lidl")) return "Lidl is a supermarket known for affordability and everyday essentials.";
  if (n.includes("sklavenit")) return "Sklavenitis is a major Greek supermarket chain with wide selection.";
  if (n.includes("ab") && (n.includes("vass") || d.includes("vass")))
    return "AB Vassilopoulos is a popular supermarket chain with many locations across Athens.";
  if (n.includes("jumbo")) return "Jumbo is a big-box store for home goods, toys, stationery, and budget items.";
  if (n.includes("public")) return "Public focuses on electronics, gadgets, books, and tech accessories.";
  if (n.includes("ikea")) return "IKEA offers furniture, home solutions, and accessories (flat-pack style).";

  if (n.includes("museum") || d.includes("museum")) return "A museum: explore collections such as archaeology, art, or history.";
  if (n.includes("hospital") || d.includes("hospital") || t.includes("hospital"))
    return "A hospital: emergency care, clinics, and specialist medical services.";
  if (n.includes("pharmacy") || d.includes("pharmacy") || t.includes("pharmacy"))
    return "A pharmacy: prescriptions, medicines, and basic health products.";
  if (n.includes("atm") || d.includes("atm")) return "An ATM: withdraw cash and basic banking actions.";
  if (n.includes("cafe") || d.includes("cafe") || t.includes("cafe")) return "A café: coffee, snacks, and seating.";
  if (n.includes("restaurant") || d.includes("restaurant") || t.includes("restaurant"))
    return "A restaurant: sit-down dining and meals.";
  if (n.includes("parking") || d.includes("parking") || t.includes("parking"))
    return "Parking: car spots—some may be paid or time-limited.";
  if (n.includes("port") || n.includes("piraeus"))
    return "A port area: ferries, ship terminals, and transport connections.";

  if (n.includes("acropolis")) return "The Acropolis is Athens’ historic hilltop citadel with iconic monuments.";
  if (n.includes("parthenon")) return "The Parthenon is the most famous ancient temple and a symbol of classical Greece.";
  if (n.includes("syntagma")) return "Syntagma Square is central Athens’ main square and a major transport hub.";
  if (n.includes("monastiraki")) return "Monastiraki is lively, known for the flea market and easy old-town access.";
  if (n.includes("plaka")) return "Plaka is the historic neighborhood under the Acropolis with classic Athens scenery.";

  return "A place in Athens. Confirm the address/category, then pin it and route.";
}

function aiBadgeForPlace(name, display = "", tags = null) {
  const n = (name || "").toLowerCase();
  const d = (display || "").toLowerCase();
  const t = String(tags || "").toLowerCase();
  if (n.includes("lidl") || n.includes("sklavenit") || n.includes("ab") || d.includes("supermarket")) return "Shopping";
  if (n.includes("museum") || d.includes("museum")) return "Culture";
  if (n.includes("acropolis") || n.includes("parthenon") || n.includes("temple") || n.includes("stadium")) return "Landmark";
  if (t.includes("hospital") || n.includes("hospital")) return "Health";
  if (t.includes("pharmacy") || n.includes("pharmacy")) return "Health";
  if (t.includes("cafe") || n.includes("cafe")) return "Food";
  if (t.includes("restaurant") || n.includes("restaurant")) return "Food";
  if (n.includes("port") || n.includes("airport") || n.includes("station")) return "Transport";
  return "Overview";
}

function renderResults(results, q) {
  clearPanelList();
  if (!results || results.length === 0) {
    addPanelCard(makeInfoCard("No results in Athens", "Try a landmark. Or paste coordinates."));
    showPanel("No results", "Athens-only search returned nothing.");
    return;
  }

  showPanel(`Results (${results.length})`, `Tap a result to set destination • “${q}”`);

  const list = document.createElement("div");
  list.className = "list";

  results.forEach((r) => {
    const overview = aiOverviewForPlace(r.name, r.display, r.tags);
    const badge = aiBadgeForPlace(r.name, r.display, r.tags);

    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <div class="row">
        <div style="min-width:0;">
          <div class="name">${escapeHtml(r.name || "Result")}</div>
          <div class="addr">${escapeHtml(r.display || "")}</div>
        </div>
        <span class="chip primary" data-act="select">Select</span>
      </div>

      <div class="aiBox">
        <div class="aiTop">
          <div class="label">AI Overview</div>
          <div class="badge">${escapeHtml(badge)}</div>
        </div>
        <div class="aiText">${escapeHtml(overview)}</div>
      </div>

      <div class="chips">
        <span class="chip" data-act="center">Center</span>
        <span class="chip" data-act="route">Route</span>
        <span class="chip" data-act="copy">Copy coords</span>
      </div>
    `;

    card.addEventListener("click", (e) => {
      const act = e.target?.dataset?.act;
      if (!act) return;

      if (act === "select") {
        selectResult(r);
      } else if (act === "center") {
        map.setView([r.lat, r.lon], Math.max(map.getZoom(), 15), { animate: true });
        toast("Centered.");
      } else if (act === "route") {
        selectResult(r);
        buildRoute();
      } else if (act === "copy") {
        copyToClipboard(`${r.lat.toFixed(6)}, ${r.lon.toFixed(6)}`);
        toast("Copied.");
      }
    });

    list.appendChild(card);
  });

  addPanelCard(list);
}

function selectResult(r) {
  selectedResult = r;

  clearDestination();
  clearSearchMarkers();

  const marker = L.marker([r.lat, r.lon]).addTo(map).bindPopup(`<b>${escapeHtml(r.name || "Destination")}</b>`);
  searchMarkers.push(marker);
  destMarker = marker;

  showPanel("Selected", r.display || r.name || "");
  renderSelectedCard(r);

  if (autoFit) {
    const b = L.latLngBounds([[r.lat, r.lon]]);
    if (userLatLng) b.extend(userLatLng);
    map.fitBounds(b.pad(0.22), { animate: true });
  } else {
    map.panTo([r.lat, r.lon], { animate: true });
  }
}

function renderSelectedCard(r) {
  clearPanelList();
  const overview = aiOverviewForPlace(r.name, r.display, r.tags);
  const badge = aiBadgeForPlace(r.name, r.display, r.tags);

  const card = document.createElement("div");
  card.className = "card";
  card.innerHTML = `
    <div class="name">${escapeHtml(r.name || "Destination")}</div>
    <div class="addr">${escapeHtml(r.display || "")}</div>

    <div class="aiBox">
      <div class="aiTop">
        <div class="label">AI Overview</div>
        <div class="badge">${escapeHtml(badge)}</div>
      </div>
      <div class="aiText">${escapeHtml(overview)}</div>
    </div>

    <div class="chips">
      <span class="chip primary" id="btnRouteNow">Route</span>
      <span class="chip" id="btnCenterNow">Center</span>
      <span class="chip" id="btnCopyNow">Copy coords</span>
      <span class="chip" id="btnUnselect">Unselect</span>
    </div>
  `;
  addPanelCard(card);

  $("btnRouteNow")?.addEventListener("click", buildRoute);
  $("btnCenterNow")?.addEventListener("click", () => map.setView([r.lat, r.lon], Math.max(map.getZoom(), 15), { animate: true }));
  $("btnCopyNow")?.addEventListener("click", () => {
    copyToClipboard(`${r.lat.toFixed(6)}, ${r.lon.toFixed(6)}`);
    toast("Copied.");
  });
  $("btnUnselect")?.addEventListener("click", () => {
    selectedResult = null;
    toast("Unselected.");
    showPanel("Ready", "Tap the map to drop a pin • or Search • then Route.");
    clearPanelList();
    addPanelCard(makeInfoCard("Tip", "Routing controls are on the home screen. Near Me opens only when you press Near."));
  });
}

async function doSearch() {
  setDockActive("dockSearch");
  hideSuggest();

  const q = normalizeQuery($("q")?.value);
  if (!q) {
    toast("Type a place to search.");
    return;
  }

  if (q.toLowerCase().includes("near me")) {
    toast("Press Near to scan nearby places.");
    return;
  }

  const coords = likelyCoords(q);
  if (coords) {
    if (athensLock && !inBbox(coords.lat, coords.lon, ATHENS_BBOX)) {
      toast("Outside Athens lock.");
      showPanel("Outside Athens", "Those coordinates are outside the Athens-only area.");
      return;
    }
    setDestination(coords.lat, coords.lon, "Coordinates");
    return;
  }

  clearRoute();
  clearDestination();
  clearSearchMarkers();

  showPanel("Searching…", `Looking for “${q}” in Athens.`);
  clearPanelList();
  addPanelCard(makeInfoCard("Searching…", "CPYA backend first, then Nominatim fallback."));

  try {
    let results = await tryCPYA(q);
    if (!results || results.length === 0) results = await nominatimSearch(q);

    results = (results || []).filter((r) => inBbox(r.lat, r.lon, ATHENS_BBOX));
    renderResults(results, q);
  } catch (e) {
    clearPanelList();
    addPanelCard(makeInfoCard("Search failed", "Network/provider issue. Try again."));
    showPanel("Search failed", "Please retry.");
  }
}

if ($("btnGo")) $("btnGo").addEventListener("click", doSearch);
if ($("q")) $("q").addEventListener("keydown", (e) => {
  if (e.key === "Enter") doSearch();
});

// ---------- Routing: different routers per mode ----------
function routerForMode(mode) {
  if (mode === "driving") return L.Routing.osrmv1({ serviceUrl: "https://router.project-osrm.org/route/v1" });
  if (mode === "walking") return L.Routing.osrmv1({ serviceUrl: "https://routing.openstreetmap.de/routed-foot/route/v1" });
  return L.Routing.osrmv1({ serviceUrl: "https://routing.openstreetmap.de/routed-bike/route/v1" });
}

function modeLabel() {
  if (routeMode === "walking") return "Walking";
  if (routeMode === "cycling") return "Cycling";
  return "Driving";
}

function setSegActive() {
  $("segDrive")?.classList.toggle("active", routeMode === "driving");
  $("segWalk")?.classList.toggle("active", routeMode === "walking");
  $("segBike")?.classList.toggle("active", routeMode === "cycling");
}

function setMode(mode) {
  routeMode = mode;
  sSet(STORE.mode, routeMode);

  // home badge
  if ($("modeBadgeHome")) $("modeBadgeHome").textContent = modeLabel();
  // (optional: if you kept drawer badge text somewhere)
  if ($("modeBadge")) $("modeBadge").textContent = modeLabel();

  setSegActive();
  toast(`Mode: ${modeLabel()}`);
}

$("segDrive")?.addEventListener("click", () => setMode("driving"));
$("segWalk")?.addEventListener("click", () => setMode("walking"));
$("segBike")?.addEventListener("click", () => setMode("cycling"));

setSegActive();
if ($("modeBadgeHome")) $("modeBadgeHome").textContent = modeLabel();
if ($("modeBadge")) $("modeBadge").textContent = modeLabel();

// ✅ HOME toggles (routing options are NOT in settings anymore)
bindSwitch($("swFitHome"), autoFit, (v) => {
  autoFit = v;
  sSetBool(STORE.fit, v);
});
bindSwitch($("swStepsHome"), showSteps, (v) => {
  showSteps = v;
  sSetBool(STORE.steps, v);
});

$("btnHomeRouteInfo")?.addEventListener("click", () => {
  toast("Tip: switch mode if route looks wrong. Driving/Walking/Cycling uses different routers.");
});

function buildRoute() {
  setDockActive("dockRoute");

  if (!userLatLng) {
    toast("We need your location.");
    showPanel("Need your location", "Tap Locate or allow location, then Route again.");
    return;
  }

  let dest = null;
  let destName = "Destination";

  if (selectedResult) {
    dest = L.latLng(selectedResult.lat, selectedResult.lon);
    destName = selectedResult.name || destName;
  } else if (destMarker) {
    dest = destMarker.getLatLng();
    destName = destMarker.options?.title || "Dropped pin";
  }

  if (!dest) {
    toast("Tap map or search first.");
    showPanel("No destination", "Tap the map to drop a pin, or search a place.");
    return;
  }

  if (athensLock && !inBbox(dest.lat, dest.lng, ATHENS_BBOX)) {
    toast("Destination outside Athens lock.");
    return;
  }

  clearRoute();

  showPanel("Routing…", `${modeLabel()} • from you to ${destName}`);
  clearPanelList();
  addPanelCard(makeInfoCard("Calculating route…", "If it looks wrong, switch Driving/Walking/Cycling on the home screen."));

  routingControl = L.Routing.control({
    waypoints: [L.Routing.waypoint(userLatLng, "You"), L.Routing.waypoint(dest, destName)],
    router: routerForMode(routeMode),
    addWaypoints: false,
    draggableWaypoints: false,
    fitSelectedRoutes: false,
    show: false,
    routeWhileDragging: false,
    lineOptions: { addWaypoints: false, styles: [{ opacity: 0.9, weight: 6 }] },
    createMarker: function (i, wp) {
      if (i === 0) return L.circleMarker(wp.latLng, { radius: 8, weight: 2, opacity: 1, fillOpacity: 0.9 });
      return L.marker(wp.latLng);
    }
  }).addTo(map);

  routingControl.on("routesfound", (e) => {
    const route = e.routes?.[0];
    if (!route) return;

    if (routingLine) {
      try { map.removeLayer(routingLine); } catch {}
    }
    routingLine = L.polyline(route.coordinates, { weight: 6, opacity: 0.9 }).addTo(map);

    if (autoFit) map.fitBounds(routingLine.getBounds().pad(0.15), { animate: true });

    renderRoute(route, destName);
    toast("Route ready.");
  });

  routingControl.on("routingerror", () => {
    clearPanelList();
    addPanelCard(makeInfoCard("Routing failed", "Provider/network error. Try again or switch mode."));
    showPanel("Routing failed", "Try again.");
    toast("Routing failed.");
  });
}

function renderRoute(route, destName) {
  clearPanelList();

  const dist = route.summary?.totalDistance ?? null;
  const time = route.summary?.totalTime ?? null;

  const top = document.createElement("div");
  top.className = "card";
  top.innerHTML = `
    <div class="row">
      <div style="min-width:0;">
        <div class="name">${modeLabel()} route</div>
        <div class="addr">To: ${escapeHtml(destName)}</div>
      </div>
      <div style="text-align:right;flex:0 0 auto;">
        <div style="font-weight:900;font-size:14px;">${formatDist(dist)}</div>
        <div style="color:rgba(234,240,255,.72);font-size:12px;">${formatTime(time)}</div>
      </div>
    </div>
    <div class="chips">
      <span class="chip primary" id="btnRecalcNow">Recalculate</span>
      <span class="chip" id="btnClearRoute">Clear route</span>
      <span class="chip" id="btnModeHint">Mode: ${modeLabel()}</span>
    </div>
  `;
  addPanelCard(top);

  $("btnRecalcNow")?.addEventListener("click", buildRoute);
  $("btnClearRoute")?.addEventListener("click", () => {
    clearRoute();
    toast("Route cleared.");
    showPanel("Ready", "Tap the map to drop a pin • or Search • then Route.");
    clearPanelList();
    addPanelCard(makeInfoCard("Tip", "Press Near only when needed. Routing controls are on the home screen."));
  });
  $("btnModeHint")?.addEventListener("click", () => toast("Change Driving/Walking/Cycling on the home screen."));

  if (showSteps) {
    const stepsCard = document.createElement("div");
    stepsCard.className = "card";
    stepsCard.innerHTML = `<div class="name">Turn-by-turn</div><div class="addr">Tap a step to center.</div>`;
    addPanelCard(stepsCard);

    const steps = extractSteps(route);
    if (!steps.length) {
      addPanelCard(makeInfoCard("Steps unavailable", "This router did not provide instructions."));
      showPanel("Route ready", `${formatDist(dist)} • ${formatTime(time)} • ${modeLabel()}`);
      return;
    }

    const wrap = document.createElement("div");
    wrap.className = "list";

    steps.slice(0, 60).forEach((s) => {
      const item = document.createElement("div");
      item.className = "step";
      item.innerHTML = `
        <div class="stepLeft">
          <div class="stepIcon">${stepIconSVG(s.type)}</div>
          <div class="stepText">
            <div class="t">${escapeHtml(s.text)}</div>
            <div class="s">${escapeHtml(s.road || "")}</div>
          </div>
        </div>
        <div class="stepDist">${s.dist ? formatDist(s.dist) : ""}</div>
      `;
      item.addEventListener("click", () => {
        if (s.lat != null && s.lon != null) map.panTo([s.lat, s.lon], { animate: true });
      });
      wrap.appendChild(item);
    });

    addPanelCard(wrap);
  }

  showPanel("Route ready", `${formatDist(dist)} • ${formatTime(time)} • ${modeLabel()}`);
}

function extractSteps(route) {
  const out = [];

  if (Array.isArray(route.instructions)) {
    for (const ins of route.instructions) {
      out.push({
        text: ins.text || ins.instruction || "Continue",
        dist: ins.distance ?? ins.dist ?? null,
        type: normalizeType(ins.type || ins.modifier || ""),
        road: ins.road || ins.name || "",
        lat: ins.latLng?.lat ?? ins.lat ?? null,
        lon: ins.latLng?.lng ?? ins.lon ?? null
      });
    }
    return out;
  }

  const leg = route.legs?.[0];
  if (leg && Array.isArray(leg.steps)) {
    for (const st of leg.steps) {
      const man = st.maneuver || {};
      out.push({
        text: st.instruction || buildTextFromManeuver(man, st.name),
        dist: st.distance ?? null,
        type: normalizeType(man.type || man.modifier || ""),
        road: st.name || "",
        lat: man.location ? man.location[1] : null,
        lon: man.location ? man.location[0] : null
      });
    }
  }

  return out;
}

function buildTextFromManeuver(m, road) {
  const t = (m.type || "continue").replaceAll("_", " ");
  const mod = m.modifier ? ` (${m.modifier})` : "";
  return `${t}${mod}${road ? " onto " + road : ""}`;
}

function normalizeType(t) {
  const s = String(t || "").toLowerCase();
  if (s.includes("uturn") || s === "uturn") return "uturn";
  if (s.includes("roundabout")) return "roundabout";
  if (s.includes("left")) return "left";
  if (s.includes("right")) return "right";
  if (s.includes("straight") || s.includes("continue") || s.includes("depart")) return "straight";
  if (s.includes("arrive") || s.includes("destination")) return "arrive";
  return "straight";
}

function stepIconSVG(type) {
  const c = "currentColor";
  if (type === "left")
    return `
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M14 6l-6 6 6 6" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M8 12h10" stroke="${c}" stroke-width="2" stroke-linecap="round"/>
    </svg>`;
  if (type === "right")
    return `
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M10 6l6 6-6 6" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M6 12h10" stroke="${c}" stroke-width="2" stroke-linecap="round"/>
    </svg>`;
  if (type === "uturn")
    return `
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M17 7v6a5 5 0 1 1-5-5h7" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  if (type === "roundabout")
    return `
    <svg viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="5" stroke="${c}" stroke-width="2"/>
      <path d="M12 2v4M22 12h-4M12 22v-4M2 12h4" stroke="${c}" stroke-width="2" stroke-linecap="round"/>
    </svg>`;
  if (type === "arrive")
    return `
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M6 4v16M6 4l12 4-12 4" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  return `
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M12 5v14M5 12h14" stroke="${c}" stroke-width="2" stroke-linecap="round"/>
    </svg>`;
}

// ---------- Clipboard ----------
function copyToClipboard(txt) {
  try {
    navigator.clipboard.writeText(txt);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = txt;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  }
}

// ---------- Near Me scan ----------
function overpassQuery(type, lat, lon, radius) {
  const mapT = {
    pharmacy: '["amenity"="pharmacy"]',
    atm: '["amenity"="atm"]',
    supermarket: '["shop"="supermarket"]',
    cafe: '["amenity"="cafe"]',
    restaurant: '["amenity"="restaurant"]',
    fuel: '["amenity"="fuel"]',
    hospital: '["amenity"="hospital"]',
    police: '["amenity"="police"]',
    parking: '["amenity"="parking"]'
  };
  const f = mapT[type] || mapT.pharmacy;

  return `
[out:json][timeout:25];
(
  node${f}(around:${radius},${lat},${lon});
  way${f}(around:${radius},${lat},${lon});
);
out center;
`;
}

async function nearScan() {
  if (!userLatLng) {
    toast("Need your location.");
    return;
  }

  const type = $("nearType")?.value || "pharmacy";
  const radius = Number($("nearRadius")?.value || 800);

  if ($("nearList")) $("nearList").innerHTML = "<div class='hint'>Scanning…</div>";

  try {
    const res = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      body: overpassQuery(type, userLatLng.lat, userLatLng.lng, radius)
    });

    const data = await res.json();
    renderNearResults(data.elements || []);
  } catch {
    if ($("nearList")) $("nearList").innerHTML = "<div class='hint'>Scan failed.</div>";
  }
}

function renderNearResults(elements) {
  const list = $("nearList");
  if (!list) return;

  list.innerHTML = "";

  if (!elements.length) {
    list.innerHTML = "<div class='hint'>No results nearby.</div>";
    return;
  }

  elements.slice(0, 24).forEach((elx) => {
    const lat = elx.lat || elx.center?.lat;
    const lon = elx.lon || elx.center?.lon;
    if (!lat || !lon) return;

    const name = elx.tags?.name || "Place";

    const div = document.createElement("div");
    div.className = "card";
    div.innerHTML = `
      <div class="name">${escapeHtml(name)}</div>
      <div class="addr">${escapeHtml(elx.tags?.addr?.street || elx.tags?.["addr:street"] || "")}</div>
      <div class="chips">
        <span class="chip primary">Select</span>
        <span class="chip" data-act="center">Center</span>
      </div>
    `;

    div.addEventListener("click", (e) => {
      const act = e.target?.dataset?.act;
      if (act === "center") {
        map.setView([lat, lon], Math.max(map.getZoom(), 16), { animate: true });
        return;
      }
      setDestination(lat, lon, name);
      toast("Selected from Near Me.");
      setNearState(NEAR_STATE.closed);
    });

    list.appendChild(div);
  });
}

$("nearGo")?.addEventListener("click", nearScan);

// ---------- Settings binding (only non-routing) ----------
bindSwitch($("swLock"), athensLock, (v) => {
  athensLock = v;
  sSetBool(STORE.lock, v);
  applyAthensLock();
});

bindSwitch($("swCPYA"), sGetBool(STORE.cpya, true), (v) => {
  sSetBool(STORE.cpya, v);
});

bindSwitch($("swRememberLoc"), rememberLoc, (v) => {
  rememberLoc = v;
  sSetBool(STORE.rememberLoc, v);
});

$("btnAskLoc")?.addEventListener("click", () => requestLocation());
$("btnRecenter")?.addEventListener("click", () => map.setView(ATHENS_CENTER, 13));

// ---------- Time + Weather ----------
function updateClock() {
  const d = new Date();
  if ($("timeVal")) $("timeVal").textContent = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if ($("dateVal")) $("dateVal").textContent = d.toLocaleDateString();
}
setInterval(updateClock, 1000);
updateClock();

async function loadWeather() {
  try {
    const url = "https://api.open-meteo.com/v1/forecast?latitude=37.98&longitude=23.73&current_weather=true";
    const res = await fetch(url);
    const data = await res.json();
    const w = data.current_weather;
    if (!w) return;
    if ($("weatherVal")) $("weatherVal").textContent = `${Math.round(w.temperature)}°C`;
  } catch {}
}
loadWeather();

// ---------- Compass ----------
$("btnCompass")?.addEventListener("click", () => {
  if (typeof DeviceOrientationEvent === "undefined") {
    toast("Compass not supported.");
    return;
  }
  window.addEventListener("deviceorientation", (e) => {
    if (e.alpha == null) return;
    const heading = 360 - e.alpha;
    if ($("needle")) $("needle").style.transform = `rotate(${heading}deg)`;
    if ($("headingTxt")) $("headingTxt").textContent = `${Math.round(heading)}°`;
  });
});

// ---------- Dock ----------
$("dockSearch")?.addEventListener("click", () => {
  setDockActive("dockSearch");
  showPanel("Ready", "Search or tap map.");
});

$("dockRoute")?.addEventListener("click", buildRoute);

// ---------- Account (local-only placeholder) ----------
const AUTH_STORE = { session: "ath_nav_session" };

function getSession() {
  try {
    const raw = localStorage.getItem(AUTH_STORE.session);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function setSession(obj) {
  try {
    if (!obj) localStorage.removeItem(AUTH_STORE.session);
    else localStorage.setItem(AUTH_STORE.session, JSON.stringify(obj));
  } catch {}
}
function renderAccount() {
  const s = getSession();
  const status = $("acctStatus");
  const btnLogout = $("btnLogout");
  if (s?.email) {
    if (status) status.textContent = s.email;
    if (btnLogout) btnLogout.style.display = "";
  } else {
    if (status) status.textContent = "Guest";
    if (btnLogout) btnLogout.style.display = "none";
  }
}

function openAuth() {
  const o = $("authOverlay");
  const m = $("authModal");
  if (o) o.style.display = "block";
  if (m) m.style.display = "block";
}
function closeAuth() {
  const o = $("authOverlay");
  const m = $("authModal");
  if (o) o.style.display = "none";
  if (m) m.style.display = "none";
}

let authMode = "login"; // login | create
function setAuthMode(mode) {
  authMode = mode;
  $("authTabLogin")?.classList.toggle("active", mode === "login");
  $("authTabCreate")?.classList.toggle("active", mode === "create");
  if ($("btnAuthSubmit")) $("btnAuthSubmit").textContent = mode === "login" ? "Log in" : "Create account";
  if ($("authSub")) $("authSub").textContent = mode === "login" ? "Log in (local only)" : "Create account (local only)";
}

$("btnOpenAuth")?.addEventListener("click", openAuth);
$("btnCloseAuth")?.addEventListener("click", closeAuth);
$("authOverlay")?.addEventListener("click", closeAuth);

$("authTabLogin")?.addEventListener("click", () => setAuthMode("login"));
$("authTabCreate")?.addEventListener("click", () => setAuthMode("create"));

$("btnAuthSubmit")?.addEventListener("click", () => {
  const email = ($("authEmail")?.value || "").trim();
  const pass = ($("authPass")?.value || "").trim();
  if (!email || !pass) {
    toast("Enter email + password.");
    return;
  }

  // Placeholder: accept anything and store session locally.
  setSession({ email, t: Date.now() });
  renderAccount();
  closeAuth();
  toast(authMode === "login" ? "Logged in (local)." : "Account created (local).");
});

$("btnLogout")?.addEventListener("click", () => {
  setSession(null);
  renderAccount();
  toast("Logged out.");
});

setAuthMode("login");
renderAccount();

// ---------- Loading end ----------
setTimeout(() => {
  if ($("loading")) $("loading").style.display = "none";
  setLoad(100);
  setLoadText("Ready.");
}, 900);
