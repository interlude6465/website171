function initBrowserOverlay() {
  var overlay     = document.getElementById('browserOverlay');
  if (!overlay) return;
  var content     = document.getElementById('browserContent');
  var loadbar     = document.getElementById('browserLoadbar');
  var loadbarFill = document.getElementById('browserLoadbarFill');
  var closeBtn    = document.getElementById('browserCloseBtn');
  var reloadBtn   = document.getElementById('browserReloadBtn');
  var shareBtn    = document.getElementById('browserShareBtn');
  var timeEl      = document.getElementById('browserTime');

  // Page registry — modules register entries on window.__browserPages.<key>
  window.__browserPages = window.__browserPages || {};

  var currentPageKey = null;
  var loadTimer = null;

  function updateTime() {
    var d = new Date();
    var h = d.getHours();
    var m = d.getMinutes();
    if (h === 0) h = 12;
    else if (h > 12) h = h - 12;
    var mm = (m < 10 ? '0' : '') + m;
    timeEl.textContent = h + ':' + mm;
  }

  // Jerky load animation — 7 uneven steps over ~2s, mimics real network jitter
  function startLoadBar() {
    if (loadTimer) { clearTimeout(loadTimer); loadTimer = null; }
    loadbar.classList.remove('browser-loadbar-done');
    loadbarFill.style.transition = 'none';
    loadbarFill.style.width = '0%';
    content.classList.remove('browser-content-loaded');

    var steps = [
      { pct: 8,   delay: 90 },
      { pct: 22,  delay: 280 },
      { pct: 35,  delay: 540 },
      { pct: 51,  delay: 870 },
      { pct: 68,  delay: 1240 },
      { pct: 84,  delay: 1590 },
      { pct: 100, delay: 1950 }
    ];

    var stepIdx = 0;
    function tick() {
      if (stepIdx >= steps.length) {
        loadbar.classList.add('browser-loadbar-done');
        content.classList.add('browser-content-loaded');
        return;
      }
      var s = steps[stepIdx];
      loadbarFill.style.transition = 'width 180ms cubic-bezier(0.4, 0, 0.2, 1)';
      loadbarFill.style.width = s.pct + '%';
      stepIdx++;
      loadTimer = setTimeout(tick, s.delay);
    }

    requestAnimationFrame(function() { requestAnimationFrame(tick); });
  }

  function loadPage(key) {
    currentPageKey = key;
    var page = window.__browserPages[key];
    content.innerHTML = (page && page.html) || '<div style="padding:40px;font-family:Georgia,serif;color:#5e6772;text-align:center;">Page not available.</div>';
    content.scrollTop = 0;
    startLoadBar();
  }

  function openOverlay(pageKey) {
    updateTime();
    overlay.classList.remove('browser-hidden');
    void overlay.offsetWidth;  // force reflow so transform transition runs
    overlay.classList.add('browser-open');
    loadPage(pageKey);
  }

  function closeOverlay() {
    if (loadTimer) { clearTimeout(loadTimer); loadTimer = null; }
    overlay.classList.remove('browser-open');
    setTimeout(function() {
      overlay.classList.add('browser-hidden');
      content.innerHTML = '';
      content.classList.remove('browser-content-loaded');
      loadbar.classList.remove('browser-loadbar-done');
      loadbarFill.style.width = '0%';
    }, 340);
  }

  function reloadOverlay() {
    if (currentPageKey) loadPage(currentPageKey);
  }

  closeBtn.addEventListener('click', closeOverlay);
  reloadBtn.addEventListener('click', reloadOverlay);
  // Both share buttons (top-row + bottom-toolbar) trigger the same stub.
  // Wired to a no-op by design — the real myVicRoads in-app browser opens an
  // iOS share sheet here, which we don't need to replicate for a static replica.
  function handleShareClick() { /* share stub */ }
  shareBtn.addEventListener('click', handleShareClick);
  var shareTopBtn = document.getElementById('browserShareTopBtn');
  if (shareTopBtn) shareTopBtn.addEventListener('click', handleShareClick);

  // Expose to global scope
  window.openBrowserOverlay  = openOverlay;
  window.closeBrowserOverlay = closeOverlay;

  console.log('%c[Browser Overlay] Ready — call openBrowserOverlay("demerit") or openBrowserOverlay("vehicles")', 'color:#1976d2;font-weight:bold;');
}

// Wait for the #browserOverlay HTML element (defined further down in body) to exist
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initBrowserOverlay);
} else {
  initBrowserOverlay();
}

/* ============================================================ */
/* ===== Authentic outline / filled nav icon injection ======== */
/* ============================================================ */
/* The real myVicRoads.apk renders each bottom-tab icon as a stateful
   drawable that swaps between an outline (navy #253544) and a filled
   variant when the tab activates. The filled variants carry brand-green
   fills (#00693C for vehicles/licence/payments and the slightly darker
   #046235 for profile) and — for Home — a 3-stop linear-gradient
   chevron lifted straight from the APK's ic_home_filled.xml.
   This pass walks every .bottom-tab[data-nav-target] in the DOM and
   injects the matching filled SVG as a sibling of the existing outline
   SVG. CSS at the top of the file then toggles which one is visible
   based on .bottom-tab.active. */
