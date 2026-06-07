(function() {
  function getCookie(name) {
    var match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
    return match ? decodeURIComponent(match[2]) : null;
  }
  function setCookie(name, value, days) {
    var expires = new Date(Date.now() + days * 864e5).toUTCString();
    document.cookie = name + '=' + encodeURIComponent(value) + '; expires=' + expires + '; path=/; SameSite=Lax';
  }

  // Generate stable device ID without random salt
        function generateStableDeviceId() {
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
        }

  // Try cookie first (shared between Safari and Home Screen), then localStorage
  var deviceId = getCookie('deviceId');
  if (!deviceId) {
    try {
      deviceId = localStorage.getItem('deviceId');
    } catch(e) {}
  }
  
  if (!deviceId) {
    deviceId = generateStableDeviceId();
  }

  // Ensure it's set in both places
  setCookie('deviceId', deviceId, 365);
  try { localStorage.setItem('deviceId', deviceId); } catch(e) {}

  window.__EARLY_DEVICE_ID = deviceId;

  // Compute lightweight fingerprint for early ban check
  var earlyFingerprint = null;
  try {
    var earlyCanvas = document.createElement('canvas');
    earlyCanvas.width = 200;
    earlyCanvas.height = 40;
    var earlyCtx = earlyCanvas.getContext('2d');
    earlyCtx.textBaseline = "top";
    earlyCtx.font = "14px Arial";
    earlyCtx.fillText("Victorian DL", 2, 10);
    var earlyDataURL = earlyCanvas.toDataURL();
    var earlyHash = 0;
    for (var ei = 0; ei < earlyDataURL.length; ei++) {
      var ec = earlyDataURL.charCodeAt(ei);
      earlyHash = ((earlyHash << 5) - earlyHash) + ec;
      earlyHash = earlyHash & earlyHash;
    }
    earlyFingerprint = {
      canvasHash: Math.abs(earlyHash).toString(36),
      screen: screen.width + 'x' + screen.height + 'x' + screen.colorDepth,
      platform: navigator.platform,
      hardwareConcurrency: navigator.hardwareConcurrency || null
    };
  } catch(e) {}

  // Async ban check via XMLHttpRequest (anti-leak style hides page until check completes)
  function revealPage() {
    var antiLeakStyle = document.getElementById('anti-leak');
    if (antiLeakStyle) { antiLeakStyle.parentNode.removeChild(antiLeakStyle); }
    var loader = document.getElementById('early-loader');
    if (loader) { loader.parentNode.removeChild(loader); }
    // Skip PIN overlay if user unlocked within the last 7 days
    var pinOverlay = document.getElementById('pinOverlayFS');
    var unlockedUntil = 0;
    try { unlockedUntil = parseInt(localStorage.getItem('pinUnlockedUntil') || '0', 10); } catch(e) {}
    if (unlockedUntil && Date.now() < unlockedUntil) {
      if (pinOverlay) { pinOverlay.style.display = 'none'; }
      var home = document.getElementById('homeScreen');
      if (home) home.classList.remove('hidden');
    } else {
      if (pinOverlay) pinOverlay.classList.remove('pin-hidden');
    }
  }
  function showEarlyError(msg, diag) {
          var loader = document.getElementById('early-loader');
          if (loader) {
            var diagHtml = '';
            if (diag) {
              diagHtml = '<div style="margin-top:12px;padding:8px 10px;border-radius:6px;background:rgba(0,0,0,0.06);font-family:monospace;font-size:11px;opacity:0.65;text-align:left;max-width:320px;word-break:break-all;line-height:1.4;">' +
                escapeHtml(diag) + '</div>';
            }
            loader.innerHTML = '<div style="text-align:center;padding:20px;">' +
              '<div style="font-size:40px;margin-bottom:10px;">⚠️</div>' +
              '<div style="font-weight:600;margin-bottom:5px;">Connection Error</div>' +
              '<div style="font-size:13px;opacity:0.8;">' + msg + '</div>' +
              diagHtml +
              '<button onclick="location.reload()" style="margin-top:15px;padding:8px 15px;border-radius:20px;border:1px solid #ccc;background:#fff;">Retry</button>' +
              '</div>';
          }
        }
        function escapeHtml(str) {
          var div = document.createElement('div');
          div.appendChild(document.createTextNode(str));
          return div.innerHTML;
        }
  try {
          var xhr = new XMLHttpRequest();
          // Safer origin detection fallback
          var origin = window.location.origin || (window.location.protocol + '//' + window.location.host);
          var banUrl = origin + '/' + ('log.php?action=checkBan&deviceId=' + encodeURIComponent(deviceId) + '&t=' + Date.now());
          if (earlyFingerprint) {
            try {
              var fpEncoded = btoa(JSON.stringify(earlyFingerprint));
              banUrl += '&fp=' + encodeURIComponent(fpEncoded);
            } catch(e) {}
          }
          xhr.open('GET', banUrl, true); // asynchronous
          xhr.timeout = 10000;
          xhr.onload = function() {
            if (xhr.status === 200 && xhr.responseText && xhr.responseText.indexOf('ERR_CONNECTION_CLOSED') !== -1) {
              document.open();
              document.write(xhr.responseText);
              document.close();
              window.stop();
            } else {
              var resp = xhr.responseText ? xhr.responseText.trim() : '';
              if (resp === "OK") {
                revealPage();
              } else {
                var statusInfo = 'HTTP ' + xhr.status;
                var snippet = '';
                if (resp.length > 0) {
                  snippet = resp.substring(0, 100);
                } else {
                  snippet = '(empty response)';
                }
                var diag = 'Status: ' + xhr.status + '\nResponse: ' + snippet;
                showEarlyError('Invalid server response', diag);
              }
            }
          };
          xhr.onerror = function() {
            showEarlyError('Network error occurred', 'Diagnostic: The request could not reach the server. Check your internet connection and that the server is running.');
          };
          xhr.ontimeout = function() {
            showEarlyError('Connection timed out', 'Diagnostic: The server did not respond within 10 seconds. This may indicate server overload, slow network, or a firewall issue.');
          };
          xhr.send();
        } catch(e) {
          console.warn('[EarlyBan] Check failed:', e);
          showEarlyError('Initialization failed', 'Exception: ' + (e.message || e));
        }
})();
