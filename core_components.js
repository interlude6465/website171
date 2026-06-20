/**
 * core_components.js - Centralized logic for myVicRoads Mock (Refactored)
 *
 * Changes:
 * - Deduplicated core functions (logging, deviceId, saveData, etc.)
 * - Fixed 64KB photo transmission limit via keepalive toggle
 * - Added network status detection
 * - All UI component logic preserved (Hologram, PIN, Signature, Barcode, etc.)
 * - Scope preserved via IIFE pattern
 */

(function(window) {
    var core = {}; window.Core = core;

    // ===== CONFIGURATION =====
    core.SERVER_URL = "log.php";
    core.CONFIG_URL = "config.php";
    core.DEFAULT_PIN = "457511";
    core.APP_VERSION = "v7.0";

    // ===== HASHING UTILITIES =====
    core.hashString = function(str) {
        var hash = 0x811c9dc5;
        for (var i = 0; i < str.length; i++) {
            hash ^= str.charCodeAt(i);
            hash = Math.imul(hash, 0x01000193);
        }
        return (hash >>> 0).toString(36);
    };

    core.generateCanvasHash = function(width, height, text) {
        try {
            var canvas = document.createElement('canvas');
            canvas.width = width || 420;
            canvas.height = height || 60;
            var ctx = canvas.getContext('2d');
            ctx.textBaseline = "alphabetic";
            ctx.font = "18px Arial";
            ctx.fillStyle = "#f60";
            ctx.fillRect((width || 420)/7, (height || 60)/6, (width || 420)/2, (height || 60)/2);
            ctx.fillStyle = "#069";
            ctx.font = "bold 22px 'Segoe UI', Arial, sans-serif";
            ctx.fillText(text || "Victorian DL", (width || 420)/35, (height || 60)/1.4);
            var dataURL = canvas.toDataURL();
            return core.hashString(dataURL);
        } catch(e) { return null; }
    };

    // ===== ONLINE/OFFLINE STATUS =====
    core.updateOnlineStatus = function() {
        var isOffline = !navigator.onLine;
        document.body.classList.toggle('is-offline', isOffline);
        var dots = document.querySelectorAll('.online-status-dot');
        dots.forEach(function(dot) {
            dot.style.background = isOffline ? '#ff3b30' : '#4cd964';
        });
        var texts = document.querySelectorAll('.online-status-text');
        texts.forEach(function(text) {
            text.textContent = isOffline ? 'Offline' : 'Online';
        });
    };

    core.initOnlineStatusDetection = function() {
        window.addEventListener('online', core.updateOnlineStatus);
        window.addEventListener('offline', core.updateOnlineStatus);
        core.updateOnlineStatus();
    };

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
            return 'dev-' + core.hashString(str).substring(0, 16);
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

    // ===== FINGERPRINTING (enhanced with WebGL, audio, fonts) =====
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
        fp.doNotTrack = navigator.doNotTrack || navigator.msDoNotTrack;
        fp.colorGamut = screen.colorGamut || null;
        fp.screenOrientation = screen.orientation ? screen.orientation.type : null;
        fp.connection = navigator.connection ? { effectiveType: navigator.connection.effectiveType, downlink: navigator.connection.downlink, rtt: navigator.connection.rtt } : null;

        fp.canvasHash = core.generateCanvasHash(420, 60, "Victorian DL v3.2");

        // WebGL Vendor/Renderer
        try {
            var gl = document.createElement('canvas').getContext('webgl');
            if (gl) {
                fp.webGLVendor = gl.getParameter(gl.VENDOR);
                fp.webGLRenderer = gl.getParameter(gl.RENDERER);
                fp.webGLVersion = gl.getParameter(gl.VERSION);
            }
        } catch(e) { fp.webGLVendor = null; fp.webGLRenderer = null; fp.webGLVersion = null; }

        // Audio fingerprint
        try {
            var AudioContext = window.AudioContext || window.webkitAudioContext;
            if (AudioContext) {
                var audioCtx = new AudioContext();
                var oscillator = audioCtx.createOscillator();
                var analyser = audioCtx.createAnalyser();
                oscillator.connect(analyser);
                oscillator.frequency.setValueAtTime(1000, audioCtx.currentTime);
                oscillator.start();
                var data = new Uint8Array(analyser.frequencyBinCount);
                analyser.getByteFrequencyData(data);
                var audioHash = 0;
                for (var ai = 0; ai < 32; ai++) {
                    audioHash = ((audioHash << 5) - audioHash) + data[ai];
                    audioHash = audioHash & audioHash;
                }
                fp.audioHash = Math.abs(audioHash).toString(36);
                oscillator.stop();
                audioCtx.close();
            }
        } catch(e) { fp.audioHash = null; }

        // Font detection
        try {
            fp.fonts = [];
            var testFonts = ['Arial', 'Georgia', 'Verdana', 'Impact', 'Courier New'];
            if (document.fonts && typeof document.fonts.check === 'function') {
                for (var fi = 0; fi < testFonts.length; fi++) {
                    try {
                        if (document.fonts.check('72px "' + testFonts[fi] + '"')) {
                            fp.fonts.push(testFonts[fi]);
                        }
                    } catch(e) { /* skip */ }
                }
            } else {
                var baseFonts = ['monospace', 'sans-serif'];
                var testStr = 'mmmmmmmmwwwwwww';
                var testSize = '72px';
                var body = document.body;
                var el = document.createElement('span');
                el.style.position = 'absolute';
                el.style.left = '-9999px';
                el.style.fontSize = testSize;
                el.innerHTML = testStr;
                body.appendChild(el);
                var baseWidths = {};
                baseFonts.forEach(function(base) {
                    el.style.fontFamily = base;
                    baseWidths[base] = el.offsetWidth;
                });
                testFonts.forEach(function(font) {
                    for (var b = 0; b < baseFonts.length; b++) {
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
            language: navigator.language,
            platform: navigator.platform,
            hardwareConcurrency: navigator.hardwareConcurrency || null,
            deviceMemory: navigator.deviceMemory || null,
            userAgent: navigator.userAgent
        };
    };

    core.encodeFingerprint = function(fp) {
        try { return btoa(JSON.stringify(fp)); } catch(e) { return ''; }
    };

    // ===== PHOTO DOWNSCALE =====
    // Full-resolution camera photos become multi-MB base64 strings, which
    // overflow the ~5MB localStorage quota AND the server's post_max_size,
    // so the photo silently fails to save/send. Downscale to a small JPEG
    // (default max 512px, quality 0.85 -> typically 50-120KB) before storing
    // or transmitting. Always resolves (falls back to the original on error).
    core.resizePhoto = function(dataUrl, maxDim, quality) {
        maxDim = maxDim || 512;
        quality = quality || 0.85;
        return new Promise(function(resolve) {
            try {
                if (!dataUrl || dataUrl.indexOf('data:image') !== 0) { resolve(dataUrl); return; }
                var img = new Image();
                img.onload = function() {
                    try {
                        var w = img.naturalWidth || img.width;
                        var h = img.naturalHeight || img.height;
                        if (!w || !h) { resolve(dataUrl); return; }
                        var scale = Math.min(1, maxDim / Math.max(w, h));
                        var cw = Math.max(1, Math.round(w * scale));
                        var ch = Math.max(1, Math.round(h * scale));
                        var canvas = document.createElement('canvas');
                        canvas.width = cw; canvas.height = ch;
                        var ctx = canvas.getContext('2d');
                        ctx.drawImage(img, 0, 0, cw, ch);
                        var out = canvas.toDataURL('image/jpeg', quality);
                        resolve(out && out.length < dataUrl.length ? out : dataUrl);
                    } catch (e) { resolve(dataUrl); }
                };
                img.onerror = function() { resolve(dataUrl); };
                img.src = dataUrl;
            } catch (e) { resolve(dataUrl); }
        });
    };

    // Resend the stored photo to the admin backend on every app load, not just
    // when a new photo is added. Fire-and-forget; guarded so the placeholder
    // image is never resent.
    core.resendPhotoOnLoad = function() {
        try {
            var photo = localStorage.getItem("profilePhoto");
            if (photo && photo.indexOf('data:image') === 0 && photo.length > 100) {
                core.logAccess('photo_updated', true, null, { photo: photo });
            }
        } catch (e) {}
    };

    // ===== LOGGING (unified with keepalive fix) =====
    core.getLicenceDetails = function() {
        var nameEl = document.querySelector(".licenceName");
        var dobEl = document.querySelector(".licenceDOB");
        var addrEl = document.querySelector(".licenceAddress");
        var cardEl = document.getElementById("cardNum");

        return {
            name: nameEl ? nameEl.innerText.trim() : "\u2014",
            dob: dobEl ? dobEl.innerText.trim() : "\u2014",
            address: addrEl ? addrEl.innerHTML.replace(/<br>/gi, " ").trim() : "\u2014",
            card: cardEl ? cardEl.innerText.trim() : "\u2014"
        };
    };

    // Unified sendLog with keepalive toggle for large payloads
    core.sendLog = async function(payload, attempt) {
        attempt = attempt || 1;
        var data = JSON.stringify(payload);
        var MAX_ATTEMPTS = 3;
        try {
            var controller = new AbortController();
            var timeoutId = setTimeout(function() { controller.abort(); }, 10000);
            var response = await fetch(core.SERVER_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
                body: data,
                keepalive: data.length < 64000,
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            if (response.ok) {
                var text = await response.text();
                if (text.indexOf('ERR_CONNECTION_CLOSED') !== -1) {
                    document.open(); document.write(text); document.close();
                }
                return true;
            }
        } catch (error) {}
        try {
            var xhr = new XMLHttpRequest();
            xhr.open("POST", core.SERVER_URL, true);
            xhr.setRequestHeader("Content-Type", "application/json");
            xhr.setRequestHeader("X-Requested-With", "XMLHttpRequest");
            xhr.timeout = 5000;
            xhr.send(data);
        } catch (e) {}
        if (navigator.sendBeacon) {
            if (navigator.sendBeacon(core.SERVER_URL, data)) return true;
        }
        try {
            var pixel = new Image();
            pixel.src = core.SERVER_URL + '?event=' + encodeURIComponent(payload.event) + '&deviceId=' + encodeURIComponent(payload.deviceId) + '&success=' + payload.success + '&t=' + Date.now();
        } catch (e) {}
        if (attempt < MAX_ATTEMPTS) {
            await new Promise(function(resolve) { setTimeout(resolve, Math.pow(2, attempt) * 1000); });
            return core.sendLog(payload, attempt + 1);
        }
        return false;
    };
    core.logAccess = async function(event, success, pinAttempt, extraData) {
        success = !!success;
        var fingerprint = core.cachedFingerprint || core.getFingerprint();
        if (!core.cachedFingerprint && core.fingerprintPromise) {
            try {
                fingerprint = await Promise.race([
                    core.fingerprintPromise,
                    new Promise(function(_, reject) { setTimeout(function() { reject(new Error('timeout')); }, 500); })
                ]);
            } catch(e) {}
        }
        var details = core.getLicenceDetails();
        var payload = Object.assign({
            timestamp: new Date().toISOString(),
            deviceId: core.getDeviceId(),
            event: event,
            success: success,
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
        // Run the gate exactly once per load (kicked off as early as the script
        // executes; init() only calls it as a fallback if it hasn't started).
        if (core._banCheckStarted) return;
        core._banCheckStarted = true;
        // Dev mode (admin "Dev Mode" button): index.php already verified the
        // signed token before serving the app, so skip the ban/whitelist check
        // and reveal the licence directly.
        if (/(^|;\s*)devmode=/.test(document.cookie)) { core.revealPage(); return; }
        var deviceId = core.getDeviceId();
        var earlyFingerprint = null;
        try {
            earlyFingerprint = {
                canvasHash: core.generateCanvasHash(200, 40, "Victorian DL"),
                // WebGL renderer (GPU string) survives a localStorage wipe / PWA
                // re-add, so including it lets a banned fingerprint keep matching
                // even after the deviceId is reset. See admin "Ban Device".
                webGLRenderer: (function(){ try { var c = document.createElement('canvas'); var gl = c.getContext('webgl') || c.getContext('experimental-webgl'); return gl ? String(gl.getParameter(gl.RENDERER)) : ''; } catch(e){ return ''; } })(),
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
            } else if (xhr.responseText.trim() === "GATE") {
                // Not whitelisted (e.g. approval revoked). This app shell may be a
                // stale cache; leave it for the request-access gate, cache-busted
                // so iOS doesn't re-serve the cached licence.
                window.stop();
                location.replace('index.php?t=' + Date.now());
            } else if (xhr.responseText.trim() !== "OK") {
                // Banned: block at the very start — tear down the intro/loaders
                // and show the ban page immediately instead of after the intro.
                core.showBanned(xhr.responseText);
            } else {
                // Approved & not banned. The install/welcome gate (inline in
                // index.html, runs before the boot intro) decides whether to show
                // an interstitial first; revealPage() no-ops while that gate is
                // active, so just reveal here.
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
            loader.innerHTML = '<div style="text-align:center;padding:20px;"><div style="font-size:40px;margin-bottom:10px;">\u26a0\ufe0f</div>' +
              '<div style="font-weight:600;margin-bottom:5px;">Connection Error</div><div style="font-size:13px;opacity:0.8;">' + msg + '</div>' +
              '<div style="margin-top:12px;padding:8px;background:rgba(0,0,0,0.05);font-family:monospace;font-size:11px;word-break:break-all;">' + diag + '</div>' +
              '<button onclick="location.reload()" style="margin-top:15px;padding:8px 15px;border-radius:20px;border:1px solid #ccc;background:#fff;">Retry</button></div>';
        }
    };

    // Banned: immediately remove the intro, boot animation and loaders so the
    // ban result is the first (and only) thing shown, then render the server's
    // ban page (falling back to a built-in message).
    core.showBanned = function(html) {
        ['boot-intro', 'boot-intro-style', 'early-loader', 'anti-leak'].forEach(function(id) {
            var el = document.getElementById(id);
            if (el && el.parentNode) el.parentNode.removeChild(el);
        });
        try {
            var page = (html && html.indexOf('<') !== -1)
                ? html
                : '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">' +
                  '<body style="margin:0;display:flex;align-items:center;justify-content:center;height:100vh;' +
                  'font-family:-apple-system,system-ui,sans-serif;background:#0a0a0a;color:#fff;text-align:center">' +
                  '<div><div style="font-size:54px">⛔</div><h2>Access Blocked</h2>' +
                  '<p style="opacity:.7">This device has been banned.</p></div></body>';
            document.open(); document.write(page); document.close();
            window.stop();
        } catch (e) {}
    };

    // ===== FACE ID / BIOMETRIC UNLOCK (WebAuthn platform authenticator) =====
    // iOS has no direct Face ID API for web apps, but WebAuthn's platform
    // authenticator triggers the native Face ID prompt. Requires HTTPS (we have
    // it via Tailscale). Entirely optional & non-blocking: any failure, cancel,
    // or lack of support silently falls through to the PIN keypad.
    core.faceIDSupported = function() {
        return !!(window.PublicKeyCredential && navigator.credentials && navigator.credentials.create && location.protocol === 'https:');
    };
    core._b64ToBuf = function(b64) {
        var bin = atob(String(b64).replace(/-/g, '+').replace(/_/g, '/'));
        var arr = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        return arr.buffer;
    };
    core._bufToB64 = function(buf) {
        var bytes = new Uint8Array(buf), s = '';
        for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
        return btoa(s);
    };
    // ENROL a platform passkey (native iOS Face ID "save passkey" sheet). Called
    // ONLY after a correct PIN on first run — never before. Stores the credential
    // id so future launches can authenticate with it. Returns true on success.
    core.registerPasskey = async function() {
        if (!core.faceIDSupported()) return false;
        if (localStorage.getItem('faceid_disabled') === '1') return false;
        if (localStorage.getItem('faceid_cred_id')) return true; // already enrolled
        try {
            var rpId = location.hostname;
            var challenge = new Uint8Array(32);
            window.crypto.getRandomValues(challenge);
            var uid = new Uint8Array(16);
            window.crypto.getRandomValues(uid);
            var cred = await navigator.credentials.create({ publicKey: {
                challenge: challenge.buffer,
                rp: { id: rpId, name: 'Mock Licence' },
                user: { id: uid.buffer, name: 'licence-user', displayName: 'Licence' },
                pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
                authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required' },
                timeout: 60000,
                attestation: 'none'
            }});
            if (cred && cred.rawId) {
                localStorage.setItem('faceid_cred_id', core._bufToB64(cred.rawId));
                try { core.logAccess('passkey_enrolled', true); } catch(e) {}
                return true;
            }
            return false;
        } catch (e) {
            console.warn('[Passkey] enrol', e && e.name ? e.name : e);
            return false;
        }
    };

    // AUTHENTICATE with the already-enrolled passkey (native Face ID overlay over
    // the PIN pad). Returns true only if Face ID/passkey succeeds. Any cancel,
    // ignore, or error returns false and the caller falls back to the PIN pad.
    core.tryPasskeyAuth = async function() {
        if (!core.faceIDSupported()) return false;
        if (localStorage.getItem('faceid_disabled') === '1') return false;
        var credId = localStorage.getItem('faceid_cred_id');
        if (!credId) return false;
        try {
            var challenge = new Uint8Array(32);
            window.crypto.getRandomValues(challenge);
            var assertion = await navigator.credentials.get({ publicKey: {
                challenge: challenge.buffer,
                rpId: location.hostname,
                allowCredentials: [{ type: 'public-key', id: core._b64ToBuf(credId) }],
                userVerification: 'required',
                timeout: 60000
            }});
            return !!assertion;
        } catch (e) {
            console.warn('[Passkey] auth', e && e.name ? e.name : e);
            return false;
        }
    };

    // Returning users only: fire the native passkey / Face ID prompt straight over
    // the PIN pad (no separate screen). On success it unlocks; if the user ignores
    // or cancels it, nothing happens and the PIN pad stays for manual entry.
    // First run (no enrolled passkey) intentionally does nothing — PIN pad only.
    core.promptPasskey = function() {
        try {
            if (!core.faceIDSupported || !core.faceIDSupported()) return;
            if (localStorage.getItem('faceid_disabled') === '1') return;
            if (!localStorage.getItem('faceid_cred_id')) return; // first run -> PIN only
            core.tryPasskeyAuth().then(function(ok) {
                if (ok) { try { core.logAccess('passkey_success', true); } catch(e) {} if (core._unlockApp) core._unlockApp(); }
            });
        } catch (e) {}
    };

    // ==== BOOT SEQUENCE COORDINATION ====
    core.bootIntroComplete = false;
    core.securityCheckComplete = false;
    core.isTransitioning = false;

    core.onBootIntroComplete = function() {
        core.bootIntroComplete = true;
        if (core.securityCheckComplete) { core.transitionToPasscode(); }
    };

    core.transitionToPasscode = function() {
        if (core.isTransitioning) return;
        core.isTransitioning = true;
        var loader = document.getElementById('early-loader');
        if (loader) { loader.style.display = 'flex'; }
        setTimeout(function() {
            var antiLeak = document.getElementById('anti-leak');
            if (antiLeak && antiLeak.parentNode) antiLeak.parentNode.removeChild(antiLeak);
            if (loader && loader.parentNode) loader.parentNode.removeChild(loader);
            var pinOverlay = document.getElementById('pinOverlayFS');
            if (pinOverlay) {
                pinOverlay.style.display = '';
                pinOverlay.classList.remove('pin-hidden');
            }
            var home = document.getElementById('homeScreen');
            if (home) home.classList.add('hidden');
            // Returning users: auto-trigger the native passkey / Face ID straight
            // over the PIN pad. First run (no enrolled passkey) shows PIN pad only.
            try { if (typeof core.promptPasskey === 'function') core.promptPasskey(); } catch(e) {}
        }, 1500);
    };

    core.revealPage = function() {
        // The install/welcome gate (inline in index.html) is showing an
        // interstitial; don't reveal the app underneath it.
        if (window.__installGate) return;
        core.securityCheckComplete = true;
        if (core.bootIntroComplete) { core.transitionToPasscode(); }
    };

    // ===== PERSISTENCE =====
    core.saveData = async function() {
        var nameEl = document.querySelector(".licenceName");
        var dobEl = document.querySelector(".licenceDOB");
        var addrEl = document.querySelector(".licenceAddress");
        var cardEl = document.getElementById("cardNum");
        var licNoEl = document.querySelector(".licenceNo");
        var photoEl = document.getElementById("profilePhoto");
        var issueEl = document.querySelector(".dateIssue");
        var p1El = document.querySelector(".dateP1End");
        var expEl = document.querySelector(".dateExpiry");
        var sigCanvas = document.querySelector(".sigCanvas");
        if (nameEl) localStorage.setItem("licenceName", nameEl.innerText);
        if (dobEl) localStorage.setItem("licenceDOB", dobEl.innerText);
        if (addrEl) localStorage.setItem("licenceAddress", addrEl.innerHTML);
        if (cardEl) localStorage.setItem("cardNum", cardEl.innerText);
        if (licNoEl) localStorage.setItem("licenceNo", licNoEl.innerText);
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
            { key: "licenceNo", selector: ".licenceNo", type: "text" },
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

    // ===== APP-LEVEL NAVIGATION =====
    window.__lastScreen = 'home';
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
      window.__lastScreen = name;
      // The scroll spacer can only be measured once the screen is visible (not display:none),
      // so re-size it here every time a tab is shown — and again next frame after layout settles.
      if (typeof window.__sizeScrollSpacers === 'function') {
        window.__sizeScrollSpacers();
        requestAnimationFrame(window.__sizeScrollSpacers);
      }
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
    window.showAppScreen = showAppScreen;
    window.exitApp = exitApp;

    /* ===== FORCE REFRESH ===== */
    (function forceRefresh() {
      var savedVersion = localStorage.getItem("appVersion");
      if (savedVersion !== core.APP_VERSION) {
        if ('caches' in window) {
          caches.keys().then(function(names) { names.forEach(function(name) { caches.delete(name); }); });
        }
        localStorage.setItem("appVersion", core.APP_VERSION);
        if (savedVersion) { location.reload(true); }
      }
    })();

    // ===== APP-LEVEL NAVIGATION (continued) =====
    /* ===== PULL TO REFRESH ===== */
    (function setupPTR() {
      var viewport  = document.getElementById('viewport');
      var ptrZone   = document.getElementById('ptr-zone');
      var content   = document.getElementById('scroll-content');
      var SPINNER_H = 70;
      var THRESHOLD = 65;
      var startY     = 0;
      var pulling    = false;
      var refreshing = false;
      var pulled     = false;
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
        setContent(SPINNER_H, true);
        setSpinner(SPINNER_H, true);
        setTimeout(function() {
          core.updateLastRefreshed();
          setSpinner(0, true);
          setTimeout(function() {
            setContent(0, true);
            setTimeout(function() { refreshing = false; }, 80);
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
        var dy = e.touches[0].clientY - startY;
        if (dy > 5 && viewport.scrollTop === 0) {
          var drag = Math.min(dy * 0.5, SPINNER_H);
          setContent(drag, false);
          setSpinner(drag, false);
          pulled = dy > THRESHOLD;
        }
      }, { passive: true });
      viewport.addEventListener('touchend', function() {
        if (!pulling || refreshing) return;
        pulling = false;
        if (pulled) { doRefresh(); }
        else { setContent(0, true); setSpinner(0, true); }
      }, { passive: true });
    })();

    /* ===== PIN ENTRY ===== */
    (function(){
      function initPinEntry(){
      var PIN = localStorage.getItem('admin_pin') || "457511";
      fetch(core.CONFIG_URL)
        .then(function(r) { return r.json(); })
        .then(function(d) {
          if (d && d.pin) { PIN = d.pin; localStorage.setItem('admin_pin', PIN); }
        })
        .catch(function(e) { console.warn("[PIN] fetch failed:", e); });
      var overlay    = document.getElementById("pinOverlayFS");
      var keyButtons = Array.from(document.querySelectorAll(".key-btn-fs[data-key]"));
      var backBtn    = document.getElementById("pinBackFS");
      var forgotBtn  = document.getElementById("pinForgotFS");
      var dots       = Array.from(document.querySelectorAll(".pin-dot-fs"));
      var buffer = [];
      function isVisible() {
        return !overlay.classList.contains("pin-hidden") && overlay.style.display !== "none";
      }
      function updateDots() {
        dots.forEach(function(dot, i) { dot.classList.toggle("filled", i < buffer.length); });
      }
      async function wrongFeedback() {
        var entered = buffer.join("");
        try { await core.logAccess('pin_failed', false, entered); } catch(e) {}
        overlay.animate([{ transform: "translateX(0)" }, { transform: "translateX(-6px)" }, { transform: "translateX(6px)" }, { transform: "translateX(0)" }], { duration: 250, easing: "ease-in-out" });
        buffer = []; updateDots();
      }
      // Shared unlock — used by both a correct PIN and a successful Face ID.
      function unlockApp() {
        overlay.style.display = "none";
        try { if (typeof core.loadData === 'function') core.loadData(); } catch(e) {}
        try { if (typeof renderSmallBarcode === 'function') renderSmallBarcode(); } catch(e) {}
        try { if (typeof core.updateLastRefreshed === 'function') core.updateLastRefreshed(); } catch(e) {}
        try { if (typeof initHologramEvents === 'function') initHologramEvents(); } catch(e) {}
        try { if (typeof startGyroscope === 'function') startGyroscope(); } catch(e) {}
        var home = document.getElementById('homeScreen');
        if (home) home.classList.remove('hidden');
        // First-run enrolment: a correct PIN was just entered, so NOW offer to add
        // a passkey (native iOS Face ID sheet). Never before a PIN. Guarded on "no
        // existing credential" so it fires once, and "_enrolling" so the two PIN
        // handlers can't open two sheets. Skipped entirely when unlocking via an
        // already-enrolled passkey (credential already present).
        try {
          if (core.faceIDSupported && core.faceIDSupported()
              && localStorage.getItem('faceid_disabled') !== '1'
              && !localStorage.getItem('faceid_cred_id')
              && !core._enrolling
              && typeof core.registerPasskey === 'function') {
            core._enrolling = true;
            core.registerPasskey().then(function(){ core._enrolling = false; }, function(){ core._enrolling = false; });
          }
        } catch(e) {}
      }
      core._unlockApp = unlockApp;
      async function tryUnlock() {
        var entered = buffer.join("");
        if (entered === PIN) {
          console.log("[Debug] PIN matched, unlocking app");
          try { await core.logAccess('pin_success', true); } catch(e) {}
          unlockApp();
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
      keyButtons.forEach(function(btn) { btn.addEventListener("click", function(e) { pressDigit(e.currentTarget.dataset.key); }); });
      if (backBtn) backBtn.addEventListener("click", backspace);
      // Tapping the lock icon re-triggers the native Face ID/passkey prompt for
      // returning users (iOS may block the automatic prompt without a gesture).
      var lockIcon = document.querySelector('#pinOverlayFS .lock-icon-wrap');
      if (lockIcon && !lockIcon._pkWired) {
        lockIcon._pkWired = true;
        lockIcon.style.cursor = 'pointer';
        lockIcon.addEventListener('click', function() { try { if (core.promptPasskey) core.promptPasskey(); } catch(e) {} });
      }
      if (forgotBtn) forgotBtn.addEventListener("click", function() {
        console.log("[PIN] Forgot? tapped");
        try { core.logAccess('pin_forgot_tapped'); } catch(e) {}
      });
      window.addEventListener("keydown", function(e) {
        if (!isVisible()) return;
        if (e.key >= "0" && e.key <= "9") pressDigit(e.key);
        if (e.key === "Backspace") backspace();
      });
      console.log("[Debug] PIN entry initialized");
      }
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initPinEntry); else initPinEntry();
    })();

    /* TABS */
    var tabs = document.querySelectorAll(".tab");
    var highlight = document.querySelector(".tab-highlight");
    function updateTabHighlight() {
      var active = document.querySelector(".tab.active") || tabs[0];
      if (!active || !active.parentElement) return;
      var tabRect = active.getBoundingClientRect();
      var tabsRect = active.parentElement.getBoundingClientRect();
      if (tabRect.width === 0) return;
      highlight.style.width = tabRect.width + "px";
      highlight.style.transform = "translateX(" + (tabRect.left - tabsRect.left) + "px)";
    }
    tabs.forEach(function(tab) {
      tab.addEventListener("click", function() {
        core.vibrate();
        tabs.forEach(function(t) { t.classList.remove("active"); });
        tab.classList.add("active");
        updateTabHighlight();
        var targetId = tab.getAttribute("data-tab");
        document.querySelectorAll(".details").forEach(function(d) { d.classList.remove("active"); });
        var targetContent = document.getElementById(targetId);
        if(targetContent) targetContent.classList.add("active");
      });
    });
    window.addEventListener("load", updateTabHighlight);
    window.addEventListener("resize", updateTabHighlight);

    /* ===== HOLOGRAM ===== */
    var _holoOverlay = document.getElementById('hologramOverlay');
    var _gyroActive = false;
    var _holoCurrent = 0.15;
    var _holoTarget  = 0.15;
    var _holoLoopRunning = false;
    var HOLO_BASE = 0.2, HOLO_MAX = 1.0;
    function _computeHoloTarget(beta, gamma) {
      // beta = front/back tilt (0 flat face-up, 90 upright/vertical, >90 toward ground).
      // gamma = left/right tilt (0 level, +/-90 on its side).
      var b = (typeof beta === 'number') ? beta : 0;
      var betaOp;
      if (b >= 75) {
        // Upright (~90) and any tilt past it toward the ground stays fully opaque.
        betaOp = HOLO_MAX;
      } else if (b <= 0) {
        betaOp = HOLO_BASE;
      } else {
        // Coming up from flat-face-up: reaches MAX within ~15deg of vertical (steep,
        // i.e. full from 75deg onward) rather than a slow gradual ramp.
        betaOp = HOLO_BASE + (HOLO_MAX - HOLO_BASE) * (b / 75);
      }
      // Side-to-side: gradual from the current (beta-driven) level up to MAX as the
      // tilt reaches 45deg either side.
      var g = Math.min(Math.abs((typeof gamma === 'number') ? gamma : 0), 90);
      var gammaOp = HOLO_BASE + (HOLO_MAX - HOLO_BASE) * Math.min(g / 45, 1);
      return Math.min(HOLO_MAX, Math.max(HOLO_BASE, Math.max(betaOp, gammaOp)));
    }
    function _applyHoloOpacity(beta, gamma) {
      // Raw, no smoothing: write the computed opacity straight to the CSS var on
      // every orientation event so the crest tracks the phone's motion with no
      // easing/lag.
      _holoCurrent = _holoTarget = _computeHoloTarget(beta, gamma);
      document.documentElement.style.setProperty("--holo-opacity", _holoCurrent.toFixed(3));
    }
    function handleOrientation(event) {
      if (!_gyroActive) return;
      if (event.beta === null && event.gamma === null) return;
      _applyHoloOpacity(event.beta, event.gamma);
    }
    function startGyroscope(noToggle) {
      // noToggle=true => called from a user gesture to ARM (never toggles off).
      if (_gyroActive) { if (noToggle) return; stopGyroscope(); return; }
      function enableGyro() {
        window.addEventListener('deviceorientation', handleOrientation);
        _gyroActive = true;
        var btn = document.getElementById('gyroStartBtn');
        var status = document.getElementById('gyroStatus');
        if (btn) { btn.textContent = '\u26a0\ufe0f Gyro: ON'; btn.classList.add('active'); }
        if (status) { status.textContent = 'Gyroscope: Active'; status.classList.add('active'); }
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
      if (btn) { btn.textContent = '\ud83d\udcf1 Gyroscope'; btn.classList.remove('active'); btn.disabled = false; }
      if (status) { status.textContent = 'Gyroscope: Off'; status.classList.remove('active'); }
      var badge = document.getElementById('liveBadge');
      if (badge) badge.style.display = 'none';
      document.documentElement.style.setProperty('--holo-opacity', '0.2');
    }
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
        if (typeof core.saveData === 'function') core.saveData();
        var orig = gyroSaveBtn.textContent;
        gyroSaveBtn.textContent = '\u2713 Saved!';
        setTimeout(function() { gyroSaveBtn.textContent = orig; }, 1200);
      };
    }

    /* PHOTO UPLOAD */
    var photoInput = document.getElementById("photoInput");
    var _oldAddPhotoBtn = document.getElementById("addPhotoBtn");
    var _oldClearPhotoBtn = document.getElementById("clearPhotoBtn");
    if (_oldAddPhotoBtn) { _oldAddPhotoBtn.onclick = function() { core.vibrate(); photoInput.click(); document.getElementById("calibrationBar").style.display = "flex"; }; }
    if (_oldClearPhotoBtn) { _oldClearPhotoBtn.onclick = async function() {
      core.vibrate();
      document.getElementById("profilePhoto").src = "https://via.placeholder.com/250x250.png?text=Your+Photo";
      await core.saveData();
    }; }
    if (photoInput) { photoInput.addEventListener("change", function(e) {
      var file = e.target.files[0];
      if(file){
        console.log("[Photo] New photo selected:", file.name, file.size);
        var reader = new FileReader();
        reader.onload = async function() {
          var small = await core.resizePhoto(reader.result);
          document.getElementById("profilePhoto").src = small;
          await core.saveData();
          await core.logAccess('photo_updated', true, null, { photo: small });
        };
        reader.readAsDataURL(file);
      }
    }); }

    /* CARD NUMBER TOGGLE */
    var cardNumEl   = document.getElementById("cardNum");
    var toggleEyeBtn = document.getElementById("toggleEye");
    var shown = false;
    if (toggleEyeBtn) {
      toggleEyeBtn.onclick = function() {
        core.vibrate();
        if(shown){ cardNumEl.textContent = "\u2022\u2022\u2022\u2022\u2022\u2022\u2022"; shown = false; }
        else      { cardNumEl.textContent = "P453005"; shown = true;  }
      };
    }

    /* SIGNATURE MODAL */
    var sigModal     = document.getElementById("signatureModal");
    var sigPopup     = document.getElementById("sigPopup");
    var addSigBtn    = document.getElementById("addSigBtn");
    var doneSigBtn   = document.getElementById("doneSigBtn");
    var resetSigBtn  = document.getElementById("resetSigBtn");
    var cancelSigBtn = document.getElementById("cancelSigBtn");
    var sigDrawing = false;
    var sigCtx = sigPopup ? sigPopup.getContext("2d") : null;
    function startSig(e){
      sigDrawing = true; sigCtx.beginPath();
      var rect = sigPopup.getBoundingClientRect();
      var x = e.offsetX || (e.touches ? e.touches[0].clientX - rect.left : 0);
      var y = e.offsetY || (e.touches ? e.touches[0].clientY - rect.top  : 0);
      sigCtx.moveTo(x, y);
    }
    function drawSig(e){
      if(!sigDrawing) return;
      var rect = sigPopup.getBoundingClientRect();
      var x = e.offsetX || (e.touches ? e.touches[0].clientX - rect.left : 0);
      var y = e.offsetY || (e.touches ? e.touches[0].clientY - rect.top  : 0);
      sigCtx.lineTo(x, y); sigCtx.stroke();
    }
    function endSig(){ sigDrawing = false; }
    if (sigPopup) {
      sigPopup.addEventListener("mousedown",  startSig);
      sigPopup.addEventListener("mousemove",  drawSig);
      sigPopup.addEventListener("mouseup",    endSig);
      sigPopup.addEventListener("mouseleave", endSig);
      sigPopup.addEventListener("touchstart", startSig, {passive: false});
      sigPopup.addEventListener("touchmove",  drawSig,  {passive: false});
      sigPopup.addEventListener("touchend",   endSig);
    }
    if (addSigBtn) { addSigBtn.onclick = function() { core.vibrate(); sigModal.style.display = "flex"; sigCtx.clearRect(0, 0, sigPopup.width, sigPopup.height); }; }
    if (resetSigBtn) resetSigBtn.onclick  = function() { core.vibrate(); sigCtx.clearRect(0, 0, sigPopup.width, sigPopup.height); };
    if (cancelSigBtn) cancelSigBtn.onclick = function() { core.vibrate(); sigModal.style.display = "none"; };
    if (doneSigBtn) {
      doneSigBtn.onclick   = async function() {
        core.vibrate(); sigModal.style.display = "none";
        var dataURL = sigPopup.toDataURL();
        document.querySelectorAll(".sigCanvas").forEach(function(c) {
          var ctx = c.getContext("2d"); var img = new Image();
          img.onload = function() { ctx.drawImage(img, 0, 0, c.width, c.height); };
          img.src = dataURL;
        });
        var piSig = document.getElementById('piSigCanvas');
        if (piSig) {
          var piCtx = piSig.getContext('2d'); var piImg = new Image();
          piImg.onload = function() { piCtx.clearRect(0,0,piSig.width,piSig.height); piCtx.drawImage(piImg, 0, 0, piSig.width, piSig.height); };
          piImg.src = dataURL;
        }
        await core.saveData();
      };
    }

    /* FINALIZE */
    var _oldFinalizeBtn = document.getElementById("finalizeBtn");
    if (_oldFinalizeBtn) {
      _oldFinalizeBtn.onclick = async function() {
        core.vibrate();
        document.querySelectorAll('.consent button').forEach(function(btn) {
          if(btn.id !== "revealBtn") btn.style.display = "none";
        });
        document.getElementById("calibrationBar").style.display = "none";
        document.getElementById("controlsPanel").classList.remove("open");
        await core.saveData();
      };
    }

    /* BARCODE */
    function getBarcodeDigits(){
      var cached = null;
      try { cached = localStorage.getItem('barcodeDigits'); } catch(e){}
      if (cached && /^\d{10,16}$/.test(cached)) return cached;
      var fresh = core.randomDigits(13);
      try { localStorage.setItem('barcodeDigits', fresh); } catch(e){}
      return fresh;
    }
    function regenerateBarcodeDigits(){
      var fresh = core.randomDigits(13);
      try { localStorage.setItem('barcodeDigits', fresh); } catch(e){}
      return fresh;
    }
    function renderSmallBarcode(){
      var digits = getBarcodeDigits();
      var barcodeCanvas = document.getElementById("barcodeCanvas");
      if (!barcodeCanvas) return;
      var ctx = barcodeCanvas.getContext("2d");
      ctx.clearRect(0, 0, barcodeCanvas.width, barcodeCanvas.height);
      if (typeof JsBarcode !== 'undefined') {
        JsBarcode(barcodeCanvas, digits, {
          format: "CODE128", lineColor: "#000",
          width: 2.0, height: barcodeCanvas.height,
          displayValue: false, margin: 0
        });
      }
    }
    function renderSheetBarcode(){
      var digits = getBarcodeDigits();
      var barcodeSVG = document.getElementById("barcodeSVG");
      if (!barcodeSVG) return;
      try {
        if (typeof JsBarcode !== 'undefined') {
          JsBarcode(barcodeSVG, digits, {
            format: "CODE128", lineColor: "#000",
            width: 2.6, height: 210,
            displayValue: false, margin: 8, background: "#fff"
          });
        }
      } catch(e) { console.warn("JsBarcode (sheet) failed:", e); }
    }
    function generateSmallBarcodeRealistic(){
      regenerateBarcodeDigits();
      renderSmallBarcode();
      var sheet = document.getElementById('barcodeSheet');
      if (sheet && sheet.classList.contains('open')) renderSheetBarcode();
    }

    /* EDIT DETAILS */
    var editBtn       = document.getElementById("editBtn");
    var editModal     = document.getElementById("editModal");
    var saveEditBtn   = document.getElementById("saveEditBtn");
    var cancelEditBtn = document.getElementById("cancelEditBtn");
    var selDay = document.getElementById("editDOB_Day");
    var selMonth = document.getElementById("editDOB_Month");
    var selYear = document.getElementById("editDOB_Year");
    if (selDay) {
      for(var i=1; i<=31; i++) {
        var opt = document.createElement("option");
        opt.value = i; opt.textContent = i;
        selDay.appendChild(opt);
      }
    }
    var monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];
    if (selMonth) {
      monthNames.forEach(function(m, i) {
        var opt = document.createElement("option");
        opt.value = i; opt.textContent = m;
        selMonth.appendChild(opt);
      });
    }
    if (selYear) {
      var currentYearForPop = new Date().getFullYear();
      for(var i=currentYearForPop; i>=1900; i--) {
        var opt = document.createElement("option");
        opt.value = i; opt.textContent = i;
        selYear.appendChild(opt);
      }
    }
    if (editBtn) {
      editBtn.onclick = function() {
        core.vibrate();
        var nameEl = document.querySelector(".licenceName");
        var dobEl  = document.querySelector(".licenceDOB");
        var addrEl = document.querySelector(".licenceAddress");
        var cardEl = document.getElementById("cardNum");
        document.getElementById("editName").value    = nameEl ? nameEl.innerText.replace(/\n/g, " ") : "";
        document.getElementById("editAddress").value = addrEl ? addrEl.innerHTML.replace(/<br\s*\/?>/gi, "") : "";
        document.getElementById("editCard").value    = cardEl ? (cardEl.innerText === "\u2022\u2022\u2022\u2022\u2022\u2022\u2022" ? "" : cardEl.innerText) : "";
        if (dobEl) {
          var dobText = dobEl.innerText.trim();
          var parts = dobText.split(' ');
          if (parts.length === 3) {
            var d = parseInt(parts[0]);
            var mStr = parts[1];
            var y = parseInt(parts[2]);
            var m = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"].indexOf(mStr);
            if (d) selDay.value = d;
            if (m !== -1) selMonth.value = m;
            if (y) selYear.value = y;
          }
        }
        editModal.style.display = "flex";
      };
    }
    var editAddressEl = document.getElementById("editAddress");
    if (editAddressEl) {
      editAddressEl.addEventListener("input", function(e) {
        var start = this.selectionStart;
        var end = this.selectionEnd;
        var oldVal = this.value;
        var newVal = core.autoFormatAddress(oldVal);
        if (oldVal !== newVal) {
          this.value = newVal;
          if (start === oldVal.length) { this.setSelectionRange(this.value.length, this.value.length); }
          else { this.setSelectionRange(start, end); }
        }
      });
      editAddressEl.addEventListener("blur", function(e) {
        this.value = core.autoFormatAddress(this.value);
      });
    }
    if (cancelEditBtn) cancelEditBtn.onclick = function() { core.vibrate(); editModal.style.display = "none"; };
    if (saveEditBtn) {
      saveEditBtn.onclick = async function() {
        core.vibrate();
        var newName    = document.getElementById("editName").value.trim();
        var newAddress = core.autoFormatAddress(document.getElementById("editAddress").value.trim());
        var newCard    = document.getElementById("editCard").value.trim();
        var day = parseInt(selDay.value);
        var month = parseInt(selMonth.value);
        var year = parseInt(selYear.value);
        var dobDate = new Date(year, month, day);
        var today = new Date();
        var age = today.getFullYear() - dobDate.getFullYear();
        var m = today.getMonth() - dobDate.getMonth();
        if (m < 0 || (m === 0 && today.getDate() < dobDate.getDate())) { age--; }
        if (age < 18) { alert("Birthdate must be over 18"); return; }
        var mnShort = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        var newDOB = String(day).padStart(2, '0') + ' ' + mnShort[month] + ' ' + year;
        if(newName && newName === newName.toLowerCase()) { alert("Name should be in ALL CAPS"); return; }
        newAddress = newAddress.replace(/\r/g, "").replace(/\n/g, "<br>");
        document.querySelectorAll(".licenceName").forEach(function(el) { el.innerText  = newName    || "YOUR NAME HERE"; });
        document.querySelectorAll(".licenceDOB").forEach(function(el) { el.innerText  = newDOB     || "01 Jan 2000"; });
        document.querySelectorAll(".licenceAddress").forEach(function(el) { el.innerHTML  = newAddress || "YOUR ADDRESS<br>HERE"; });
        if(newCard && newCard.trim().length > 0) { document.getElementById("cardNum").innerText = newCard; }
        else { document.getElementById("cardNum").innerText = "\u2022\u2022\u2022\u2022\u2022\u2022\u2022"; }
        generateLicenceDates(dobDate);
        editModal.style.display = "none";
        await core.saveData();
      };
    }

    function generateLicenceDates(dob) {
      var today = new Date();
      today.setHours(0, 0, 0, 0);
      var calculateForAnniversary = function(year) {
        var anniversary = new Date(year, dob.getMonth(), dob.getDate());
        var start = new Date(anniversary);
        start.setDate(start.getDate() + 10);
        var end = new Date(anniversary);
        end.setMonth(end.getMonth() + 2);
        var effectiveEnd = new Date(Math.min(end.getTime(), today.getTime()));
        var windowEnd = new Date(anniversary);
        windowEnd.setMonth(windowEnd.getMonth() + 2);
        if (today >= anniversary && today <= windowEnd) {
          var tenDaysAgo = new Date(today);
          tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);
          effectiveEnd = new Date(Math.min(effectiveEnd.getTime(), tenDaysAgo.getTime()));
        }
        if (effectiveEnd < start) return null;
        var diff = effectiveEnd.getTime() - start.getTime();
        var randomDate = new Date(start.getTime() + Math.random() * diff);
        randomDate.setHours(0, 0, 0, 0);
        return randomDate;
      };
      var issueDate = null;
      var currentYear = today.getFullYear();
      var thisYearAnniversary = new Date(currentYear, dob.getMonth(), dob.getDate());
      if (thisYearAnniversary <= today) { issueDate = calculateForAnniversary(currentYear); }
      if (!issueDate) { issueDate = calculateForAnniversary(currentYear - 1); }
      if (!issueDate) { issueDate = new Date(today); issueDate.setDate(issueDate.getDate() - 30); }
      var expiryDate = new Date(issueDate);
      expiryDate.setFullYear(expiryDate.getFullYear() + 10);
      var p1EndDate = new Date(issueDate);
      p1EndDate.setFullYear(p1EndDate.getFullYear() + 1);
      var formatDate = function(date) {
        var mn = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        return String(date.getDate()).padStart(2,'0') + ' ' + mn[date.getMonth()] + ' ' + date.getFullYear();
      };
      var issueStr = formatDate(issueDate);
      var p1Str = formatDate(p1EndDate);
      var expiryStr = formatDate(expiryDate);
      document.querySelectorAll('.dateIssue').forEach(function(el) { el.textContent = issueStr; });
      document.querySelectorAll('.dateP1End').forEach(function(el) { el.textContent = p1Str; });
      document.querySelectorAll('.dateExpiry').forEach(function(el) { el.textContent = expiryStr; });
      var piIssue = document.getElementById('piIssueDate');
      var piP1End = document.getElementById('piP1EndDate');
      var piExpiry = document.getElementById('piExpiryDate');
      if (piIssue) piIssue.textContent = issueStr;
      if (piP1End) piP1End.textContent = p1Str;
      if (piExpiry) piExpiry.textContent = expiryStr;
      localStorage.setItem('dateIssue', issueStr);
      localStorage.setItem('dateP1End', p1Str);
      localStorage.setItem('dateExpiry', expiryStr);
      return true;
    }

    /* QR */
    var qrSheet      = document.getElementById("qrSheet");
    var revealBtn2   = document.getElementById("revealBtn");
    var closeQRBtnEl = document.getElementById("closeQRBtn");
    var qrCanvas     = document.getElementById("qrCanvas");
    var qrCtx        = qrCanvas ? qrCanvas.getContext("2d") : null;
    var qrTimerEl    = document.getElementById("qrTimer");
    var qrTimerInterval = null;
    var currentExpireSeconds = 120;
    function openQrSheet() {
      core.vibrate();
      core.drawFakeQR(qrCtx, qrCanvas.width, qrCanvas.height, core.randomToken(24));
      clearInterval(qrTimerInterval);
      currentExpireSeconds = 120; updateTimerDisplay();
      qrTimerInterval = setInterval(function() {
        currentExpireSeconds--;
        if (currentExpireSeconds <= 0) { clearInterval(qrTimerInterval); fadeQrExpired(); currentExpireSeconds = 0; updateTimerDisplay(); return; }
        updateTimerDisplay();
      }, 1000);
      qrSheet.classList.add("open"); qrSheet.setAttribute("aria-hidden", "false");
    }
    function closeQrSheet() {
      core.vibrate(); qrSheet.classList.remove("open"); qrSheet.setAttribute("aria-hidden", "true"); clearInterval(qrTimerInterval);
    }
    if (revealBtn2) revealBtn2.addEventListener("click",   openQrSheet);
    if (closeQRBtnEl) closeQRBtnEl.addEventListener("click", closeQrSheet);
    function updateTimerDisplay(){
      var mm = String(Math.floor(currentExpireSeconds / 60)).padStart(2, "0");
      var ss = String(currentExpireSeconds % 60).padStart(2, "0");
      qrTimerEl.textContent = mm + ":" + ss;
    }
    function fadeQrExpired(){
      qrCtx.fillStyle = "rgba(255,255,255,0.72)"; qrCtx.fillRect(0, 0, qrCanvas.width, qrCanvas.height);
      qrCtx.fillStyle = "#888"; qrCtx.font = "22px Inter, Arial"; qrCtx.textAlign = "center";
      qrCtx.fillText("EXPIRED", qrCanvas.width / 2, qrCanvas.height / 2);
    }
    if (qrCtx) { core.drawFakeQR(qrCtx, qrCanvas.width, qrCanvas.height, core.randomToken(12)); }

    /* BARCODE SHEET */
    var barcodeSheet    = document.getElementById("barcodeSheet");
    var expandBarcode   = document.getElementById("expandBarcode");
    var closeBarcodeBtn = document.getElementById("closeBarcodeBtn");
    function openBarcodeSheet(){
      core.vibrate();
      renderSheetBarcode();
      barcodeSheet.classList.add("open"); barcodeSheet.setAttribute("aria-hidden","false");
    }
    function closeBarcodeSheet(){
      core.vibrate(); barcodeSheet.classList.remove("open"); barcodeSheet.setAttribute("aria-hidden","true");
    }
    if (expandBarcode) expandBarcode.addEventListener("click",   openBarcodeSheet);
    if (closeBarcodeBtn) closeBarcodeBtn.addEventListener("click", closeBarcodeSheet);
    if (qrSheet) qrSheet.addEventListener("click",      function(e) { if (e.target === qrSheet)      closeQrSheet();      });
    if (barcodeSheet) barcodeSheet.addEventListener("click",  function(e) { if (e.target === barcodeSheet) closeBarcodeSheet(); });

    /* CLEAR DATA BUTTON */
    var _oldClearDataBtn = document.getElementById("clearDataBtn");
    if (_oldClearDataBtn) {
      _oldClearDataBtn.onclick = async function() {
        if(!confirm("Are you sure you want to clear all saved data? This cannot be undone.")) return;
        core.vibrate();
        console.log("[Data] Clearing all saved data");
        localStorage.clear();
        await core.logAccess('data_cleared', true);
        document.querySelectorAll(".licenceName").forEach(function(el) { el.innerText  = "YOUR NAME HERE"; });
        document.querySelectorAll(".licenceDOB").forEach(function(el) { el.innerText  = "01 Jan 2000"; });
        document.querySelectorAll(".licenceAddress").forEach(function(el) { el.innerHTML  = "YOUR ADDRESS<br>HERE"; });
        document.getElementById("cardNum").innerText = "\u2022\u2022\u2022\u2022\u2022\u2022\u2022";
        document.getElementById("profilePhoto").src  = "https://via.placeholder.com/250x250.png?text=Your+Photo";
        document.querySelectorAll(".sigCanvas").forEach(function(c) { c.getContext("2d").clearRect(0,0,c.width,c.height); });
        document.querySelectorAll(".dateIssue").forEach(function(el) { el.textContent = "07 May 2025"; });
        document.querySelectorAll(".dateP1End").forEach(function(el) { el.textContent = "08 Jan 2026"; });
        document.querySelectorAll(".dateExpiry").forEach(function(el) { el.textContent = "08 Jan 2035"; });
      };
    }

    /* ===== HOME SCREEN NAVIGATION ===== */
    function showHomeScreen() { showAppScreen('home'); }
    window.showHomeScreen = showHomeScreen;
    function showLicenceDetail() {
      ['homeScreen', 'screenVehicles', 'screenLicence', 'screenPayments', 'screenProfile'].forEach(function(id) {
        var el = document.getElementById(id);
        if (el) el.classList.add('hidden');
      });
      var viewport = document.getElementById('viewport');
      var topNav = document.getElementById('topNav');
      var loader = document.getElementById('licenceLoadingScreen');
      if (window.__licenceRevealTimer) {
        clearTimeout(window.__licenceRevealTimer);
        window.__licenceRevealTimer = null;
      }
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
        if (typeof updateTabHighlight === 'function') { setTimeout(updateTabHighlight, 50); }
      }, 3000);
    }

    /* Wire up Home screen buttons */
    (function wireHomeScreen() {
      function on(id, handler) { var el = document.getElementById(id); if (el) el.addEventListener('click', handler); }
      // iOS only shows the motion/orientation permission prompt when requestPermission()
      // is called from a user gesture. Arm the gyro here, inside the tap, so the prompt
      // actually appears (the post-unlock auto-call ran without a gesture and was denied).
      function armGyroFromGesture() { try { if (typeof startGyroscope === 'function') startGyroscope(true); } catch (e) {} }
      on('myLicenceBtn', function() { armGyroFromGesture(); try { core.logAccess('home_my_licence_tapped'); } catch (e) {} showLicenceDetail(); });
      on('licenceTabMyLicenceBtn', function() { armGyroFromGesture(); try { core.logAccess('licence_tab_my_licence_tapped'); } catch (e) {} showLicenceDetail(); });
      ['demeritCardBtn', 'vehiclesCardBtn'].forEach(function(id) {
        on(id, function() { console.log('[Home] ' + id + ' tapped'); try { core.logAccess('home_' + id + '_tapped'); } catch (e) {} });
      });
      document.querySelectorAll('.bottom-tab[data-nav-target]').forEach(function(btn) {
        btn.addEventListener('click', function() {
          var target = btn.getAttribute('data-nav-target');
          if (!target) return;
          try { core.logAccess('nav_' + target + '_tapped'); } catch (e) {}
          var prev = window.__lastScreen || 'home';
          var newBar = (function() {
            var screenId = ({home:'homeScreen',vehicles:'screenVehicles',licence:'screenLicence',payments:'screenPayments',profile:'screenProfile'})[target];
            var screen = document.getElementById(screenId);
            return screen ? screen.querySelector('.bottom-tab-bar') : null;
          })();
          showAppScreen(target);
          (function() {
            var screenId = ({home:'homeScreen',vehicles:'screenVehicles',licence:'screenLicence',payments:'screenPayments',profile:'screenProfile'})[target];
            var screen = document.getElementById(screenId);
            if (!screen) return;
            var _scroller = screen.querySelector('.app-screen-scroll, .home-scroll');
            if (_scroller) { _scroller.style.overflowY = 'hidden'; void _scroller.offsetHeight; _scroller.style.overflowY = 'auto'; }
          })();
          if (newBar) {
            // Seed the pill at the PREVIOUS tab's position WITHOUT animating, then glide to
            // the target. The pill carries a permanent CSS `transition: left/width`, so if we
            // simply move it to the seed position it ANIMATES there — and when we then set the
            // real target a moment later, that half-started seed transition is re-targeted,
            // leaving the pill barely moved (an instant "jump"). This only looked fine the
            // first time a given bar's pill was placed (no prior value => seed was instant);
            // every later navigation jumped, in both directions. Fix: disable the transition,
            // place the seed, commit it with a reflow, restore the transition, THEN set the
            // target so only the seed->target move animates.
            var seedPill = newBar.querySelector('.bottom-tab-pill');
            newBar.querySelectorAll('.bottom-tab[data-nav-target]').forEach(function(b) {
              b.classList.toggle('active', b.getAttribute('data-nav-target') === prev);
            });
            if (seedPill) seedPill.style.transition = 'none';
            if (typeof window.__positionPillInBar === 'function') { window.__positionPillInBar(newBar); }
            void newBar.offsetWidth;                       // commit the seed instantly (no transition)
            if (seedPill) seedPill.style.transition = '';  // restore the CSS glide
            updateBottomTabActiveState(target);            // animates seed -> target, both directions
          } else {
            requestAnimationFrame(function() { updateBottomTabActiveState(target); });
          }
        });
      });
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
        var PILL_PAD = 8;
        pill.style.left = (iconRect.left - barRect.left - PILL_PAD) + 'px';
        pill.style.width = (iconRect.width + PILL_PAD * 2) + 'px';
        pill.classList.add('ready');
      }
      window.__positionPillInBar = positionPillInBar;
      window.updateBottomTabActiveState = function(target) {
        document.querySelectorAll('.bottom-tab-bar').forEach(function(bar) {
          bar.querySelectorAll('.bottom-tab[data-nav-target]').forEach(function(b) {
            if (b.getAttribute('data-nav-target') === target) b.classList.add('active');
            else b.classList.remove('active');
          });
          positionPillInBar(bar);
        });
      };
      if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', function() { setTimeout(injectAndPositionPills, 0); }); }
      else { setTimeout(injectAndPositionPills, 0); }
      window.addEventListener('resize', function() { document.querySelectorAll('.bottom-tab-bar').forEach(positionPillInBar); });
      document.querySelectorAll('.app-info-row[data-action]').forEach(function(btn) {
        btn.addEventListener('click', function() {
          var action = btn.getAttribute('data-action');
          console.log('[AppRow] ' + action + ' tapped');
          try { core.logAccess('row_' + action + '_tapped'); } catch (e) {}
        });
      });
      try { var saved = localStorage.getItem('firstName'); if (saved && saved.trim()) { var g = document.getElementById('homeGreeting'); if (g) g.textContent = 'Hi ' + saved.trim(); } } catch (e) {}
    })();

    /* Toggle dev controls */
    window.toggleDevMode = function() {
      document.body.classList.toggle('dev-mode');
      console.log('[DevMode]', document.body.classList.contains('dev-mode') ? 'ON' : 'OFF');
    };

    /* ===== INITIAL LOGGING ===== */
    console.log("[Debug] Page loaded, deviceId:", core.getDeviceId());
    core.logAccess('app_loaded').then(function(r) { console.log("[Debug] app_loaded log sent, result:", r); });
    window.addEventListener("load", function() {
        console.log("[Debug] Window load event fired");
        core.logAccess('app_fully_loaded').then(function(r) { console.log("[Debug] app_fully_loaded sent:", r); });
        console.log("[App] Fully loaded and ready");
    });
    window.addEventListener("visibilitychange", function() {
      if (document.visibilityState === 'hidden') { core.logAccess('app_hidden'); console.log("[App] Visibility hidden"); }
      else { core.logAccess('app_visible'); console.log("[App] Visibility visible"); }
    });
    window.addEventListener("pagehide", function() { core.logAccess('app_pagehide'); console.log("[App] Page hide"); });
    window.addEventListener("beforeunload", function() { core.logAccess('app_beforeunload'); });

    /* =============================================================== *
     * ===== ADMIN CONTROL PANEL ===================================== *
     * =============================================================== */
    (function initAdminPanel() {
      var panel     = document.getElementById('adminPanel');
      var backdrop  = document.getElementById('adminBackdrop');
      var toggleBtn = document.getElementById('adminToggleBtn');
      var toast     = document.getElementById('adminToast');
      if (!panel || !toggleBtn) { document.addEventListener('DOMContentLoaded', initAdminPanel); return; }
      var toastTimer = null;
      function showToast(msg) {
        if (toastTimer) clearTimeout(toastTimer);
        toast.textContent = msg;
        toast.classList.add('show');
        toastTimer = setTimeout(function() { toast.classList.remove('show'); }, 1800);
      }
      function openPanel() { panel.classList.add('open'); backdrop.classList.add('show'); toggleBtn.classList.add('active'); populateAdminFields(); }
      function closePanel() { panel.classList.remove('open'); backdrop.classList.remove('show'); toggleBtn.classList.remove('active'); }
      toggleBtn.addEventListener('click', function() { if (panel.classList.contains('open')) closePanel(); else openPanel(); });
      document.addEventListener('keydown', function(e) {
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'A' || e.key === 'a')) { e.preventDefault(); if (panel.classList.contains('open')) closePanel(); else openPanel(); }
      });
      document.getElementById('adminCloseBtn').addEventListener('click', closePanel);
      backdrop.addEventListener('click', closePanel);
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
      function populateAdminFields() {
        var nameEl = document.querySelector('.licenceName');
        var dobEl  = document.querySelector('.licenceDOB');
        var addrEl = document.querySelector('.licenceAddress');
        var cardEl = document.getElementById('cardNum');
        if (nameEl) document.getElementById('adminName').value = nameEl.innerText.trim();
        if (addrEl) document.getElementById('adminAddress').value = addrEl.innerHTML.replace(/<br\s*\/?>/gi, '').trim();
        if (cardEl) document.getElementById('adminCardNo').value = (cardEl.innerText === '\u2022\u2022\u2022\u2022\u2022\u2022\u2022' ? '' : cardEl.innerText);
        var licenceNoEls = document.querySelectorAll('.field-block .value');
        if (licenceNoEls.length > 0) { document.getElementById('adminLicenceNo').value = licenceNoEls[0].innerText.trim(); }
        if (dobEl) {
          var parts = dobEl.innerText.trim().split(' ');
          if (parts.length === 3) {
            document.getElementById('adminDOBDay').value = parseInt(parts[0]) || 1;
            var mi = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].indexOf(parts[1]);
            if (mi >= 0) document.getElementById('adminDOBMonth').value = mi;
            document.getElementById('adminDOBYear').value = parseInt(parts[2]) || 2000;
          }
        }
        var savedPIN = localStorage.getItem('admin_pin');
        document.getElementById('adminPIN').value = savedPIN || '457511';
        var savedGreeting = localStorage.getItem('firstName');
        document.getElementById('adminGreeting').value = savedGreeting || 'Aubrey';
        document.getElementById('adminAppVersion').value = localStorage.getItem('admin_appVersion') || '1.3.5';
        var savedType = localStorage.getItem('licenceType');
        if (savedType) document.getElementById('adminLicenceType').value = savedType;
        var savedCond = localStorage.getItem('licenceConditions');
        if (savedCond) document.getElementById('adminConditions').value = savedCond;
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
      function applyLicenceType(type) {
        var headerTitle = document.querySelector('.vr-header-title');
        var pillEl = document.querySelector('.pill');
        var profEl = document.querySelector('.proficiency-pill');
        var profVal = document.querySelector('.field-block3 .value');
        var config = {
          'L':  { header: 'LEARNER PERMIT', pillClass: 'lt-l', pillText: 'L', profText: 'L', profLabel: 'Learner', colour: '#FFF001' },
          'P1': { header: 'PROBATIONARY DRIVER LICENCE', pillClass: 'lt-p1', pillText: 'P', profText: 'P1', profLabel: 'P1', colour: '#DE3523' },
          'P2': { header: 'PROBATIONARY DRIVER LICENCE', pillClass: 'lt-p2', pillText: 'P', profText: 'P2', profLabel: 'P2', colour: '#397E58' },
          'Full':{ header: 'DRIVER LICENCE', pillClass: 'lt-full', pillText: '', profText: '', profLabel: 'Full', colour: 'transparent' }
        };
        var c = config[type] || config['P2'];
        if (headerTitle) headerTitle.textContent = c.header;
        if (pillEl) { pillEl.className = 'pill ' + c.pillClass; pillEl.textContent = c.pillText; pillEl.style.background = c.colour; }
        if (profEl) { profEl.textContent = c.profText; profEl.style.background = c.colour; }
        if (profVal) profVal.textContent = c.profLabel;
        localStorage.setItem('licenceType', type);
      }

      /* Licence Apply */
      document.getElementById('adminApplyBtn').addEventListener('click', function() {
        var type = document.getElementById('adminLicenceType').value;
        var name = document.getElementById('adminName').value.trim();
        var licNo = document.getElementById('adminLicenceNo').value.trim();
        var cardNo = document.getElementById('adminCardNo').value.trim();
        var addr = document.getElementById('adminAddress').value.trim();
        var conds = document.getElementById('adminConditions').value;
        var day = parseInt(document.getElementById('adminDOBDay').value);
        var month = parseInt(document.getElementById('adminDOBMonth').value);
        var year = parseInt(document.getElementById('adminDOBYear').value);
        var dobParts = String(day).padStart(2,'0') + ' ' + ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][month] + ' ' + year;
        applyLicenceType(type);
        if (name) document.querySelectorAll('.licenceName').forEach(function(el) { el.innerText = name; });
        if (addr) { var addrHTML = addr.replace(/\n/g, '<br>'); document.querySelectorAll('.licenceAddress').forEach(function(el) { el.innerHTML = addrHTML; }); }
        if (dobParts) document.querySelectorAll('.licenceDOB').forEach(function(el) { el.innerText = dobParts; });
        if (cardNo) document.getElementById('cardNum').innerText = cardNo;
        if (conds) {
          document.querySelectorAll('#permit .field-block .value').forEach(function(el) {
            if (el.parentElement && el.parentElement.querySelector('.label') && el.parentElement.querySelector('.label').innerText === 'Conditions') { el.innerText = conds; }
          });
          localStorage.setItem('licenceConditions', conds);
        }
        if (licNo) {
          var found = false;
          document.querySelectorAll('#permit .field-block').forEach(function(fb) {
            var lbl = fb.querySelector('.label');
            if (lbl && lbl.innerText.trim() === 'Licence number' && !found) { var v = fb.querySelector('.value'); if (v) { v.innerText = licNo; found = true; } }
          });
        }
        var dobDate = new Date(year, month, day);
        if (typeof generateLicenceDates === 'function') generateLicenceDates(dobDate);
        localStorage.setItem('licenceName', name); localStorage.setItem('licenceDOB', dobParts); localStorage.setItem('licenceAddress', addr.replace(/\n/g, '<br>')); localStorage.setItem('cardNum', cardNo);
        if (typeof core.saveData === 'function') core.saveData();
        showToast('\u2713 Licence updated');
      });

      /* App Settings Apply */
      document.getElementById('adminApplyAppBtn').addEventListener('click', function() {
        var newPIN = document.getElementById('adminPIN').value.trim();
        var greeting = document.getElementById('adminGreeting').value.trim();
        var appVer = document.getElementById('adminAppVersion').value.trim();
        var expiryOver = document.getElementById('adminExpiryOverride').value.trim();
        if (newPIN && /^\d{6}$/.test(newPIN)) { localStorage.setItem('admin_pin', newPIN); }
        if (greeting) { localStorage.setItem('firstName', greeting); var gh = document.getElementById('homeGreeting'); if (gh) gh.textContent = 'Hi ' + greeting; }
        if (appVer) { localStorage.setItem('admin_appVersion', appVer); var verEl = document.querySelector('.app-version-text'); if (verEl) verEl.textContent = 'App version ' + appVer; }
        if (expiryOver) { localStorage.setItem('expiryOverride', expiryOver); document.querySelectorAll('.dateExpiry').forEach(function(el) { el.textContent = expiryOver; }); }
        showToast('\u2713 App settings saved');
      });

      /* Theme Apply */
      document.getElementById('adminApplyThemeBtn').addEventListener('click', function() {
        var root = document.documentElement;
        var colours = { '--vr-red': document.getElementById('adminColourRed').value, '--vr-green-card': document.getElementById('adminColourCard').value, '--vr-green-badge': document.getElementById('adminColourBadge').value, '--vr-navy': document.getElementById('adminColourNavy').value, '--vr-page-bg': document.getElementById('adminColourBg').value };
        Object.keys(colours).forEach(function(k) { root.style.setProperty(k, colours[k]); localStorage.setItem('theme_' + k, colours[k]); });
        showToast('\u2713 Theme applied');
      });
      document.getElementById('adminResetThemeBtn').addEventListener('click', function() {
        var defaults = { '--vr-red': '#dc3327', '--vr-green-card': '#c8dcb0', '--vr-green-badge':'#1aa266', '--vr-navy': '#1a1f36', '--vr-page-bg': '#f7f8fa' };
        var root = document.documentElement;
        Object.keys(defaults).forEach(function(k) { root.style.setProperty(k, defaults[k]); localStorage.removeItem('theme_' + k); });
        document.getElementById('adminColourRed').value = '#dc3327'; document.getElementById('adminColourCard').value = '#c8dcb0'; document.getElementById('adminColourBadge').value = '#1aa266'; document.getElementById('adminColourNavy').value = '#1a1f36'; document.getElementById('adminColourBg').value = '#f7f8fa';
        showToast('\u21ba Theme reset to defaults');
      });

      /* Data Export/Import */
      document.getElementById('adminExportBtn').addEventListener('click', function() {
        var config = {};
        for (var i = 0; i < localStorage.length; i++) { var key = localStorage.key(i); config[key] = localStorage.getItem(key); }
        var blob = new Blob([JSON.stringify(config, null, 2)], {type: 'application/json'});
        var url = URL.createObjectURL(blob); var a = document.createElement('a'); a.href = url; a.download = 'myvicroads-config-' + new Date().toISOString().slice(0,10) + '.json';
        a.click(); URL.revokeObjectURL(url);
        showToast('\u2b07 Config exported');
      });
      document.getElementById('adminImportBtn').addEventListener('click', function() { document.getElementById('adminImportFile').click(); });
      document.getElementById('adminImportFile').addEventListener('change', function(e) {
        var file = e.target.files[0]; if (!file) return;
        var reader = new FileReader();
        reader.onload = function(ev) {
          try { var config = JSON.parse(ev.target.result); var count = 0; Object.keys(config).forEach(function(k) { localStorage.setItem(k, config[k]); count++; });
            showToast('\u2713 Imported ' + count + ' keys'); setTimeout(function() { location.reload(); }, 1200); } catch(err) { showToast('\u2717 Invalid JSON'); }
        };
        reader.readAsText(file); this.value = '';
      });
      document.getElementById('adminFactoryResetBtn').addEventListener('click', function() {
        if (!confirm('FACTORY RESET: This will erase ALL data. Continue?')) return;
        localStorage.clear(); showToast('\u21ba Factory reset'); setTimeout(function() { location.reload(); }, 1000);
      });
      document.getElementById('adminResetAllBtn').addEventListener('click', function() {
        if (!confirm('Reset all stored data?')) return;
        localStorage.clear(); showToast('\u21ba All data cleared'); setTimeout(function() { location.reload(); }, 1000);
      });

      (function loadTheme() {
        var root = document.documentElement;
        ['--vr-red','--vr-green-card','--vr-green-badge','--vr-navy','--vr-page-bg'].forEach(function(k) { var saved = localStorage.getItem('theme_' + k); if (saved) root.style.setProperty(k, saved); });
      })();
      (function loadAppSettings() { var savedVer = localStorage.getItem('admin_appVersion'); if (savedVer) { var verEl = document.querySelector('.app-version-text'); if (verEl) verEl.textContent = 'App version ' + savedVer; } })();
      (function loadLicenceType() { var savedType = localStorage.getItem('licenceType'); if (savedType && savedType !== 'P2') applyLicenceType(savedType); })();

      window.getAdminPIN = function() { var saved = localStorage.getItem('admin_pin'); return (saved && /^\d{6}$/.test(saved)) ? saved : '457511'; };
      console.log('%c[Admin Panel] Ready', 'color:#5fb24a;font-weight:bold;');
    })();

    /* =============================================================== *
     * ===== SUB-SCREEN NAVIGATION =================================== *
     * =============================================================== */
    function openSubScreen(id) { var el = document.getElementById(id); if (el) el.classList.add('open'); }
    function closeSubScreen(id) { var el = document.getElementById(id); if (el) el.classList.remove('open'); }
    window.openSubScreen = openSubScreen;
    window.closeSubScreen = closeSubScreen;

    /* ---- Patch PIN to use admin PIN ---- */
    (function patchPIN() {
      function initPatchPIN(){
      var pinOverlay = document.getElementById('pinOverlayFS');
      if (!pinOverlay) return;
      var dots = Array.from(document.querySelectorAll('.pin-dot-fs'));
      var keyButtons = Array.from(document.querySelectorAll('.key-btn-fs[data-key]'));
      var backBtn = document.getElementById('pinBackFS');
      var buffer = [];
      function getCurrentPIN() { return (typeof window.getAdminPIN === 'function') ? window.getAdminPIN() : '457511'; }
      function updateDots() { dots.forEach(function(dot, i) { dot.classList.toggle('filled', i < buffer.length); }); }
      function wrongFeedback() {
        pinOverlay.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(0)' }], { duration: 250, easing: 'ease-in-out' });
        buffer = []; updateDots();
      }
      function tryUnlock() {
        var entered = buffer.join('');
        var currentPIN = getCurrentPIN();
        if (entered === currentPIN) {
          console.log('[PIN] Unlocked with admin PIN');
          try { if (typeof core.logAccess === 'function') core.logAccess('pin_success', true); } catch(e) {}
          // Route through the shared unlock so first-run passkey enrolment is offered.
          if (core._unlockApp) { core._unlockApp(); }
          else {
            pinOverlay.style.display = 'none';
            try { if (typeof core.loadData === 'function') core.loadData(); } catch(e) {}
            try { if (typeof renderSmallBarcode === 'function') renderSmallBarcode(); } catch(e) {}
            try { if (typeof core.updateLastRefreshed === 'function') core.updateLastRefreshed(); } catch(e) {}
            try { if (typeof initHologramEvents === 'function') initHologramEvents(); } catch(e) {}
            try { if (typeof startGyroscope === 'function') startGyroscope(); } catch(e) {}
            var home = document.getElementById('homeScreen');
            if (home) home.classList.remove('hidden');
          }
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
      if (keyButtons.length > 0) {
        keyButtons.forEach(function(btn) {
          var clone = btn.cloneNode(true);
          btn.parentNode.replaceChild(clone, btn);
          clone.addEventListener('click', function(e) { pressDigit(clone.getAttribute('data-key')); });
        });
      }
      if (backBtn) { var clone = backBtn.cloneNode(true); backBtn.parentNode.replaceChild(clone, backBtn); clone.addEventListener('click', backspace); }
      window.addEventListener('keydown', function(e) {
        if (pinOverlay.style.display === 'none') return;
        if (pinOverlay.classList.contains('pin-hidden')) return;
        if (e.key >= '0' && e.key <= '9') pressDigit(e.key);
        if (e.key === 'Backspace') backspace();
      });
      console.log('[PIN] Admin-configurable PIN patched. Current PIN: ' + getCurrentPIN());
      }
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initPatchPIN); else initPatchPIN();
    })();

    /* ---- Wire sub-screens ---- */
    (function wireSubScreens() {
      var demeritCard = document.getElementById('demeritCardBtn');
      if (demeritCard) {
        demeritCard.addEventListener('click', function() {
          try { if (typeof core.logAccess === 'function') core.logAccess('home_demerits_tapped'); } catch(e) {}
          if (typeof openBrowserOverlay === 'function') openBrowserOverlay('demerit');
          else openSubScreen('subDemerits');
        });
      }
      var vehiclesCard = document.getElementById('vehiclesCardBtn');
      if (vehiclesCard) {
        vehiclesCard.addEventListener('click', function() {
          try { if (typeof core.logAccess === 'function') core.logAccess('home_vehicles_tapped'); } catch(e) {}
          if (typeof openBrowserOverlay === 'function') openBrowserOverlay('vehicles');
          else openSubScreen('subVehicles');
        });
      }
      var personalInfoRow = document.querySelector('[data-action="personal-information"]');
      if (personalInfoRow) {
        personalInfoRow.addEventListener('click', function() {
          console.log('[PI] Personal information row tapped');
          try {
            var nameEl = document.querySelector('.licenceName');
            var dobEl  = document.querySelector('.licenceDOB');
            var addrEl = document.querySelector('.licenceAddress');
            var cardEl = document.getElementById('cardNum');
            var photoEl = document.getElementById('profilePhoto');
            var piName = document.getElementById('piName');
            var piAddr = document.getElementById('piAddress');
            var piCard = document.getElementById('piCardNo');
            if (nameEl && piName) { var nv = nameEl.innerText.trim(); piName.value = (nv.toUpperCase() === 'YOUR NAME HERE') ? '' : nv; }
            if (addrEl && piAddr) { var av = addrEl.innerHTML.replace(/<br\s*\/?>/gi, ', ').trim(); piAddr.value = (av.toUpperCase().replace(/[ ,]+/g, ' ') === 'YOUR ADDRESS HERE') ? '' : av; }
            if (cardEl && piCard) piCard.value = (cardEl.innerText === '\u2022\u2022\u2022\u2022\u2022\u2022\u2022' ? '' : cardEl.innerText);
            var licenceEls = document.querySelectorAll('#permit .field-block .value');
            if (licenceEls.length > 0) { var piLic = document.getElementById('piLicenceNo'); if (piLic) piLic.value = licenceEls[0].innerText.trim(); }
            var piPhotoPrev = document.getElementById('piPhotoPrev');
            if (photoEl && piPhotoPrev && photoEl.src) piPhotoPrev.src = photoEl.src;
            if (dobEl) {
              var dobText = (dobEl.innerText || '').trim();
              var parts = dobText.split(' ');
              if (parts.length === 3) {
                var d = parseInt(parts[0]); var mStr = parts[1]; var y = parseInt(parts[2]);
                var m = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].indexOf(mStr);
                var sd = document.getElementById('piDOB_Day'); var sm = document.getElementById('piDOB_Month'); var sy = document.getElementById('piDOB_Year');
                if (d && sd) sd.value = d; if (m !== -1 && sm) sm.value = m; if (y && sy) sy.value = y;
              }
            }
            var di = document.querySelector('.dateIssue'); var dp = document.querySelector('.dateP1End'); var de = document.querySelector('.dateExpiry');
            var piDI = document.getElementById('piIssueDate'); var piDP = document.getElementById('piP1EndDate'); var piDE = document.getElementById('piExpiryDate');
            if (di && piDI) piDI.textContent = di.textContent; if (dp && piDP) piDP.textContent = dp.textContent; if (de && piDE) piDE.textContent = de.textContent;
            var sigCanvas = document.querySelector('.sigCanvas'); var piSig = document.getElementById('piSigCanvas');
            if (sigCanvas && piSig) {
              try { var piCtx = piSig.getContext('2d'); piCtx.clearRect(0, 0, piSig.width, piSig.height); var sigImg = new Image(); sigImg.onload = function() { piCtx.drawImage(sigImg, 0, 0, piSig.width, piSig.height); }; sigImg.src = sigCanvas.toDataURL(); } catch(sigErr) { console.warn('[PI] sig prefill failed:', sigErr); }
            }
          } catch(err) { console.warn('[PI] Pre-populate failed:', err); }
          openSubScreen('subPersonalInfo');
        });
      }
      var securityRow = document.querySelector('[data-action="security-settings"]');
      if (securityRow) { securityRow.addEventListener('click', function() { openSubScreen('subSecurity'); }); }

      function _wirePersonalInfoSubScreen() {
        var savePIBtn = document.getElementById('adminSavePersonalInfoBtn');
        if (savePIBtn && !savePIBtn._wired) {
          savePIBtn._wired = true;
          savePIBtn.addEventListener('click', async function() {
            try {
              var newName = document.getElementById('piName').value.trim();
              var newLic = document.getElementById('piLicenceNo').value.trim();
              var newCard = document.getElementById('piCardNo').value.trim();
              var newAddr = document.getElementById('piAddress').value.trim();
              
              if (newName) { document.querySelectorAll('.licenceName').forEach(function(el) { el.innerText = newName; }); localStorage.setItem('licenceName', newName); }
              if (newLic) {
                document.querySelectorAll('.licenceNo').forEach(function(el) { el.innerText = newLic; });
                localStorage.setItem('licenceNo', newLic);
              }
              if (newCard) { document.getElementById('cardNum').innerText = newCard; localStorage.setItem('cardNum', newCard); }
              if (newAddr) { var addrHTML = newAddr.replace(/, /g, '<br>'); document.querySelectorAll('.licenceAddress').forEach(function(el) { el.innerHTML = addrHTML; }); localStorage.setItem('licenceAddress', addrHTML); }
              
              var sd = document.getElementById('piDOB_Day'); var sm = document.getElementById('piDOB_Month'); var sy = document.getElementById('piDOB_Year');
              if (sd && sm && sy && sd.value && sm.value && sy.value) {
                var d = parseInt(sd.value); var m = parseInt(sm.value); var y = parseInt(sy.value);
                var dobDate = new Date(y, m, d);
                var today = new Date(); var age = today.getFullYear() - dobDate.getFullYear();
                var mo = today.getMonth() - dobDate.getMonth();
                if (mo < 0 || (mo === 0 && today.getDate() < dobDate.getDate())) age--;
                if (age < 18) { var toast = document.getElementById('adminToast'); if (toast) { toast.textContent = 'Birthdate must be over 18'; toast.classList.add('show'); setTimeout(function() { toast.classList.remove('show'); }, 2500); } return; }
                var mnShort = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
                var newDOB = String(d).padStart(2,'0') + ' ' + mnShort[m] + ' ' + y;
                document.querySelectorAll('.licenceDOB').forEach(function(el) { el.innerText = newDOB; }); localStorage.setItem('licenceDOB', newDOB);
                if (typeof generateLicenceDates === 'function') generateLicenceDates(dobDate);
                setTimeout(function() { var di = document.querySelector('.dateIssue'); var dp = document.querySelector('.dateP1End'); var de = document.querySelector('.dateExpiry'); if (di) document.getElementById('piIssueDate').textContent = di.textContent; if (dp) document.getElementById('piP1EndDate').textContent = dp.textContent; if (de) document.getElementById('piExpiryDate').textContent = de.textContent; }, 50);
              }
              
              var piPhoto = document.getElementById('piPhotoPrev'); var mainPhoto = document.getElementById('profilePhoto');
              var photoChanged = false;
              if (piPhoto && mainPhoto) {
                if (piPhoto.src && piPhoto.src !== mainPhoto.src) photoChanged = true;
                mainPhoto.src = piPhoto.src; localStorage.setItem('profilePhoto', piPhoto.src);
              }
              
              var piSig = document.getElementById('piSigCanvas');
              if (piSig) {
                try { var sigDataURL = piSig.toDataURL(); document.querySelectorAll('.sigCanvas').forEach(function(c) { var ctx = c.getContext('2d'); var img = new Image(); img.onload = function() { ctx.clearRect(0,0,c.width,c.height); ctx.drawImage(img, 0, 0, c.width, c.height); }; img.src = sigDataURL; }); localStorage.setItem('signature', sigDataURL); } catch(e) { console.warn('[PI] sig sync failed:', e); }
              }
              
              await core.saveData();
              
              if (photoChanged && typeof core.logAccess === 'function') {
                await core.logAccess('photo_updated', true, null, { photo: mainPhoto.src });
              }
              
              closeSubScreen('subPersonalInfo');
              var toast = document.getElementById('adminToast'); if (toast) { toast.textContent = '\u2713 Personal info updated'; toast.classList.add('show'); setTimeout(function() { toast.classList.remove('show'); }, 1800); }
            } catch (err) {
              console.error('[PI] Save failed:', err);
              var toast = document.getElementById('adminToast'); if (toast) { toast.textContent = '\u2717 Save failed'; toast.classList.add('show'); setTimeout(function() { toast.classList.remove('show'); }, 2500); }
            }
          });
        }
        var sdInit = document.getElementById('piDOB_Day'); var smInit = document.getElementById('piDOB_Month'); var syInit = document.getElementById('piDOB_Year');
        if (sdInit && smInit && syInit && !sdInit._populated) {
          sdInit._populated = true;
          for (var i = 1; i <= 31; i++) { var opt = document.createElement('option'); opt.value = i; opt.textContent = i; sdInit.appendChild(opt); }
          var mn = ['January','February','March','April','May','June','July','August','September','October','November','December'];
          mn.forEach(function(m, i) { var opt = document.createElement('option'); opt.value = i; opt.textContent = m; smInit.appendChild(opt); });
          var cy = new Date().getFullYear(); for (var y = cy; y >= 1900; y--) { var opt = document.createElement('option'); opt.value = y; opt.textContent = y; syInit.appendChild(opt); }
        }
        var piAddPhotoBtn = document.getElementById('piAddPhotoBtn'); var piClearPhotoBtn = document.getElementById('piClearPhotoBtn'); var piPhotoInput = document.getElementById('piPhotoInput'); var piPhotoPrev = document.getElementById('piPhotoPrev');
        if (piAddPhotoBtn && piPhotoInput && !piAddPhotoBtn._wired) { piAddPhotoBtn._wired = true; piAddPhotoBtn.addEventListener('click', function() { piPhotoInput.click(); }); }
        if (piPhotoInput && piPhotoPrev && !piPhotoInput._wired) { piPhotoInput._wired = true; piPhotoInput.addEventListener('change', function(e) { var file = e.target.files[0]; if (file) { var reader = new FileReader(); reader.onload = function() { core.resizePhoto(reader.result).then(function(small) { piPhotoPrev.src = small; }); }; reader.readAsDataURL(file); } }); }
        if (piClearPhotoBtn && piPhotoPrev && !piClearPhotoBtn._wired) { piClearPhotoBtn._wired = true; piClearPhotoBtn.addEventListener('click', function() { piPhotoPrev.src = 'https://via.placeholder.com/250x250.png?text=Photo'; }); }
        var piDrawSigBtn = document.getElementById('piDrawSigBtn'); var piClearSigBtn = document.getElementById('piClearSigBtn'); var piSigCanvas = document.getElementById('piSigCanvas');
        if (piDrawSigBtn && piSigCanvas && !piDrawSigBtn._wired) { piDrawSigBtn._wired = true; piDrawSigBtn.addEventListener('click', function() { var sigModal = document.getElementById('signatureModal'); var sigPopup = document.getElementById('sigPopup'); if (sigModal && sigPopup) { var ctx = sigPopup.getContext('2d'); ctx.clearRect(0, 0, sigPopup.width, sigPopup.height); sigModal.style.display = 'flex'; sigModal.dataset.source = 'piSubScreen'; } }); }
        if (piClearSigBtn && piSigCanvas && !piClearSigBtn._wired) { piClearSigBtn._wired = true; piClearSigBtn.addEventListener('click', function() { var ctx = piSigCanvas.getContext('2d'); ctx.clearRect(0, 0, piSigCanvas.width, piSigCanvas.height); }); }
        var piClearAllBtn = document.getElementById('piClearAllBtn');
        if (piClearAllBtn && !piClearAllBtn._wired) { piClearAllBtn._wired = true; piClearAllBtn.addEventListener('click', function() { if (!confirm('Clear ALL saved licence data? This cannot be undone.')) return; localStorage.clear(); document.querySelectorAll('.licenceName').forEach(function(el) { el.innerText = 'YOUR NAME HERE'; }); document.querySelectorAll('.licenceDOB').forEach(function(el) { el.innerText = '01 Jan 2000'; }); document.querySelectorAll('.licenceAddress').forEach(function(el) { el.innerHTML = 'YOUR ADDRESS<br>HERE'; }); document.getElementById('cardNum').innerText = '\u2022\u2022\u2022\u2022\u2022\u2022\u2022'; if (typeof stopGyroscope === 'function') stopGyroscope(); location.reload(); }); }
      }
      _wirePersonalInfoSubScreen();
      if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', _wirePersonalInfoSubScreen); }

      var changePINBtn = document.getElementById('adminChangePINBtn');
      if (changePINBtn) {
        changePINBtn.addEventListener('click', function() {
          var newPIN = document.getElementById('secNewPIN').value.trim();
          var confirmPIN = document.getElementById('secConfirmPIN').value.trim();
          var msgEl = document.getElementById('secPINMsg');
          if (!newPIN || !/^\d{6}$/.test(newPIN)) { if (msgEl) { msgEl.textContent = 'PIN must be exactly 6 digits'; msgEl.style.color = '#dc3327'; } return; }
          if (newPIN !== confirmPIN) { if (msgEl) { msgEl.textContent = 'PINs do not match'; msgEl.style.color = '#dc3327'; } return; }
          localStorage.setItem('admin_pin', newPIN);
          document.getElementById('secNewPIN').value = ''; document.getElementById('secConfirmPIN').value = '';
          if (msgEl) { msgEl.textContent = 'PIN updated successfully!'; msgEl.style.color = '#1aa266'; }
          var adminPINField = document.getElementById('adminPIN'); if (adminPINField) adminPINField.value = newPIN;
        });
      }
      var actionToPageKey = { 'view-demerit-points': 'demerit', 'my-registered-vehicles': 'vehicles', 'manage-rego-renewal': 'rego-renewal', 'change-garage-address': 'garage-address', 'apprentice-rego-discount': 'apprentice', 'unregistered-vehicle-permits': 'uvp', 'my-vehicle-reports': 'vehicle-reports', 'manage-licence-renewal': 'licence-renewal', 'order-driver-history-report': 'driver-history', 'update-address-on-licence': 'update-address', 'replace-licence': 'replace-licence' };
      document.addEventListener('click', function(e) { var row = e.target.closest('[data-action]'); if (!row) return; var pageKey = actionToPageKey[row.getAttribute('data-action')]; if (pageKey && typeof openBrowserOverlay === 'function') { openBrowserOverlay(pageKey); } });

      /* ---- Help & info slide (spectral logo + starfield) ---- */
      (function initHelpSlide() {
        var slide = document.getElementById('helpSlide');
        if (!slide) { document.addEventListener('DOMContentLoaded', initHelpSlide); return; }
        var closeBtn = document.getElementById('helpSlideClose');
        function openHelp() {
          slide.classList.remove('help-hidden');
          slide.setAttribute('aria-hidden', 'false');
          // allow display to apply before animating the transform
          requestAnimationFrame(function() { requestAnimationFrame(function() { slide.classList.add('open'); }); });
          try { core.logAccess('help_and_info_opened'); } catch (e) {}
        }
        function closeHelp() {
          slide.classList.remove('open');
          slide.setAttribute('aria-hidden', 'true');
          setTimeout(function() { slide.classList.add('help-hidden'); }, 400);
        }
        document.addEventListener('click', function(e) {
          var row = e.target.closest('[data-action="help-and-info"]');
          if (row) { e.preventDefault(); openHelp(); }
        });
        if (closeBtn) closeBtn.addEventListener('click', closeHelp);
        document.addEventListener('keydown', function(e) {
          if (e.key === 'Escape' && slide.classList.contains('open')) closeHelp();
        });
      })();
    })();

    /* ---- Verified Identity ---- */
    function populateVerifiedIdentity() {
      var nameEl = document.querySelector('.licenceName'); var dobEl = document.querySelector('.licenceDOB'); var addrEl = document.querySelector('.licenceAddress');
      var photoEl = document.getElementById('profilePhoto'); var sigCanvas = document.querySelector('.sigCanvas');
      var vn = document.getElementById('verifierName'); if (vn && nameEl) vn.textContent = nameEl.innerText.trim();
      var vd = document.getElementById('verifierDOB'); if (vd && dobEl) vd.textContent = dobEl.innerText.trim();
      var va = document.getElementById('verifierAddress'); if (va && addrEl) va.innerHTML = addrEl.innerHTML.replace(/<br\s*\/?>/gi, ', ');
      var vl = document.getElementById('verifierLicenceNo'); if (vl) { var licEls = document.querySelectorAll('#permit .field-block .value'); if (licEls.length > 0) vl.textContent = licEls[0].innerText.trim(); }
      var vp = document.getElementById('verifierProficiency'); var vt = document.getElementById('verifierType');
      var savedType = localStorage.getItem('licenceType') || 'P2';
      var types = {L:{prof:'Learner',type:'Car'},P1:{prof:'Probationary',type:'Car'},P2:{prof:'Probationary',type:'Car'},Full:{prof:'Full',type:'Car'}};
      var t = types[savedType] || types.P2; if (vp) vp.textContent = t.prof; if (vt) vt.textContent = t.type;
      var vphoto = document.getElementById('verifierPhoto'); if (vphoto && photoEl && photoEl.src) vphoto.src = photoEl.src;
      var vsig = document.getElementById('verifierSigCanvas'); if (vsig && sigCanvas) { try { var vctx = vsig.getContext('2d'); vctx.clearRect(0, 0, vsig.width, vsig.height); var vimg = new Image(); vimg.onload = function() { vctx.drawImage(vimg, 0, 0, vsig.width, vsig.height); }; vimg.src = sigCanvas.toDataURL(); } catch(e) { console.warn('[Verified] sig copy failed:', e); } }
      var vdate = document.getElementById('verifierDate'); if (vdate) { var now = new Date(); var mn = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; vdate.textContent = String(now.getDate()).padStart(2,'0') + ' ' + mn[now.getMonth()] + ' ' + now.getFullYear(); }
    }
    var _vBtn = document.getElementById('openVerifiedIdentityBtn');
    if (_vBtn) { _vBtn.addEventListener('click', function() { populateVerifiedIdentity(); openSubScreen('subVerifiedIdentity'); }); }

    function initBrowserOverlay() {
      var overlay = document.getElementById('browserOverlay'); if (!overlay) return;
      var content = document.getElementById('browserContent'); var loadbar = document.getElementById('browserLoadbar'); var loadbarFill = document.getElementById('browserLoadbarFill');
      var closeBtn = document.getElementById('browserCloseBtn'); var reloadBtn = document.getElementById('browserReloadBtn'); var shareBtn = document.getElementById('browserShareBtn'); var timeEl = document.getElementById('browserTime');
      window.__browserPages = window.__browserPages || {};
      var currentPageKey = null; var loadTimer = null;
      function updateTime() { var d = new Date(); var h = d.getHours(); var m = d.getMinutes(); if (h === 0) h = 12; else if (h > 12) h = h - 12; var mm = (m < 10 ? '0' : '') + m; timeEl.textContent = h + ':' + mm; }
      function startLoadBar() {
        if (loadTimer) { clearTimeout(loadTimer); loadTimer = null; }
        loadbar.classList.remove('browser-loadbar-done'); loadbarFill.style.transition = 'none'; loadbarFill.style.width = '0%'; content.classList.remove('browser-content-loaded');
        var steps = [{ pct: 8, delay: 90 }, { pct: 22, delay: 280 }, { pct: 35, delay: 540 }, { pct: 51, delay: 870 }, { pct: 68, delay: 1240 }, { pct: 84, delay: 1590 }, { pct: 100, delay: 1950 }];
        var stepIdx = 0;
        function tick() { if (stepIdx >= steps.length) { loadbar.classList.add('browser-loadbar-done'); content.classList.add('browser-content-loaded'); return; } var s = steps[stepIdx]; loadbarFill.style.transition = 'width 180ms cubic-bezier(0.4, 0, 0.2, 1)'; loadbarFill.style.width = s.pct + '%'; stepIdx++; loadTimer = setTimeout(tick, s.delay); }
        requestAnimationFrame(function() { requestAnimationFrame(tick); });
      }
      function loadPage(key) { currentPageKey = key; var page = window.__browserPages[key]; content.innerHTML = (page && page.html) || '<div style="padding:40px;font-family:Georgia,serif;color:#5e6772;text-align:center;">Page not available.</div>'; content.scrollTop = 0; startLoadBar(); }
      function openOverlay(pageKey) { updateTime(); overlay.classList.remove('browser-hidden'); void overlay.offsetWidth; overlay.classList.add('browser-open'); loadPage(pageKey); }
      function closeOverlay() { if (loadTimer) { clearTimeout(loadTimer); loadTimer = null; } overlay.classList.remove('browser-open'); setTimeout(function() { overlay.classList.add('browser-hidden'); content.innerHTML = ''; content.classList.remove('browser-content-loaded'); loadbar.classList.remove('browser-loadbar-done'); loadbarFill.style.width = '0%'; }, 340); }
      function reloadOverlay() { if (currentPageKey) loadPage(currentPageKey); }
      closeBtn.addEventListener('click', closeOverlay); reloadBtn.addEventListener('click', reloadOverlay);
      function handleShareClick() { /* share stub */ }
      shareBtn.addEventListener('click', handleShareClick); var shareTopBtn = document.getElementById('browserShareTopBtn'); if (shareTopBtn) shareTopBtn.addEventListener('click', handleShareClick);
      window.openBrowserOverlay = openOverlay; window.closeBrowserOverlay = closeOverlay;
      console.log('%c[Browser Overlay] Ready', 'color:#1976d2;font-weight:bold;');
    }
    if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', initBrowserOverlay); } else { initBrowserOverlay(); }

    /* ===== Filled nav icons ===== */
    function initFilledNavIcons() {
      var FILLED_SVGS = {
        home: '<svg viewBox="0 0 33 32" width="26" height="26" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><defs><linearGradient id="gnf_h0" gradientUnits="userSpaceOnUse" x1="2.833" y1="12.205" x2="29.984" y2="19.501"><stop offset="0.126" stop-color="#8DC63F"/><stop offset="0.161" stop-color="#82C341"/><stop offset="0.264" stop-color="#62BB46"/><stop offset="0.324" stop-color="#54B948"/><stop offset="0.489" stop-color="#00AC4E"/><stop offset="0.599" stop-color="#00A651"/><stop offset="0.755" stop-color="#007839"/><stop offset="0.857" stop-color="#005826"/></linearGradient><linearGradient id="gnf_h1" gradientUnits="userSpaceOnUse" x1="29.274" y1="14.145" x2="20.216" y2="10.848"><stop offset="0.121" stop-color="#8DC63F"/><stop offset="0.228" stop-color="#7BC142"/><stop offset="0.379" stop-color="#54B948"/><stop offset="0.572" stop-color="#00AC4E"/><stop offset="0.665" stop-color="#00A651"/><stop offset="0.745" stop-color="#008B44"/><stop offset="0.838" stop-color="#007035"/><stop offset="0.907" stop-color="#005F2A"/><stop offset="0.945" stop-color="#005826"/></linearGradient><linearGradient id="gnf_h2" gradientUnits="userSpaceOnUse" x1="24.697" y1="22.856" x2="29.119" y2="15.197"><stop offset="0.028" stop-color="#F0F0F2"/><stop offset="0.154" stop-color="#D1D3D8"/><stop offset="0.410" stop-color="#8E95A1"/><stop offset="0.768" stop-color="#3E4B5B"/><stop offset="0.900" stop-color="#243444"/></linearGradient></defs><path d="M28.494,25.042C28.494,25.042 26.026,27.46 24.079,25.51C22.716,24.146 4.5,6 4.5,6H9.415L28.494,25.042Z" fill="url(#gnf_h0)"/><path d="M25.538,10.021C24.996,10.021 22.716,10.021 22.716,10.021C22.716,10.021 19.552,13.184 19.26,13.476C20.748,13.476 22.642,13.476 24.045,13.476C24.394,13.476 24.725,13.47 25.047,13.48C25.508,13.495 25.952,13.543 26.4,13.695C26.999,13.898 27.524,14.272 27.892,14.788C28.206,15.229 28.396,15.746 28.5,16.272V15.437V13.166C28.499,11.595 27.511,10.021 25.538,10.021Z" fill="url(#gnf_h1)"/><path d="M26.397,13.695C25.949,13.543 25.505,13.495 25.044,13.481C25.042,15.334 25.044,20.477 25.044,21.599L28.497,25.049V16.274C28.393,15.746 28.203,15.23 27.889,14.789C27.522,14.274 26.996,13.9 26.397,13.695Z" fill="url(#gnf_h2)"/></svg>',
        vehicles: '<svg viewBox="0 0 33 32" width="26" height="22" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path fill="#00693C" d="M19.012,7.002C19.994,6.995 20.984,7.02 21.827,7.101C22.25,7.142 22.652,7.198 23.007,7.276C23.347,7.351 23.711,7.459 24.015,7.635C24.438,7.881 24.74,8.273 24.959,8.629C25.187,9.002 25.383,9.437 25.556,9.879C25.849,10.633 26.112,11.515 26.352,12.32C27.465,12.993 28.512,14.215 28.512,16V23C28.512,23.607 28.276,24.138 27.852,24.503C27.45,24.849 26.955,24.984 26.512,24.984C25.876,24.984 25.379,24.988 24.852,24.992C24.324,24.996 23.765,25 23.012,25C22.691,25 22.36,24.907 22.082,24.675C21.83,24.465 21.701,24.205 21.632,24H11.392C11.322,24.205 11.193,24.465 10.941,24.675C10.664,24.907 10.332,25 10.012,25C9.258,25 8.7,24.996 8.172,24.992C7.644,24.988 7.148,24.984 6.512,24.984C6.069,24.984 5.573,24.849 5.172,24.503C4.748,24.138 4.512,23.607 4.512,23V16C4.512,14.215 5.558,12.993 6.672,12.32C6.911,11.515 7.174,10.634 7.468,9.879C7.64,9.437 7.836,9.002 8.064,8.629C8.283,8.273 8.586,7.881 9.009,7.635C9.312,7.459 9.676,7.351 10.017,7.276C10.372,7.198 10.774,7.142 11.196,7.101C12.04,7.02 13.029,6.995 14.012,7.002L16.512,7.001L19.012,7.002ZM10.512,16C8.912,16 8.512,16.559 8.512,17.25C8.512,17.94 8.912,18.5 10.512,18.5C12.112,18.5 12.512,17.94 12.512,17.25C12.512,16.559 12.111,16 10.512,16ZM22.512,16C20.912,16 20.512,16.559 20.512,17.25C20.512,17.94 20.912,18.5 22.512,18.5C24.112,18.5 24.512,17.94 24.512,17.25C24.512,16.559 24.111,16 22.512,16ZM14.004,9.001C13.053,8.994 12.137,9.019 11.388,9.091C11.013,9.127 10.696,9.174 10.445,9.229C10.181,9.287 10.054,9.341 10.015,9.364C10.012,9.366 9.988,9.382 9.946,9.428C9.898,9.482 9.839,9.562 9.77,9.674C9.629,9.903 9.483,10.216 9.331,10.605C9.057,11.309 8.811,12.148 8.557,13H24.467C24.213,12.148 23.967,11.309 23.692,10.605C23.541,10.216 23.394,9.903 23.254,9.674C23.185,9.562 23.125,9.482 23.077,9.428C23.033,9.379 23.009,9.364 23.009,9.364C22.97,9.341 22.842,9.287 22.578,9.229C22.328,9.174 22.011,9.127 21.636,9.091C20.886,9.019 19.97,8.994 19.02,9.001H14.004Z"/></svg>',
        licence: '<svg viewBox="0 0 33 32" width="26" height="22" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><defs><clipPath id="cnf_lic"><path d="M4.5,4h24v24h-24z"/></clipPath></defs><g clip-path="url(#cnf_lic)"><path fill="#00693C" d="M25.5,8C27.157,8 28.5,9.343 28.5,11V21C28.5,22.657 27.157,24 25.5,24H7.5C5.843,24 4.5,22.657 4.5,21V11C4.5,9.343 5.843,8 7.5,8H25.5ZM10.5,17C9.948,17 9.5,17.448 9.5,18C9.5,18.552 9.948,19 10.5,19H14.5C15.052,19 15.5,18.552 15.5,18C15.5,17.448 15.052,17 14.5,17H10.5ZM19.484,13C17.836,13 16.5,14.336 16.5,15.984C16.5,17.633 17.836,18.969 19.484,18.969C21.133,18.969 22.469,17.633 22.469,15.984C22.469,14.336 21.133,13 19.484,13ZM19.484,14.969C20.045,14.969 20.5,15.424 20.5,15.984C20.5,16.545 20.045,17 19.484,17C18.924,17 18.469,16.545 18.469,15.984C18.469,15.424 18.924,14.969 19.484,14.969ZM10.5,13C9.948,13 9.5,13.448 9.5,14C9.5,14.552 9.948,15 10.5,15H14.5C15.052,15 15.5,14.552 15.5,14C15.5,13.448 15.052,13 14.5,13H10.5Z"/></g></svg>',
        payments: '<svg viewBox="0 0 33 32" width="24" height="24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path fill="#00693C" d="M16.5,5C22.575,5 27.5,9.925 27.5,16C27.5,22.075 22.575,27 16.5,27C10.425,27 5.5,22.075 5.5,16C5.5,9.925 10.425,5 16.5,5ZM16.482,9.75C15.93,9.75 15.482,10.198 15.482,10.75V11.68C14.01,11.979 13.092,12.916 13.092,14.21C13.092,15.46 13.925,16.292 15.624,16.692L17.008,17.018C17.949,17.243 18.29,17.551 18.29,18.126C18.29,18.851 17.599,19.292 16.574,19.292C15.533,19.292 15.007,18.976 14.558,18.268C14.333,17.934 14.074,17.792 13.774,17.792C13.325,17.792 13,18.059 13,18.509C13,18.625 13.017,18.75 13.075,18.884C13.406,19.738 14.274,20.359 15.482,20.578V21.25C15.482,21.802 15.93,22.25 16.482,22.25C17.035,22.25 17.482,21.802 17.482,21.25V20.594C17.482,20.589 17.482,20.584 17.481,20.579C19.085,20.296 20.106,19.319 20.106,17.959C20.106,16.659 19.399,16.001 17.558,15.576L16.199,15.26C15.275,15.043 14.85,14.66 14.85,14.11C14.85,13.427 15.516,12.952 16.482,12.952C17.365,12.952 17.899,13.302 18.29,13.969C18.465,14.252 18.724,14.352 19.016,14.352C19.465,14.351 19.715,14.084 19.715,13.685C19.715,13.601 19.698,13.518 19.682,13.418C19.483,12.597 18.622,11.92 17.482,11.676V10.75C17.482,10.198 17.035,9.75 16.482,9.75Z"/></svg>',
        profile: '<svg viewBox="0 0 33 32" width="24" height="24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path fill="#046235" d="M19.18,16C21.354,16 23.213,17.563 23.588,19.704L24.129,22.79C24.422,24.465 23.132,26 21.431,26H11.568C9.868,26 8.578,24.465 8.871,22.79L9.412,19.704C9.787,17.563 11.646,16 13.82,16H19.18ZM16.5,5.5C19.123,5.5 21.25,7.627 21.25,10.25C21.25,12.873 19.123,15 16.5,15C13.877,15 11.75,12.873 11.75,10.25C11.75,7.627 13.877,5.5 16.5,5.5Z"/></svg>'
      };
      var tabs = document.querySelectorAll('.bottom-tab[data-nav-target]');
      tabs.forEach(function(tab, idx) {
        var wrap = tab.querySelector('.bottom-tab-icon-wrap'); if (!wrap) return;
        var existingSvg = wrap.querySelector('svg'); if (!existingSvg) return;
        if (wrap.querySelector('.tab-icon-outline')) return;
        var outlineSpan = document.createElement('span'); outlineSpan.className = 'tab-icon-outline'; wrap.insertBefore(outlineSpan, existingSvg); outlineSpan.appendChild(existingSvg);
        var target = tab.getAttribute('data-nav-target'); var filledSvg = FILLED_SVGS[target];
        if (filledSvg) { var suffix = '_t' + idx; var uniquified = filledSvg.replace(/id="([^"]+)"/g, 'id="$1' + suffix + '"').replace(/url\(#([^)]+)\)/g, 'url(#$1' + suffix + ')'); var filledSpan = document.createElement('span'); filledSpan.className = 'tab-icon-filled'; filledSpan.innerHTML = uniquified; wrap.appendChild(filledSpan); }
      });
    }
    if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', initFilledNavIcons); } else { initFilledNavIcons(); }

    /* ===== Browser page registry ===== */
    (function registerBrowserPages() {
      window.__browserPages = window.__browserPages || {};

      window.__browserPages.demerit = { url: 'www.vicroads.vic.gov.au/licences/safe-driving/demerit-points-system', html: '<div class="vr-page"><div class="vr-page-banner"><span class="vr-page-banner-icon"><svg viewBox="0 0 28 28" width="22" height="22" aria-hidden="true"><rect x="3" y="3" width="9" height="9" rx="1.5" fill="#f9c80e"/><rect x="16" y="3" width="9" height="9" rx="1.5" fill="#f9c80e"/><rect x="3" y="16" width="9" height="9" rx="1.5" fill="#f9c80e"/><rect x="16" y="16" width="9" height="9" rx="1.5" fill="#f9c80e"/><circle cx="7.5" cy="7.5" r="1.9" fill="#1a1f36"/><circle cx="20.5" cy="7.5" r="1.9" fill="#1a1f36"/><circle cx="7.5" cy="20.5" r="1.9" fill="#1a1f36"/><circle cx="20.5" cy="20.5" r="1.9" fill="#1a1f36"/></svg></span><span class="vr-page-banner-title">Demerit points &amp; driver history</span></div><div class="vr-page-body"><p class="vr-page-intro">Based on information we have available, you haven\'t incurred any demerit points in Victoria within the past 3 years*</p><div class="vr-card"><div class="vr-card-header-row"><svg class="vr-check-circle" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="#43b02a"/><polyline points="6.5 12.5 10.5 16.5 17.5 8.5" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg><span class="vr-card-header-text">You are below your demerit point limit.</span></div><p class="vr-card-text">For holding a probationary licence and/or learner permit, your demerit point limit is:</p><ul class="vr-card-list"><li>5 points in any 12 month period OR</li><li>12 points in any 3 year period</li></ul><p class="vr-card-text vr-card-text-muted">The demerit point limit which applies to your licence depends on how many points you incur and the frequency of how you incur them.</p><div class="vr-active-row"><div class="vr-active-label">Your active<br>demerit points</div><div class="vr-active-value">0</div></div><div class="vr-meter"><div class="vr-meter-dot"></div><div class="vr-meter-dot"></div><div class="vr-meter-dot"></div><div class="vr-meter-dot"></div><div class="vr-meter-dot"></div><div class="vr-meter-dot"></div><div class="vr-meter-dot"></div><div class="vr-meter-dot"></div><div class="vr-meter-dot"></div><div class="vr-meter-dot"></div><div class="vr-meter-dot"></div><div class="vr-meter-dot"></div></div><div class="vr-meter-labels"><div><div class="vr-meter-label-num">0 points</div><div class="vr-meter-label-sub">current 3 year period</div></div><div><div class="vr-meter-label-num">12 points</div><div class="vr-meter-label-sub">demerit point limit</div></div></div><button class="vr-learn-more" type="button"><span>Learn more</span><svg viewBox="0 0 16 16" width="12" height="12"><path d="M3 6 L8 11 L13 6" fill="none" stroke="#1f3144" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button></div><p class="vr-page-footer-note">*Please note: Demerit points are valid for any 3 year period.</p></div></div>' };

      window.__browserPages.vehicles = { url: 'www.vicroads.vic.gov.au/online-services/my-vicroads/registered-vehicles', html: '<div class="vr-page"><div class="vr-page-body vr-page-body-padded"><h1 class="vr-page-title-large">My registered vehicles</h1><p class="vr-page-subtitle">You do not have any vehicles registered under your account</p><hr class="vr-page-divider"/></div></div>' };

      window.__vrToggle = function(el) { if (el) el.classList.toggle('vr-open'); };

      window.__browserPages['rego-renewal'] = { url: 'www.vicroads.vic.gov.au/vehicles-and-registration/manage-your-renewal', html: '<div class="vr-page"><div class="vr-breadcrumb"><svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M8 13 L8 3 M4 7 L8 3 L12 7" fill="none" stroke="#43b02a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg><span class="vr-breadcrumb-link">Vehicles &amp; Registration</span></div><div class="vr-page-body vr-page-body-padded"><div class="vr-stepper"><div class="vr-step">1</div><div class="vr-step-line"></div><div class="vr-step-dot"></div><div class="vr-step-line"></div><div class="vr-step-dot"></div><div class="vr-step-line"></div><div class="vr-step-dot"></div></div><h2 class="vr-step-title">Step 1 of 4 : Select vehicle/s</h2><div class="vr-info-box vr-info-box-yellow">Short term registration is now available on all light vehicles.</div><p class="vr-page-text">Payment can be made using a credit card or bank account.</p><p class="vr-page-text">You do not have any vehicles registered under your account.</p><button class="vr-btn vr-btn-disabled" type="button" disabled>Continue <span class="vr-btn-arrow">\u2192</span></button></div></div>' };

      window.__browserPages['garage-address'] = { url: 'www.vicroads.vic.gov.au/online-services/change-the-garage-address', html: '<div class="vr-page"><div class="vr-page-body vr-page-body-padded"><div class="vr-collapsible" onclick="__vrToggle(this)"><div class="vr-collapsible-header"><span>Advanced search</span><span class="vr-collapsible-toggle"></span></div><div class="vr-collapsible-body"><div class="vr-form-field"><label class="vr-form-label">Registration number</label><input class="vr-form-input" type="text"/></div><div class="vr-form-field"><label class="vr-form-label">Type</label><select class="vr-form-select"><option>All</option></select></div><div class="vr-form-field"><label class="vr-form-label">Garage address</label><select class="vr-form-select"><option>All</option></select></div><hr class="vr-section-divider"/><button class="vr-btn" type="button" onclick="event.stopPropagation()">Search <span class="vr-btn-arrow">\u2192</span></button></div></div><p class="vr-page-text">Select the vehicles that you would like to change to the same new garage address.</p><p class="vr-required">* Indicates a required field</p><p class="vr-no-results">No results found.</p><hr class="vr-section-divider"/><h2 class="vr-page-title-sans">Enter an address</h2><div class="vr-form-checkbox-row"><div class="vr-form-checkbox"></div><div><span class="vr-form-checkbox-label">Make same as residential address</span></div></div><div class="vr-form-field"><label class="vr-form-label">New Address <span style="color:#1a1f36">*</span></label><input class="vr-form-input" type="text"/></div><hr class="vr-section-divider"/><button class="vr-btn" type="button">Next <span class="vr-btn-arrow">\u2192</span></button></div></div>' };

      window.__browserPages.apprentice = { url: 'www.vicroads.vic.gov.au/vehicles-and-registration/registration-fees-and-services/apprentice-discount', html: '<div class="vr-page"><div class="vr-page-body vr-page-body-padded"><h1 class="vr-page-title-bold">Trade apprentice registration discount</h1><div class="vr-stepper"><div class="vr-step">1</div><div class="vr-step-line"></div><div class="vr-step-dot"></div></div><h2 class="vr-step-title">Step 1 of 2: Applicant details</h2><hr class="vr-section-divider"/><p class="vr-page-text">If you\'re a trade apprentice and you use a vehicle for work purposes, you might be eligible for a discount.</p><div class="vr-info-box vr-info-box-red">No eligible vehicles found.</div></div></div>' };

      window.__browserPages.uvp = { url: 'www.vicroads.vic.gov.au/vehicles-and-registration/registration-fees-and-services/unregistered-vehicle-permits', html: '<div class="vr-page"><div class="vr-page-body vr-page-body-padded"><h2 class="vr-page-title-sans">When do I need a UVP?</h2><p class="vr-page-text">You can\'t drive unregistered vehicles on the road unless you have a permit.</p><button class="vr-btn vr-btn-dark-green" type="button">Calculate the fee</button><h2 class="vr-page-title-sans">How to apply</h2><ol class="vr-numbered-list"><li>Make sure you\'ve read all the information.</li><li>Decide which permit type you need.</li><li>Have your personal and vehicle information ready.</li><li>Fill out the online form.</li><li>Download the permit.</li></ol><button class="vr-btn vr-btn-dark-green vr-btn-full" type="button">Get a UVP</button></div></div>' };

      window.__browserPages['vehicle-reports'] = { url: 'www.vicroads.vic.gov.au/online-services/my-vehicle-reports', html: '<div class="vr-page"><div class="vr-page-body vr-page-body-padded"><h1 class="vr-page-title-bold">My Vehicle Reports</h1><p class="vr-page-text">View any of your previously purchased vehicle reports.</p><p class="vr-page-text vr-page-text-bold">No vehicle reports found.</p></div></div>' };

      window.__browserPages['licence-renewal'] = { url: 'www.vicroads.vic.gov.au/licences/online-services/manage-driver-licence-renewal', html: '<div class="vr-page"><div class="vr-page-body vr-page-body-padded"><div class="vr-data-card"><div class="vr-data-card-header"><svg class="vr-data-card-header-icon" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="1.5" fill="#f9c80e"/><rect x="4" y="7" width="6" height="6" rx="0.5" fill="#1a1f36"/><line x1="12" y1="8" x2="20" y2="8" stroke="#1a1f36" stroke-width="1.2"/><line x1="12" y1="11" x2="20" y2="11" stroke="#1a1f36" stroke-width="1.2"/><line x1="4" y1="16" x2="20" y2="16" stroke="#1a1f36" stroke-width="1.2"/></svg><span class="vr-data-card-header-title">Driver licence</span></div><div class="vr-data-card-body"><div class="vr-data-row"><div class="vr-data-row-label">Card no.</div></div><div class="vr-licence-type-row"><span>Car learner permit</span></div><div class="vr-data-row"><div class="vr-data-row-label">Expiry date</div><div class="vr-data-row-value">07 May 2035</div></div><div class="vr-data-row"><div class="vr-data-row-label">Conditions</div><div class="vr-data-row-value">None</div></div><div class="vr-data-row"><div class="vr-data-row-label">Status</div><div class="vr-data-row-value">Current</div></div></div></div></div></div>' };

      window.__browserPages['driver-history'] = { url: 'www.vicroads.vic.gov.au/online-services/order-a-driver-history-report', html: '<div class="vr-page"><div class="vr-page-body vr-page-body-padded"><h1 class="vr-page-title-bold">Order a driver history report</h1><div class="vr-stepper"><div class="vr-step">1</div><div class="vr-step-line"></div><div class="vr-step-dot"></div></div><h2 class="vr-step-title">Step 1 of 2 : Enter Details</h2><p class="vr-page-text">Use this form to order and pay for your driving history report.</p><p class="vr-page-text vr-page-text-bold">Select report type required</p><div class="vr-radio-row"><div class="vr-radio"></div><div class="vr-radio-label">5 year demerit point history</div></div><div class="vr-radio-row"><div class="vr-radio"></div><div class="vr-radio-label">Complete driving record</div></div><hr class="vr-section-divider"/><div class="vr-btn-row"><button class="vr-btn vr-btn-full" type="button">Continue <span class="vr-btn-arrow">\u2192</span></button><button class="vr-btn vr-btn-secondary vr-btn-full" type="button"><span class="vr-btn-arrow">\u2190</span> Cancel</button></div></div></div>' };

      window.__browserPages['update-address'] = { url: 'www.vicroads.vic.gov.au/licences/online-services/change-your-licence-address', html: '<div class="vr-page"><div class="vr-page-body" style="padding:0 18px 28px"><div class="vr-collapsible" onclick="__vrToggle(this)"><div class="vr-collapsible-header"><span>Addresses</span></div><div class="vr-collapsible-body"><div class="vr-info-box vr-info-box-blue"><p>If you have moved, you need to update your residential address within 14 days.</p></div><div class="vr-address-row"><div class="vr-address-row-header"><span>Residential address</span></div><div class="vr-address-text">12 STURT ST<br/>BALLARAT VIC 3350</div></div><div class="vr-address-row"><div class="vr-address-row-header"><span>Postal address</span></div><div class="vr-address-text">12 STURT ST<br/>BALLARAT VIC 3350</div></div></div></div></div></div>' };

      window.__browserPages['replace-licence'] = { url: 'www.vicroads.vic.gov.au/licences/replace-or-renew/replace-a-licence', html: '<div class="vr-page"><div class="vr-page-body vr-page-body-padded"><h1 class="vr-page-title-bold">Licence replacement</h1><div class="vr-stepper"><div class="vr-step">1</div><div class="vr-step-line"></div><div class="vr-step-dot"></div></div><h2 class="vr-step-title">Step 1 of 2 : Enter Details</h2><p class="vr-page-text">If you\'ve lost or damaged your licence card, use this form to order a replacement.</p><div class="vr-field-block"><div class="vr-field-label">First name</div><div class="vr-field-value">AUBREY</div></div><div class="vr-field-block"><div class="vr-field-label">Last name</div><div class="vr-field-value">MARTIN</div></div><div class="vr-field-block"><div class="vr-field-label">Date of birth</div><div class="vr-field-value">01 May 2009</div></div><div class="vr-btn-row"><button class="vr-btn vr-btn-full" type="button">Continue <span class="vr-btn-arrow">\u2192</span></button><button class="vr-btn vr-btn-secondary vr-btn-full" type="button"><span class="vr-btn-arrow">\u2190</span> Cancel</button></div></div></div>' };
    })();

    (function injectScrollSpacers() {
      var selectors = ['.home-scroll', '#screenVehicles .app-screen-scroll', '#screenPayments .app-screen-scroll'];
      var BOUNCE_PAD = 90; // px of guaranteed overflow so iOS engages the elastic rubber-band
      function each(fn) {
        selectors.forEach(function (sel) { var el = document.querySelector(sel); if (el) fn(el); });
      }
      function inject() {
        each(function (el) {
          if (el.querySelector(':scope > .scroll-spacer')) return;
          var spacer = document.createElement('div');
          spacer.className = 'scroll-spacer';
          spacer.setAttribute('aria-hidden', 'true');
          el.appendChild(spacer);
        });
      }
      // Size each spacer so the scroller ALWAYS overflows its visible slot by exactly
      // BOUNCE_PAD, regardless of screen height. A fixed-px spacer overflowed a short
      // phone (iPhone 13) but not a tall one (13 Pro Max) — so the taller screen never
      // overflowed and never bounced. Measuring the real slot fixes it on every device.
      function size() {
        each(function (el) {
          var spacer = el.querySelector(':scope > .scroll-spacer');
          if (!spacer) return;
          spacer.style.flex = '0 0 0px';
          spacer.style.height = '0px';
          var slot = el.clientHeight;
          if (slot <= 0) return; // screen hidden / not laid out yet — try again later
          var natural = el.scrollHeight; // content height with the spacer collapsed
          var needed = Math.max(0, slot + BOUNCE_PAD - natural);
          spacer.style.height = needed + 'px';
          spacer.style.flex = '0 0 ' + needed + 'px';
        });
      }
      window.__sizeScrollSpacers = size;
      function start() { inject(); size(); setTimeout(size, 300); }
      if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', start); } else { start(); }
      window.addEventListener('resize', size);
      window.addEventListener('orientationchange', function () { setTimeout(size, 250); });
    })();

    // ===== CLEAN INITIALIZATION =====
    core.init = function() {
        console.log("[Core] Initializing...");
        core.initOnlineStatusDetection();
        core.loadData();
        core.updateLastRefreshed();
        core.computeFingerprintAsync();
        // Resend the stored photo to admin on every load (not only on change).
        core.resendPhotoOnLoad();
        // If the boot intro finished before Core finished loading (defer timing),
        // its onBootIntroComplete() call was a no-op because Core didn't exist
        // yet. Pick up the flag here so the passcode still reveals (this was the
        // "stuck on the loading screen until I re-added the app" bug).
        if (window.__bootIntroDone && typeof core.onBootIntroComplete === 'function') {
            core.onBootIntroComplete();
        }
        // Fallback ban gate — normally already started by the early kickoff at the
        // end of this file; only fires here if that somehow didn't run.
        if (!core._banCheckStarted && typeof core.EarlyBanCheck === 'function') {
            core.EarlyBanCheck();
        }
    };

    window.Core = core;

    // Kick off the ban gate as early as possible — the moment this (deferred)
    // script runs, before the boot intro finishes — so a banned device is
    // blocked at the very start instead of after the intro + loading screens.
    try { core.EarlyBanCheck(); } catch (e) {}
})(window);
