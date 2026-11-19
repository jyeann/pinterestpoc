'use strict';
// Case file: the only behaviour is the print button. Everything else is server-rendered.
(function () {
  var btn = document.querySelector('[data-testid="case-print"]');
  if (!btn) return;
  btn.addEventListener('click', function () { window.print(); });
}());
