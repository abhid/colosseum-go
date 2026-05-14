/* Secure360 presentation — reveal.js bootstrap. */

(function () {
  window.addEventListener('load', () => {
    if (typeof Reveal === 'undefined') return;
    Reveal.initialize({
      hash: true,
      slideNumber: 'c/t',
      controls: true,
      progress: true,
      center: true,
      transition: 'fade',
      transitionSpeed: 'fast',
      autoAnimate: true,
      width: 1280,
      height: 800,
      margin: 0.08,
      minScale: 0.3,
      maxScale: 2.0,
      pdfSeparateFragments: false,
      plugins: [RevealHighlight, RevealNotes],
    });
  });
})();
