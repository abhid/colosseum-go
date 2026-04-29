/* Colosseum presentation — reveal.js bootstrap + demo slide wiring. */

(function () {
  const DEFAULT_DEMO_URL = 'http://localhost:8001';
  const params = new URLSearchParams(window.location.search);
  const demoParam = (params.get('demo') || '').trim();

  // Resolve the demo origin. Special value "video" switches to the prerecorded fallback.
  const isVideoMode = demoParam.toLowerCase() === 'video';
  const demoURL = isVideoMode ? '' : (demoParam || DEFAULT_DEMO_URL);

  // Wire the demo slide once reveal is ready.
  document.addEventListener('DOMContentLoaded', () => {
    const frame = document.getElementById('demo-frame');
    const video = document.getElementById('demo-video');
    const dot = document.getElementById('demo-status-dot');
    const label = document.getElementById('demo-status-label');
    const urlLabel = document.getElementById('demo-url-label');
    const resetBtn = document.getElementById('demo-reset');

    if (isVideoMode) {
      if (frame) frame.style.display = 'none';
      if (video) video.style.display = 'block';
      if (label) label.textContent = 'prerecorded';
      if (dot) dot.classList.add('ok');
      if (urlLabel) urlLabel.textContent = 'fallback video';
    } else {
      if (frame) frame.src = demoURL;
      if (video) video.style.display = 'none';
      if (urlLabel) urlLabel.textContent = demoURL;
      pingDemo(demoURL, dot, label);
    }

    if (resetBtn && !isVideoMode && frame) {
      resetBtn.addEventListener('click', () => {
        frame.src = demoURL;
        pingDemo(demoURL, dot, label);
      });
    }
  });

  function pingDemo(url, dot, label) {
    if (!dot || !label) return;
    label.textContent = 'checking…';
    dot.classList.remove('ok', 'bad');
    // CORS will almost always block the response body; we only care whether
    // the request reaches the server at all. `mode: no-cors` + a timeout is
    // enough for a green/red indicator.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    fetch(url.replace(/\/+$/, '') + '/healthz', { mode: 'no-cors', signal: controller.signal })
      .then(() => {
        clearTimeout(timer);
        dot.classList.add('ok');
        label.textContent = 'connected';
      })
      .catch(() => {
        clearTimeout(timer);
        dot.classList.add('bad');
        label.textContent = 'unreachable';
      });
  }

  // Reveal.js initialization.
  window.addEventListener('load', () => {
    if (typeof Reveal === 'undefined') return;
    Reveal.initialize({
      hash: true,
      slideNumber: 'c/t',
      controls: true,
      progress: true,
      center: false,
      transition: 'fade',
      transitionSpeed: 'fast',
      width: 1280,
      height: 800,
      margin: 0.04,
      minScale: 0.3,
      maxScale: 2.0,
      pdfSeparateFragments: false,
      plugins: [RevealHighlight, RevealNotes],
    });
  });
})();
