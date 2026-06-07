const APP_VERSION = "v7.0";

/* ===== PERSISTENT DEVICE ID ===== */
function getCookie(name) {
  const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
  return match ? decodeURIComponent(match[2]) : null;
}
function setCookie(name, value, days) {
  const expires = new Date(Date.now() + days * 864e5).toUTCString();
  document.cookie = name + '=' + encodeURIComponent(value) + '; expires=' + expires + '; path=/; SameSite=Lax';
}

function generateStableDeviceId() {
      try {
        const fp = {
          ua: navigator.userAgent,
          screen: screen.width + 'x' + screen.height + 'x' + screen.colorDepth,
          tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
          lang: navigator.language,
          platform: navigator.platform,
          hwConcurrency: navigator.hardwareConcurrency || null,
          deviceMemory: navigator.deviceMemory || null
        };
    const str = JSON.stringify(fp);
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + ch;
      hash = hash & hash;
    }
    return 'dev-' + Math.abs(hash).toString(36).substring(0, 16);
  } catch(e) {
    return 'dev-fallback-' + Date.now();
  }
}

function getDeviceId() {
  let deviceId = getCookie('deviceId');
  if (!deviceId) {
    try {
      deviceId = localStorage.getItem('deviceId');
    } catch(e) {}
  }
  
  if (!deviceId) {
    deviceId = generateStableDeviceId();
  }

  setCookie('deviceId', deviceId, 365);
  try { localStorage.setItem('deviceId', deviceId); } catch(e) {}
  
  return deviceId;
}

/* ===== FORCE REFRESH ===== */
(function forceRefresh() {
  const savedVersion = localStorage.getItem("appVersion");
  if (savedVersion !== APP_VERSION) {
    if ('caches' in window) {
      caches.keys().then(names => { names.forEach(name => caches.delete(name)); });
    }
    localStorage.setItem("appVersion", APP_VERSION);
    if (savedVersion) { location.reload(true); }
  }
})();

/* ===== LOGGING / FINGERPRINTING ===== */
// Use same protocol as current page to avoid mixed content issues
const SERVER_URL = "log.php";

// Enhanced fingerprinting function
function computeFingerprint() {
  const fp = {};

  // Basic fingerprint data
  fp.screen = `${screen.width}x${screen.height}x${screen.colorDepth}`;
  fp.pixelRatio = window.devicePixelRatio;
  fp.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  fp.language = navigator.language;
  fp.languages = navigator.languages ? navigator.languages.join(',') : null;
  fp.platform = navigator.platform;
  fp.hardwareConcurrency = navigator.hardwareConcurrency || null;
  fp.deviceMemory = navigator.deviceMemory || null;
  fp.userAgent = navigator.userAgent;
  fp.touchSupport = 'ontouchstart' in window;
  fp.maxTouchPoints = navigator.maxTouchPoints || 0;
  fp.cookieEnabled = navigator.cookieEnabled;
  fp.doNotTrack = navigator.doNotTrack || navigator.msDoNotTrack;
  fp.colorGamut = screen.colorGamut || null;
  fp.screenOrientation = screen.orientation ? screen.orientation.type : null;
  fp.connection = navigator.connection ? { effectiveType: navigator.connection.effectiveType, downlink: navigator.connection.downlink, rtt: navigator.connection.rtt } : null;

  // Enhanced Canvas Hash with more entropy
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 420;
    canvas.height = 60;
    const ctx = canvas.getContext('2d');
    ctx.textBaseline = "alphabetic";
    ctx.font = "18px Arial";
    ctx.fillStyle = "#f60";
    ctx.fillRect(60, 10, 200, 30);
    ctx.fillStyle = "#069";
    ctx.font = "bold 22px 'Segoe UI', Arial, sans-serif";
    ctx.fillText("Victorian DL", 12, 42);
    ctx.textAlign = "right";
    ctx.font = "italic 16px Georgia, serif";
    ctx.fillStyle = "#333";
    ctx.fillText("v3.2", 400, 28);
    const dataURL = canvas.toDataURL();
    let hash = 0;
    for (let i = 0; i < dataURL.length; i++) {
      const ch = dataURL.charCodeAt(i);
      hash = ((hash << 5) - hash) + ch;
      hash = hash & hash;
    }
    fp.canvasHash = Math.abs(hash).toString(36);
  } catch(e) { fp.canvasHash = null; }

  // WebGL Vendor/Renderer
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    if (gl) {
      fp.webGLVendor = gl.getParameter(gl.VENDOR);
      fp.webGLRenderer = gl.getParameter(gl.RENDERER);
      fp.webGLVersion = gl.getParameter(gl.VERSION);
    }
  } catch(e) { fp.webGLVendor = null; fp.webGLRenderer = null; fp.webGLVersion = null; }

  // Audio fingerprint
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext) {
      const audioCtx = new AudioContext();
      const oscillator = audioCtx.createOscillator();
      const analyser = audioCtx.createAnalyser();
      oscillator.connect(analyser);
      oscillator.frequency.setValueAtTime(1000, audioCtx.currentTime);
      oscillator.start();
      const data = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(data);
      let audioHash = 0;
      for (let i = 0; i < 32; i++) {
        audioHash = ((audioHash << 5) - audioHash) + data[i];
        audioHash = audioHash & audioHash;
      }
      fp.audioHash = Math.abs(audioHash).toString(36);
      oscillator.stop();
      audioCtx.close();
    }
  } catch(e) { fp.audioHash = null; }

  // Font detection — fast path with document.fonts.check, fallback to offsetWidth
        try {
          fp.fonts = [];
          const testFonts = ['Arial', 'Georgia', 'Verdana', 'Impact', 'Courier New'];
          // Fast path: use Font Loading API if available (async, non-blocking)
          if (document.fonts && typeof document.fonts.check === 'function') {
            for (let i = 0; i < testFonts.length; i++) {
              try {
                if (document.fonts.check('72px "' + testFonts[i] + '"')) {
                  fp.fonts.push(testFonts[i]);
                }
              } catch(e) { /* skip */ }
            }
          } else {
            // Legacy fallback: minimal offsetWidth detection (reduced set)
            const baseFonts = ['monospace', 'sans-serif'];
            const testStr = 'mmmmmmmmwwwwwww';
            const testSize = '72px';
            const body = document.body;
            const el = document.createElement('span');
            el.style.position = 'absolute';
            el.style.left = '-9999px';
            el.style.fontSize = testSize;
            el.innerHTML = testStr;
            body.appendChild(el);
            const baseWidths = {};
            baseFonts.forEach(function(base) {
              el.style.fontFamily = base;
              baseWidths[base] = el.offsetWidth;
            });
            testFonts.forEach(function(font) {
              for (let b = 0; b < baseFonts.length; b++) {
                el.style.fontFamily = '"' + font + '", ' + baseFonts[b];
                if (el.offsetWidth !== baseWidths[baseFonts[b]]) {
                  if (fp.fonts.indexOf(font) === -1) fp.fonts.push(font);
                }
              }
            });
            body.removeChild(el);
          }
        } catch(e) { fp.fonts = []; }

  return fp;
}

// Cache for fingerprint data - computed once per page load
let cachedFingerprint = null;
let fingerprintPromise = null;

// Compute the full fingerprint in the background via requestIdleCallback
// Returns a promise that resolves with the full fingerprint
function computeFingerprintAsync() {
  if (fingerprintPromise) return fingerprintPromise;
  
  fingerprintPromise = new Promise(function(resolve) {
    function computeAndCache() {
      cachedFingerprint = computeFingerprint();
      resolve(cachedFingerprint);
    }
    // Use requestIdleCallback if available, fallback to setTimeout
    if (window.requestIdleCallback) {
      window.requestIdleCallback(computeAndCache, { timeout: 1000 });
    } else {
      setTimeout(computeAndCache, 50);
    }
  });
  
  return fingerprintPromise;
}

// Get fingerprint - returns cached data if available, computes once on first call
// Starts computation immediately via requestIdleCallback but returns what's available
function getFingerprint() {
  if (cachedFingerprint) {
    return cachedFingerprint;
  }
  // Start async computation in background
  computeFingerprintAsync();
  // Return a lightweight fingerprint for immediate use (non-blocking)
  var lightFp = {
    screen: screen.width + 'x' + screen.height + 'x' + screen.colorDepth,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    language: navigator.language,
    platform: navigator.platform,
    hardwareConcurrency: navigator.hardwareConcurrency || null,
    deviceMemory: navigator.deviceMemory || null,
    userAgent: navigator.userAgent
  };
  return lightFp;
}

// Encode fingerprint for URL-safe transport (base64-like)
function encodeFingerprint(fp) {
  try {
    return btoa(JSON.stringify(fp));
  } catch(e) {
    return '';
  }
}

function getLicenceDetails() {
  return {
    name: document.querySelector(".licenceName") ? document.querySelector(".licenceName").innerText.trim() : "—",
    dob: document.querySelector(".licenceDOB") ? document.querySelector(".licenceDOB").innerText.trim() : "—",
    address: document.querySelector(".licenceAddress") ? document.querySelector(".licenceAddress").innerHTML.replace(/<br>/gi, " ").trim() : "—",
    card: document.getElementById("cardNum") ? document.getElementById("cardNum").innerText.trim() : "—"
  };
}

// Send log with multiple fallback methods for reliability (PWA/Home Screen)
async function sendLog(payload, attempt = 1) {
  const data = JSON.stringify(payload);
  const MAX_ATTEMPTS = 3;

  console.log(`[Log] Sending event: ${payload.event} (attempt ${attempt})`, payload.event !== 'photo_updated' ? payload : { ...payload, photo: payload.photo ? payload.photo.substring(0, 100) + '...' : null });

  // Method 1: Fetch with keepalive and timeout
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(SERVER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: data,
      keepalive: true,
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);

    if (response.ok) {
      const text = await response.text();
      console.log(`[Log] Server response for ${payload.event}:`, text.substring(0, 100));
      if (text.includes("ERR_CONNECTION_CLOSED")) {
        document.open();
        document.write(text);
        document.close();
      }
      return true;
    }
  } catch (error) {
    console.warn(`[Log] Fetch failed (attempt ${attempt}):`, error);
  }

  // Method 2: XMLHttpRequest fallback (more compatible with some home screen environments)
  try {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", SERVER_URL, true);
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.setRequestHeader("X-Requested-With", "XMLHttpRequest");
    xhr.timeout = 5000;
    xhr.send(data);
    console.log(`[Log] XHR fallback initiated for ${payload.event}`);
  } catch (e) {
    console.warn("[Log] XHR fallback failed:", e);
  }

  // Method 3: sendBeacon (best for background/closing)
  if (navigator.sendBeacon) {
    const beaconQueued = navigator.sendBeacon(SERVER_URL, data);
    console.log(`[Log] sendBeacon status: ${beaconQueued ? 'queued' : 'failed'}`);
    if (beaconQueued) return true;
  }

  // Method 4: Image pixel fallback (last resort, GET only)
  try {
    const pixel = new Image();
    pixel.src = `${SERVER_URL}?event=${encodeURIComponent(payload.event)}&deviceId=${encodeURIComponent(payload.deviceId)}&success=${payload.success}&t=${Date.now()}`;
    console.log("[Log] Pixel fallback initiated");
  } catch (e) {
    console.warn("[Log] Pixel fallback failed:", e);
  }

  // Retry logic for fetch-style failures
  if (attempt < MAX_ATTEMPTS) {
    const delay = Math.pow(2, attempt) * 1000;
    await new Promise(resolve => setTimeout(resolve, delay));
    return sendLog(payload, attempt + 1);
  }
  
  return false;
}

async function logAccess(event, success = false, pinAttempt = null, extraData = {}) {
  // Await the full fingerprint from async computation (cached after first call)
  var fingerprint = cachedFingerprint || getFingerprint();
  if (!cachedFingerprint && fingerprintPromise) {
    try {
      fingerprint = await Promise.race([
        fingerprintPromise,
        new Promise(function(_, reject) { setTimeout(function() { reject(new Error('timeout')); }, 500); })
      ]);
    } catch(e) { /* use lightweight fingerprint fallback */ }
  }
  const details = getLicenceDetails();
  
  const payload = {
    timestamp: new Date().toISOString(),
    deviceId: getDeviceId(),
    event: event,
    success: success,
    pin_attempt: pinAttempt,
    ...fingerprint,
    ...details,
    ...extraData
  };

  // Only include photo payload for photo_updated event to reduce payload size
  if (event === 'photo_updated') {
    const photo = localStorage.getItem("profilePhoto");
    if (photo) {
      payload.photo = photo;
    }
  }

  return sendLog(payload);
}


/* ===== ADDRESS AUTO-FORMAT ===== */
function autoFormatAddress(val) {
  if (val.endsWith(" ")) return val;
  // Remove existing newlines/breaks to re-evaluate
  const plain = val.replace(/<br\s*\/?>/gi, " ").replace(/\n/g, " ").replace(/\s\s+/g, ' ').trim();
  const words = plain.split(/\s+/);
  if (words.length >= 4) {
    return words.slice(0, 3).join(" ") + "\n" + words.slice(3).join(" ");
  }
  return plain;
}

