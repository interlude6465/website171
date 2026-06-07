(function(){
  var ua = navigator.userAgent || '';
  var platform = navigator.platform || '';
  // Match iPhone/iPod explicitly. iPad is excluded per project requirements.
  var isIPhone = /iPhone|iPod/i.test(ua) || /iPhone|iPod/i.test(platform);
  if (isIPhone) return; // allowed — let the page load

  // Build the block screen and replace everything else.
  // Runs before DOMContentLoaded, so we haveto wait until the body exists.
  function paintBlock(){
    try {
      document.documentElement.innerHTML =
        '<head>' +
          '<meta charset="utf-8">' +
          '<meta name="viewport" content="width=device-width,initial-scale=1">' +
          '<title>iPhone only</title>' +
          '<style>' +
            'html,body{margin:0;padding:0;height:100%;background:#0b0b0f;color:#f2f2f7;' +
            'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;}' +
            '.gate{min-height:100%;display:flex;flex-direction:column;align-items:center;' +
            'justify-content:center;text-align:center;padding:32px 24px;box-sizing:border-box;}' +
            '.gate h1{font-size:28px;font-weight:700;margin:0 0 12px;letter-spacing:-0.5px;}' +
            '.gate p{font-size:16px;line-height:1.5;margin:0 0 8px;color:#c7c7cc;max-width:420px;}' +
            '.gate .icon{font-size:56px;margin-bottom:16px;}' +
          '</style>' +
        '</head>' +
        '<body><div class="gate">' +
          '<div class="icon">📱</div>' +
          '<h1>iPhone only</h1>' +
          '<p>This site is designed exclusively for iPhone.</p>' +
          '<p>Please open it on an iPhone to continue.</p>' +
        '</div></body>';
    } catch (e) {
      // Fallback if innerHTML on documentElement is blocked: stop the page.
      document.body && (document.body.innerHTML = '<div style="padding:40px;text-align:center;font-family:sans-serif;">This site is iPhone-only.</div>');
    }
    // Stop any further script execution from the original page.
    if (window.stop) { try { window.stop(); } catch(e){} }
  }

  if (document.readyState === 'loading') {
    // Paint as soon as the parser hits body; don't wait for full load.
    document.addEventListener('readystatechange', function once(){
      if (document.readyState !== 'loading') {document.removeEventListener('readystatechange', once);
        paintBlock();
      }
    });
  } else {
    paintBlock();
  }
})();
