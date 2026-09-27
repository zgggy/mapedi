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

/** 运行期错误：状态提示 + 继续运行（不杀死应用）；同一消息 5 秊内不重复 */
let lastNoticeAt = 0;
let lastNoticeMsg = '';
function showNonFatal(msg: string) {
  console.error(msg);
  const now = Date.now();
  if (msg === lastNoticeMsg && now - lastNoticeAt < 5000) return;
  lastNoticeAt = now;
  lastNoticeMsg = msg;
  import('./app/store.svelte')
    .then((m) => {
      m.editor.status = `⚠️ 运行错误（已忽略）：${String(msg).slice(0, 120)}`;
      m.editor.touchView();
    })
    .catch(() => {});
}

// 挂载失败才是致命错误；运行期错误走状态提示
window.addEventListener('error', (e) => showNonFatal(String(e.error ?? e.message)));
window.addEventListener('unhandledrejection', (e) => showNonFatal(String(e.reason)));

try {
  // mount 是追加不是清空：先移除启动占位，否则「启动中…」会以 fixed 全屏残留（层序错误 / 挡交互）
  target.innerHTML = '';
  mount(App, { target });
} catch (e) {
  showFatal(e instanceof Error ? e.stack || e.message : String(e));
}
