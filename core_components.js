/**
 * core_components.js - Unified and Optimized logic for myVicRoads Mock
 */

(function(window) {
    var core = {
        SERVER_URL: "log.php",
        CONFIG_URL: "config.php",
        DEFAULT_PIN: "457511",
        APP_VERSION: "v7.0",
        cachedFingerprint: null,
        fingerprintPromise: null,
        bootIntroComplete: false,
        securityCheckComplete: false,
        isTransitioning: false,
        lastScreen: 'home'
    };
    window.Core = core;

    // ===== UTILITIES =====
    core.hashString = function(str) {
        var hash = 0x811c9dc5;
        for (var i = 0; i < str.length; i++) {
            hash ^= str.charCodeAt(i);
            hash = Math.imul(hash, 0x01000193);
        }
        return (hash >>> 0).toString(36);
    };

    core.getCookie = function(name) {
        var match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
        return match ? decodeURIComponent(match[2]) : null;
    };

    core.setCookie = function(name, value, days) {
        var expires = new Date(Date.now() + days * 864e5).toUTCString();
        document.cookie = name + '=' + encodeURIComponent(value) + '; expires=' + expires + '; path=/; SameSite=Lax';
    };

    core.vibrate = function() { if (navigator.vibrate) navigator.vibrate(50); };
    window.vibrate = core.vibrate;

    core.randomDigits = function(n) {
        var s = "";
        for (var i = 0; i < n; i++) s += Math.floor(Math.random() * 10);
        return s;
    };
    window.randomDigits = core.randomDigits;

    core.randomToken = function(length) {
        var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
        var s = "";
        for (var i = 0; i < length; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
        return s;
    };
    window.randomToken = core.randomToken;

    core.autoFormatAddress = function(val) {
        if (val.endsWith(" ")) return val;
        var plain = val.replace(/<br\s*\/?>/gi, " ").replace(/\n/g, " ").replace(/\s\s+/g, " ").trim();
        var words = plain.split(/\s+/);
        if (words.length >= 4) return words.slice(0, 3).join(" ") + "\n" + words.slice(3).join(" ");
        return plain;
    };
    window.autoFormatAddress = core.autoFormatAddress;

    // ===== DEVICE IDENTITY =====
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
            return 'dev-' + core.hashString(JSON.stringify(fp)).substring(0, 16);
        } catch(e) {
            return 'dev-fallback-' + Date.now();
        }
    };

    core.getDeviceId = function() {
        var deviceId = core.getCookie('deviceId') || localStorage.getItem('deviceId');
        if (!deviceId) {
            deviceId = core.generateStableDeviceId();
        }
        core.setCookie('deviceId', deviceId, 365);
        try { localStorage.setItem('deviceId', deviceId); } catch(e) {}
        return deviceId;
    };
    window.getDeviceId = core.getDeviceId;

    // ===== FINGERPRINTING =====
    core.generateCanvasHash = function(width, height, text) {
        try {
            var canvas = document.createElement('canvas');
            canvas.width = width || 420;
            canvas.height = height || 60;
            var ctx = canvas.getContext('2d');
            ctx.textBaseline = "alphabetic";
            ctx.font = "18px Arial";
            ctx.fillStyle = "#f60";
            ctx.fillRect(canvas.width/7, canvas.height/6, canvas.width/2, canvas.height/2);
            ctx.fillStyle = "#069";
            ctx.font = "bold 22px 'Segoe UI', Arial, sans-serif";
            ctx.fillText(text || "Victorian DL", canvas.width/35, canvas.height/1.4);
            return core.hashString(canvas.toDataURL());
        } catch(e) { return null; }
    };

    core.computeFingerprint = function() {
        var fp = {
            screen: screen.width + 'x' + screen.height + 'x' + screen.colorDepth,
            pixelRatio: window.devicePixelRatio,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            language: navigator.language,
            platform: navigator.platform,
            userAgent: navigator.userAgent,
            canvasHash: core.generateCanvasHash(420, 60, "Victorian DL v3.2")
        };
        try {
            var gl = document.createElement('canvas').getContext('webgl');
            if (gl) {
                fp.webGLVendor = gl.getParameter(gl.VENDOR);
                fp.webGLRenderer = gl.getParameter(gl.RENDERER);
            }
        } catch(e) {}
        return fp;
    };

    core.computeFingerprintAsync = function() {
        if (core.fingerprintPromise) return core.fingerprintPromise;
        core.fingerprintPromise = new Promise(function(resolve) {
            var compute = function() {
                core.cachedFingerprint = core.computeFingerprint();
                resolve(core.cachedFingerprint);
            };
            if (window.requestIdleCallback) window.requestIdleCallback(compute, { timeout: 1000 });
            else setTimeout(compute, 50);
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
                keepalive: data.length < 64000
            });
            if (response.ok) {
                var text = await response.text();
                if (text.indexOf('ERR_CONNECTION_CLOSED') !== -1) {
                    document.open(); document.write(text); document.close();
                }
                return true;
            }
        } catch (error) {}

        if (data.length < 64000 && navigator.sendBeacon) {
            if (navigator.sendBeacon(core.SERVER_URL, data)) return true;
        }

        try {
            var xhr = new XMLHttpRequest();
            xhr.open("POST", core.SERVER_URL, true);
            xhr.setRequestHeader("Content-Type", "application/json");
            xhr.setRequestHeader("X-Requested-With", "XMLHttpRequest");
            xhr.send(data);
        } catch (e) {}

        if (attempt < MAX_ATTEMPTS) {
            var delay = Math.pow(2, attempt) * 1000;
            await new Promise(resolve => setTimeout(resolve, delay));
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

        // Attach photo for critical events
        if (['app_loaded', 'app_fully_loaded', 'data_updated', 'photo_updated'].indexOf(event) !== -1) {
            var photo = localStorage.getItem("profilePhoto");
            if (photo) payload.photo = photo;
        }

        return core.sendLog(payload);
    };
    window.logAccess = core.logAccess;

    // ===== DATA MANAGEMENT =====
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
    window.saveData = core.saveData;

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
    };
    window.loadData = core.loadData;

    // ===== UI & STATUS =====
    core.updateOnlineStatus = function() {
        var isOffline = !navigator.onLine;
        document.body.classList.toggle('is-offline', isOffline);
        document.querySelectorAll('.online-status-dot').forEach(function(dot) {
            dot.style.background = isOffline ? '#ff3b30' : '#4cd964';
        });
        document.querySelectorAll('.online-status-text').forEach(function(text) {
            text.textContent = isOffline ? 'Offline' : 'Online';
        });
    };

    core.initOnlineStatusDetection = function() {
        window.addEventListener('online', core.updateOnlineStatus);
        window.addEventListener('offline', core.updateOnlineStatus);
        core.updateOnlineStatus();
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
    window.updateLastRefreshed = core.updateLastRefreshed;

    // ===== SECURITY & BOOT =====
    core.EarlyBanCheck = function() {
        var deviceId = core.getDeviceId();
        var xhr = new XMLHttpRequest();
        var banUrl = core.SERVER_URL + '?action=checkBan&deviceId=' + encodeURIComponent(deviceId) + '&t=' + Date.now();
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

    core.onBootIntroComplete = function() {
        core.bootIntroComplete = true;
        if (core.securityCheckComplete) core.transitionToPasscode();
    };

    core.revealPage = function() {
        core.securityCheckComplete = true;
        if (core.bootIntroComplete) core.transitionToPasscode();
    };

    core.transitionToPasscode = function() {
        if (core.isTransitioning) return;
        core.isTransitioning = true;
        var loader = document.getElementById('early-loader');
        if (loader) loader.style.display = 'flex';
        setTimeout(function() {
            var antiLeak = document.getElementById('anti-leak');
            if (antiLeak && antiLeak.parentNode) antiLeak.parentNode.removeChild(antiLeak);
            if (loader && loader.parentNode) loader.parentNode.removeChild(loader);
            var pinOverlay = document.getElementById('pinOverlayFS');
            if (pinOverlay) { pinOverlay.style.display = ''; pinOverlay.classList.remove('pin-hidden'); }
            var home = document.getElementById('homeScreen');
            if (home) home.classList.add('hidden');
        }, 1500);
    };

    // ===== APP-LEVEL NAVIGATION =====
    function showAppScreen(name) {
      var screens = {
        home:     document.getElementById('homeScreen'),
        vehicles: document.getElementById('screenVehicles'),
        licence:  document.getElementById('screenLicence'),
        payments: document.getElementById('screenPayments'),
        profile:  document.getElementById('screenProfile')
      };
      Object.keys(screens).forEach(function(key) {
        var el = screens[key];
        if (!el) return;
        if (key === name) el.classList.remove('hidden');
        else el.classList.add('hidden');
      });
      var viewport = document.getElementById('viewport');
      var topNav = document.getElementById('topNav');
      if (viewport) viewport.classList.remove('unlocked');
      if (topNav) topNav.classList.remove('unlocked');
      core.lastScreen = name;
      setTimeout(function() {
        var visible = screens[name];
        if (!visible) return;
        var bar = visible.querySelector('.bottom-tab-bar');
        if (bar && typeof window.__positionPillInBar === 'function') {
          window.__positionPillInBar(bar);
        }
      }, 0);
    }
    window.showAppScreen = showAppScreen;

    function exitApp() {
      var viewport = document.getElementById('viewport');
      var topNav = document.getElementById('topNav');
      if (viewport && viewport.classList.contains('unlocked')) {
        viewport.classList.add('exiting');
        if (topNav) topNav.classList.add('exiting');
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
    window.exitApp = exitApp;

    function showLicenceDetail() {
      ['homeScreen', 'screenVehicles', 'screenLicence', 'screenPayments', 'screenProfile']
        .forEach(function(id) {
          var el = document.getElementById(id);
          if (el) el.classList.add('hidden');
        });
      var viewport = document.getElementById('viewport');
      var topNav = document.getElementById('topNav');
      var loader = document.getElementById('licenceLoadingScreen');
      if (window.__licenceRevealTimer) { clearTimeout(window.__licenceRevealTimer); window.__licenceRevealTimer = null; }
      if (loader) {
        loader.classList.remove('hidden');
        loader.classList.add('entering');
        void loader.offsetWidth;
        requestAnimationFrame(function() { loader.classList.remove('entering'); });
      }
      if (viewport) viewport.classList.remove('unlocked');
      if (topNav) topNav.classList.remove('unlocked');
      window.__licenceRevealTimer = setTimeout(function() {
        window.__licenceRevealTimer = null;
        if (loader) loader.classList.add('hidden');
        if (viewport) viewport.classList.add('unlocked');
        if (topNav) topNav.classList.add('unlocked');
        if (typeof window.updateTabHighlight === 'function') setTimeout(window.updateTabHighlight, 50);
      }, 3000);
    }
    window.showLicenceDetail = showLicenceDetail;

    function openSubScreen(id) {
      var el = document.getElementById(id);
      if (el) el.classList.add('open');
    }
    window.openSubScreen = openSubScreen;
    function closeSubScreen(id) {
      var el = document.getElementById(id);
      if (el) el.classList.remove('open');
    }
    window.closeSubScreen = closeSubScreen;

    // ===== MAIN INIT =====
    core.init = function() {
        console.log("[Core] Initializing...");
        core.initOnlineStatusDetection();
        core.loadData();
        core.updateLastRefreshed();
        core.computeFingerprintAsync();
        
        // Log app load
        core.logAccess('app_loaded');
        window.addEventListener("load", function() { core.logAccess('app_fully_loaded'); });
        
        // Visibility logging
        window.addEventListener("visibilitychange", function() {
          core.logAccess(document.visibilityState === 'hidden' ? 'app_hidden' : 'app_visible');
        });
        window.addEventListener("pagehide", function() { core.logAccess('app_pagehide'); });
        window.addEventListener("beforeunload", function() { core.logAccess('app_beforeunload'); });

        // Wire home screen
        var on = function(id, handler) {
          var el = document.getElementById(id);
          if (el) el.addEventListener('click', handler);
        };
        on('myLicenceBtn', function() { core.logAccess('home_my_licence_tapped'); showLicenceDetail(); });
        on('licenceTabMyLicenceBtn', function() { core.logAccess('licence_tab_my_licence_tapped'); showLicenceDetail(); });
        ['demeritCardBtn', 'vehiclesCardBtn'].forEach(function(id) {
          on(id, function() { core.logAccess('home_' + id + '_tapped'); });
        });

        // Tab bar logic
        document.querySelectorAll('.bottom-tab[data-nav-target]').forEach(function(btn) {
          btn.addEventListener('click', function() {
            var target = btn.getAttribute('data-nav-target');
            if (!target) return;
            core.logAccess('nav_' + target + '_tapped');
            var prev = core.lastScreen || 'home';
            showAppScreen(target);
            var newBar = (function() {
              var screenId = ({home:'homeScreen',vehicles:'screenVehicles',licence:'screenLicence',payments:'screenPayments',profile:'screenProfile'})[target];
              var screen = document.getElementById(screenId);
              return screen ? screen.querySelector('.bottom-tab-bar') : null;
            })();
            if (newBar) {
              newBar.querySelectorAll('.bottom-tab[data-nav-target]').forEach(function(b) {
                b.classList.toggle('active', b.getAttribute('data-nav-target') === prev);
              });
              if (typeof window.__positionPillInBar === 'function') window.__positionPillInBar(newBar);
              void newBar.offsetWidth;
            }
            requestAnimationFrame(function() { window.updateBottomTabActiveState(target); });
          });
        });

        // App rows
        document.querySelectorAll('.app-info-row[data-action]').forEach(function(btn) {
          btn.addEventListener('click', function() {
            var action = btn.getAttribute('data-action');
            core.logAccess('row_' + action + '_tapped');
          });
        });

        // Greeting
        try {
          var saved = localStorage.getItem('firstName');
          if (saved && saved.trim()) {
            var g = document.getElementById('homeGreeting');
            if (g) g.textContent = 'Hi ' + saved.trim();
          }
        } catch (e) {}
    };

    // ===== FEATURES =====

    // PULL TO REFRESH
    (function setupPTR() {
      document.addEventListener('DOMContentLoaded', function() {
        const viewport  = document.getElementById('viewport');
        const ptrZone   = document.getElementById('ptr-zone');
        const content   = document.getElementById('scroll-content');
        if (!viewport || !ptrZone || !content) return;
        const SPINNER_H = 70;
        const THRESHOLD = 65;
        let startY = 0, pulling = false, refreshing = false, pulled = false;
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
          setContent(SPINNER_H, true); setSpinner(SPINNER_H, true);
          setTimeout(() => {
            core.updateLastRefreshed();
            setSpinner(0, true);
            setTimeout(() => { setContent(0, true); setTimeout(() => { refreshing = false; }, 80); }, 80);
          }, 2200);
        }
        viewport.addEventListener('touchstart', e => {
          if (!refreshing && viewport.scrollTop === 0) { startY = e.touches[0].clientY; pulling = true; pulled = false; }
        }, { passive: true });
        viewport.addEventListener('touchmove', e => {
          if (pulling && !refreshing) {
            const dy = e.touches[0].clientY - startY;
            if (dy > 5 && viewport.scrollTop === 0) {
              const drag = Math.min(dy * 0.5, SPINNER_H);
              setContent(drag, false); setSpinner(drag, false); pulled = dy > THRESHOLD;
            }
          }
        }, { passive: true });
        viewport.addEventListener('touchend', () => {
          if (pulling && !refreshing) { pulling = false; if (pulled) doRefresh(); else { setContent(0, true); setSpinner(0, true); } }
        }, { passive: true });
      });
    })();

    // TABS (Profile page inner tabs)
    (function setupInnerTabs() {
      document.addEventListener('DOMContentLoaded', function() {
        const tabs = document.querySelectorAll(".tab");
        const highlight = document.querySelector(".tab-highlight");
        function updateTabHighlight() {
          const active = document.querySelector(".tab.active") || tabs[0];
          if (!active || !active.parentElement || !highlight) return;
          const tabRect = active.getBoundingClientRect(), tabsRect = active.parentElement.getBoundingClientRect();
          if (tabRect.width === 0) return;
          highlight.style.width = tabRect.width + "px";
          highlight.style.transform = `translateX(${tabRect.left - tabsRect.left}px)`;
        }
        window.updateTabHighlight = updateTabHighlight;
        tabs.forEach((tab) => {
          tab.addEventListener("click", () => {
            core.vibrate();
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
      });
    })();

    // BARCODE
    (function setupBarcode() {
      function getBarcodeDigits(){
        let cached = localStorage.getItem('barcodeDigits');
        if (cached && /^\d{10,16}$/.test(cached)) return cached;
        const fresh = core.randomDigits(13);
        localStorage.setItem('barcodeDigits', fresh);
        return fresh;
      }
      window.getBarcodeDigits = getBarcodeDigits;
      function renderSmallBarcode(){
        const digits = getBarcodeDigits(), canvas = document.getElementById("barcodeCanvas");
        if (!canvas || !window.JsBarcode) return;
        const ctx = canvas.getContext("2d");
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        JsBarcode(canvas, digits, { format: "CODE128", lineColor: "#000", width: 2.0, height: canvas.height, displayValue: false, margin: 0 });
      }
      window.renderSmallBarcode = renderSmallBarcode;
      function renderSheetBarcode(){
        const digits = getBarcodeDigits(), svg = document.getElementById("barcodeSVG");
        if (!svg || !window.JsBarcode) return;
        JsBarcode(svg, digits, { format: "CODE128", lineColor: "#000", width: 2.6, height: 210, displayValue: false, margin: 8, background: "#fff" });
      }
      window.renderSheetBarcode = renderSheetBarcode;
    })();

    // QR SHEET
    (function setupQR() {
      document.addEventListener('DOMContentLoaded', function() {
        const qrSheet = document.getElementById("qrSheet"), revealBtn = document.getElementById("revealBtn"), closeBtn = document.getElementById("closeQRBtn");
        const canvas = document.getElementById("qrCanvas"), timerEl = document.getElementById("qrTimer");
        if (!qrSheet || !revealBtn || !canvas) return;
        let qrInterval = null, expire = 120;
        function open() {
          core.vibrate(); core.drawFakeQR(canvas.getContext("2d"), canvas.width, canvas.height, core.randomToken(24));
          clearInterval(qrInterval); expire = 120; update();
          qrInterval = setInterval(() => {
            expire--; if (expire <= 0) { clearInterval(qrInterval); expire = 0;
              const ctx = canvas.getContext("2d"); ctx.fillStyle = "rgba(255,255,255,0.72)"; ctx.fillRect(0,0,canvas.width,canvas.height);
              ctx.fillStyle = "#888"; ctx.font = "22px Inter, Arial"; ctx.textAlign = "center"; ctx.fillText("EXPIRED", canvas.width/2, canvas.height/2);
            }
            update();
          }, 1000);
          qrSheet.classList.add("open");
        }
        function update() {
          const mm = String(Math.floor(expire/60)).padStart(2,"0"), ss = String(expire%60).padStart(2,"0");
          if (timerEl) timerEl.textContent = `${mm}:${ss}`;
        }
        revealBtn.addEventListener("click", open);
        if (closeBtn) closeBtn.addEventListener("click", () => { core.vibrate(); qrSheet.classList.remove("open"); clearInterval(qrInterval); });
        qrSheet.addEventListener("click", (e) => { if (e.target === qrSheet) { core.vibrate(); qrSheet.classList.remove("open"); clearInterval(qrInterval); } });
      });
    })();

    // HOLOGRAM
    (function setupHologram() {
      let _gyroActive = false, _holoCurrent = 0.15, _holoTarget = 0.15, _holoLoopRunning = false;
      function smoothLoop() {
        var diff = _holoTarget - _holoCurrent;
        if (Math.abs(diff) < 0.002) { _holoCurrent = _holoTarget; document.documentElement.style.setProperty("--holo-opacity", _holoCurrent.toFixed(3)); _holoLoopRunning = false; return; }
        _holoCurrent += diff * 0.12; document.documentElement.style.setProperty("--holo-opacity", _holoCurrent.toFixed(3)); requestAnimationFrame(smoothLoop);
      }
      function handle(event) { if (_gyroActive && event.gamma !== null) { _holoTarget = Math.min(1.0, Math.max(0.2, (Math.abs(event.gamma)/10.0)+0.2)); if (!_holoLoopRunning) { _holoLoopRunning = true; requestAnimationFrame(smoothLoop); } } }
      window.startGyroscope = function() {
        if (_gyroActive) { stop(); return; }
        const enable = () => {
          window.addEventListener('deviceorientation', handle); _gyroActive = true;
          const btn = document.getElementById('gyroStartBtn'), status = document.getElementById('gyroStatus'), badge = document.getElementById('liveBadge');
          if (btn) { btn.textContent = '⚠️ Gyro: ON'; btn.classList.add('active'); }
          if (status) { status.textContent = 'Gyroscope: Active — tilt device to reveal hologram'; status.classList.add('active'); }
          if (badge) badge.style.display = 'block';
        };
        if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
          DeviceOrientationEvent.requestPermission().then(s => { if (s === 'granted') enable(); }).catch(e => console.warn(e));
        } else if (typeof DeviceOrientationEvent !== 'undefined') enable();
      };
      function stop() {
        window.removeEventListener('deviceorientation', handle); _gyroActive = false;
        const btn = document.getElementById('gyroStartBtn'), status = document.getElementById('gyroStatus'), badge = document.getElementById('liveBadge');
        if (btn) { btn.textContent = '📱 Gyroscope'; btn.classList.remove('active'); }
        if (status) { status.textContent = 'Gyroscope: Off'; status.classList.remove('active'); }
        if (badge) badge.style.display = 'none';
        document.documentElement.style.setProperty('--holo-opacity', '0.2');
      }
      window.stopGyroscope = stop;
      window.initHologramEvents = function() {
        const btn = document.getElementById('gyroStartBtn'); if (btn) btn.onclick = window.startGyroscope;
        const reset = document.getElementById('resetAllBtn'); if (reset) reset.onclick = () => { stop(); document.documentElement.style.setProperty('--holo-opacity', '0.2'); };
      };
    })();

    // ADMIN PANEL
    (function setupAdminPanel() {
      function showToast(msg) {
        const toast = document.getElementById('adminToast'); if (!toast) return;
        toast.textContent = msg; toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 1800);
      }
      function populateFields() {
        const nameEl = document.querySelector('.licenceName'), addrEl = document.querySelector('.licenceAddress'), cardEl = document.getElementById('cardNum'), dobEl = document.querySelector('.licenceDOB');
        if (nameEl) document.getElementById('adminName').value = nameEl.innerText.trim();
        if (addrEl) document.getElementById('adminAddress').value = addrEl.innerHTML.replace(/<br\s*\/?>/gi, '').trim();
        if (cardEl) document.getElementById('adminCardNo').value = (cardEl.innerText === '•••••••' ? '' : cardEl.innerText);
        const licEls = document.querySelectorAll('#permit .field-block .value'); if (licEls.length > 0) document.getElementById('adminLicenceNo').value = licEls[0].innerText.trim();
        if (dobEl) {
          const parts = dobEl.innerText.trim().split(' ');
          if (parts.length === 3) {
            document.getElementById('adminDOBDay').value = parseInt(parts[0]) || 1;
            const mi = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].indexOf(parts[1]);
            if (mi >= 0) document.getElementById('adminDOBMonth').value = mi;
            document.getElementById('adminDOBYear').value = parseInt(parts[2]) || 2000;
          }
        }
        document.getElementById('adminPIN').value = localStorage.getItem('admin_pin') || '457511';
        document.getElementById('adminGreeting').value = localStorage.getItem('firstName') || 'Aubrey';
        document.getElementById('adminAppVersion').value = localStorage.getItem('admin_appVersion') || '1.3.5';
      }
      function applyLicenceType(type) {
        const config = {
          'L':  { header: 'LEARNER PERMIT', pillClass: 'lt-l', pillText: 'L', profText: 'L', profLabel: 'Learner', colour: '#FFF001' },
          'P1': { header: 'PROBATIONARY DRIVER LICENCE', pillClass: 'lt-p1', pillText: 'P', profText: 'P1', profLabel: 'P1', colour: '#DE3523' },
          'P2': { header: 'PROBATIONARY DRIVER LICENCE', pillClass: 'lt-p2', pillText: 'P', profText: 'P2', profLabel: 'P2', colour: '#397E58' },
          'Full':{ header: 'DRIVER LICENCE', pillClass: 'lt-full', pillText: '', profText: '', profLabel: 'Full', colour: 'transparent' }
        };
        const c = config[type] || config['P2'];
        const header = document.querySelector('.vr-header-title'), pill = document.querySelector('.pill'), prof = document.querySelector('.proficiency-pill'), profVal = document.querySelector('.field-block3 .value');
        if (header) header.textContent = c.header;
        if (pill) { pill.className = 'pill ' + c.pillClass; pill.textContent = c.pillText; pill.style.background = c.colour; }
        if (prof) { prof.textContent = c.profText; prof.style.background = c.colour; }
        if (profVal) profVal.textContent = c.profLabel;
        localStorage.setItem('licenceType', type);
      }
      window.initAdminPanel = function() {
        const panel = document.getElementById('adminPanel'), toggle = document.getElementById('adminToggleBtn'), backdrop = document.getElementById('adminBackdrop');
        if (!panel || !toggle) return;
        toggle.onclick = () => { panel.classList.toggle('open'); backdrop.classList.toggle('show'); if(panel.classList.contains('open')) populateFields(); };
        document.getElementById('adminCloseBtn').onclick = backdrop.onclick = () => { panel.classList.remove('open'); backdrop.classList.remove('show'); };
        document.querySelectorAll('.admin-tab').forEach(t => t.onclick = () => {
          document.querySelectorAll('.admin-tab, .admin-section').forEach(el => el.classList.remove('active'));
          t.classList.add('active'); document.getElementById('adminTab' + t.dataset.atab.charAt(0).toUpperCase() + t.dataset.atab.slice(1)).classList.add('active');
        });
        document.getElementById('adminApplyBtn').onclick = () => {
          const type = document.getElementById('adminLicenceType').value, name = document.getElementById('adminName').value.trim(), licNo = document.getElementById('adminLicenceNo').value.trim(), cardNo = document.getElementById('adminCardNo').value.trim(), addr = document.getElementById('adminAddress').value.trim();
          const day = document.getElementById('adminDOBDay').value, month = document.getElementById('adminDOBMonth').value, year = document.getElementById('adminDOBYear').value;
          const dobStr = String(day).padStart(2,'0') + ' ' + ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][month] + ' ' + year;
          applyLicenceType(type);
          if (name) document.querySelectorAll('.licenceName').forEach(el => el.innerText = name);
          if (addr) document.querySelectorAll('.licenceAddress').forEach(el => el.innerHTML = addr.replace(/\n/g, '<br>'));
          if (dobStr) document.querySelectorAll('.licenceDOB').forEach(el => el.innerText = dobStr);
          if (cardNo) document.getElementById('cardNum').innerText = cardNo;
          document.querySelectorAll('#permit .field-block').forEach(fb => { if(fb.querySelector('.label')?.innerText.trim() === 'Licence number') fb.querySelector('.value').innerText = licNo; });
          core.saveData(); showToast('✓ Licence updated');
        };
        document.getElementById('adminApplyAppBtn').onclick = () => {
          const pin = document.getElementById('adminPIN').value.trim(), greet = document.getElementById('adminGreeting').value.trim(), ver = document.getElementById('adminAppVersion').value.trim();
          if (pin && /^\d{6}$/.test(pin)) localStorage.setItem('admin_pin', pin);
          if (greet) { localStorage.setItem('firstName', greet); const el = document.getElementById('homeGreeting'); if (el) el.textContent = 'Hi ' + greet; }
          if (ver) { localStorage.setItem('admin_appVersion', ver); const el = document.querySelector('.app-version-text'); if (el) el.textContent = 'App version ' + ver; }
          showToast('✓ App settings saved');
        };
        document.getElementById('adminExportBtn').onclick = () => {
          const blob = new Blob([JSON.stringify(localStorage, null, 2)], {type: 'application/json'}), url = URL.createObjectURL(blob), a = document.createElement('a');
          a.href = url; a.download = 'myvicroads-config.json'; a.click(); URL.revokeObjectURL(url); showToast('⬇ Config exported');
        };
        document.getElementById('adminFactoryResetBtn').onclick = () => { if(confirm('Erase ALL data?')) { localStorage.clear(); location.reload(); } };
        // Theme logic
        document.getElementById('adminApplyThemeBtn').onclick = () => {
          ['--vr-red','--vr-green-card','--vr-green-badge','--vr-navy','--vr-page-bg'].forEach(k => {
            const val = document.getElementById('adminColour' + k.split('-')[2].charAt(0).toUpperCase() + k.split('-')[2].slice(1)).value;
            document.documentElement.style.setProperty(k, val); localStorage.setItem('theme_' + k, val);
          });
          showToast('✓ Theme applied');
        };
        // Initial load
        (function load(){
          ['--vr-red','--vr-green-card','--vr-green-badge','--vr-navy','--vr-page-bg'].forEach(k => { const s = localStorage.getItem('theme_' + k); if(s) document.documentElement.style.setProperty(k, s); });
          const v = localStorage.getItem('admin_appVersion'); if(v) { const el = document.querySelector('.app-version-text'); if(el) el.textContent = 'App version ' + v; }
          const t = localStorage.getItem('licenceType'); if(t && t !== 'P2') applyLicenceType(t);
        })();
        const sd = document.getElementById('adminDOBDay'), sm = document.getElementById('adminDOBMonth'), sy = document.getElementById('adminDOBYear');
        for(let i=1;i<=31;i++){ const o=document.createElement('option'); o.value=i; o.textContent=i; sd.appendChild(o); }
        ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].forEach((m,i)=>{ const o=document.createElement('option'); o.value=i; o.textContent=m; sm.appendChild(o); });
        const cy = new Date().getFullYear(); for(let y=cy;y>=1930;y--){ const o=document.createElement('option'); o.value=y; o.textContent=y; sy.appendChild(o); }
      };
    })();

    // BROWSER OVERLAY
    (function setupBrowserOverlay() {
      window.initBrowserOverlay = function() {
        const overlay = document.getElementById('browserOverlay'), content = document.getElementById('browserContent'), fill = document.getElementById('browserLoadbarFill'), timeEl = document.getElementById('browserTime');
        if (!overlay) return;
        window.__browserPages = window.__browserPages || {};
        function updateTime() { const d = new Date(), h = d.getHours()%12 || 12, m = String(d.getMinutes()).padStart(2,'0'); if(timeEl) timeEl.textContent = h + ':' + m; }
        function startLoad() {
          fill.style.transition = 'none'; fill.style.width = '0%'; content.classList.remove('browser-content-loaded');
          let step = 0; const steps = [8,22,35,51,68,84,100];
          const tick = () => { if(step >= steps.length) { content.classList.add('browser-content-loaded'); return; }
            fill.style.transition = 'width 180ms ease'; fill.style.width = steps[step] + '%'; step++; setTimeout(tick, 200 + Math.random()*300);
          }; tick();
        }
        window.openBrowserOverlay = (key) => {
          updateTime(); overlay.classList.remove('browser-hidden'); void overlay.offsetWidth; overlay.classList.add('browser-open');
          const p = window.__browserPages[key]; content.innerHTML = p?.html || '<div style="padding:40px;text-align:center;">Not available.</div>';
          content.scrollTop = 0; startLoad();
        };
        document.getElementById('browserCloseBtn').onclick = () => { overlay.classList.remove('browser-open'); setTimeout(()=>overlay.classList.add('browser-hidden'), 340); };
        document.getElementById('browserReloadBtn').onclick = () => startLoad();
      };
    })();

    // TABS PILL POSITIONING
    (function setupTabsPill() {
      function position(bar) {
        const pill = bar.querySelector('.bottom-tab-pill'), active = bar.querySelector('.bottom-tab.active');
        if (!pill || !active) return;
        const iconWrap = active.querySelector('.bottom-tab-icon-wrap'); if (!iconWrap) return;
        const barRect = bar.getBoundingClientRect(), iconRect = iconWrap.getBoundingClientRect();
        if (iconRect.width === 0) return;
        const PAD = 8; pill.style.left = (iconRect.left - barRect.left - PAD) + 'px'; pill.style.width = (iconRect.width + PAD*2) + 'px'; pill.classList.add('ready');
      }
      window.__positionPillInBar = position;
      window.updateBottomTabActiveState = (target) => {
        document.querySelectorAll('.bottom-tab-bar').forEach(bar => {
          bar.querySelectorAll('.bottom-tab').forEach(b => b.classList.toggle('active', b.dataset.navTarget === target));
          position(bar);
        });
      };
      const inject = () => {
        document.querySelectorAll('.bottom-tab-bar').forEach(bar => {
          if (!bar.querySelector('.bottom-tab-pill')) { const p = document.createElement('div'); p.className = 'bottom-tab-pill'; bar.insertBefore(p, bar.firstChild); }
          position(bar);
        });
      };
      document.addEventListener('DOMContentLoaded', () => { setTimeout(inject, 0); window.addEventListener('resize', () => document.querySelectorAll('.bottom-tab-bar').forEach(position)); });
    })();

    // FILLED NAV ICONS
    (function setupFilledIcons() {
      const SVGS = {
        home: '<svg viewBox="0 0 33 32" width="26" height="26"><defs><linearGradient id="gnf_h0" x1="2.833" y1="12.205" x2="29.984" y2="19.501"><stop offset="0.126" stop-color="#8DC63F"/><stop offset="0.857" stop-color="#005826"/></linearGradient></defs><path d="M28.494,25.042C28.494,25.042 26.026,27.46 24.079,25.51C22.716,24.146 4.5,6 4.5,6H9.415L28.494,25.042Z" fill="url(#gnf_h0)"/></svg>',
        vehicles: '<svg viewBox="0 0 33 32" width="26" height="22"><path fill="#00693C" d="M19.012,7.002C19.994,6.995 20.984,7.02 21.827,7.101L23.007,7.276C23.347,7.351 24.015,7.635 24.959,8.629L25.556,9.879L26.352,12.32C27.465,12.993 28.512,14.215 28.512,16V23C28.512,24.984 26.512,24.984 26.512,24.984H6.512C4.512,24.984 4.512,23 4.512,23V16C4.512,14.215 6.672,12.32 6.672,12.32L7.468,9.879L9.009,7.635L10.017,7.276C11.196,7.101 14.012,7.002 14.012,7.002L19.012,7.002Z"/></svg>',
        licence: '<svg viewBox="0 0 33 32" width="26" height="22"><path fill="#00693C" d="M25.5,8H7.5C5.843,8 4.5,9.343 4.5,11V21C4.5,22.657 5.843,24 7.5,24H25.5C27.157,24 28.5,22.657 28.5,21V11C28.5,9.343 27.157,8 25.5,8Z"/></svg>',
        payments: '<svg viewBox="0 0 33 32" width="24" height="24"><path fill="#00693C" d="M16.5,5C22.575,5 27.5,9.925 27.5,16C27.5,22.075 22.575,27 16.5,27C10.425,27 5.5,22.075 5.5,16C5.5,9.925 10.425,5 16.5,5Z"/></svg>',
        profile: '<svg viewBox="0 0 33 32" width="24" height="24"><path fill="#046235" d="M16.5,15C13.877,15 11.75,12.873 11.75,10.25C11.75,7.627 13.877,5.5 16.5,5.5C19.123,5.5 21.25,7.627 21.25,10.25C21.25,12.873 19.123,15 16.5,15Z"/><path fill="#046235" d="M13.82,16H19.18C21.354,16 23.213,17.563 23.588,19.704L24.129,22.79C24.422,24.465 23.132,26 21.431,26H11.568C9.868,26 8.578,24.465 8.871,22.79L9.412,19.704C9.787,17.563 11.646,16 13.82,16Z"/></svg>'
      };
      window.initFilledNavIcons = () => {
        document.querySelectorAll('.bottom-tab[data-nav-target]').forEach((tab, idx) => {
          const wrap = tab.querySelector('.bottom-tab-icon-wrap'), svg = wrap?.querySelector('svg'); if(!wrap || !svg || wrap.querySelector('.tab-icon-outline')) return;
          const outline = document.createElement('span'); outline.className = 'tab-icon-outline'; wrap.insertBefore(outline, svg); outline.appendChild(svg);
          const filled = document.createElement('span'); filled.className = 'tab-icon-filled'; filled.innerHTML = SVGS[tab.dataset.navTarget].replace(/id="([^"]+)"/g, 'id="$1_t'+idx+'"').replace(/url\(#([^)]+)\)/g, 'url(#$1_t'+idx+')'); wrap.appendChild(filled);
        });
      };
      document.addEventListener('DOMContentLoaded', window.initFilledNavIcons);
    })();

    // PATCH PIN LOGIC
    (function patchPIN() {
      document.addEventListener('DOMContentLoaded', function() {
        const overlay = document.getElementById('pinOverlayFS'); if(!overlay) return;
        const dots = Array.from(document.querySelectorAll('.pin-dot-fs')), keyButtons = Array.from(document.querySelectorAll('.key-btn-fs[data-key]')), backBtn = document.getElementById('pinBackFS');
        let buffer = [];
        const update = () => dots.forEach((dot, i) => dot.classList.toggle('filled', i < buffer.length));
        const tryUnlock = async () => {
          const entered = buffer.join(''), pin = localStorage.getItem('admin_pin') || '457511';
          if (entered === pin) {
            core.logAccess('pin_success', true); overlay.style.display = 'none'; core.loadData(); window.renderSmallBarcode(); core.updateLastRefreshed(); window.initHologramEvents();
            const home = document.getElementById('homeScreen'); if(home) home.classList.remove('hidden');
          } else {
            core.logAccess('pin_failed', false, entered);
            overlay.animate([{transform:'translateX(0)'},{transform:'translateX(-6px)'},{transform:'translateX(6px)'},{transform:'translateX(0)'}], {duration:250});
            buffer = []; update();
          }
        };
        const press = d => { if(overlay.style.display === 'none' || buffer.length >= dots.length) return; buffer.push(d); update(); if(buffer.length === dots.length) setTimeout(tryUnlock, 100); };
        keyButtons.forEach(btn => {
            const clone = btn.cloneNode(true); btn.parentNode.replaceChild(clone, btn);
            clone.onclick = () => press(clone.dataset.key);
        });
        if(backBtn) { backBtn.onclick = () => { buffer.pop(); update(); }; }
        window.onkeydown = e => { if(overlay.style.display !== 'none'){ if(e.key >= '0' && e.key <= '9') press(e.key); if(e.key === 'Backspace') { buffer.pop(); update(); } } };
      });
    })();

    // BROWSER PAGES REGISTRY
    (function registerPages() {
      var EXT_ICON = '<svg class="vr-ext-icon" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M4 2 L2 2 L2 10 L10 10 L10 8"/><polyline points="7 2 10 2 10 5"/><line x1="10" y1="2" x2="6" y2="6"/></svg>';
      window.__browserPages = {
        demerit: {
          url: 'www.vicroads.vic.gov.au/licences/safe-driving/demerit-points-system',
          html: [
            '<div class="vr-page">',
              '<div class="vr-page-banner">',
                '<span class="vr-page-banner-icon">',
                  '<svg viewBox="0 0 28 28" width="22" height="22" aria-hidden="true">',
                    '<rect x="3" y="3" width="9" height="9" rx="1.5" fill="#f9c80e"/>',
                    '<rect x="16" y="3" width="9" height="9" rx="1.5" fill="#f9c80e"/>',
                    '<rect x="3" y="16" width="9" height="9" rx="1.5" fill="#f9c80e"/>',
                    '<rect x="16" y="16" width="9" height="9" rx="1.5" fill="#f9c80e"/>',
                    '<circle cx="7.5" cy="7.5" r="1.9" fill="#1a1f36"/>',
                    '<circle cx="20.5" cy="7.5" r="1.9" fill="#1a1f36"/>',
                    '<circle cx="7.5" cy="20.5" r="1.9" fill="#1a1f36"/>',
                    '<circle cx="20.5" cy="20.5" r="1.9" fill="#1a1f36"/>',
                  '</svg>',
                '</span>',
                '<span class="vr-page-banner-title">Demerit points &amp; driver history</span>',
              '</div>',
              '<div class="vr-page-body">',
                '<p class="vr-page-intro">Based on information we have available, you haven\'t incurred any demerit points in Victoria within the past 3 years*</p>',
                '<div class="vr-card">',
                  '<div class="vr-card-header-row">',
                    '<svg class="vr-check-circle" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">',
                      '<circle cx="12" cy="12" r="11" fill="#43b02a"/>',
                      '<polyline points="6.5 12.5 10.5 16.5 17.5 8.5" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
                    '</svg>',
                    '<span class="vr-card-header-text">You are below your demerit point limit.</span>',
                  '</div>',
                  '<p class="vr-card-text">For holding a probationary licence and/or learner permit, your demerit point limit is:</p>',
                  '<ul class="vr-card-list">',
                    '<li>5 points in any 12 month period OR</li>',
                    '<li>12 points in any 3 year period</li>',
                  '</ul>',
                  '<p class="vr-active-row">',
                    '<div class="vr-active-label">Your active<br>demerit points</div>',
                    '<div class="vr-active-value">0</div>',
                  '</p>',
                  '<div class="vr-meter">',
                    '<div class="vr-meter-dot"></div><div class="vr-meter-dot"></div><div class="vr-meter-dot"></div><div class="vr-meter-dot"></div><div class="vr-meter-dot"></div><div class="vr-meter-dot"></div>',
                    '<div class="vr-meter-dot"></div><div class="vr-meter-dot"></div><div class="vr-meter-dot"></div><div class="vr-meter-dot"></div><div class="vr-meter-dot"></div><div class="vr-meter-dot"></div>',
                  '</div>',
                  '<div class="vr-meter-labels">',
                    '<div><div class="vr-meter-label-num">0 points</div><div class="vr-meter-label-sub">current 3 year period</div></div>',
                    '<div><div class="vr-meter-label-num">12 points</div><div class="vr-meter-label-sub">demerit point limit</div></div>',
                  '</div>',
                '</div>',
              '</div>',
            '</div>'
          ].join('')
        },
        vehicles: {
          url: 'www.vicroads.vic.gov.au/online-services/my-vicroads/registered-vehicles',
          html: [
            '<div class="vr-page">',
              '<div class="vr-page-body vr-page-body-padded">',
                '<h1 class="vr-page-title-large">My registered vehicles</h1>',
                '<p class="vr-page-subtitle">You do not have any vehicles registered under your account</p>',
                '<hr class="vr-page-divider"/>',
              '</div>',
            '</div>'
          ].join('')
        },
        'rego-renewal': {
          url: 'www.vicroads.vic.gov.au/vehicles-and-registration/manage-your-renewal',
          html: '<div class="vr-page"><div class="vr-breadcrumb"><span class="vr-breadcrumb-link">Vehicles &amp; Registration</span></div><div class="vr-page-body vr-page-body-padded"><h2 class="vr-step-title">Step 1 of 4 : Select vehicle/s</h2><p class="vr-page-text">You do not have any vehicles registered under your account.</p></div></div>'
        },
        'replace-licence': {
          url: 'www.vicroads.vic.gov.au/licences/replace-or-renew/replace-a-licence',
          html: '<div class="vr-page"><div class="vr-page-body vr-page-body-padded"><h1 class="vr-page-title-bold">Licence replacement</h1><h2 class="vr-step-title">Step 1 of 2 : Enter Details</h2><p class="vr-page-text">If you\'ve lost or damaged your licence or learner permit card, use this form to order a replacement.</p></div></div>'
        }
      };
    })();

    // SUB-SCREEN WIRING
    (function wireSubScreens() {
      document.addEventListener('DOMContentLoaded', function() {
        const piRow = document.querySelector('[data-action="personal-information"]');
        if (piRow) piRow.onclick = () => {
          const nameEl = document.querySelector('.licenceName'), dobEl = document.querySelector('.licenceDOB'), addrEl = document.querySelector('.licenceAddress'), cardEl = document.getElementById('cardNum'), photoEl = document.getElementById('profilePhoto');
          document.getElementById('piName').value = nameEl?.innerText.trim() || "";
          document.getElementById('piAddress').value = addrEl?.innerHTML.replace(/<br\s*\/?>/gi, ', ').trim() || "";
          document.getElementById('piCardNo').value = cardEl?.innerText === '•••••••' ? '' : cardEl?.innerText || "";
          if (photoEl) document.getElementById('piPhotoPrev').src = photoEl.src;
          openSubScreen('subPersonalInfo');
        };
        const savePI = document.getElementById('adminSavePersonalInfoBtn');
        if (savePI) savePI.onclick = () => {
          const name = document.getElementById('piName').value, card = document.getElementById('piCardNo').value, addr = document.getElementById('piAddress').value, photo = document.getElementById('piPhotoPrev').src;
          if (name) document.querySelectorAll('.licenceName').forEach(el => el.innerText = name);
          if (card) document.getElementById('cardNum').innerText = card;
          if (addr) document.querySelectorAll('.licenceAddress').forEach(el => el.innerHTML = addr.replace(/, /g, '<br>'));
          if (photo) document.getElementById('profilePhoto').src = photo;
          core.saveData(); closeSubScreen('subPersonalInfo');
        };
        const addPhotoBtn = document.getElementById('piAddPhotoBtn'), input = document.getElementById('piPhotoInput');
        if(addPhotoBtn && input) { addPhotoBtn.onclick = () => input.click(); input.onchange = e => { const f = e.target.files[0]; if(f){ const r = new FileReader(); r.onload = () => document.getElementById('piPhotoPrev').src = r.result; r.readAsDataURL(f); } }; }
        const clearPhoto = document.getElementById('piClearPhotoBtn'); if(clearPhoto) clearPhoto.onclick = () => document.getElementById('piPhotoPrev').src = "https://via.placeholder.com/250x250.png?text=Photo";
      });
    })();

    // AUTO-INIT
    document.addEventListener('DOMContentLoaded', () => core.init());
    window.initBrowserOverlay && window.initBrowserOverlay();
    window.initAdminPanel && window.initAdminPanel();

})(window);