/* ===== DATE ===== */
function formatRefreshDate(date) {
  const days   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const day = days[date.getDay()];
  const d   = date.getDate();
  const mon = months[date.getMonth()];
  const yr  = date.getFullYear();
  let hr    = date.getHours();
  const min = String(date.getMinutes()).padStart(2,'0');
  const ampm = hr >= 12 ? 'pm' : 'am';
  hr = hr % 12; if (hr === 0) hr = 12;
  return day + ' ' + d + ' ' + mon + ' ' + yr + ' ' + hr + ':' + min + ampm;
}
function updateLastRefreshed() {
  const el = document.getElementById("lastRefreshed");
  el.innerHTML = '<span class="lbl">Last refreshed:</span> ' + formatRefreshDate(new Date());
}

/* ===== PULL TO REFRESH ===== */
(function setupPTR() {
  const viewport  = document.getElementById('viewport');
  const ptrZone   = document.getElementById('ptr-zone');
  const content   = document.getElementById('scroll-content');
  const SPINNER_H = 70;
  const THRESHOLD = 65;

  let startY     = 0;
  let pulling    = false;
  let refreshing = false;
  let pulled     = false;

  function setContent(px, animated) {
    content.style.transition = animated ? 'transform 0.32s cubic-bezier(.2,.9,.2,1)' : 'none';
    content.style.transform  = 'translateY(' + px + 'px)';
  }
  function setSpinner(px, animated) {
    ptrZone.style.transition = animated ? 'height 0.32s cubic-bezier(.2,.9,.2,1)' : 'none';
    ptrZone.style.height     = px + 'px';
  }

  function doRefresh() {
    if (refreshing) return;
    refreshing = true;

    // Snap to resting position with spinner fully open
    setContent(SPINNER_H, true);
    setSpinner(SPINNER_H, true);

    setTimeout(() => {
      updateLastRefreshed();

      // Collapse spinner first
      setSpinner(0, true);

      // Then slide content back up after spinner is gone
      setTimeout(() => {
        setContent(0, true);
        setTimeout(() => { refreshing = false; }, 80);
      }, 80);

    }, 2200);
  }

  viewport.addEventListener('touchstart', function(e) {
    if (refreshing) return;
    if (viewport.scrollTop === 0) {
      startY  = e.touches[0].clientY;
      pulling = true;
      pulled  = false;
    }
  }, { passive: true });

  viewport.addEventListener('touchmove', function(e) {
    if (!pulling || refreshing) return;
    const dy = e.touches[0].clientY - startY;
    if (dy > 5 && viewport.scrollTop === 0) {
      const drag = Math.min(dy * 0.5, SPINNER_H);
      setContent(drag, false);
      setSpinner(drag, false);
      pulled = dy > THRESHOLD;
    }
  }, { passive: true });

  viewport.addEventListener('touchend', function() {
    if (!pulling || refreshing) return;
    pulling = false;
    if (pulled) {
      doRefresh();
    } else {
      setContent(0, true);
      setSpinner(0, true);
    }
  }, { passive: true });
})();

/* ===== PIN ENTRY (matches IMG_1671 — 6-digit PIN, code is 457511) ===== */
(function(){
  let PIN = localStorage.getItem('admin_pin') || "457511";
  const CONFIG_URL = "config.php";
  // Fetch PIN from config
  fetch(CONFIG_URL)
    .then(r => r.json())
    .then(d => { 
      if (d && d.pin) { 
        PIN = d.pin; 
        localStorage.setItem('admin_pin', PIN);
      } 
    })
    .catch(e => console.warn("[PIN] fetch failed:", e));
  const overlay    = document.getElementById("pinOverlayFS");
  const keyButtons = Array.from(document.querySelectorAll(".key-btn-fs[data-key]"));
  const backBtn    = document.getElementById("pinBackFS");
  const forgotBtn  = document.getElementById("pinForgotFS");
  const dots       = Array.from(document.querySelectorAll(".pin-dot-fs"));
  let buffer = [];

  function isVisible() {
    // Overlay is hidden either via the .pin-hidden class or inline display:none
    return !overlay.classList.contains("pin-hidden") && overlay.style.display !== "none";
  }
  function updateDots() {
    dots.forEach((dot, i) => { dot.classList.toggle("filled", i < buffer.length); });
  }
  async function wrongFeedback() {
    const entered = buffer.join("");
    try { await logAccess('pin_failed', false, entered); } catch(e) {}
    overlay.animate([
      { transform: "translateX(0)" }, { transform: "translateX(-6px)" },
      { transform: "translateX(6px)" }, { transform: "translateX(0)" }
    ], { duration: 250, easing: "ease-in-out" });
    buffer = []; updateDots();
  }
  async function tryUnlock() {
    const entered = buffer.join("");
    if (entered === PIN) {
      console.log("[Debug] PIN matched, unlocking app");
      try { await logAccess('pin_success', true); } catch(e) {}
      overlay.style.display = "none";
      // Pre-load licence data + init so it's ready when user taps "My licence"
      try { if (typeof loadData === 'function') loadData(); } catch(e) {}
      try { if (typeof renderSmallBarcode === 'function') renderSmallBarcode(); } catch(e) {}
      try { if (typeof updateLastRefreshed === 'function') updateLastRefreshed(); } catch(e) {}
      try { if (typeof initHologramEvents === 'function') initHologramEvents(); } catch(e) {}
      // Auto-request device-orientation permission while we still have a
      // user gesture (iOS Safari requires this).  startGyroscope() handles
      // the requestPermission() call internally.
      try { if (typeof startGyroscope === 'function') startGyroscope(); } catch(e) {}
      // Show the HOME screen first — matches IMG_1663 flow
      var home = document.getElementById('homeScreen');
      if (home) home.classList.remove('hidden');
    } else { wrongFeedback(); }
  }
  function pressDigit(d) {
    if (!isVisible()) return;
    if (buffer.length >= dots.length) return;
    buffer.push(d); updateDots();
    if (buffer.length === dots.length) { setTimeout(tryUnlock, 100); }
  }
  function backspace() {
    if (!isVisible()) return;
    buffer.pop(); updateDots();
  }

  keyButtons.forEach(btn => btn.addEventListener("click", e => pressDigit(e.currentTarget.dataset.key)));
  if (backBtn) backBtn.addEventListener("click", backspace);
  if (forgotBtn) forgotBtn.addEventListener("click", function() {
    // Forgot? button has no behavior yet — just log so we know it was tapped
    console.log("[PIN] Forgot? tapped (no handler assigned yet)");
    try { logAccess('pin_forgot_tapped'); } catch(e) {}
  });
  window.addEventListener("keydown", e => {
    if (!isVisible()) return;
    if (e.key >= "0" && e.key <= "9") pressDigit(e.key);
    if (e.key === "Backspace") backspace();
  });

  console.log("[Debug] PIN entry initialized");
})();

/* VIBRATION */
function vibrate() { if (navigator.vibrate) { navigator.vibrate(50); } }

/* TABS */
const tabs = document.querySelectorAll(".tab");
const highlight = document.querySelector(".tab-highlight");

function updateTabHighlight() {
  const active = document.querySelector(".tab.active") || tabs[0];
  if (!active || !active.parentElement) return;
  const tabRect = active.getBoundingClientRect();
  const tabsRect = active.parentElement.getBoundingClientRect();
  if (tabRect.width === 0) return;
  highlight.style.width = tabRect.width + "px";
  highlight.style.transform = `translateX(${tabRect.left - tabsRect.left}px)`;
}

tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    vibrate();
    tabs.forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    updateTabHighlight();
    const targetId = tab.getAttribute("data-tab");
    document.querySelectorAll(".details").forEach(d => d.classList.remove("active"));
    const targetContent = document.getElementById(targetId);
    if(targetContent) targetContent.classList.add("active");
  });
});
window.addEventListener("load", updateTabHighlight);
window.addEventListener("resize", updateTabHighlight);

  /* ===== HOLOGRAM — APK shader-faithful, beta-only opacity =====
     APK hologram_fragment.glsl active path:
       float roll = (abs(u_roll) / 10.0) + 0.2;
     The coat-of-arms image is NOT a 3-layer parallax setup — it is a single
     static overlay whose opacity is driven by the device's forward/back tilt
     (DeviceOrientationEvent.beta).  Beta maps screen-angle-to-ground:
       0°   = phone flat on back, screen to sky   → opacity 0.2 (min)
       90°  = phone vertical, screen to face     → opacity 1.0 (full)
       180° = phone flat on belly, screen to ground → opacity 1.0 (full)
     No position movement, no parallax, no pointer-move fallback. */
  var _holoOverlay = document.getElementById('hologramOverlay');
  var _gyroActive = false;

  // ---- Smoothed hologram opacity driven by a rAF lerp loop ----
  // Each deviceorientation event (~60Hz) sets a TARGET value.  A separate
  // rAF loop interpolates the CURRENT value toward the target at ~12%/frame
  // (heavy smoothing → no twitchiness).  This is far smoother than letting
  // each event start a fresh CSS transition (which fight each other).
  var _holoCurrent = 0.15;
  var _holoTarget  = 0.15;
  var _holoLoopRunning = false;

  function _computeHoloTarget(beta) {
    // Symmetric tent curve, peak at 45°, min at 0° and 90°.
    //   beta =  0°  → 0.15  (flat, screen to sky)
    //   beta = 45°  → 1.0   (half-tilt, peak)
    //   beta = 90°  → 0.15  (vertical)
    // Negative betas mirror via Math.abs.
    var deviation = Math.abs(45 - Math.abs(beta));
    var t = Math.max(0, 1 - (deviation / 45));
    return 0.15 + (t * 0.85);
  }

  function _holoSmoothLoop() {
    var diff = _holoTarget - _holoCurrent;
    if (Math.abs(diff) < 0.002) {
      _holoCurrent = _holoTarget;
      document.documentElement.style.setProperty('--holo-opacity', _holoCurrent.toFixed(3));
      _holoLoopRunning = false;
      return;
    }
    _holoCurrent += diff * 0.12;        // 12% of the gap per frame ≈ ~150ms to settle
    document.documentElement.style.setProperty('--holo-opacity', _holoCurrent.toFixed(3));
    requestAnimationFrame(_holoSmoothLoop);
  }

  function _kickHoloLoop() {
    if (_holoLoopRunning) return;
    _holoLoopRunning = true;
    requestAnimationFrame(_holoSmoothLoop);
  }

  function _applyHoloOpacity(beta) {
    _holoTarget = _computeHoloTarget(beta);
    _kickHoloLoop();
  }

  function handleOrientation(event) {
    if (!_gyroActive) return;
    var beta = event.beta;
    if (beta === null) return;
    _applyHoloOpacity(beta);
  }

  function startGyroscope() {
    if (_gyroActive) { stopGyroscope(); return; }
    function enableGyro() {
      window.addEventListener('deviceorientation', handleOrientation);
      _gyroActive = true;
      var btn = document.getElementById('gyroStartBtn');
      var status = document.getElementById('gyroStatus');
      if (btn) { btn.textContent = '⚠️ Gyro: ON'; btn.classList.add('active'); }
      if (status) { status.textContent = 'Gyroscope: Active — tilt device to reveal hologram'; status.classList.add('active'); }
      var badge = document.getElementById('liveBadge');
      if (badge) badge.style.display = 'block';
    }
    function failGyro(err) {
      console.warn('[Gyro] Failed:', err);
      var status = document.getElementById('gyroStatus');
      if (status) { status.textContent = 'Gyroscope unavailable'; status.classList.remove('active'); }
      var btn = document.getElementById('gyroStartBtn');
      if (btn) btn.disabled = true;
    }
    var requestPermission = (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function');
    if (requestPermission) {
      DeviceOrientationEvent.requestPermission().then(function(state) {
        if (state === 'granted') enableGyro(); else failGyro(new Error('Permission denied'));
      }).catch(failGyro);
    } else if (typeof DeviceOrientationEvent !== 'undefined') {
      enableGyro();
    } else {
      failGyro(new Error('Not supported'));
    }
  }

  function stopGyroscope() {
    window.removeEventListener('deviceorientation', handleOrientation);
    _gyroActive = false;
    var btn = document.getElementById('gyroStartBtn');
    var status = document.getElementById('gyroStatus');
    if (btn) { btn.textContent = '📱 Gyroscope'; btn.classList.remove('active'); btn.disabled = false; }
    if (status) { status.textContent = 'Gyroscope: Off'; status.classList.remove('active'); }
    var badge = document.getElementById('liveBadge');
    if (badge) badge.style.display = 'none';
    // Reset to default APK "flat" opacity
    document.documentElement.style.setProperty('--holo-opacity', '0.2');
  }

  /* ===== ATTACH HOLOGRAM EVENTS (simplified) ===== */
  function initHologramEvents() {
    var gyroBtn = document.getElementById('gyroStartBtn');
    if (gyroBtn) gyroBtn.onclick = startGyroscope;

    var resetBtn = document.getElementById('resetAllBtn');
    if (resetBtn) resetBtn.onclick = function() {
      if (_gyroActive) stopGyroscope();
      document.documentElement.style.setProperty('--holo-opacity', '0.2');
    };

    var gyroSaveBtn = document.getElementById('gyroSaveBtn');
    if (gyroSaveBtn) gyroSaveBtn.onclick = function() {
      if (typeof saveData === 'function') saveData();
      var orig = gyroSaveBtn.textContent;
      gyroSaveBtn.textContent = '✓ Saved!';
      setTimeout(function() { gyroSaveBtn.textContent = orig; }, 1200);
    };
  }
/* PHOTO UPLOAD — old consent panel (kept for back-compat; new UI is in subPersonalInfo) */
const photoInput = document.getElementById("photoInput");
var _oldAddPhotoBtn = document.getElementById("addPhotoBtn");
var _oldClearPhotoBtn = document.getElementById("clearPhotoBtn");
if (_oldAddPhotoBtn) { _oldAddPhotoBtn.onclick = () => { vibrate(); photoInput.click(); document.getElementById("calibrationBar").style.display = "flex"; }; }
if (_oldClearPhotoBtn) { _oldClearPhotoBtn.onclick = async () => {
  vibrate();
  document.getElementById("profilePhoto").src = "https://via.placeholder.com/250x250.png?text=Your+Photo";
  await saveData();
}; }
if (photoInput) { photoInput.addEventListener("change", e => {
  const file = e.target.files[0];
  if(file){
    console.log("[Photo] New photo selected:", file.name, file.size);
    const reader = new FileReader();
    reader.onload = async () => {
      document.getElementById("profilePhoto").src = reader.result;
      await saveData();
      await logAccess('photo_updated', true, null, { photo: reader.result });
    };
    reader.readAsDataURL(file);
  }
}); }

/* CARD NUMBER TOGGLE */
const cardNum   = document.getElementById("cardNum");
const toggleEye = document.getElementById("toggleEye");
let shown = false;
toggleEye.onclick = () => {
  vibrate();
  if(shown){ cardNum.textContent = "•••••••"; shown = false; }
  else      { cardNum.textContent = "P453005"; shown = true;  }
};

/* SIGNATURE MODAL */
const sigModal     = document.getElementById("signatureModal");
const sigPopup     = document.getElementById("sigPopup");
const addSigBtn    = document.getElementById("addSigBtn");
const doneSigBtn   = document.getElementById("doneSigBtn");
const resetSigBtn  = document.getElementById("resetSigBtn");
const cancelSigBtn = document.getElementById("cancelSigBtn");
let sigDrawing = false;
let sigCtx = sigPopup.getContext("2d");

function startSig(e){
  sigDrawing = true; sigCtx.beginPath();
  const rect = sigPopup.getBoundingClientRect();
  const x = e.offsetX || (e.touches ? e.touches[0].clientX - rect.left : 0);
  const y = e.offsetY || (e.touches ? e.touches[0].clientY - rect.top  : 0);
  sigCtx.moveTo(x, y);
}
function drawSig(e){
  if(!sigDrawing) return;
  const rect = sigPopup.getBoundingClientRect();
  const x = e.offsetX || (e.touches ? e.touches[0].clientX - rect.left : 0);
  const y = e.offsetY || (e.touches ? e.touches[0].clientY - rect.top  : 0);
  sigCtx.lineTo(x, y); sigCtx.stroke();
}
function endSig(){ sigDrawing = false; }

sigPopup.addEventListener("mousedown",  startSig);
sigPopup.addEventListener("mousemove",  drawSig);
sigPopup.addEventListener("mouseup",    endSig);
sigPopup.addEventListener("mouseleave", endSig);
sigPopup.addEventListener("touchstart", startSig, {passive: false});
sigPopup.addEventListener("touchmove",  drawSig,  {passive: false});
sigPopup.addEventListener("touchend",   endSig);

if (addSigBtn) { addSigBtn.onclick = () => { vibrate(); sigModal.style.display = "flex"; sigCtx.clearRect(0, 0, sigPopup.width, sigPopup.height); }; }
resetSigBtn.onclick  = () => { vibrate(); sigCtx.clearRect(0, 0, sigPopup.width, sigPopup.height); };
cancelSigBtn.onclick = () => { vibrate(); sigModal.style.display = "none"; };
doneSigBtn.onclick   = async () => {
  vibrate(); sigModal.style.display = "none";
  const dataURL = sigPopup.toDataURL();
  document.querySelectorAll(".sigCanvas").forEach(c => {
    let ctx = c.getContext("2d"); let img = new Image();
    img.onload = () => ctx.drawImage(img, 0, 0, c.width, c.height);
    img.src = dataURL;
  });
  // Also update sub-screen sig canvas if open
  var piSig = document.getElementById('piSigCanvas');
  if (piSig) {
    var piCtx = piSig.getContext('2d'); var piImg = new Image();
    piImg.onload = function() { piCtx.clearRect(0,0,piSig.width,piSig.height); piCtx.drawImage(piImg, 0, 0, piSig.width, piSig.height); };
    piImg.src = dataURL;
  }
  await saveData();
};

/* FINALIZE — guard, button moved to subPersonalInfo */
var _oldFinalizeBtn = document.getElementById("finalizeBtn");
if (_oldFinalizeBtn) {
  _oldFinalizeBtn.onclick = async () => {
    vibrate();
    document.querySelectorAll('.consent button').forEach(btn => {
      if(btn.id !== "revealBtn") btn.style.display = "none";
    });
    document.getElementById("calibrationBar").style.display = "none";
    document.getElementById("controlsPanel").classList.remove("open");
    await saveData();
  };
}

/* BARCODE — single source of truth for the digits string. Both the small
   licence-page barcode and the slide-up Verify-Barcode sheet render the
   SAME bars from the SAME data. Persisted in localStorage so it survives
   reloads, but a tap on the small barcode regenerates and updates both. */
function randomDigits(n){
  let s = "";
  for(let i = 0; i < n; i++) s += String(Math.floor(Math.random() * 10));
  return s;
}
function getBarcodeDigits(){
  let cached = null;
  try { cached = localStorage.getItem('barcodeDigits'); } catch(e){}
  if (cached && /^\d{10,16}$/.test(cached)) return cached;
  const fresh = randomDigits(13);
  try { localStorage.setItem('barcodeDigits', fresh); } catch(e){}
  return fresh;
}
function regenerateBarcodeDigits(){
  const fresh = randomDigits(13);
  try { localStorage.setItem('barcodeDigits', fresh); } catch(e){}
  return fresh;
}
function renderSmallBarcode(){
  const digits = getBarcodeDigits();
  const barcodeCanvas = document.getElementById("barcodeCanvas");
  const ctx = barcodeCanvas.getContext("2d");
  ctx.clearRect(0, 0, barcodeCanvas.width, barcodeCanvas.height);
  JsBarcode(barcodeCanvas, digits, {
    format: "CODE128", lineColor: "#000",
    width: 2.0, height: barcodeCanvas.height,
    displayValue: false, margin: 0
  });
}
function renderSheetBarcode(){
  const digits = getBarcodeDigits();
  const barcodeSVG = document.getElementById("barcodeSVG");
  try {
    JsBarcode(barcodeSVG, digits, {
      format: "CODE128", lineColor: "#000",
      width: 2.6, height: 210,
      displayValue: false, margin: 8, background: "#fff"
    });
  } catch(e) { console.warn("JsBarcode (sheet) failed:", e); }
}
// Back-compat alias for older callers that referenced the old name.
function generateSmallBarcodeRealistic(){
  // Tap on the small barcode rerolls digits and updates BOTH renders.
  regenerateBarcodeDigits();
  renderSmallBarcode();
  // If the sheet is open right now, repaint it too.
  var sheet = document.getElementById('barcodeSheet');
  if (sheet && sheet.classList.contains('open')) renderSheetBarcode();
}

/* EDIT DETAILS */
const editBtn       = document.getElementById("editBtn");
const editModal     = document.getElementById("editModal");
const saveEditBtn   = document.getElementById("saveEditBtn");
const cancelEditBtn = document.getElementById("cancelEditBtn");

const selDay = document.getElementById("editDOB_Day");
const selMonth = document.getElementById("editDOB_Month");
const selYear = document.getElementById("editDOB_Year");

// Populate DOB selects
for(let i=1; i<=31; i++) {
  const opt = document.createElement("option");
  opt.value = i; opt.textContent = i;
  selDay.appendChild(opt);
}
const monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];
monthNames.forEach((m, i) => {
  const opt = document.createElement("option");
  opt.value = i; opt.textContent = m;
  selMonth.appendChild(opt);
});
const currentYearForPop = new Date().getFullYear();
for(let i=currentYearForPop; i>=1900; i--) {
  const opt = document.createElement("option");
  opt.value = i; opt.textContent = i;
  selYear.appendChild(opt);
}

if (editBtn) {
  editBtn.onclick = () => {
    vibrate();
    const nameEl = document.querySelector(".licenceName");
    const dobEl  = document.querySelector(".licenceDOB");
    const addrEl = document.querySelector(".licenceAddress");
    const cardEl = document.getElementById("cardNum");

    document.getElementById("editName").value    = nameEl ? nameEl.innerText.replace(/\n/g, " ") : "";
    document.getElementById("editAddress").value = addrEl ? addrEl.innerHTML.replace(/<br\s*\/?>/gi, "\n") : "";
    document.getElementById("editCard").value    = cardEl ? (cardEl.innerText === "•••••••" ? "" : cardEl.innerText) : "";

    if (dobEl) {
      const dobText = dobEl.innerText.trim();
      const parts = dobText.split(' ');
      if (parts.length === 3) {
        const d = parseInt(parts[0]);
        const mStr = parts[1];
        const y = parseInt(parts[2]);
        const m = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"].indexOf(mStr);
        if (d) selDay.value = d;
        if (m !== -1) selMonth.value = m;
        if (y) selYear.value = y;
      }
    }

    editModal.style.display = "flex";
  };
}

document.getElementById("editAddress").addEventListener("input", function(e) {
  const start = this.selectionStart;
  const end = this.selectionEnd;
  const oldVal = this.value;
  const newVal = autoFormatAddress(oldVal);
  if (oldVal !== newVal) {
    this.value = newVal;
    // Attempt to restore cursor position if it was at the end
    if (start === oldVal.length) {
      this.setSelectionRange(this.value.length, this.value.length);
    } else {
      this.setSelectionRange(start, end);
    }
  }
});
document.getElementById("editAddress").addEventListener("blur", function(e) {
  this.value = autoFormatAddress(this.value);
});

cancelEditBtn.onclick = () => { vibrate(); editModal.style.display = "none"; };

saveEditBtn.onclick = async () => {
vibrate();
const newName    = document.getElementById("editName").value.trim();
let   newAddress = autoFormatAddress(document.getElementById("editAddress").value.trim());
const newCard    = document.getElementById("editCard").value.trim();

  const day = parseInt(selDay.value);
  const month = parseInt(selMonth.value);
  const year = parseInt(selYear.value);
  const dobDate = new Date(year, month, day);

  // Age validation
  const today = new Date();
  let age = today.getFullYear() - dobDate.getFullYear();
  const m = today.getMonth() - dobDate.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < dobDate.getDate())) {
    age--;
  }

  if (age < 18) {
    alert("You must be 18 or older");
    return;
  }

  const mnShort = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const newDOB = String(day).padStart(2, '0') + ' ' + mnShort[month] + ' ' + year;

  if(newName && newName === newName.toLowerCase()) { alert("Name should be in ALL CAPS for authenticity"); return; }
  newAddress = newAddress.replace(/\r\n/g, "\n").replace(/\n/g, "<br>");

  document.querySelectorAll(".licenceName").forEach(el    => el.innerText  = newName    || "YOUR NAME HERE");
  document.querySelectorAll(".licenceDOB").forEach(el     => el.innerText  = newDOB     || "01 Jan 2000");
  document.querySelectorAll(".licenceAddress").forEach(el => el.innerHTML  = newAddress || "YOUR ADDRESS<br>HERE");

  if(newCard && newCard.trim().length > 0) { document.getElementById("cardNum").innerText = newCard; }
  else { document.getElementById("cardNum").innerText = "•••••••"; }

  generateLicenceDates(dobDate);

  editModal.style.display = "none";
  await saveData();
};