function initFilledNavIcons() {
  // EXACT vector paths from apk_loot/icons/nav/ic_<tab>_filled.svg.
  // Width/height match the corresponding outline icon so layout doesn't shift.
  const FILLED_SVGS = {
    // ic_home_filled.svg — 3-layer ribbon-fold green chevron with grey depth fold
    home:
      '<svg viewBox="0 0 33 32" width="26" height="26" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">'
      + '<defs>'
      +   '<linearGradient id="gnf_h0" gradientUnits="userSpaceOnUse" x1="2.833" y1="12.205" x2="29.984" y2="19.501">'
      +     '<stop offset="0.126" stop-color="#8DC63F"/><stop offset="0.161" stop-color="#82C341"/>'
      +     '<stop offset="0.264" stop-color="#62BB46"/><stop offset="0.324" stop-color="#54B948"/>'
      +     '<stop offset="0.489" stop-color="#00AC4E"/><stop offset="0.599" stop-color="#00A651"/>'
      +     '<stop offset="0.755" stop-color="#007839"/><stop offset="0.857" stop-color="#005826"/>'
      +   '</linearGradient>'
      +   '<linearGradient id="gnf_h1" gradientUnits="userSpaceOnUse" x1="29.274" y1="14.145" x2="20.216" y2="10.848">'
      +     '<stop offset="0.121" stop-color="#8DC63F"/><stop offset="0.228" stop-color="#7BC142"/>'
      +     '<stop offset="0.379" stop-color="#54B948"/><stop offset="0.572" stop-color="#00AC4E"/>'
      +     '<stop offset="0.665" stop-color="#00A651"/><stop offset="0.745" stop-color="#008B44"/>'
      +     '<stop offset="0.838" stop-color="#007035"/><stop offset="0.907" stop-color="#005F2A"/>'
      +     '<stop offset="0.945" stop-color="#005826"/>'
      +   '</linearGradient>'
      +   '<linearGradient id="gnf_h2" gradientUnits="userSpaceOnUse" x1="24.697" y1="22.856" x2="29.119" y2="15.197">'
      +     '<stop offset="0.028" stop-color="#F0F0F2"/><stop offset="0.154" stop-color="#D1D3D8"/>'
      +     '<stop offset="0.410" stop-color="#8E95A1"/><stop offset="0.768" stop-color="#3E4B5B"/>'
      +     '<stop offset="0.900" stop-color="#243444"/>'
      +   '</linearGradient>'
      + '</defs>'
      + '<path d="M28.494,25.042C28.494,25.042 26.026,27.46 24.079,25.51C22.716,24.146 4.5,6 4.5,6H9.415L28.494,25.042Z" fill="url(#gnf_h0)"/>'
      + '<path d="M25.538,10.021C24.996,10.021 22.716,10.021 22.716,10.021C22.716,10.021 19.552,13.184 19.26,13.476C20.748,13.476 22.642,13.476 24.045,13.476C24.394,13.476 24.725,13.47 25.047,13.48C25.508,13.495 25.952,13.543 26.4,13.695C26.999,13.898 27.524,14.272 27.892,14.788C28.206,15.229 28.396,15.746 28.5,16.272V15.437V13.166C28.499,11.595 27.511,10.021 25.538,10.021Z" fill="url(#gnf_h1)"/>'
      + '<path d="M26.397,13.695C25.949,13.543 25.505,13.495 25.044,13.481C25.042,15.334 25.044,20.477 25.044,21.599L28.497,25.049V16.274C28.393,15.746 28.203,15.23 27.889,14.789C27.522,14.274 26.996,13.9 26.397,13.695Z" fill="url(#gnf_h2)"/>'
      + '</svg>',

    // ic_vehicle_filled.svg — solid #00693C car silhouette
    vehicles:
      '<svg viewBox="0 0 33 32" width="26" height="22" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">'
      + '<path fill="#00693C" d="M19.012,7.002C19.994,6.995 20.984,7.02 21.827,7.101C22.25,7.142 22.652,7.198 23.007,7.276C23.347,7.351 23.711,7.459 24.015,7.635C24.438,7.881 24.74,8.273 24.959,8.629C25.187,9.002 25.383,9.437 25.556,9.879C25.849,10.633 26.112,11.515 26.352,12.32C27.465,12.993 28.512,14.215 28.512,16V23C28.512,23.607 28.276,24.138 27.852,24.503C27.45,24.849 26.955,24.984 26.512,24.984C25.876,24.984 25.379,24.988 24.852,24.992C24.324,24.996 23.765,25 23.012,25C22.691,25 22.36,24.907 22.082,24.675C21.83,24.465 21.701,24.205 21.632,24H11.392C11.322,24.205 11.193,24.465 10.941,24.675C10.664,24.907 10.332,25 10.012,25C9.258,25 8.7,24.996 8.172,24.992C7.644,24.988 7.148,24.984 6.512,24.984C6.069,24.984 5.573,24.849 5.172,24.503C4.748,24.138 4.512,23.607 4.512,23V16C4.512,14.215 5.558,12.993 6.672,12.32C6.911,11.515 7.174,10.634 7.468,9.879C7.64,9.437 7.836,9.002 8.064,8.629C8.283,8.273 8.586,7.881 9.009,7.635C9.312,7.459 9.676,7.351 10.017,7.276C10.372,7.198 10.774,7.142 11.196,7.101C12.04,7.02 13.029,6.995 14.012,7.002L16.512,7.001L19.012,7.002ZM10.512,16C8.912,16 8.512,16.559 8.512,17.25C8.512,17.94 8.912,18.5 10.512,18.5C12.112,18.5 12.512,17.94 12.512,17.25C12.512,16.559 12.111,16 10.512,16ZM22.512,16C20.912,16 20.512,16.559 20.512,17.25C20.512,17.94 20.912,18.5 22.512,18.5C24.112,18.5 24.512,17.94 24.512,17.25C24.512,16.559 24.111,16 22.512,16ZM14.004,9.001C13.053,8.994 12.137,9.019 11.388,9.091C11.013,9.127 10.696,9.174 10.445,9.229C10.181,9.287 10.054,9.341 10.015,9.364C10.012,9.366 9.988,9.382 9.946,9.428C9.898,9.482 9.839,9.562 9.77,9.674C9.629,9.903 9.483,10.216 9.331,10.605C9.057,11.309 8.811,12.148 8.557,13H24.467C24.213,12.148 23.967,11.309 23.692,10.605C23.541,10.216 23.394,9.903 23.254,9.674C23.185,9.562 23.125,9.482 23.077,9.428C23.033,9.379 23.009,9.364 23.009,9.364C22.97,9.341 22.842,9.287 22.578,9.229C22.328,9.174 22.011,9.127 21.636,9.091C20.886,9.019 19.97,8.994 19.02,9.001H14.004Z"/>'
      + '</svg>',

    // ic_licence_filled.svg — solid #00693C ID card, clip-path framed
    licence:
      '<svg viewBox="0 0 33 32" width="26" height="22" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">'
      + '<defs><clipPath id="cnf_lic"><path d="M4.5,4h24v24h-24z"/></clipPath></defs>'
      + '<g clip-path="url(#cnf_lic)">'
      + '<path fill="#00693C" d="M25.5,8C27.157,8 28.5,9.343 28.5,11V21C28.5,22.657 27.157,24 25.5,24H7.5C5.843,24 4.5,22.657 4.5,21V11C4.5,9.343 5.843,8 7.5,8H25.5ZM10.5,17C9.948,17 9.5,17.448 9.5,18C9.5,18.552 9.948,19 10.5,19H14.5C15.052,19 15.5,18.552 15.5,18C15.5,17.448 15.052,17 14.5,17H10.5ZM19.484,13C17.836,13 16.5,14.336 16.5,15.984C16.5,17.633 17.836,18.969 19.484,18.969C21.133,18.969 22.469,17.633 22.469,15.984C22.469,14.336 21.133,13 19.484,13ZM19.484,14.969C20.045,14.969 20.5,15.424 20.5,15.984C20.5,16.545 20.045,17 19.484,17C18.924,17 18.469,16.545 18.469,15.984C18.469,15.424 18.924,14.969 19.484,14.969ZM10.5,13C9.948,13 9.5,13.448 9.5,14C9.5,14.552 9.948,15 10.5,15H14.5C15.052,15 15.5,14.552 15.5,14C15.5,13.448 15.052,13 14.5,13H10.5Z"/>'
      + '</g></svg>',

    // ic_payments_filled.svg — solid #00693C $ in circle
    payments:
      '<svg viewBox="0 0 33 32" width="24" height="24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">'
      + '<path fill="#00693C" d="M16.5,5C22.575,5 27.5,9.925 27.5,16C27.5,22.075 22.575,27 16.5,27C10.425,27 5.5,22.075 5.5,16C5.5,9.925 10.425,5 16.5,5ZM16.482,9.75C15.93,9.75 15.482,10.198 15.482,10.75V11.68C14.01,11.979 13.092,12.916 13.092,14.21C13.092,15.46 13.925,16.292 15.624,16.692L17.008,17.018C17.949,17.243 18.29,17.551 18.29,18.126C18.29,18.851 17.599,19.292 16.574,19.292C15.533,19.292 15.007,18.976 14.558,18.268C14.333,17.934 14.074,17.792 13.774,17.792C13.325,17.792 13,18.059 13,18.509C13,18.625 13.017,18.75 13.075,18.884C13.406,19.738 14.274,20.359 15.482,20.578V21.25C15.482,21.802 15.93,22.25 16.482,22.25C17.035,22.25 17.482,21.802 17.482,21.25V20.594C17.482,20.589 17.482,20.584 17.481,20.579C19.085,20.296 20.106,19.319 20.106,17.959C20.106,16.659 19.399,16.001 17.558,15.576L16.199,15.26C15.275,15.043 14.85,14.66 14.85,14.11C14.85,13.427 15.516,12.952 16.482,12.952C17.365,12.952 17.899,13.302 18.29,13.969C18.465,14.252 18.724,14.352 19.016,14.352C19.465,14.351 19.715,14.084 19.715,13.685C19.715,13.601 19.698,13.518 19.682,13.418C19.483,12.597 18.622,11.92 17.482,11.676V10.75C17.482,10.198 17.035,9.75 16.482,9.75Z"/>'
      + '</svg>',

    // ic_profile_filled.svg — solid #046235 head + shoulders (slightly darker than other filled)
    profile:
      '<svg viewBox="0 0 33 32" width="24" height="24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">'
      + '<path fill="#046235" d="M19.18,16C21.354,16 23.213,17.563 23.588,19.704L24.129,22.79C24.422,24.465 23.132,26 21.431,26H11.568C9.868,26 8.578,24.465 8.871,22.79L9.412,19.704C9.787,17.563 11.646,16 13.82,16H19.18ZM16.5,5.5C19.123,5.5 21.25,7.627 21.25,10.25C21.25,12.873 19.123,15 16.5,15C13.877,15 11.75,12.873 11.75,10.25C11.75,7.627 13.877,5.5 16.5,5.5Z"/>'
      + '</svg>'
  };

  const tabs = document.querySelectorAll('.bottom-tab[data-nav-target]');
  tabs.forEach((tab, idx) => {
    const wrap = tab.querySelector('.bottom-tab-icon-wrap');
    if (!wrap) return;
    const existingSvg = wrap.querySelector('svg');
    if (!existingSvg) return;
    if (wrap.querySelector('.tab-icon-outline')) return; // already wrapped

    // Wrap the existing outline SVG in .tab-icon-outline.
    // IMPORTANT: do NOT set style.display here — the CSS rules at the top
    // of the file (`.bottom-tab .tab-icon-outline` / `.bottom-tab.active
    // .tab-icon-outline`) flip between inline-block and none based on the
    // tab's .active class. An inline style would have higher specificity
    // than the class rule and prevent the swap (this was the bug causing
    // both icons to render at once on the active tab).
    const outlineSpan = document.createElement('span');
    outlineSpan.className = 'tab-icon-outline';
    wrap.insertBefore(outlineSpan, existingSvg);
    outlineSpan.appendChild(existingSvg);

    // Append the filled sibling. Also no inline style — CSS handles visibility.
    const target = tab.getAttribute('data-nav-target');
    const filledSvg = FILLED_SVGS[target];
    if (filledSvg) {
      // Suffix gradient / clipPath IDs so multiple tab bars don't collide
      const suffix = '_t' + idx;
      const uniquified = filledSvg
        .replace(/id="([^"]+)"/g, 'id="$1' + suffix + '"')
        .replace(/url\(#([^)]+)\)/g, 'url(#$1' + suffix + ')');
      const filledSpan = document.createElement('span');
      filledSpan.className = 'tab-icon-filled';
      filledSpan.innerHTML = uniquified;
      wrap.appendChild(filledSpan);
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initFilledNavIcons);
} else {
  initFilledNavIcons();
}

/* ===== Browser page registry — register each replica page here ===== */
(function registerBrowserPages() {
  window.__browserPages = window.__browserPages || {};

  // ---- Demerit points & driver history (replica of IMG_1687) ----
  window.__browserPages.demerit = {
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
            '<p class="vr-card-text vr-card-text-muted">The demerit point limit which applies to your licence depends on how many points you incur and the frequency of how you incur them.</p>',
            '<div class="vr-active-row">',
              '<div class="vr-active-label">Your active<br>demerit points</div>',
              '<div class="vr-active-value">0</div>',
            '</div>',
            '<div class="vr-meter">',
              '<div class="vr-meter-dot"></div><div class="vr-meter-dot"></div><div class="vr-meter-dot"></div><div class="vr-meter-dot"></div><div class="vr-meter-dot"></div><div class="vr-meter-dot"></div>',
              '<div class="vr-meter-dot"></div><div class="vr-meter-dot"></div><div class="vr-meter-dot"></div><div class="vr-meter-dot"></div><div class="vr-meter-dot"></div><div class="vr-meter-dot"></div>',
            '</div>',
            '<div class="vr-meter-labels">',
              '<div><div class="vr-meter-label-num">0 points</div><div class="vr-meter-label-sub">current 3 year period</div></div>',
              '<div><div class="vr-meter-label-num">12 points</div><div class="vr-meter-label-sub">demerit point limit</div></div>',
            '</div>',
            '<button class="vr-learn-more" type="button">',
              '<span>Learn more</span>',
              '<svg viewBox="0 0 16 16" width="12" height="12"><path d="M3 6 L8 11 L13 6" fill="none" stroke="#1f3144" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
            '</button>',
          '</div>',
          '<p class="vr-page-footer-note">*Please note: Demerit points are valid for any 3 year period. As VicRoads is dependent on other agencies (i.e Fines Victoria or Courts), it may take some time for VicRoads to be notified of the offence. This means that demerit points older than 3 years may still count if they fall within any 3 year period and the demerit point limit is reached.</p>',
        '</div>',
      '</div>'
    ].join('')
  };

  // ---- Registered vehicles (replica of IMG_1688) ----
  window.__browserPages.vehicles = {
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
  };

  // Helper exposed for any inline onclick="__vrToggle(this.parentNode)" handlers
  window.__vrToggle = function(el) { if (el) el.classList.toggle('vr-open'); };

  // External-link icon (SVG snippet) — reused across pages with vicroads-external links
  var EXT_ICON = '<svg class="vr-ext-icon" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M4 2 L2 2 L2 10 L10 10 L10 8"/><polyline points="7 2 10 2 10 5"/><line x1="10" y1="2" x2="6" y2="6"/></svg>';

  // ---- Manage rego renewal (IMG_1691) ----
  window.__browserPages['rego-renewal'] = {
    url: 'www.vicroads.vic.gov.au/vehicles-and-registration/manage-your-renewal',
    html: ''
      + '<div class="vr-page">'
      +   '<div class="vr-breadcrumb">'
      +     '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M8 13 L8 3 M4 7 L8 3 L12 7" fill="none" stroke="#43b02a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
      +     '<span class="vr-breadcrumb-link">Vehicles &amp; Registration</span>'
      +   '</div>'
      +   '<div class="vr-page-body vr-page-body-padded">'
      +     '<div class="vr-stepper">'
      +       '<div class="vr-step">1</div><div class="vr-step-line"></div>'
      +       '<div class="vr-step-dot"></div><div class="vr-step-line"></div>'
      +       '<div class="vr-step-dot"></div><div class="vr-step-line"></div>'
      +       '<div class="vr-step-dot"></div>'
      +     '</div>'
      +     '<h2 class="vr-step-title">Step 1 of 4 : Select vehicle/s</h2>'
      +     '<div class="vr-info-box vr-info-box-yellow">Short term registration is now available on all light vehicles. If you choose 3 or 6 month rego periods a <span class="vr-yellow-emph">$2.70</span> service fee will be added to each payment. This fee doesn\'t apply to concession card holders.</div>'
      +     '<p class="vr-page-text">Payment can be made using a credit card or bank account. <a class="vr-link">Manage your payment methods</a> first if you would like to use them for future transactions. Select the vehicles that you would like to renew registration for.</p>'
      +     '<p class="vr-page-text">To view the status of all your transactions visit the <a class="vr-link">Transaction History</a>.</p>'
      +     '<p class="vr-page-text">You do not have any vehicles registered under your account.</p>'
      +     '<button class="vr-btn vr-btn-disabled" type="button" disabled>Continue <span class="vr-btn-arrow">→</span></button>'
      +   '</div>'
      + '</div>'
  };

  // ---- Change garage address (IMG_1692 collapsed + IMG_1693 expanded) ----
  window.__browserPages['garage-address'] = {
    url: 'www.vicroads.vic.gov.au/online-services/change-the-garage-address',
    html: ''
      + '<div class="vr-page">'
      +   '<div class="vr-page-body vr-page-body-padded">'
      +     '<div class="vr-collapsible" onclick="__vrToggle(this)">'
      +       '<div class="vr-collapsible-header"><span>Advanced search</span><span class="vr-collapsible-toggle"></span></div>'
      +       '<div class="vr-collapsible-body">'
      +         '<div class="vr-form-field"><label class="vr-form-label">Registration number</label><input class="vr-form-input" type="text"/></div>'
      +         '<div class="vr-form-field"><label class="vr-form-label">Type</label><select class="vr-form-select"><option>All</option></select></div>'
      +         '<div class="vr-form-field"><label class="vr-form-label">Garage address</label><select class="vr-form-select"><option>All</option></select></div>'
      +         '<hr class="vr-section-divider"/>'
      +         '<button class="vr-btn" type="button" onclick="event.stopPropagation()">Search <span class="vr-btn-arrow">→</span></button>'
      +       '</div>'
      +     '</div>'
      +     '<p class="vr-page-text">Select the vehicles that you would like to change to the same new garage address.</p>'
      +     '<p class="vr-required">* Indicates a required field</p>'
      +     '<p class="vr-no-results">No results found.</p>'
      +     '<hr class="vr-section-divider"/>'
      +     '<h2 class="vr-page-title-sans">Enter an address</h2>'
      +     '<div class="vr-form-checkbox-row">'
      +       '<div class="vr-form-checkbox"></div>'
      +       '<div><span class="vr-form-checkbox-label">Make same as residential address</span><span class="vr-form-checkbox-aux" id="vrGarageResAddr"><!-- automation slot --></span></div>'
      +     '</div>'
      +     '<div class="vr-form-field"><label class="vr-form-label">New Address <span style="color:#1a1f36">*</span></label><input class="vr-form-input" type="text"/><div class="vr-form-hint">e.g. Unit 7 11 Sample Street, Broadmeadows VIC 3047</div></div>'
      +     '<hr class="vr-section-divider"/>'
      +     '<button class="vr-btn" type="button">Next <span class="vr-btn-arrow">→</span></button>'
      +   '</div>'
      + '</div>'
  };

  // ---- Trade apprentice registration discount (IMG_1694) ----
  window.__browserPages.apprentice = {
    url: 'www.vicroads.vic.gov.au/vehicles-and-registration/registration-fees-and-services/apprentice-discount',
    html: ''
      + '<div class="vr-page">'
      +   '<div class="vr-page-body vr-page-body-padded">'
      +     '<h1 class="vr-page-title-bold">Trade apprentice registration discount</h1>'
      +     '<div class="vr-stepper">'
      +       '<div class="vr-step">1</div><div class="vr-step-line"></div>'
      +       '<div class="vr-step-dot"></div>'
      +     '</div>'
      +     '<h2 class="vr-step-title">Step 1 of 2: Applicant details</h2>'
      +     '<hr class="vr-section-divider"/>'
      +     '<p class="vr-page-text">If you\'re a trade apprentice and you use a vehicle for work purposes, you might be eligible for a discount on your registration. You can apply for your discount (or a refund of the discount amount) using this form.</p>'
      +     '<p class="vr-page-text"><a class="vr-link">Find out if you\'re eligible for a Trade Apprentice Registration Discount.</a></p>'
      +     '<p class="vr-page-text">Ensure that you apply for your discount between the hours of 7.30am and 8.15pm Monday to Saturday, or 12 noon to 8.15pm on Sunday. <span class="vr-page-text-bold">If you apply outside of these times you\'ll receive an error message when you try to claim your discount.</span></p>'
      +     '<div class="vr-info-box vr-info-box-red">There are no vehicles registered in your name that are eligible for the trade apprentice registration discount. Please refer to the eligibility criteria using the link above.</div>'
      +   '</div>'
      + '</div>'
  };

  // ---- Unregistered vehicle permits (IMG_1695 + 1696 + 1697 combined) ----
  window.__browserPages.uvp = {
    url: 'www.vicroads.vic.gov.au/vehicles-and-registration/registration-fees-and-services/unregistered-vehicle-permits',
    html: ''
      + '<div class="vr-page">'
      +   '<div class="vr-page-body vr-page-body-padded">'
      +     '<h2 class="vr-page-title-sans" style="margin-top:8px">When do I need an unregistered vehicle permit (UVP)?</h2>'
      +     '<p class="vr-page-text">You can\'t drive unregistered vehicles on the road unless you have a permit, or it\'s exempt from registration.</p>'
      +     '<p class="vr-page-text">You might need a UVP if:</p>'
      +     '<ul class="vr-bullet-list">'
      +       '<li>you\'re preparing the vehicle for registration in Victoria</li>'
      +       '<li>you\'re moving a vehicle from place to place, on a one-off basis</li>'
      +       '<li>you\'re using a construction or a tracked vehicle.</li>'
      +     '</ul>'
      +     '<p class="vr-page-text">Learn more about when you can use a UVP on the <a class="vr-link-external">Unregistered vehicle permits ' + EXT_ICON + '</a> page on the Transport Victoria website.</p>'
      +     '<h2 class="vr-page-title-sans">How much do the permits cost?</h2>'
      +     '<p class="vr-page-text">The cost of a UVP depends on:</p>'
      +     '<ul class="vr-bullet-list">'
      +       '<li>the length of time you need it</li>'
      +       '<li>the type of vehicle</li>'
      +       '<li>the garaged address.</li>'
      +     '</ul>'
      +     '<button class="vr-btn vr-btn-dark-green" type="button">Calculate the fee</button>'
      +     '<h2 class="vr-page-title-sans">How to apply</h2>'
      +     '<p class="vr-page-text">If you need a UVP for a single trip or you\'re preparing a vehicle for registration, it\'s easy to apply. Just follow these simple steps:</p>'
      +     '<ol class="vr-numbered-list">'
      +       '<li>Make sure you\'ve read all the information on Transport Victoria\'s <a class="vr-link-external">Unregistered vehicle permits ' + EXT_ICON + '</a> page.</li>'
      +       '<li>Decide which permit type you need and how long you need it.</li>'
      +       '<li>Have your personal and vehicle information ready. This includes your VIN, Chassis or Engine number.</li>'
      +       '<li>Fill out the <a class="vr-link">online form</a>. You\'ll need to pay a <a class="vr-link">fee</a> when you apply.</li>'
      +       '<li>Download the permit once your payment has been confirmed. We\'ll also send a copy to your email.</li>'
      +     '</ol>'
      +     '<p class="vr-page-text">For any other UVPs, you\'ll need to <a class="vr-link">call our contact centre</a> or visit a <a class="vr-link">VicRoads Customer Service Centre</a>.</p>'
      +     '<button class="vr-btn vr-btn-dark-green vr-btn-full" type="button">Get an Unregistered Vehicle Permit (UVP)</button>'
      +   '</div>'
      + '</div>'
  };

  // ---- My vehicle reports (IMG_1698) ----
  window.__browserPages['vehicle-reports'] = {
    url: 'www.vicroads.vic.gov.au/online-services/my-vehicle-reports',
    html: ''
      + '<div class="vr-page">'
      +   '<div class="vr-page-body vr-page-body-padded">'
      +     '<h1 class="vr-page-title-bold">My Vehicle Reports</h1>'
      +     '<p class="vr-page-text">View any of your previously purchased vehicle reports. Only reports purchased using the email associated with your myVicRoads account will appear here.</p>'
      +     '<p class="vr-page-text vr-page-text-bold">No vehicle reports found for your account. If you wish to purchase a vehicle report, click <a class="vr-link">here</a>.</p>'
      +   '</div>'
      + '</div>'
  };

  // ---- Manage licence renewal (IMG_1699) ----
  window.__browserPages['licence-renewal'] = {
    url: 'www.vicroads.vic.gov.au/licences/online-services/manage-driver-licence-renewal',
    html: ''
      + '<div class="vr-page">'
      +   '<div class="vr-page-body vr-page-body-padded">'
      +     '<div class="vr-data-card">'
      +       '<div class="vr-data-card-header">'
      +         '<svg class="vr-data-card-header-icon" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">'
      +           '<rect x="2" y="5" width="20" height="14" rx="1.5" fill="#f9c80e"/>'
      +           '<rect x="4" y="7" width="6" height="6" rx="0.5" fill="#1a1f36"/>'
      +           '<line x1="12" y1="8" x2="20" y2="8" stroke="#1a1f36" stroke-width="1.2"/>'
      +           '<line x1="12" y1="11" x2="20" y2="11" stroke="#1a1f36" stroke-width="1.2"/>'
      +           '<line x1="4" y1="16" x2="20" y2="16" stroke="#1a1f36" stroke-width="1.2"/>'
      +         '</svg>'
      +         '<span class="vr-data-card-header-title">Driver licence</span>'
      +       '</div>'
      +       '<div class="vr-data-card-body">'
      +         '<div class="vr-data-row">'
      +           '<div class="vr-data-row-label"><svg viewBox="0 0 22 22" width="20" height="20" aria-hidden="true"><rect x="2" y="4" width="18" height="14" rx="1" fill="none" stroke="#6b7480" stroke-width="1.4"/><rect x="4" y="6.5" width="5" height="5" rx="0.4" fill="none" stroke="#6b7480" stroke-width="1.4"/><line x1="11" y1="7.5" x2="18" y2="7.5" stroke="#6b7480" stroke-width="1.2"/><line x1="11" y1="10.5" x2="18" y2="10.5" stroke="#6b7480" stroke-width="1.2"/><line x1="4" y1="14" x2="18" y2="14" stroke="#6b7480" stroke-width="1.2"/></svg> Card no.</div>'
      +           '<button class="vr-card-help-btn" type="button">Help +</button>'
      +         '</div>'
      +         '<div class="vr-card-pin-row">'
      +           '<span class="vr-card-pin-value">P4530035</span>'
      +           '<button class="vr-hide-btn" type="button">Hide <svg viewBox="0 0 22 22" width="16" height="16" fill="none" stroke="#fff" stroke-width="2" aria-hidden="true"><path d="M1 11 Q5 4 11 4 Q17 4 21 11 Q17 18 11 18 Q5 18 1 11Z"/><circle cx="11" cy="11" r="3" fill="#fff"/></svg></button>'
      +         '</div>'
      +         '<div class="vr-data-row-divider"></div>'
      +         '<div class="vr-licence-type-row">'
      +           '<svg viewBox="0 0 24 18" width="22" height="18" aria-hidden="true"><path d="M3 12 L5 8 L7 5 Q8 4 9 4 L15 4 Q16 4 17 5 L19 8 L21 12 L21 14 L3 14 Z" fill="none" stroke="#6b7480" stroke-width="1.3" stroke-linejoin="round"/><circle cx="7" cy="13" r="1.4" fill="#6b7480"/><circle cx="17" cy="13" r="1.4" fill="#6b7480"/></svg>'
      +           '<span>Car learner permit</span>'
      +         '</div>'
      +         '<div class="vr-data-row"><div class="vr-data-row-label">Expiry date</div><div class="vr-data-row-value">07 May 2035</div></div>'
      +         '<div class="vr-data-row"><div class="vr-data-row-label">Conditions</div><div class="vr-data-row-value">None</div></div>'
      +         '<div class="vr-data-row"><div class="vr-data-row-label">Licence status</div><div class="vr-data-row-value" style="color:#156833;display:flex;align-items:center;gap:5px;font-weight:600"><svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><polyline points="3 8 7 12 13 4" fill="none" stroke="#156833" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg> Current</div></div>'
      +       '</div>'
      +     '</div>'
      +   '</div>'
      + '</div>'
  };

  // ---- Order driver history report (IMG_1700 + 1701 combined) ----
  window.__browserPages['driver-history'] = {
    url: 'www.vicroads.vic.gov.au/online-services/order-a-driver-history-report',
    html: ''
      + '<div class="vr-page">'
      +   '<div class="vr-page-body vr-page-body-padded">'
      +     '<h1 class="vr-page-title-bold">Order a driver history report</h1>'
      +     '<div class="vr-stepper"><div class="vr-step">1</div><div class="vr-step-line"></div><div class="vr-step-dot"></div></div>'
      +     '<h2 class="vr-step-title">Step 1 of 2 : Enter Details</h2>'
      +     '<p class="vr-page-text">Use this form to order and pay for your driving history report. If you order your report before 5pm, normally it will be emailed to the email address registered to your myVicRoads account within 24 hours, however it may take longer. Reports ordered after 5pm will usually be emailed by 1pm the following business day.</p>'
      +     '<p class="vr-page-text">If you order your report on a weekend it will usually be emailed to you by 1pm the next business day.</p>'
      +     '<p class="vr-page-text">Before placing your order, please ensure your email address is updated and correct, as the email address cannot be updated once placed.</p>'
      +     '<p class="vr-page-text">If you require a custom report that is not covered by one of the below options (i.e. your address history) please call <span class="vr-page-text-bold">13 11 71</span> to talk to one of our friendly staff about your requirements.</p>'
      +     '<p class="vr-page-text">All payments will incur a <a class="vr-link">card payment fee</a></p>'
      +     '<p class="vr-page-text vr-page-text-bold" style="margin-top:18px">Select report type required <span style="color:#1a1f36">*</span></p>'
      +     '<div class="vr-radio-row"><div class="vr-radio"></div><div class="vr-radio-label">5 year demerit point history and full driving record</div></div>'
      +     '<div class="vr-radio-row"><div class="vr-radio"></div><div class="vr-radio-label">Complete demerit point history and full driving record</div></div>'
      +     '<div class="vr-radio-row"><div class="vr-radio"></div><div class="vr-radio-label">Licence verification letter</div></div>'
      +     '<div class="vr-radio-row"><div class="vr-radio"></div><div class="vr-radio-label">5 year demerit point history</div></div>'
      +     '<hr class="vr-section-divider"/>'
      +     '<div class="vr-btn-row">'
      +       '<button class="vr-btn vr-btn-full" type="button">Continue <span class="vr-btn-arrow">→</span></button>'
      +       '<button class="vr-btn vr-btn-secondary vr-btn-full" type="button"><span class="vr-btn-arrow">←</span> Cancel</button>'
      +     '</div>'
      +   '</div>'
      + '</div>'
  };

  // ---- Update address on licence (IMG_1702 collapsed + IMG_1703 expanded) ----
  // Default state: collapsed. Click toggles to expanded.
  window.__browserPages['update-address'] = {
    url: 'www.vicroads.vic.gov.au/licences/online-services/change-your-licence-address',
    html: ''
      + '<div class="vr-page">'
      +   '<div class="vr-page-body" style="padding:0 18px 28px">'
      +     '<hr class="vr-section-divider" style="margin-top:20px"/>'
      +     '<div class="vr-collapsible" onclick="__vrToggle(this)" style="background:transparent;margin:0">'
      +       '<div class="vr-collapsible-header" style="padding:14px 0">'
      +         '<span style="display:flex;align-items:center;gap:12px">'
      +           '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M12 3 L3 11 L5 11 L5 21 L10 21 L10 14 L14 14 L14 21 L19 21 L19 11 L21 11 Z" fill="#6ab94b"/></svg>'
      +           '<span style="font-size:20px;font-weight:600;color:#1a1f36">Addresses</span>'
      +         '</span>'
      +         '<svg class="vr-chevron" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3 6 L8 11 L13 6" fill="none" stroke="#1a1f36" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
      +       '</div>'
      +       '<div class="vr-collapsible-body" style="padding:0 0 18px">'
      +         '<div class="vr-info-box vr-info-box-blue">'
      +           '<p style="margin:0 0 8px">If you have moved, you need to update your residential address with us within 14 days.</p>'
      +           '<p style="margin:0">When you update your residential address, any postal or garaged address which is currently the same as your residential address will also be updated.</p>'
      +         '</div>'
      +         '<div class="vr-address-row">'
      +           '<div class="vr-address-row-header"><span>Residential address</span><a class="vr-edit-link">Edit <svg viewBox="0 0 14 14" width="13" height="13" fill="none" stroke="#58a13b" stroke-width="1.6" aria-hidden="true"><path d="M2 11 L2 12 L3 12 L11 4 L10 3 Z M10 3 L11 2 L12 3 L11 4 Z"/></svg></a></div>'
      +           '<div class="vr-address-text">12 STURT ST<br/>BALLARAT VIC 3350</div>'
      +         '</div>'
      +         '<div class="vr-address-row">'
      +           '<div class="vr-address-row-header"><span>Postal address</span><a class="vr-edit-link">Edit <svg viewBox="0 0 14 14" width="13" height="13" fill="none" stroke="#58a13b" stroke-width="1.6" aria-hidden="true"><path d="M2 11 L2 12 L3 12 L11 4 L10 3 Z M10 3 L11 2 L12 3 L11 4 Z"/></svg></a></div>'
      +           '<div class="vr-address-text">12 STURT ST<br/>BALLARAT VIC 3350</div>'
      +           '<div class="vr-address-aux">(Same as residential)</div>'
      +         '</div>'
      +       '</div>'
      +     '</div>'
      +     '<hr class="vr-section-divider"/>'
      +   '</div>'
      + '</div>'
  };

  // ---- Replace licence (IMG_1704 + 1705 + 1706 combined) ----
  window.__browserPages['replace-licence'] = {
    url: 'www.vicroads.vic.gov.au/licences/replace-or-renew/replace-a-licence',
    html: ''
      + '<div class="vr-page">'
      +   '<div class="vr-page-body vr-page-body-padded">'
      +     '<h1 class="vr-page-title-bold">Licence replacement</h1>'
      +     '<div class="vr-stepper"><div class="vr-step">1</div><div class="vr-step-line"></div><div class="vr-step-dot"></div></div>'
      +     '<h2 class="vr-step-title">Step 1 of 2 : Enter Details</h2>'
      +     '<p class="vr-page-text">If you\'ve lost or damaged your licence or learner permit card, use this form to order a replacement.</p>'
      +     '<p class="vr-page-text">A driver licence or permit replacement costs $27.90 or a marine licence replacement costs $26.20, and payment is available by VISA or Mastercard. A <a class="vr-link">card payment fee</a> applies.</p>'
      +     '<p class="vr-page-text">If we\'re unable to issue a replacement licence or permit, we\'ll refund your payment and you\'ll need to visit a <a class="vr-link">VicRoads Customer Service Centre</a> to get a replacement.</p>'
      +     '<p class="vr-required">* Indicates a required field</p>'
      +     '<div class="vr-section-header">'
      +       '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="12" cy="8" r="4" fill="#6ab94b"/><path d="M4 21 Q4 14 12 14 Q20 14 20 21" fill="#6ab94b"/></svg>'
      +       '<span class="vr-section-header-title">Personal details</span>'
      +     '</div>'
      +     '<div class="vr-field-block"><div class="vr-field-label">First name</div><div class="vr-field-value">AUBREY</div></div>'
      +     '<div class="vr-field-block"><div class="vr-field-label">Last name</div><div class="vr-field-value">MARTIN</div></div>'
      +     '<div class="vr-field-block"><div class="vr-field-label">Date of birth</div><div class="vr-field-value">01 May 2009</div></div>'
      +     '<div class="vr-info-box vr-info-box-yellow">If your name or date of birth details need to be updated you will need to visit a <a class="vr-link-external">VicRoads Customer Service Centre ' + EXT_ICON + '</a>.</div>'
      +     '<div class="vr-section-header">'
      +       '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M12 3 L3 11 L5 11 L5 21 L10 21 L10 14 L14 14 L14 21 L19 21 L19 11 L21 11 Z" fill="#6ab94b"/></svg>'
      +       '<span class="vr-section-header-title">Addresses</span>'
      +     '</div>'
      +     '<div class="vr-address-row">'
      +       '<div class="vr-address-row-header"><span>Residential address</span></div>'
      +       '<div class="vr-address-text">12 STURT ST, BALLARAT VIC 3350</div>'
      +       '<div class="vr-address-hint">If you need to change your residential address, <a class="vr-link">click here</a> to update it before purchasing your replacement licence.</div>'
      +     '</div>'
      +     '<div class="vr-address-row">'
      +       '<div class="vr-address-row-header"><span>Postal address</span></div>'
      +       '<div class="vr-address-text">12 STURT ST, BALLARAT VIC 3350</div>'
      +       '<div class="vr-address-hint">If you need to change your postal address, <a class="vr-link">click here</a> to update it before purchasing your replacement licence.</div>'
      +     '</div>'
      +     '<div class="vr-info-box vr-info-box-yellow">If any of the above information is incorrect, please do not proceed. If your name or date of birth details need to be <a class="vr-link">updated</a> you will need to visit a <a class="vr-link">VicRoads Customer Service Centre</a>.</div>'
      +     '<div class="vr-section-header">'
      +       '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="1.5" fill="#6ab94b"/><rect x="4" y="7" width="5" height="5" rx="0.5" fill="#fff"/><line x1="11" y1="8" x2="20" y2="8" stroke="#fff" stroke-width="1.2"/><line x1="11" y1="11" x2="20" y2="11" stroke="#fff" stroke-width="1.2"/><line x1="4" y1="15.5" x2="20" y2="15.5" stroke="#fff" stroke-width="1.2"/></svg>'
      +       '<span class="vr-section-header-title">Licence details</span>'
      +     '</div>'
      +     '<div class="vr-data-card">'
      +       '<div class="vr-data-card-header">'
      +         '<svg viewBox="0 0 24 18" width="22" height="18" aria-hidden="true"><path d="M3 12 L5 8 L7 5 Q8 4 9 4 L15 4 Q16 4 17 5 L19 8 L21 12 L21 14 L3 14 Z" fill="none" stroke="#f9c80e" stroke-width="1.4" stroke-linejoin="round"/><circle cx="7" cy="13" r="1.4" fill="#f9c80e"/><circle cx="17" cy="13" r="1.4" fill="#f9c80e"/></svg>'
      +         '<span class="vr-data-card-header-title">Learner permit</span>'
      +       '</div>'
      +       '<div class="vr-data-card-body">'
      +         '<div class="vr-data-row"><div class="vr-data-row-label">Expiry date</div><div class="vr-data-row-value">7/05/2035</div></div>'
      +         '<div class="vr-data-row"><div class="vr-data-row-label">Conditions</div><div class="vr-data-row-value">None</div></div>'
      +         '<div class="vr-data-row"><div class="vr-data-row-label">Licence status</div><div class="vr-data-row-value">Current</div></div>'
      +         '<div class="vr-data-row"><div class="vr-data-row-label">Licence type</div><div class="vr-data-row-value">Car</div></div>'
      +       '</div>'
      +     '</div>'
      +     '<div class="vr-info-box vr-info-box-yellow"><span style="display:flex;align-items:flex-start;gap:8px"><svg viewBox="0 0 22 22" width="18" height="18" style="flex-shrink:0;margin-top:1px" aria-hidden="true"><circle cx="11" cy="11" r="10" fill="#e6c34a"/><text x="11" y="16" text-anchor="middle" font-size="14" font-weight="800" fill="#fff" font-family="system-ui, sans-serif">i</text></svg><span>By submitting this form you agree to the terms and conditions outlined at the top of this page.</span></span></div>'
      +     '<hr class="vr-section-divider"/>'
      +     '<div class="vr-btn-row">'
      +       '<button class="vr-btn vr-btn-full" type="button">Continue <span class="vr-btn-arrow">→</span></button>'
      +       '<button class="vr-btn vr-btn-secondary vr-btn-full" type="button"><span class="vr-btn-arrow">←</span> Cancel</button>'
      +     '</div>'
      +   '</div>'
      + '</div>'
  };
})();
