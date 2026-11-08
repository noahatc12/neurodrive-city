/**
 * Error boundary: uncaught exceptions and unhandled rejections show an overlay with the
 * message, a "copy details" button and a dismiss button, instead of a silently frozen
 * canvas.
 * @module ui/errorOverlay
 */
import { h } from './dom.ts';

let installed = false;

export function installErrorOverlay(): void {
  if (installed) return;
  installed = true;
  window.addEventListener('error', (e) =>
    show(e.error instanceof Error ? e.error : new Error(e.message)),
  );
  window.addEventListener('unhandledrejection', (e) => {
    const r: unknown = e.reason;
    show(r instanceof Error ? r : new Error(String(r)));
  });
}

function show(err: Error): void {
  if (document.querySelector('.error-overlay')) return;
  const details = `NeuroDrive City error\n${new Date().toISOString()}\n${navigator.userAgent}\n\n${err.stack ?? err.message}`;
  const copyBtn = h('button', {
    class: 'btn',
    text: 'Copy details',
    onclick: () => {
      void navigator.clipboard?.writeText(details).then(() => {
        copyBtn.textContent = 'Copied';
      });
    },
  });
  const overlay = h(
    'div',
    {
      class: 'overlay error-overlay open',
      role: 'alertdialog',
      aria: { modal: 'true', label: 'Unexpected error' },
    },
    h(
      'div',
      { class: 'help-dialog glass error-dialog' },
      h('h2', { text: 'Something went wrong' }),
      h('p', { class: 'error-msg', text: err.message }),
      h('pre', {
        class: 'error-stack',
        text: (err.stack ?? '').split('\n').slice(0, 8).join('\n'),
      }),
      h(
        'div',
        { class: 'error-actions' },
        copyBtn,
        h('button', { class: 'btn btn-ghost', text: 'Dismiss', onclick: () => overlay.remove() }),
      ),
    ),
  );
  document.body.append(overlay);
}
