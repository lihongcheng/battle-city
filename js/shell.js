/* ============================================================
   BATTLE CITY · page shell
   Presentation, stage picker, pause/mute/fullscreen controls.
   The Famicom-accurate engine lives in game.js.
   ============================================================ */
(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const api = window.BCGame;
  const pad2 = (n) => String(n).padStart(2, '0');

  const screen = $('#screen');
  const soundBtn = $('#ui-sound');
  const soundLabel = $('#sound-label');
  const crtBtn = $('#ui-crt');
  const fsBtn = $('#ui-fullscreen');
  const pauseBtn = $('#ui-pause');
  const resumeBtn = $('#resume-button');
  const pauseOverlay = $('#pause-overlay');
  const statusText = $('#status-text');
  const statusLed = $('#status-led');
  const stageBadge = $('#stage-badge');
  const hiScoreEl = $('#hi-score');

  const stageOut = $('#stage-select');
  const stagePrev = $('#stage-prev');
  const stageNext = $('#stage-next');
  const stageProgress = $('#stage-progress');
  const start1P = $('#start-1p');
  const start2P = $('#start-2p');
  const openTitle = $('#open-title');
  const openBuild = $('#open-build');

  if (!api) {
    document.documentElement.classList.add('bc-error');
    const p = $('#loading p');
    if (p) p.textContent = 'ENGINE LOAD ERROR · 引擎载入失败';
    return;
  }

  // ── Stage picker ───────────────────────────────────────────────────────
  let selectedStage = 0;
  try {
    const saved = parseInt(localStorage.getItem('battlecity.startStage'), 10);
    if (Number.isFinite(saved)) selectedStage = Math.max(0, Math.min(34, saved - 1));
  } catch (e) {}

  function renderStage() {
    stageOut.textContent = pad2(selectedStage + 1);
    stageProgress.style.left = `${(selectedStage / 34) * 100}%`;
    try { localStorage.setItem('battlecity.startStage', String(selectedStage + 1)); } catch (e) {}
  }

  stagePrev.addEventListener('click', () => {
    selectedStage = (selectedStage + 34) % 35;
    renderStage();
  });
  stageNext.addEventListener('click', () => {
    selectedStage = (selectedStage + 1) % 35;
    renderStage();
  });
  renderStage();

  // ── Game launch ────────────────────────────────────────────────────────
  function focusCabinet() {
    if (window.matchMedia('(max-width: 1120px)').matches) {
      $('.cabinet')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  function blurActive() {
    const el = document.activeElement;
    if (el && typeof el.blur === 'function' && el !== document.body) el.blur();
  }

  function launch(players) {
    api.start(players, selectedStage);
    blurActive();
    focusCabinet();
  }

  start1P.addEventListener('click', () => launch(1));
  start2P.addEventListener('click', () => launch(2));
  openTitle.addEventListener('click', () => {
    api.title();
    blurActive();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  openBuild.addEventListener('click', () => {
    api.construction();
    blurActive();
    focusCabinet();
  });

  // ── Pause ──────────────────────────────────────────────────────────────
  function togglePause() {
    const s = api.getState();
    if (s.paused) api.resume();
    else if (s.phase === 'play' || s.phase === 'start') api.pause();
  }
  function resumeGame() {
    api.resume();
    blurActive();
  }
  pauseBtn.addEventListener('click', togglePause);
  resumeBtn.addEventListener('click', resumeGame);
  pauseOverlay.addEventListener('click', (e) => {
    if (e.target === pauseOverlay) resumeGame();
  });

  window.addEventListener('bc:pausechange', (e) => {
    const paused = !!(e.detail && e.detail.paused);
    pauseOverlay.setAttribute('aria-hidden', paused ? 'false' : 'true');
    if (paused) resumeBtn.focus({ preventScroll: true });
    else if (document.activeElement === resumeBtn) blurActive();
  });

  // ── Sound ──────────────────────────────────────────────────────────────
  function syncSound() {
    const muted = api.isMuted();
    soundBtn.classList.toggle('muted', muted);
    soundBtn.setAttribute('aria-pressed', muted ? 'false' : 'true');
    soundBtn.title = muted ? '声音已关闭 (M)' : '声音已开启 (M)';
    if (soundLabel) soundLabel.textContent = muted ? '静音' : '声音';
  }

  soundBtn.addEventListener('click', () => {
    api.toggleMute();
    syncSound();
  });
  window.addEventListener('bc:mutechange', syncSound);
  syncSound();

  // ── CRT scanlines ──────────────────────────────────────────────────────
  let crt = false;
  try { crt = localStorage.getItem('battlecity.crt') === '1'; } catch (e) {}
  function applyCRT() {
    screen.classList.toggle('crt', crt);
    crtBtn.setAttribute('aria-pressed', crt ? 'true' : 'false');
    crtBtn.title = crt ? '关闭 CRT 扫描线' : '开启 CRT 扫描线';
    try { localStorage.setItem('battlecity.crt', crt ? '1' : '0'); } catch (e) {}
  }
  crtBtn.addEventListener('click', () => { crt = !crt; applyCRT(); });
  applyCRT();

  // ── Fullscreen ─────────────────────────────────────────────────────────
  fsBtn.addEventListener('click', () => api.fullscreen());
  function syncFullscreen() {
    const on = !!(document.fullscreenElement || document.webkitFullscreenElement);
    const label = fsBtn.querySelector('span');
    if (label) label.textContent = on ? '退出' : '全屏';
    fsBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  document.addEventListener('fullscreenchange', syncFullscreen);
  document.addEventListener('webkitfullscreenchange', syncFullscreen);
  syncFullscreen();

  // ── Loading / engine events ────────────────────────────────────────────
  window.addEventListener('bc:error', (e) => {
    document.documentElement.classList.add('bc-error');
    const p = $('#loading p');
    if (p) p.textContent = `LOAD ERROR · ${e.detail || '像素图集载入失败'}`;
  });

  window.addEventListener('bc:start', () => {
    pauseOverlay.setAttribute('aria-hidden', 'true');
  });

  // ── Status strip ───────────────────────────────────────────────────────
  const PHASE_LABELS = {
    title: 'STANDBY',
    curtain: 'SYNC',
    select: 'STAGE SELECT',
    start: 'IN BATTLE',
    play: 'IN BATTLE',
    clear: 'STAGE CLEAR',
    gameover_tally: 'RESULT',
    gameover: 'GAME OVER',
    victory: 'VICTORY',
    edit: 'BUILD MODE'
  };

  let lastPhase = null;
  function updateStatus() {
    const s = api.getState();
    const phase = s.paused ? 'paused' : s.phase;
    const label = s.paused ? 'PAUSED' : (PHASE_LABELS[s.phase] || 'READY');

    if (phase !== lastPhase) {
      statusText.textContent = label;
      statusLed.classList.toggle('is-live', s.phase === 'title' || s.phase === 'select');
      statusLed.classList.toggle('is-play', !s.paused && (s.phase === 'play' || s.phase === 'start'));
      statusLed.classList.toggle('is-paused', s.paused);
      lastPhase = phase;
    }

    stageBadge.textContent = s.phase === 'edit' ? 'BUILD MODE' : `STAGE ${pad2(s.stage)}`;
    hiScoreEl.textContent = String(s.hiScore);

    const canPause = s.phase === 'play' || s.phase === 'start';
    pauseBtn.disabled = !(canPause || s.paused);
    const pauseLabel = s.paused ? '继续' : '暂停';
    if (pauseBtn.dataset.label !== pauseLabel) {
      pauseBtn.dataset.label = pauseLabel;
      pauseBtn.innerHTML = `${pauseLabel} <kbd>P</kbd>`;
    }
    pauseBtn.setAttribute('aria-label', s.paused ? '继续游戏' : '暂停游戏');
  }

  updateStatus();
  window.setInterval(updateStatus, 250);

  // ── Extra keyboard conveniences (do not override the original inputs) ──
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target && (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) || e.target.isContentEditable)) return;
    if (e.code === 'BracketLeft') {
      selectedStage = (selectedStage + 34) % 35;
      renderStage();
    } else if (e.code === 'BracketRight') {
      selectedStage = (selectedStage + 1) % 35;
      renderStage();
    }
  });

  // Keep the decorative LED lit once the pixel sheet has decoded.
  if (api.isReady()) {
    document.documentElement.classList.add('bc-ready');
  }
})();