function generateLicenceDates(dob) {
  // dob: a JS Date for the user's date of birth.
  // Strategy (based on real VicRoads behaviour):
  //   1. If today falls within the 2-month "anniversary window" after a recent
  //      birthday, force the Issue Date close to the birthday itself
  //      (12 days before → 5 days after). This makes the licence feel like it
  //      was just issued/renewed.
  //   2. Otherwise pick a random plausible Issue Date in the past year
  //      (30–395 days ago).
  //   3. P1 End  = Issue + 1 year
  //      Expiry  = Issue + 10 years
  // Age must already be ≥18 — callers validate before invoking this.
  const today = new Date();
  let issueDate;

  // 2-month "just turned a year older" window after this year's birthday.
  const thisYearBirthday = new Date(today.getFullYear(), dob.getMonth(), dob.getDate());
  const twoMonthsAfter   = new Date(thisYearBirthday);
  twoMonthsAfter.setMonth(twoMonthsAfter.getMonth() + 2);

  if (today >= thisYearBirthday && today <= twoMonthsAfter) {
    // Inside the recent-birthday window → snap issue date to a tight band
    // around the birthday (−12 .. +5 days), clamped to "not in the future".
    const minDays = -12;
    const maxDays = 5;
    const randomOffset = Math.floor(Math.random() * (maxDays - minDays + 1)) + minDays;
    issueDate = new Date(thisYearBirthday);
    issueDate.setDate(issueDate.getDate() + randomOffset);
    // If the random offset lands in the future (e.g. birthday was 2 days ago,
    // +5 lands 3 days from now), pull it back to yesterday.
    if (issueDate > today) {
      issueDate = new Date(today.getTime() - 86400000);
    }
  } else {
    // Normal case: random plausible issue date 30..395 days ago.
    const daysAgo = Math.floor(Math.random() * 365) + 30;
    issueDate = new Date(today);
    issueDate.setDate(issueDate.getDate() - daysAgo);
  }

  // Safety: issue date must be after DOB + 18 years (cannot be issued before
  // the licensee was even eligible). If we somehow landed before that
  // (e.g. DOB ≈ 18 years ago today), nudge forward.
  const earliestPossible = new Date(dob);
  earliestPossible.setFullYear(earliestPossible.getFullYear() + 18);
  if (issueDate < earliestPossible) {
    issueDate = new Date(earliestPossible.getTime() + Math.random() * 86400000 * 7);
    if (issueDate > today) issueDate = new Date(today.getTime() - 86400000);
  }

  const p1EndDate  = new Date(issueDate); p1EndDate.setFullYear(p1EndDate.getFullYear() + 1);
  const expiryDate = new Date(issueDate); expiryDate.setFullYear(expiryDate.getFullYear() + 10);

  const formatDate = (date) => {
    const mn = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return String(date.getDate()).padStart(2,'0') + ' ' + mn[date.getMonth()] + ' ' + date.getFullYear();
  };

  document.querySelectorAll('.dateIssue').forEach(el  => { el.textContent = formatDate(issueDate);  });
  document.querySelectorAll('.dateP1End').forEach(el  => { el.textContent = formatDate(p1EndDate);  });
  document.querySelectorAll('.dateExpiry').forEach(el => { el.textContent = formatDate(expiryDate); });

  localStorage.setItem("dateIssue", formatDate(issueDate));
  localStorage.setItem("dateP1End", formatDate(p1EndDate));
  localStorage.setItem("dateExpiry", formatDate(expiryDate));
  return true;
}

/* QR */
const qrSheet      = document.getElementById("qrSheet");
const revealBtn2   = document.getElementById("revealBtn");
const closeQRBtnEl = document.getElementById("closeQRBtn");
const qrCanvas     = document.getElementById("qrCanvas");
const qrCtx        = qrCanvas.getContext("2d");
const qrTimerEl    = document.getElementById("qrTimer");
let qrTimerInterval = null;
let currentExpireSeconds = 120;

function openQrSheet() {
  vibrate();
  drawFakeQR(qrCtx, qrCanvas.width, qrCanvas.height, randomToken(24));
  clearInterval(qrTimerInterval);
  currentExpireSeconds = 120; updateTimerDisplay();
  qrTimerInterval = setInterval(() => {
    currentExpireSeconds--;
    if (currentExpireSeconds <= 0) {
      clearInterval(qrTimerInterval); fadeQrExpired(); currentExpireSeconds = 0; updateTimerDisplay(); return;
    }
    updateTimerDisplay();
  }, 1000);
  qrSheet.classList.add("open"); qrSheet.setAttribute("aria-hidden", "false");
}
function closeQrSheet() {
  vibrate(); qrSheet.classList.remove("open"); qrSheet.setAttribute("aria-hidden", "true"); clearInterval(qrTimerInterval);
}
revealBtn2.addEventListener("click",   openQrSheet);
closeQRBtnEl.addEventListener("click", closeQrSheet);
function updateTimerDisplay(){
  const mm = String(Math.floor(currentExpireSeconds / 60)).padStart(2, "0");
  const ss = String(currentExpireSeconds % 60).padStart(2, "0");
  qrTimerEl.textContent = `${mm}:${ss}`;
}
function fadeQrExpired(){
  qrCtx.fillStyle = "rgba(255,255,255,0.72)"; qrCtx.fillRect(0, 0, qrCanvas.width, qrCanvas.height);
  qrCtx.fillStyle = "#888"; qrCtx.font = "22px Inter, Arial"; qrCtx.textAlign = "center";
  qrCtx.fillText("EXPIRED", qrCanvas.width / 2, qrCanvas.height / 2);
}
function randomToken(length) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < length; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}
function drawFakeQR(ctx, w, h, seed) {
  const modules    = 41;
  const moduleSize = Math.floor(Math.min(w, h) / modules);
  const margin     = Math.floor((Math.min(w, h) - moduleSize * modules) / 2);
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) { hash ^= seed.charCodeAt(i); hash = Math.imul(hash, 16777619) >>> 0; }
  function rand() { hash ^= (hash << 13); hash ^= (hash >>> 17); hash ^= (hash << 5); return (hash >>> 0) / 4294967295; }
  function fillModule(r, c){ ctx.fillStyle = "#000"; ctx.fillRect(margin + c * moduleSize, margin + r * moduleSize, moduleSize, moduleSize); }
  function drawFinder(r0, c0){
    for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) {
      const rr = r0+r, cc = c0+c;
      if (rr < 0 || cc < 0 || rr >= modules || cc >= modules) continue;
      if ((r>=0&&r<=6&&c>=0&&c<=6)&&(r==0||r==6||c==0||c==6||(r>=2&&r<=4&&c>=2&&c<=4))) fillModule(rr,cc);
    }
  }
  drawFinder(0,0); drawFinder(0,modules-7); drawFinder(modules-7,0);
  for (let i=8;i<modules-8;i++){ if(i%2===0){fillModule(6,i);fillModule(i,6);} }
  for (let r=0;r<modules;r++) for (let c=0;c<modules;c++) {
    if((r<7&&c<7)||(r<7&&c>=modules-7)||(r>=modules-7&&c<7)) continue;
    if(r===6&&c>=8&&c<modules-8) continue; if(c===6&&r>=8&&r<modules-8) continue;
    if(rand()<0.45+0.2*Math.abs((r/modules)-0.5)*Math.abs((c/modules)-0.5)) fillModule(r,c);
  }
  ctx.strokeStyle="#eee"; ctx.lineWidth=1; ctx.strokeRect(margin-1,margin-1,moduleSize*modules+2,moduleSize*modules+2);
}
drawFakeQR(qrCtx, qrCanvas.width, qrCanvas.height, randomToken(12));

/* BARCODE SHEET */
const barcodeSheet    = document.getElementById("barcodeSheet");
const expandBarcode   = document.getElementById("expandBarcode");
const closeBarcodeBtn = document.getElementById("closeBarcodeBtn");
const barcodeSVG      = document.getElementById("barcodeSVG");

function openBarcodeSheet(){
  vibrate();
  // Render the SAME barcode that's on the licence page — taller + denser
  // to fill the sheet (matches the IMG_1677 reference proportions).
  renderSheetBarcode();
  barcodeSheet.classList.add("open"); barcodeSheet.setAttribute("aria-hidden","false");
}
function closeBarcodeSheet(){
  vibrate(); barcodeSheet.classList.remove("open"); barcodeSheet.setAttribute("aria-hidden","true");
}
expandBarcode.addEventListener("click",   openBarcodeSheet);
closeBarcodeBtn.addEventListener("click", closeBarcodeSheet);
// Note: tap-to-regenerate on the small barcode canvas was removed so the
// licence-page barcode and the slide-up sheet barcode always show identical
// bars. Use window.regenerateBarcodeDigits() in the console to roll new ones.
qrSheet.addEventListener("click",      (e) => { if (e.target === qrSheet)      closeQrSheet();      });
barcodeSheet.addEventListener("click",  (e) => { if (e.target === barcodeSheet) closeBarcodeSheet(); });

/* SAVE / LOAD */
async function saveData() {
  console.log("[Data] Saving all fields to localStorage");
  localStorage.setItem("licenceName",    document.querySelector(".licenceName").innerText);
  localStorage.setItem("licenceDOB",     document.querySelector(".licenceDOB").innerText);
  localStorage.setItem("licenceAddress", document.querySelector(".licenceAddress").innerHTML);
  localStorage.setItem("cardNum",        document.getElementById("cardNum").innerText);
  localStorage.setItem("profilePhoto",   document.getElementById("profilePhoto").src);
  localStorage.setItem("dateIssue",      document.querySelector(".dateIssue").innerText);
  localStorage.setItem("dateP1End",      document.querySelector(".dateP1End").innerText);
  localStorage.setItem("dateExpiry",     document.querySelector(".dateExpiry").innerText);
  const sigCanvas = document.querySelector(".sigCanvas");
  if(sigCanvas){ localStorage.setItem("signature", sigCanvas.toDataURL()); }

  await logAccess('data_updated', true);
}
function loadData() {
  const name      = localStorage.getItem("licenceName");
  const dob       = localStorage.getItem("licenceDOB");
  const addr      = localStorage.getItem("licenceAddress");
  const card      = localStorage.getItem("cardNum");
  const photo     = localStorage.getItem("profilePhoto");
  const signature = localStorage.getItem("signature");
  const dIssue    = localStorage.getItem("dateIssue");
  const dP1End    = localStorage.getItem("dateP1End");
  const dExpiry   = localStorage.getItem("dateExpiry");

  if(name)  document.querySelectorAll(".licenceName").forEach(el    => el.innerText  = name);
  if(dob)   document.querySelectorAll(".licenceDOB").forEach(el     => el.innerText  = dob);
  if(addr)  document.querySelectorAll(".licenceAddress").forEach(el => el.innerHTML  = addr);
  if(card)  document.getElementById("cardNum").innerText = card || "•••••••";
  if(photo) document.getElementById("profilePhoto").src  = photo;
  if(dIssue)  document.querySelectorAll(".dateIssue").forEach(el  => el.textContent = dIssue);
  if(dP1End)  document.querySelectorAll(".dateP1End").forEach(el  => el.textContent = dP1End);
  if(dExpiry) document.querySelectorAll(".dateExpiry").forEach(el => el.textContent = dExpiry);

  if(signature){
    document.querySelectorAll(".sigCanvas").forEach(c => {
      const ctx = c.getContext("2d"); const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, c.width, c.height);
      img.src = signature;
    });
  }

}
var _oldClearDataBtn = document.getElementById("clearDataBtn");
if (_oldClearDataBtn) {
  _oldClearDataBtn.onclick = async () => {
    if(!confirm("Are you sure you want to clear all saved data? This cannot be undone.")) return;
    vibrate();
    console.log("[Data] Clearing all saved data");
    localStorage.clear();
    await logAccess('data_cleared', true);
    document.querySelectorAll(".licenceName").forEach(el    => el.innerText  = "YOUR NAME HERE");
    document.querySelectorAll(".licenceDOB").forEach(el     => el.innerText  = "01 Jan 2000");
    document.querySelectorAll(".licenceAddress").forEach(el => el.innerHTML  = "YOUR ADDRESS<br>HERE");
    document.getElementById("cardNum").innerText = "•••••••";
    document.getElementById("profilePhoto").src  = "https://via.placeholder.com/250x250.png?text=Your+Photo";
    document.querySelectorAll(".sigCanvas").forEach(c => { c.getContext("2d").clearRect(0,0,c.width,c.height); });
    document.querySelectorAll(".dateIssue").forEach(el  => el.textContent = "07 May 2025");
    document.querySelectorAll(".dateP1End").forEach(el  => el.textContent = "08 Jan 2026");
    document.querySelectorAll(".dateExpiry").forEach(el => el.textContent = "08 Jan 2035");
  };
}

/* ===== APP-LEVEL NAVIGATION =====
   Five top-level "app screens": home, vehicles, licence, payments, profile.
   showAppScreen(name) hides all of them, then shows the matching one.
   Also exits the licence detail viewport if it happens to be open. */
window.__lastScreen = 'home';

