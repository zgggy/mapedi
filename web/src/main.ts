import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';

const target = document.getElementById('app')!;
target.innerHTML =
  '<div style="position:fixed;inset:0;display:grid;place-items:center;color:#9aa3b2;font:14px system-ui">启动中…</div>';

function showFatal(msg: string) {
  target.innerHTML =
    '<div style="position:fixed;inset:0;display:grid;place-items:center;padding:24px;color:#f0a0a0;font:13px/1.5 system-ui;white-space:pre-wrap">' +
    String(msg).replace(/</g, '&lt;') +
    '</div>';
  console.error(msg);
}

window.addEventListener('error', (e) => showFatal(String(e.error ?? e.message)));
window.addEventListener('unhandledrejection', (e) => showFatal(String(e.reason)));

try {
  mount(App, { target });
} catch (e) {
  showFatal(e instanceof Error ? e.stack || e.message : String(e));
}
