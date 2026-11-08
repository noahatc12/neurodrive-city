import './ui/styles/tokens.css';
import './ui/styles/base.css';
import './ui/styles/components.css';
import { App } from './app/app.ts';
import { installErrorOverlay } from './ui/errorOverlay.ts';

/** Bootstraps the app inside an error boundary. */
function boot(): void {
  const root = document.getElementById('app');
  if (!root) throw new Error('#app root element missing');
  installErrorOverlay();
  const app = new App(root);
  void app.start();
}

boot();