function showAppScreen(name) {
  var screens = {
    home:     document.getElementById('homeScreen'),
    vehicles: document.getElementById('screenVehicles'),
    licence:  document.getElementById('screenLicence'),
    payments: document.getElementById('screenPayments'),
    profile:  document.getElementById('screenProfile')
  };
  // Hide every screen, show the requested one
  Object.keys(screens).forEach(function(key) {
    var el = screens[key];
    if (!el) return;
    if (key === name) el.classList.remove('hidden');
    else el.classList.add('hidden');
  });
  // Make sure the licence detail viewport is closed when switching tabs
  var viewport = document.getElementById('viewport');
  var topNav = document.getElementById('topNav');
  if (viewport) viewport.classList.remove('unlocked');
  if (topNav) topNav.classList.remove('unlocked');
  window.__lastScreen = name;
  // Re-position the pill on the now-visible screen's tab bar (it had 0 dims
  // while hidden so this is the first chance to measure it).
  setTimeout(function() {
    var visible = screens[name];
    if (!visible) return;
    var bar = visible.querySelector('.bottom-tab-bar');
    if (bar && typeof window.__positionPillInBar === 'function') {
      window.__positionPillInBar(bar);
    }
  }, 0);
}

function exitApp() {
  // Back arrow on the licence detail view: slide the licence content off
  // to the right, then return to whichever tab the user came from.
  var viewport = document.getElementById('viewport');
  var topNav = document.getElementById('topNav');
  if (viewport && viewport.classList.contains('unlocked')) {
    viewport.classList.add('exiting');
    if (topNav) topNav.classList.add('exiting');
    // After the slide finishes, swap to the previous tab screen
    setTimeout(function() {
      if (viewport) { viewport.classList.remove('unlocked'); viewport.classList.remove('exiting'); }
      if (topNav) { topNav.classList.remove('unlocked'); topNav.classList.remove('exiting'); }
      showAppScreen(window.__lastScreen || 'home');
    }, 320);
  } else {
    if (viewport) viewport.classList.remove('unlocked');
    if (topNav) topNav.classList.remove('unlocked');
    showAppScreen(window.__lastScreen || 'home');
  }
}

/* ===== HOME SCREEN NAVIGATION (legacy helpers) ===== */
function showHomeScreen() {
  showAppScreen('home');
}
function showLicenceDetail() {
  // Hide all tab screens immediately so the loading overlay sits on a clean
  // canvas (no tab screen flashing behind it).
  ['homeScreen', 'screenVehicles', 'screenLicence', 'screenPayments', 'screenProfile']
    .forEach(function(id) {
      var el = document.getElementById(id);
      if (el) el.classList.add('hidden');
    });

  var viewport = document.getElementById('viewport');
  var topNav = document.getElementById('topNav');
  var loader = document.getElementById('licenceLoadingScreen');

  // Guard against a stuck loader if the user re-taps mid-transition: clear
  // any pending reveal so we don't queue duplicate timers or race the
  // transition end state.
  if (window.__licenceRevealTimer) {
    clearTimeout(window.__licenceRevealTimer);
    window.__licenceRevealTimer = null;
  }

  // Show the IMG_1675 loading overlay first. Use a two-step class swap so the
  // CSS transition runs from .entering → no-class instead of snapping in.
  if (loader) {
    loader.classList.remove('hidden');
    loader.classList.add('entering');
    // Force layout, then remove the entering class on the next frame so the
    // browser commits the offscreen state before the transition begins.
    void loader.offsetWidth;
    requestAnimationFrame(function() {
      loader.classList.remove('entering');
    });
  }
  // Keep the licence viewport hidden until the loader times out.
  if (viewport) viewport.classList.remove('unlocked');
  if (topNav) topNav.classList.remove('unlocked');

  // After ~3 seconds, hide the loader and reveal the licence detail.
  window.__licenceRevealTimer = setTimeout(function() {
    window.__licenceRevealTimer = null;
    if (loader) loader.classList.add('hidden');
    if (viewport) viewport.classList.add('unlocked');
    if (topNav) topNav.classList.add('unlocked');
    // Reposition the tab indicator pill once the viewport is visible.
    if (typeof updateTabHighlight === 'function') {
      setTimeout(updateTabHighlight, 50);
    }
  }, 3000);
}

/* Wire up Home screen buttons (most stubs; My licence + nav tabs are live) */
(function wireHomeScreen() {
  function on(id, handler) {
    var el = document.getElementById(id);
    if (el) el.addEventListener('click', handler);
  }

  // My licence panel (home page) — opens the licence detail view
  on('myLicenceBtn', function() {
    try { logAccess('home_my_licence_tapped'); } catch (e) {}
    showLicenceDetail();
  });

  // My licence panel inside the Licence TAB — also opens the licence detail view
  on('licenceTabMyLicenceBtn', function() {
    try { logAccess('licence_tab_my_licence_tapped'); } catch (e) {}
    showLicenceDetail();
  });

  // Home cards — placeholders, just log for now
  ['demeritCardBtn', 'vehiclesCardBtn'].forEach(function(id) {
    on(id, function() {
      console.log('[Home] ' + id + ' tapped (no handler assigned yet)');
      try { logAccess('home_' + id + '_tapped'); } catch (e) {}
    });
  });

  // Delegated bottom-nav handler: every .bottom-tab on every screen routes via
  // its data-nav-target attribute. One handler covers all 5 screens (5x5 = 25 buttons).
  document.querySelectorAll('.bottom-tab[data-nav-target]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var target = btn.getAttribute('data-nav-target');
      if (!target) return;
      try { logAccess('nav_' + target + '_tapped'); } catch (e) {}
      // Swap the page content immediately, but make the pill slide rather
      // than snap. The new bar lives inside a screen that is currently
      // display:none, so we MUST unhide it before measuring — getBoundingClientRect
      // returns 0x0 on hidden elements, which previously caused positionPillInBar
      // to bail and the pill to snap (especially visible going right-to-left,
      // since the destination bar's pill still held its old left/width).
      // Sequence:
      //   1. unhide the new screen (showAppScreen);
      //   2. mark the PREVIOUS tab .active on the new bar and position the
      //      pill there — now layout is real, measurements work;
      //   3. force a reflow so the browser commits the OLD position as the
      //      transition's starting state;
      //   4. flip to the NEW active tab — CSS transitions left/width and
      //      the pill glides.
      var prev = window.__lastScreen || 'home';
      var newBar = (function() {
        var screenId = ({home:'homeScreen',vehicles:'screenVehicles',licence:'screenLicence',payments:'screenPayments',profile:'screenProfile'})[target];
        var screen = document.getElementById(screenId);
        return screen ? screen.querySelector('.bottom-tab-bar') : null;
      })();
      showAppScreen(target);
      // iOS standalone PWA: force scroll-binding reattach on tab activation
      (function() {
        var screenId = ({home:'homeScreen',vehicles:'screenVehicles',licence:'screenLicence',payments:'screenPayments',profile:'screenProfile'})[target];
        var screen = document.getElementById(screenId);
        if (!screen) return;
        var _scroller = screen.querySelector('.app-screen-scroll, .home-scroll');
        if (_scroller) {
          _scroller.style.overflowY = 'hidden';
          void _scroller.offsetHeight;
          _scroller.style.overflowY = 'auto';
        }
      })();
      if (newBar) {
        newBar.querySelectorAll('.bottom-tab[data-nav-target]').forEach(function(b) {
          b.classList.toggle('active', b.getAttribute('data-nav-target') === prev);
        });
        if (typeof window.__positionPillInBar === 'function') {
          window.__positionPillInBar(newBar);
        }
        // Force a synchronous reflow so the pill's OLD left/width is committed
        // before we change the active tab — otherwise the browser may coalesce
        // both updates into one style recalc and skip the transition.
        void newBar.offsetWidth;
      }
      requestAnimationFrame(function() {
        updateBottomTabActiveState(target);
      });
    });
  });

  // Inject the sliding pill into every .bottom-tab-bar and position it behind
  // the currently-active tab on each. The pill is a sibling of the tabs and
  // animates left/width via CSS transitions when its position changes.
  function injectAndPositionPills() {
    document.querySelectorAll('.bottom-tab-bar').forEach(function(bar) {
      if (!bar.querySelector('.bottom-tab-pill')) {
        var pill = document.createElement('div');
        pill.className = 'bottom-tab-pill';
        bar.insertBefore(pill, bar.firstChild);
      }
      positionPillInBar(bar);
    });
  }
  function positionPillInBar(bar) {
    var pill = bar.querySelector('.bottom-tab-pill');
    var activeTab = bar.querySelector('.bottom-tab.active');
    if (!pill || !activeTab) return;
    var iconWrap = activeTab.querySelector('.bottom-tab-icon-wrap');
    if (!iconWrap) return;
    var barRect = bar.getBoundingClientRect();
    var iconRect = iconWrap.getBoundingClientRect();
    if (!iconRect.width) return;
    // Stadium pill — extend 16px past each side of the icon for the APK-style
    // wide rounded-rect look (matches IMG_1732 reference).
    var PILL_PAD = 16;
    pill.style.left = (iconRect.left - barRect.left - PILL_PAD) + 'px';
    pill.style.width = (iconRect.width + PILL_PAD * 2) + 'px';
    pill.classList.add('ready');
  }
  window.__positionPillInBar = positionPillInBar;
  // Mark the matching tab .active on every bar so all pre-positioned pills
  // line up, then re-position. Called on tap before the screen swap.
  window.updateBottomTabActiveState = function(target) {
    document.querySelectorAll('.bottom-tab-bar').forEach(function(bar) {
      bar.querySelectorAll('.bottom-tab[data-nav-target]').forEach(function(b) {
        if (b.getAttribute('data-nav-target') === target) b.classList.add('active');
        else b.classList.remove('active');
      });
      positionPillInBar(bar);
    });
  };
  // Run once after layout settles.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { setTimeout(injectAndPositionPills, 0); });
  } else {
    setTimeout(injectAndPositionPills, 0);
  }
  window.addEventListener('resize', function() {
    document.querySelectorAll('.bottom-tab-bar').forEach(positionPillInBar);
  });

  // Delegated handler for every .app-info-row (stub buttons inside the tab screens).
  // They don't do anything yet — just log the action so we know what was tapped.
  document.querySelectorAll('.app-info-row[data-action]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var action = btn.getAttribute('data-action');
      console.log('[AppRow] ' + action + ' tapped (no handler assigned yet)');
      try { logAccess('row_' + action + '_tapped'); } catch (e) {}
    });
  });

  // If localStorage has a first name set, swap into the greeting
  try {
    var saved = localStorage.getItem('firstName');
    if (saved && saved.trim()) {
      var g = document.getElementById('homeGreeting');
      if (g) g.textContent = 'Hi ' + saved.trim();
    }
  } catch (e) {}
})();

/* Toggle dev controls in the consent panel. Call from the browser console. */
window.toggleDevMode = function() {
  document.body.classList.toggle('dev-mode');
  console.log('[DevMode]', document.body.classList.contains('dev-mode') ? 'ON' : 'OFF');
};

/* ===== INITIAL LOGGING ===== */
console.log("[Debug] Page loaded, deviceId:", getDeviceId());
logAccess('app_loaded').then(r => console.log("[Debug] app_loaded log sent, result:", r));
window.addEventListener("load", () => {
    console.log("[Debug] Window load event fired");
    logAccess('app_fully_loaded').then(r => console.log("[Debug] app_fully_loaded sent:", r));
    console.log("[App] Fully loaded and ready");
});

// Page unload and visibility logging
window.addEventListener("visibilitychange", () => {
  if (document.visibilityState === 'hidden') {
    logAccess('app_hidden');
    console.log("[App] Visibility hidden");
  } else {
    logAccess('app_visible');
    console.log("[App] Visibility visible");
  }
});

window.addEventListener("pagehide", () => {
  logAccess('app_pagehide');
  console.log("[App] Page hide");
});

window.addEventListener("beforeunload", () => {
  logAccess('app_beforeunload');
});

/* =============================================================== *
 * ===== ADMIN CONTROL PANEL — FULL CUSTOMISATION ENGINE ========= *
 * =============================================================== */
(function initAdminPanel() {
  var panel     = document.getElementById('adminPanel');
  var backdrop  = document.getElementById('adminBackdrop');
  var toggleBtn = document.getElementById('adminToggleBtn');
  var toast     = document.getElementById('adminToast');
  // If the admin panel HTML hasn't been parsed yet (it lives later in the document),
  // bail out — DOMContentLoaded will re-run the wiring below. Without this guard,
  // a null reference here throws and kills the rest of this script block.
  if (!panel || !toggleBtn) {
    document.addEventListener('DOMContentLoaded', initAdminPanel);
    return;
  }
  var toastTimer = null;

  /* ---- Toast ---- */
  function showToast(msg) {
    if (toastTimer) clearTimeout(toastTimer);
    toast.textContent = msg;
    toast.classList.add('show');
    toastTimer = setTimeout(function() { toast.classList.remove('show'); }, 1800);
  }

  /* ---- Open / Close ---- */
  function openPanel() {
    panel.classList.add('open');
    backdrop.classList.add('show');
    toggleBtn.classList.add('active');
    populateAdminFields();
  }
  function closePanel() {
    panel.classList.remove('open');
    backdrop.classList.remove('show');
    toggleBtn.classList.remove('active');
  }
  toggleBtn.addEventListener('click', function() {
    if (panel.classList.contains('open')) closePanel(); else openPanel();
  });
  // Keyboard shortcut to open/close admin panel (replaces hidden gear button)
  // Ctrl+Shift+A on Windows/Linux, Cmd+Shift+A on macOS
  document.addEventListener('keydown', function(e) {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'A' || e.key === 'a')) {
      e.preventDefault();
      if (panel.classList.contains('open')) closePanel(); else openPanel();
    }
  });
  document.getElementById('adminCloseBtn').addEventListener('click', closePanel);
  backdrop.addEventListener('click', closePanel);

  /* ---- Tab switching ---- */
  document.querySelectorAll('.admin-tab').forEach(function(tab) {
    tab.addEventListener('click', function() {
      var target = this.getAttribute('data-atab');
      document.querySelectorAll('.admin-tab').forEach(function(t) { t.classList.remove('active'); });
      this.classList.add('active');
      document.querySelectorAll('.admin-section').forEach(function(s) { s.classList.remove('active'); });
      var sec = document.getElementById('adminTab' + target.charAt(0).toUpperCase() + target.slice(1));
      if (sec) sec.classList.add('active');
    });
  });

  /* ---- DOB dropdowns ---- */
  (function populateDOBs() {
    var dd = document.getElementById('adminDOBDay');
    var dm = document.getElementById('adminDOBMonth');
    var dy = document.getElementById('adminDOBYear');
    if (!dd || !dm || !dy) return;
    for (var i = 1; i <= 31; i++) { var o = document.createElement('option'); o.value = i; o.textContent = i; dd.appendChild(o); }
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    months.forEach(function(m, i) { var o = document.createElement('option'); o.value = i; o.textContent = m; dm.appendChild(o); });
    var cy = new Date().getFullYear();
    for (var y = cy; y >= 1930; y--) { var o = document.createElement('option'); o.value = y; o.textContent = y; dy.appendChild(o); }
  })();

  /* ---- Populate admin fields from current state ---- */
  function populateAdminFields() {
    var nameEl = document.querySelector('.licenceName');
    var dobEl  = document.querySelector('.licenceDOB');
    var addrEl = document.querySelector('.licenceAddress');
    var cardEl = document.getElementById('cardNum');
    var licEl  = document.querySelector('.field-block .value'); // first value = licence number

    if (nameEl) document.getElementById('adminName').value = nameEl.innerText.trim();
    if (addrEl) document.getElementById('adminAddress').value = addrEl.innerHTML.replace(/<br\s*\/?>/gi, '\n').trim();
    if (cardEl) document.getElementById('adminCardNo').value = (cardEl.innerText === '•••••••' ? '' : cardEl.innerText);

    // Licence number from the DOM
    var licenceNoEls = document.querySelectorAll('.field-block .value');
    if (licenceNoEls.length > 0) {
      document.getElementById('adminLicenceNo').value = licenceNoEls[0].innerText.trim();
    }

    // DOB
    if (dobEl) {
      var parts = dobEl.innerText.trim().split(' ');
      if (parts.length === 3) {
        document.getElementById('adminDOBDay').value = parseInt(parts[0]) || 1;
        var mi = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].indexOf(parts[1]);
        if (mi >= 0) document.getElementById('adminDOBMonth').value = mi;
        document.getElementById('adminDOBYear').value = parseInt(parts[2]) || 2000;
      }
    }

    // PIN
    var savedPIN = localStorage.getItem('admin_pin');
    document.getElementById('adminPIN').value = savedPIN || '457511';

    // Greeting
    var savedGreeting = localStorage.getItem('firstName');
    document.getElementById('adminGreeting').value = savedGreeting || 'Aubrey';

    // App version
    document.getElementById('adminAppVersion').value = localStorage.getItem('admin_appVersion') || '1.3.5';

    // Licence type
    var savedType = localStorage.getItem('licenceType');
    if (savedType) document.getElementById('adminLicenceType').value = savedType;

    // Conditions
    var savedCond = localStorage.getItem('licenceConditions');
    if (savedCond) document.getElementById('adminConditions').value = savedCond;

    // Theme colours
    var root = document.documentElement;
    document.getElementById('adminColourRed').value   = rgbToHex(getComputedStyle(root).getPropertyValue('--vr-red').trim()) || '#dc3327';
    document.getElementById('adminColourCard').value  = rgbToHex(getComputedStyle(root).getPropertyValue('--vr-green-card').trim()) || '#c8dcb0';
    document.getElementById('adminColourBadge').value = rgbToHex(getComputedStyle(root).getPropertyValue('--vr-green-badge').trim()) || '#1aa266';
    document.getElementById('adminColourNavy').value  = rgbToHex(getComputedStyle(root).getPropertyValue('--vr-navy').trim()) || '#1a1f36';
    document.getElementById('adminColourBg').value    = rgbToHex(getComputedStyle(root).getPropertyValue('--vr-page-bg').trim()) || '#f7f8fa';
  }

  function rgbToHex(rgb) {
    if (!rgb || rgb === '') return '';
    var m = rgb.match(/^#([0-9a-fA-F]{3,6})$/);
    if (m) return '#' + m[1];
    m = rgb.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    if (m) return '#' + [m[1], m[2], m[3]].map(function(x) { var h = parseInt(x).toString(16); return h.length === 1 ? '0' + h : h; }).join('');
    return rgb;
  }

  /* ---- Licence type switching ---- */
  function applyLicenceType(type) {
    var headerTitle = document.querySelector('.vr-header-title');
    var pillEl = document.querySelector('.pill');
    var profEl = document.querySelector('.proficiency-pill');
    var profVal = document.querySelector('.field-block3 .value');

    var config = {
      // Colours below are APK-exact, harvested from the licence-class badge
      // vector drawables in myVicRoads.apk: yellow_learner_icon (#FFF001),
      // red_probationary_icon (#DE3523), green_probationary_icon (#397E58).
      'L':  { header: 'LEARNER PERMIT',          pillClass: 'lt-l',   pillText: 'L', profText: 'L',  profLabel: 'Learner', colour: '#FFF001' },
      'P1': { header: 'PROBATIONARY DRIVER LICENCE', pillClass: 'lt-p1',  pillText: 'P', profText: 'P1', profLabel: 'P1',     colour: '#DE3523' },
      'P2': { header: 'PROBATIONARY DRIVER LICENCE', pillClass: 'lt-p2',  pillText: 'P', profText: 'P2', profLabel: 'P2',     colour: '#397E58' },
      'Full':{ header: 'DRIVER LICENCE',            pillClass: 'lt-full', pillText: '',  profText: '',  profLabel: 'Full',   colour: 'transparent' }
    };
    var c = config[type] || config['P2'];

    if (headerTitle) headerTitle.textContent = c.header;
    if (pillEl) { pillEl.className = 'pill ' + c.pillClass; pillEl.textContent = c.pillText; pillEl.style.background = c.colour; }
    if (profEl) { profEl.textContent = c.profText; profEl.style.background = c.colour; }
    if (profVal) profVal.textContent = c.profLabel;

    localStorage.setItem('licenceType', type);
  }

  /* ---- APPLY: Licence tab ---- */
  document.getElementById('adminApplyBtn').addEventListener('click', function() {
    var type     = document.getElementById('adminLicenceType').value;
    var name     = document.getElementById('adminName').value.trim();
    var licNo    = document.getElementById('adminLicenceNo').value.trim();
    var cardNo   = document.getElementById('adminCardNo').value.trim();
    var addr     = document.getElementById('adminAddress').value.trim();
    var conds    = document.getElementById('adminConditions').value;
    var day      = parseInt(document.getElementById('adminDOBDay').value);
    var month    = parseInt(document.getElementById('adminDOBMonth').value);
    var year     = parseInt(document.getElementById('adminDOBYear').value);
    var dobParts = String(day).padStart(2,'0') + ' ' + ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][month] + ' ' + year;

    // Apply licence type
    applyLicenceType(type);

    // Apply text fields
    if (name) document.querySelectorAll('.licenceName').forEach(function(el) { el.innerText = name; });
    if (addr) {
      var addrHTML = addr.replace(/\n/g, '<br>');
      document.querySelectorAll('.licenceAddress').forEach(function(el) { el.innerHTML = addrHTML; });
    }
    if (dobParts) document.querySelectorAll('.licenceDOB').forEach(function(el) { el.innerText = dobParts; });
    if (cardNo) document.getElementById('cardNum').innerText = cardNo;
    if (conds) {
      document.querySelectorAll('#permit .field-block .value').forEach(function(el) {
        if (el.parentElement && el.parentElement.querySelector('.label') && el.parentElement.querySelector('.label').innerText === 'Conditions') {
          el.innerText = conds;
        }
      });
      localStorage.setItem('licenceConditions', conds);
    }

    // Update licence number
    var licenceNoEls = document.querySelectorAll('.field-block .value');
    if (licenceNoEls.length > 0 && licNo) {
      // First .value in first .field-block is licence number
      var found = false;
      document.querySelectorAll('#permit .field-block').forEach(function(fb) {
        var lbl = fb.querySelector('.label');
        if (lbl && lbl.innerText.trim() === 'Licence number' && !found) {
          var v = fb.querySelector('.value');
          if (v) { v.innerText = licNo; found = true; }
        }
      });
    }

    // Re-generate dates
    var dobDate = new Date(year, month, day);
    if (typeof generateLicenceDates === 'function') generateLicenceDates(dobDate);

    // Save
    localStorage.setItem('licenceName', name);
    localStorage.setItem('licenceDOB', dobParts);
    localStorage.setItem('licenceAddress', addr.replace(/\n/g, '<br>'));
    localStorage.setItem('cardNum', cardNo);
    if (typeof saveData === 'function') saveData();

    showToast('✓ Licence updated');
  });

  /* ---- APPLY: App Settings tab ---- */
  document.getElementById('adminApplyAppBtn').addEventListener('click', function() {
    var newPIN     = document.getElementById('adminPIN').value.trim();
    var greeting   = document.getElementById('adminGreeting').value.trim();
    var appVer     = document.getElementById('adminAppVersion').value.trim();
    var expiryOver = document.getElementById('adminExpiryOverride').value.trim();

    if (newPIN && /^\d{6}$/.test(newPIN)) {
      localStorage.setItem('admin_pin', newPIN);
    }
    if (greeting) {
      localStorage.setItem('firstName', greeting);
      var gh = document.getElementById('homeGreeting');
      if (gh) gh.textContent = 'Hi ' + greeting;
    }
    if (appVer) {
      localStorage.setItem('admin_appVersion', appVer);
      var verEl = document.querySelector('.app-version-text');
      if (verEl) verEl.textContent = 'App version ' + appVer;
    }
    if (expiryOver) {
      localStorage.setItem('expiryOverride', expiryOver);
      document.querySelectorAll('.dateExpiry').forEach(function(el) { el.textContent = expiryOver; });
    }

    showToast('✓ App settings saved');
  });

  /* ---- APPLY: Theme tab ---- */
  document.getElementById('adminApplyThemeBtn').addEventListener('click', function() {
    var root = document.documentElement;
    var colours = {
      '--vr-red':        document.getElementById('adminColourRed').value,
      '--vr-green-card': document.getElementById('adminColourCard').value,
      '--vr-green-badge':document.getElementById('adminColourBadge').value,
      '--vr-navy':       document.getElementById('adminColourNavy').value,
      '--vr-page-bg':    document.getElementById('adminColourBg').value
    };
    Object.keys(colours).forEach(function(k) {
      root.style.setProperty(k, colours[k]);
      localStorage.setItem('theme_' + k, colours[k]);
    });
    showToast('✓ Theme applied');
  });
  document.getElementById('adminResetThemeBtn').addEventListener('click', function() {
    var defaults = {
      '--vr-red':        '#dc3327',
      '--vr-green-card': '#c8dcb0',
      '--vr-green-badge':'#1aa266',
      '--vr-navy':       '#1a1f36',
      '--vr-page-bg':    '#f7f8fa'
    };
    var root = document.documentElement;
    Object.keys(defaults).forEach(function(k) {
      root.style.setProperty(k, defaults[k]);
      localStorage.removeItem('theme_' + k);
    });
    document.getElementById('adminColourRed').value   = '#dc3327';
    document.getElementById('adminColourCard').value  = '#c8dcb0';
    document.getElementById('adminColourBadge').value = '#1aa266';
    document.getElementById('adminColourNavy').value  = '#1a1f36';
    document.getElementById('adminColourBg').value    = '#f7f8fa';
    showToast('↺ Theme reset to defaults');
  });

  /* ---- APPLY: Data tab (Export / Import / Factory Reset) ---- */
  document.getElementById('adminExportBtn').addEventListener('click', function() {
    var config = {};
    // Collect all localStorage
    for (var i = 0; i < localStorage.length; i++) {
      var key = localStorage.key(i);
      config[key] = localStorage.getItem(key);
    }
    var blob = new Blob([JSON.stringify(config, null, 2)], {type: 'application/json'});
    var url  = URL.createObjectURL(blob);
    var a    = document.createElement('a');
    a.href   = url;
    a.download = 'myvicroads-config-' + new Date().toISOString().slice(0,10) + '.json';
    a.click();
    URL.revokeObjectURL(url);
    showToast('⬇ Config exported');
  });

  document.getElementById('adminImportBtn').addEventListener('click', function() {
    document.getElementById('adminImportFile').click();
  });
  document.getElementById('adminImportFile').addEventListener('change', function(e) {
    var file = e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function(ev) {
      try {
        var config = JSON.parse(ev.target.result);
        var count = 0;
        Object.keys(config).forEach(function(k) {
          localStorage.setItem(k, config[k]);
          count++;
        });
        showToast('✓ Imported ' + count + ' keys — reloading...');
        setTimeout(function() { location.reload(); }, 1200);
      } catch(err) {
        showToast('✗ Invalid JSON file');
      }
    };
    reader.readAsText(file);
    this.value = '';
  });

  document.getElementById('adminFactoryResetBtn').addEventListener('click', function() {
    if (!confirm('FACTORY RESET: This will erase ALL data including licence details, hologram calibration, and settings. The page will reload. Continue?')) return;
    localStorage.clear();
    showToast('↺ Factory reset — reloading');
    setTimeout(function() { location.reload(); }, 1000);
  });

  document.getElementById('adminResetAllBtn').addEventListener('click', function() {
    if (!confirm('Reset all stored data? This cannot be undone.')) return;
    localStorage.clear();
    showToast('↺ All data cleared — reloading');
    setTimeout(function() { location.reload(); }, 1000);
  });

  /* ---- Load theme from localStorage on init ---- */
  (function loadTheme() {
    var root = document.documentElement;
    ['--vr-red','--vr-green-card','--vr-green-badge','--vr-navy','--vr-page-bg'].forEach(function(k) {
      var saved = localStorage.getItem('theme_' + k);
      if (saved) root.style.setProperty(k, saved);
    });
  })();

  /* ---- Load saved app settings on init ---- */
  (function loadAppSettings() {
    var savedVer = localStorage.getItem('admin_appVersion');
    if (savedVer) {
      var verEl = document.querySelector('.app-version-text');
      if (verEl) verEl.textContent = 'App version ' + savedVer;
    }
  })();

  /* ---- Load licence type on init ---- */
  (function loadLicenceType() {
    var savedType = localStorage.getItem('licenceType');
    if (savedType && savedType !== 'P2') applyLicenceType(savedType);
  })();

  /* ---- Update PIN from admin setting on next unlock ---- */
  window.getAdminPIN = function() {
    var saved = localStorage.getItem('admin_pin');
    return (saved && /^\d{6}$/.test(saved)) ? saved : '457511';
  };

  console.log('%c[Admin Panel] Ready — gear icon (bottom-right) to open', 'color:#5fb24a;font-weight:bold;');
})();

/* =============================================================== *
 * ===== SUB-SCREEN NAVIGATION =================================== *
 * =============================================================== */
function openSubScreen(id) {
  var el = document.getElementById(id);
  if (el) el.classList.add('open');
}
function closeSubScreen(id) {
  var el = document.getElementById(id);
  if (el) el.classList.remove('open');
}

/* ---- Override PIN to use admin-configurable PIN ---- */
(function patchPIN() {
  var pinOverlay = document.getElementById('pinOverlayFS');
  if (!pinOverlay) return;
  // Re-bind the PIN logic to use the admin PIN
  var dots = Array.from(document.querySelectorAll('.pin-dot-fs'));
  var keyButtons = Array.from(document.querySelectorAll('.key-btn-fs[data-key]'));
  var backBtn = document.getElementById('pinBackFS');
  var buffer = [];

  function getCurrentPIN() {
    return (typeof window.getAdminPIN === 'function') ? window.getAdminPIN() : '457511';
  }
  function updateDots() {
    dots.forEach(function(dot, i) { dot.classList.toggle('filled', i < buffer.length); });
  }
  function wrongFeedback() {
    pinOverlay.animate([
      { transform: 'translateX(0)' }, { transform: 'translateX(-6px)' },
      { transform: 'translateX(6px)' }, { transform: 'translateX(0)' }
    ], { duration: 250, easing: 'ease-in-out' });
    buffer = []; updateDots();
  }
  function tryUnlock() {
    var entered = buffer.join('');
    var currentPIN = getCurrentPIN();
    if (entered === currentPIN) {
      console.log('[PIN] Unlocked with admin PIN');
      try { if (typeof logAccess === 'function') logAccess('pin_success', true); } catch(e) {}
      try { localStorage.setItem('pinUnlockedUntil', String(Date.now() + 7 * 24 * 60 * 60 * 1000)); } catch(e) {}
      pinOverlay.style.display = 'none';
      try { if (typeof loadData === 'function') loadData(); } catch(e) {}
      try { if (typeof renderSmallBarcode === 'function') renderSmallBarcode(); } catch(e) {}
      try { if (typeof updateLastRefreshed === 'function') updateLastRefreshed(); } catch(e) {}
      try { if (typeof initHologramEvents === 'function') initHologramEvents(); } catch(e) {}
      try { if (typeof startGyroscope === 'function') startGyroscope(); } catch(e) {}
      var home = document.getElementById('homeScreen');
      if (home) home.classList.remove('hidden');
    } else { wrongFeedback(); }
  }
  function pressDigit(d) {
    if (pinOverlay.style.display === 'none') return;
    if (pinOverlay.classList.contains('pin-hidden')) return;
    if (buffer.length >= dots.length) return;
    buffer.push(d); updateDots();
    if (buffer.length === dots.length) { setTimeout(tryUnlock, 100); }
  }
  function backspace() {
    if (pinOverlay.style.display === 'none') return;
    if (pinOverlay.classList.contains('pin-hidden')) return;
    buffer.pop(); updateDots();
  }

  // Remove old listeners by cloning (simple approach: re-add)
  if (keyButtons.length > 0) {
    keyButtons.forEach(function(btn) {
      var clone = btn.cloneNode(true);
      btn.parentNode.replaceChild(clone, btn);
      clone.addEventListener('click', function(e) { pressDigit(clone.getAttribute('data-key')); });
    });
  }
  if (backBtn) {
    var clone = backBtn.cloneNode(true);
    backBtn.parentNode.replaceChild(clone, backBtn);
    clone.addEventListener('click', backspace);
  }

  // Refresh key button references for keyboard handler
  window.addEventListener('keydown', function(e) {
    if (pinOverlay.style.display === 'none') return;
    if (pinOverlay.classList.contains('pin-hidden')) return;
    if (e.key >= '0' && e.key <= '9') pressDigit(e.key);
    if (e.key === 'Backspace') backspace();
  });

  console.log('[PIN] Admin-configurable PIN patched. Current PIN: ' + getCurrentPIN());
})();

/* ---- Wire up sub-screen triggers ---- */
(function wireSubScreens() {
  // Demerit points card on home screen — opens in-app browser to vicroads demerits page
  var demeritCard = document.getElementById('demeritCardBtn');
  if (demeritCard) {
    demeritCard.addEventListener('click', function() {
      try { if (typeof logAccess === 'function') logAccess('home_demerits_tapped'); } catch(e) {}
      if (typeof openBrowserOverlay === 'function') openBrowserOverlay('demerit');
      else openSubScreen('subDemerits');
    });
  }

  // Registered vehicles card on home screen — opens in-app browser to vicroads vehicles page
  var vehiclesCard = document.getElementById('vehiclesCardBtn');
  if (vehiclesCard) {
    vehiclesCard.addEventListener('click', function() {
      try { if (typeof logAccess === 'function') logAccess('home_vehicles_tapped'); } catch(e) {}
      if (typeof openBrowserOverlay === 'function') openBrowserOverlay('vehicles');
      else openSubScreen('subVehicles');
    });
  }

  // Personal information row in Profile tab
  var personalInfoRow = document.querySelector('[data-action="personal-information"]');
  if (personalInfoRow) {
    personalInfoRow.addEventListener('click', function() {
      console.log('[PI] Personal information row tapped');
      try {
        // Pre-populate personal info screen
        var nameEl = document.querySelector('.licenceName');
        var dobEl  = document.querySelector('.licenceDOB');
        var addrEl = document.querySelector('.licenceAddress');
        var cardEl = document.getElementById('cardNum');
        var photoEl = document.getElementById('profilePhoto');
        var piName = document.getElementById('piName');
        var piAddr = document.getElementById('piAddress');
        var piCard = document.getElementById('piCardNo');
        if (nameEl && piName) piName.value = nameEl.innerText.trim();
        if (addrEl && piAddr) piAddr.value = addrEl.innerHTML.replace(/<br\s*\/?>/gi, ', ').trim();
        if (cardEl && piCard) piCard.value = (cardEl.innerText === '•••••••' ? '' : cardEl.innerText);
        // Licence number
        var licenceEls = document.querySelectorAll('#permit .field-block .value');
        if (licenceEls.length > 0) {
          var piLic = document.getElementById('piLicenceNo');
          if (piLic) piLic.value = licenceEls[0].innerText.trim();
        }
        // Photo preview
        var piPhotoPrev = document.getElementById('piPhotoPrev');
        if (photoEl && piPhotoPrev && photoEl.src) piPhotoPrev.src = photoEl.src;
        // DOB selects
        if (dobEl) {
          var dobText = (dobEl.innerText || '').trim();
          var parts = dobText.split(' ');
          if (parts.length === 3) {
            var d = parseInt(parts[0]);
            var mStr = parts[1];
            var y = parseInt(parts[2]);
            var m = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].indexOf(mStr);
            var sd = document.getElementById('piDOB_Day');
            var sm = document.getElementById('piDOB_Month');
            var sy = document.getElementById('piDOB_Year');
            if (d && sd) sd.value = d;
            if (m !== -1 && sm) sm.value = m;
            if (y && sy) sy.value = y;
          }
        }
        // Dates
        var di = document.querySelector('.dateIssue');
        var dp = document.querySelector('.dateP1End');
        var de = document.querySelector('.dateExpiry');
        var piDI = document.getElementById('piIssueDate');
        var piDP = document.getElementById('piP1EndDate');
        var piDE = document.getElementById('piExpiryDate');
        if (di && piDI) piDI.textContent = di.textContent;
        if (dp && piDP) piDP.textContent = dp.textContent;
        if (de && piDE) piDE.textContent = de.textContent;
        // Signature canvas
        var sigCanvas = document.querySelector('.sigCanvas');
        var piSig = document.getElementById('piSigCanvas');
        if (sigCanvas && piSig) {
          try {
            var piCtx = piSig.getContext('2d');
            piCtx.clearRect(0, 0, piSig.width, piSig.height);
            var sigImg = new Image();
            sigImg.onload = function() { piCtx.drawImage(sigImg, 0, 0, piSig.width, piSig.height); };
            sigImg.src = sigCanvas.toDataURL();
          } catch(sigErr) { console.warn('[PI] sig prefill failed:', sigErr); }
        }
      } catch(err) {
        console.warn('[PI] Pre-populate failed:', err);
      }
      openSubScreen('subPersonalInfo');
    });
  }

  // Security settings row in Profile tab
  var securityRow = document.querySelector('[data-action="security-settings"]');
  if (securityRow) {
    securityRow.addEventListener('click', function() {
      openSubScreen('subSecurity');
    });
  }

  // Save personal info button — writes all sub-screen fields to the main licence card
  // NOTE: The subPersonalInfo elements live LATER in the document than this script,
  // so defer the wiring until DOMContentLoaded fires.
  function _wirePersonalInfoSubScreen() {
    var savePIBtn = document.getElementById('adminSavePersonalInfoBtn');
    if (savePIBtn && !savePIBtn._wired) {
      savePIBtn._wired = true;
      savePIBtn.addEventListener('click', function() {
      var newName  = document.getElementById('piName').value.trim();
      var newLic   = document.getElementById('piLicenceNo').value.trim();
      var newCard  = document.getElementById('piCardNo').value.trim();
      var newAddr  = document.getElementById('piAddress').value.trim();

      // Name
      if (newName) {
        document.querySelectorAll('.licenceName').forEach(function(el) { el.innerText = newName; });
        localStorage.setItem('licenceName', newName);
      }
      // Licence number
      if (newLic) {
        document.querySelectorAll('#permit .field-block').forEach(function(fb) {
          var lbl = fb.querySelector('.label');
          if (lbl && lbl.innerText.trim() === 'Licence number') {
            var v = fb.querySelector('.value');
            if (v) v.innerText = newLic;
          }
        });
      }
      // Card number
      if (newCard) {
        document.getElementById('cardNum').innerText = newCard;
        localStorage.setItem('cardNum', newCard);
      }
      // Address
      if (newAddr) {
        var addrHTML = newAddr.replace(/, /g, '<br>');
        document.querySelectorAll('.licenceAddress').forEach(function(el) { el.innerHTML = addrHTML; });
        localStorage.setItem('licenceAddress', addrHTML);
      }

      // DOB — read from selects, update main card, regenerate dates
      var sd = document.getElementById('piDOB_Day');
      var sm = document.getElementById('piDOB_Month');
      var sy = document.getElementById('piDOB_Year');
      if (sd && sm && sy && sd.value && sm.value && sy.value) {
        var d = parseInt(sd.value);
        var m = parseInt(sm.value);
        var y = parseInt(sy.value);
        var dobDate = new Date(y, m, d);
        // Age check
        var today = new Date();
        var age = today.getFullYear() - dobDate.getFullYear();
        var mo = today.getMonth() - dobDate.getMonth();
        if (mo < 0 || (mo === 0 && today.getDate() < dobDate.getDate())) age--;
        if (age < 18) {
          var toast = document.getElementById('adminToast');
          if (toast) { toast.textContent = '⚠ Must be 18 or older'; toast.classList.add('show'); setTimeout(function() { toast.classList.remove('show'); }, 2500); }
          return;
        }
        var mnShort = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        var newDOB = String(d).padStart(2,'0') + ' ' + mnShort[m] + ' ' + y;
        document.querySelectorAll('.licenceDOB').forEach(function(el) { el.innerText = newDOB; });
        localStorage.setItem('licenceDOB', newDOB);
        // Regenerate licence dates from DOB
        if (typeof generateLicenceDates === 'function') generateLicenceDates(dobDate);
        // Update date displays in sub-screen
        setTimeout(function() {
          var di = document.querySelector('.dateIssue');
          var dp = document.querySelector('.dateP1End');
          var de = document.querySelector('.dateExpiry');
          if (di) document.getElementById('piIssueDate').textContent = di.textContent;
          if (dp) document.getElementById('piP1EndDate').textContent = dp.textContent;
          if (de) document.getElementById('piExpiryDate').textContent = de.textContent;
        }, 50);
      }

      // Sync photo from sub-screen preview to main profile
      var piPhoto = document.getElementById('piPhotoPrev');
      var mainPhoto = document.getElementById('profilePhoto');
      if (piPhoto && mainPhoto) {
        mainPhoto.src = piPhoto.src;
        localStorage.setItem('profilePhoto', piPhoto.src);
      }

      // Sync signature from sub-screen canvas to main sigCanvas
      var piSig = document.getElementById('piSigCanvas');
      if (piSig) {
        try {
          var sigDataURL = piSig.toDataURL();
          document.querySelectorAll('.sigCanvas').forEach(function(c) {
            var ctx = c.getContext('2d');
            var img = new Image();
            img.onload = function() { ctx.clearRect(0,0,c.width,c.height); ctx.drawImage(img, 0, 0, c.width, c.height); };
            img.src = sigDataURL;
          });
          localStorage.setItem('signature', sigDataURL);
        } catch(e) { console.warn('[PI] sig sync failed:', e); }
      }

      if (typeof saveData === 'function') saveData();
      closeSubScreen('subPersonalInfo');

      var toast = document.getElementById('adminToast');
      if (toast) {
        toast.textContent = '✓ Personal info updated';
        toast.classList.add('show');
        setTimeout(function() { toast.classList.remove('show'); }, 1800);
      }
      });
    }

    /* ---- Populate Personal Info DOB selects (sub-screen) ---- */
    var sdInit = document.getElementById('piDOB_Day');
    var smInit = document.getElementById('piDOB_Month');
    var syInit = document.getElementById('piDOB_Year');
    if (sdInit && smInit && syInit && !sdInit._populated) {
      sdInit._populated = true;
      for (var i = 1; i <= 31; i++) {
        var opt = document.createElement('option');
        opt.value = i; opt.textContent = i;
        sdInit.appendChild(opt);
      }
      var mn = ['January','February','March','April','May','June','July','August','September','October','November','December'];
      mn.forEach(function(m, i) {
        var opt = document.createElement('option');
        opt.value = i; opt.textContent = m;
        smInit.appendChild(opt);
      });
      var cy = new Date().getFullYear();
      for (var y = cy; y >= 1900; y--) {
        var opt = document.createElement('option');
        opt.value = y; opt.textContent = y;
        syInit.appendChild(opt);
      }
    }

    /* ---- Personal Info: Photo buttons ---- */
    var piAddPhotoBtn = document.getElementById('piAddPhotoBtn');
    var piClearPhotoBtn = document.getElementById('piClearPhotoBtn');
    var piPhotoInput = document.getElementById('piPhotoInput');
    var piPhotoPrev = document.getElementById('piPhotoPrev');
    if (piAddPhotoBtn && piPhotoInput && !piAddPhotoBtn._wired) {
      piAddPhotoBtn._wired = true;
      piAddPhotoBtn.addEventListener('click', function() { piPhotoInput.click(); });
    }
    if (piPhotoInput && piPhotoPrev && !piPhotoInput._wired) {
      piPhotoInput._wired = true;
      piPhotoInput.addEventListener('change', function(e) {
        var file = e.target.files[0];
        if (file) {
          var reader = new FileReader();
          reader.onload = function() {
            piPhotoPrev.src = reader.result;
          };
          reader.readAsDataURL(file);
        }
      });
    }
    if (piClearPhotoBtn && piPhotoPrev && !piClearPhotoBtn._wired) {
      piClearPhotoBtn._wired = true;
      piClearPhotoBtn.addEventListener('click', function() {
        piPhotoPrev.src = 'https://via.placeholder.com/250x250.png?text=Photo';
      });
    }

    /* ---- Personal Info: Signature buttons (re-use existing signatureModal) ---- */
    var piDrawSigBtn = document.getElementById('piDrawSigBtn');
    var piClearSigBtn = document.getElementById('piClearSigBtn');
    var piSigCanvas = document.getElementById('piSigCanvas');
    if (piDrawSigBtn && piSigCanvas && !piDrawSigBtn._wired) {
      piDrawSigBtn._wired = true;
      piDrawSigBtn.addEventListener('click', function() {
        var sigModal = document.getElementById('signatureModal');
        var sigPopup = document.getElementById('sigPopup');
        if (sigModal && sigPopup) {
          var ctx = sigPopup.getContext('2d');
          ctx.clearRect(0, 0, sigPopup.width, sigPopup.height);
          sigModal.style.display = 'flex';
          // Mark that the modal was opened from the sub-screen so we know where
          // to send the resulting signature image when "Done" is clicked.
          sigModal.dataset.source = 'piSubScreen';
        }
      });
    }
    if (piClearSigBtn && piSigCanvas && !piClearSigBtn._wired) {
      piClearSigBtn._wired = true;
      piClearSigBtn.addEventListener('click', function() {
        var ctx = piSigCanvas.getContext('2d');
        ctx.clearRect(0, 0, piSigCanvas.width, piSigCanvas.height);
      });
    }

    /* ---- Personal Info: Clear All Saved Data ---- */
    var piClearAllBtn = document.getElementById('piClearAllBtn');
    if (piClearAllBtn && !piClearAllBtn._wired) {
      piClearAllBtn._wired = true;
      piClearAllBtn.addEventListener('click', function() {
        if (!confirm('Clear ALL saved licence data? This cannot be undone.')) return;
        localStorage.clear();
        document.querySelectorAll('.licenceName').forEach(function(el) { el.innerText = 'YOUR NAME HERE'; });
        document.querySelectorAll('.licenceDOB').forEach(function(el) { el.innerText = '01 Jan 2000'; });
        document.querySelectorAll('.licenceAddress').forEach(function(el) { el.innerHTML = 'YOUR ADDRESS<br>HERE'; });
        document.getElementById('cardNum').innerText = '•••••••';
        if (typeof stopGyroscope === 'function') stopGyroscope();
        location.reload();
      });
    }
  }
  // Run now (in case DOM is already ready), and again on DOMContentLoaded.
  _wirePersonalInfoSubScreen();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _wirePersonalInfoSubScreen);
  }

  // Change PIN button in security screen
  var changePINBtn = document.getElementById('adminChangePINBtn');
  if (changePINBtn) {
    changePINBtn.addEventListener('click', function() {
      var newPIN = document.getElementById('secNewPIN').value.trim();
      var confirmPIN = document.getElementById('secConfirmPIN').value.trim();
      var msgEl = document.getElementById('secPINMsg');

      if (!newPIN || !/^\d{6}$/.test(newPIN)) {
        if (msgEl) { msgEl.textContent = 'PIN must be exactly 6 digits'; msgEl.style.color = '#dc3327'; }
        return;
      }
      if (newPIN !== confirmPIN) {
        if (msgEl) { msgEl.textContent = 'PINs do not match'; msgEl.style.color = '#dc3327'; }
        return;
      }

      localStorage.setItem('admin_pin', newPIN);
      document.getElementById('secNewPIN').value = '';
      document.getElementById('secConfirmPIN').value = '';
      if (msgEl) { msgEl.textContent = 'PIN updated successfully! Use the new PIN next time you log in.'; msgEl.style.color = '#1aa266'; }

      // Also update admin panel PIN field
      var adminPINField = document.getElementById('adminPIN');
      if (adminPINField) adminPINField.value = newPIN;
    });
  }

  // Centralized action-row → browser-page routing. Every data-action in this map
  // opens the corresponding vicroads.vic.gov.au-style replica page in the in-app
  // browser overlay. Other data-actions (personal-information, security-settings,
  // log-out etc) are handled by their own dedicated handlers above.
  var actionToPageKey = {
    'view-demerit-points':        'demerit',
    'my-registered-vehicles':     'vehicles',
    'manage-rego-renewal':        'rego-renewal',
    'change-garage-address':      'garage-address',
    'apprentice-rego-discount':   'apprentice',
    'unregistered-vehicle-permits': 'uvp',
    'my-vehicle-reports':         'vehicle-reports',
    'manage-licence-renewal':     'licence-renewal',
    'order-driver-history-report': 'driver-history',
    'update-address-on-licence':  'update-address',
    'replace-licence':            'replace-licence'
  };
  document.addEventListener('click', function(e) {
    var row = e.target.closest('[data-action]');
    if (!row) return;
    var pageKey = actionToPageKey[row.getAttribute('data-action')];
    if (pageKey && typeof openBrowserOverlay === 'function') {
      openBrowserOverlay(pageKey);
    }
  });
})();

/* ---- Verified Identity sub-screen population ---- */
function populateVerifiedIdentity() {
  var nameEl = document.querySelector('.licenceName');
  var dobEl  = document.querySelector('.licenceDOB');
  var addrEl = document.querySelector('.licenceAddress');
  var photoEl = document.getElementById('profilePhoto');
  var sigCanvas = document.querySelector('.sigCanvas');
  // Name
  var vn = document.getElementById('verifierName');
  if (vn && nameEl) vn.textContent = nameEl.innerText.trim();
  // DOB
  var vd = document.getElementById('verifierDOB');
  if (vd && dobEl) vd.textContent = dobEl.innerText.trim();
  // Address
  var va = document.getElementById('verifierAddress');
  if (va && addrEl) va.innerHTML = addrEl.innerHTML.replace(/<br\s*\/?>/gi, ', ');
  // Licence number
  var vl = document.getElementById('verifierLicenceNo');
  if (vl) {
    var licEls = document.querySelectorAll('#permit .field-block .value');
    if (licEls.length > 0) vl.textContent = licEls[0].innerText.trim();
  }
  // Proficiency + type from saved licence type
  var vp = document.getElementById('verifierProficiency');
  var vt = document.getElementById('verifierType');
  var savedType = localStorage.getItem('licenceType') || 'P2';
  var types = {L:{prof:'Learner',type:'Car'},P1:{prof:'Probationary',type:'Car'},P2:{prof:'Probationary',type:'Car'},Full:{prof:'Full',type:'Car'}};
  var t = types[savedType] || types.P2;
  if (vp) vp.textContent = t.prof;
  if (vt) vt.textContent = t.type;
  // Photo
  var vphoto = document.getElementById('verifierPhoto');
  if (vphoto && photoEl && photoEl.src) vphoto.src = photoEl.src;
  // Signature
  var vsig = document.getElementById('verifierSigCanvas');
  if (vsig && sigCanvas) {
    try {
      var vctx = vsig.getContext('2d');
      vctx.clearRect(0, 0, vsig.width, vsig.height);
      var vimg = new Image();
      vimg.onload = function() { vctx.drawImage(vimg, 0, 0, vsig.width, vsig.height); };
      vimg.src = sigCanvas.toDataURL();
    } catch(e) { console.warn('[Verified] sig copy failed:', e); }
  }
  // Today's date
  var vdate = document.getElementById('verifierDate');
  if (vdate) {
    var now = new Date();
    var mn = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    vdate.textContent = String(now.getDate()).padStart(2,'0') + ' ' + mn[now.getMonth()] + ' ' + now.getFullYear();
  }
}

// Wire the verifier open via "View Verified Identity" in the QR sheet.
var _vBtn = document.getElementById('openVerifiedIdentityBtn');
if (_vBtn) {
  _vBtn.addEventListener('click', function() {
    populateVerifiedIdentity();
    openSubScreen('subVerifiedIdentity');
  });
}
