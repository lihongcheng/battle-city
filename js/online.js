/* ============================================================
   BATTLE CITY · two-phone link play (host side)
   The host runs the game and P1. A second phone joins as a
   PeerJS data controller and receives a live canvas video feed.
   ============================================================ */
(() => {
  'use strict';

  const api = window.BCGame;
  if (!api) return;

  const PREFIX = 'bcity2p-';
  const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  const $ = (sel) => document.querySelector(sel);

  const modal       = $('#online-modal');
  const openBtn     = $('#open-online');
  const closeBtn    = $('#online-close');
  const qrEl        = $('#online-qr');
  const codeEl      = $('#online-code');
  const urlEl       = $('#online-url');
  const copyBtn     = $('#online-copy');
  const shareBtn    = $('#online-share');
  const statusEl    = $('#online-status');
  const statusText  = $('#online-status-text');
  const startBtn    = $('#online-start');
  const disconnect  = $('#online-disconnect');
  const resync      = $('#online-resync');
  const badge       = $('#online-badge');
  const toastEl     = $('#online-toast');

  if (!modal || !openBtn) return;

  let peer = null;
  let conn = null;
  let mediaCall = null;
  let videoStream = null;
  let mirrorCanvas = null;
  let mirrorCtx = null;
  let mirrorTimer = 0;
  let roomCode = '';
  let joinUrl = '';
  let connected = false;
  let started = false;
  let watchdog = 0;
  let stateTimer = 0;
  let toastTimer = 0;
  let lastRemoteAt = 0;
  let peerRetry = 0;
  let disposed = false;
  let hostWakeLock = null;

  function showToast(message, isError = false) {
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.classList.toggle('error', !!isError);
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 3200);
  }

  function setStatus(text, state = '') {
    if (statusText) statusText.textContent = text;
    if (statusEl) {
      statusEl.classList.remove('is-waiting', 'is-connected', 'is-error');
      if (state) statusEl.classList.add(state);
    }
  }

  function setStartEnabled(on) {
    if (startBtn) startBtn.disabled = !on;
  }

  async function keepHostAwake() {
    if (!('wakeLock' in navigator) || hostWakeLock) return;
    try { hostWakeLock = await navigator.wakeLock.request('screen'); } catch (e) {}
  }

  function setBadge(on) {
    if (!badge) return;
    badge.hidden = !on;
  }

  function setRoomCode(code) {
    roomCode = code;
    if (codeEl) codeEl.textContent = code || '----';
    joinUrl = new URL('remote.html', window.location.href);
    joinUrl.searchParams.set('room', code);
    joinUrl.searchParams.set('v', '20261024f');
    joinUrl = joinUrl.href;
    if (urlEl) urlEl.value = joinUrl;
    renderQR(joinUrl);
  }

  function renderQR(url) {
    if (!qrEl) return;
    if (!window.qrcode) {
      qrEl.innerHTML = '<div class="online-qr-empty">QR 组件未载入<br>请使用链接加入</div>';
      return;
    }
    try {
      const qr = qrcode(0, 'M');
      qr.addData(url);
      qr.make();
      qrEl.innerHTML = qr.createSvgTag(4, 4);
    } catch (e) {
      qrEl.innerHTML = '<div class="online-qr-empty">二维码生成失败<br>请复制下方链接</div>';
    }
  }

  function randomCode(length = 6) {
    const bytes = new Uint8Array(length);
    if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(bytes);
    else for (let i = 0; i < length; i++) bytes[i] = Math.random() * 256;
    let out = '';
    for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
    return out;
  }

  function sendState() {
    if (!connected || !conn || !conn.open) return;
    try {
      const state = api.getState();
      conn.send({ t: 'state', phase: state.phase, paused: state.paused });
    } catch (e) {}
  }

  function startStateUpdates() {
    clearInterval(stateTimer);
    sendState();
    stateTimer = setInterval(sendState, 500);
  }

  function cleanupMedia() {
    if (mirrorTimer) { clearInterval(mirrorTimer); mirrorTimer = 0; }
    if (mediaCall) {
      try { mediaCall.close(); } catch (e) {}
      mediaCall = null;
    }
    if (videoStream) {
      try { videoStream.getTracks().forEach(t => t.stop()); } catch (e) {}
      videoStream = null;
    }
  }

  function resetConnection() {
    connected = false;
    setStartEnabled(false);
    safeClearInput();
    cleanupMedia();
    clearInterval(stateTimer);
    stateTimer = 0;
  }

  function safeClearInput() {
    try { api.clearRemoteInput(); } catch (e) {}
  }

  function wireConnection(c) {
    if (conn && conn !== c && conn.open) {
      try { c.close(); } catch (e) {}
      return;
    }
    conn = c;
    c.on('open', () => {
      connected = true;
      peerRetry = 0;
      setStatus('玩家 2 已连接 · 正在同步画面…', 'is-connected');
      setStartEnabled(true);
      setBadge(true);
      if (resync) resync.hidden = false;
      if (started) startVideoCall();
      else setStatus('玩家 2 已连接 · 等待开始', 'is-connected');
      startStateUpdates();
      showToast('玩家 2 已连接');
    });
    c.on('data', (msg) => {
      if (!msg || typeof msg !== 'object') return;
      lastRemoteAt = Date.now();
      if (msg.t === 'input') {
        api.setRemoteInput(msg);
      } else if (msg.t === 'fire') {
        if (typeof api.queueRemoteFire === 'function') api.queueRemoteFire();
      } else if (msg.t === 'action' && msg.action === 'pause') {
        if (started) api.togglePause();
      } else if (msg.t === 'video-request') {
        if (started) {
          setStatus('正在重新同步画面…', 'is-waiting');
          startVideoCall();
        }
      }
    });
    c.on('close', () => {
      if (conn === c) {
        connected = false;
        setStartEnabled(false);
        setBadge(false);
        if (resync) resync.hidden = true;
        setStatus('玩家 2 已断开 · 可让其重新加入', 'is-error');
        safeClearInput();
        cleanupMedia();
        clearInterval(stateTimer);
        stateTimer = 0;
        showToast('玩家 2 已断开', true);
      }
    });
    c.on('error', () => {
      if (conn === c) setStatus('玩家 2 连接异常', 'is-error');
    });
  }

  function getMirrorStream() {
    const gameCanvas = document.getElementById('game');
    if (!gameCanvas) return null;
    if (!mirrorCanvas) {
      mirrorCanvas = document.createElement('canvas');
      mirrorCanvas.width = 384;
      mirrorCanvas.height = 360;
      mirrorCtx = mirrorCanvas.getContext('2d');
      if (mirrorCtx) mirrorCtx.imageSmoothingEnabled = false;
    }
    if (!mirrorCanvas.captureStream) return null;
    if (mirrorTimer) { clearInterval(mirrorTimer); mirrorTimer = 0; }
    const draw = () => {
      try { mirrorCtx.drawImage(gameCanvas, 0, 0, mirrorCanvas.width, mirrorCanvas.height); } catch (e) {}
    };
    draw();
    mirrorTimer = setInterval(draw, 1000 / 24);
    return mirrorCanvas.captureStream(24);
  }

  function capVideoSender() {
    setTimeout(() => {
      try {
        const pc = mediaCall && mediaCall.peerConnection;
        if (!pc) return;
        const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
        if (!sender || !sender.getParameters || !sender.setParameters) return;
        const params = sender.getParameters();
        if (!params.encodings || !params.encodings.length) params.encodings = [{}];
        params.encodings[0].maxBitrate = 600000;
        params.encodings[0].maxFramerate = 24;
        sender.setParameters(params).catch(() => {});
      } catch (e) {}
    }, 600);
  }

  function startVideoCall() {
    cleanupMedia();
    if (!peer || !conn || !conn.open) return;
    if (typeof HTMLCanvasElement === 'undefined') return;
    try {
      // Capture a dedicated 512×480 mirror instead of the 768×720 game canvas:
      // lighter to encode on phones and still pin-sharp for this pixel game.
      videoStream = getMirrorStream();
      if (!videoStream) {
        setStatus('已连接 · 当前浏览器不支持画面同步，请看主机屏幕', 'is-error');
        return;
      }
      const track = videoStream.getVideoTracks()[0];
      if (track && 'contentHint' in track) track.contentHint = 'motion';
      mediaCall = peer.call(conn.peer, videoStream);
      if (mediaCall) capVideoSender();
      if (!mediaCall) {
        setStatus('已连接 · 画面同步未建立，请看主机屏幕', 'is-error');
        return;
      }
      mediaCall.on('stream', () => {
        setStatus('玩家 2 已连接 · 画面已同步', 'is-connected');
      });
      mediaCall.on('error', () => {
        setStatus('已连接 · 画面同步失败，请看主机屏幕', 'is-error');
      });
      mediaCall.on('close', () => {
        // The input data channel can remain usable even if video ends.
      });
    } catch (e) {
      setStatus('已连接 · 画面同步失败，请看主机屏幕', 'is-error');
    }
  }

  function createRoom() {
    if (disposed) return;
    if (!window.isSecureContext) {
      setStatus('联机需要 HTTPS 页面（GitHub Pages 可直接使用）', 'is-error');
      setStartEnabled(false);
      return;
    }
    if (!window.Peer) {
      setStatus('PeerJS 未载入，无法联机', 'is-error');
      setStartEnabled(false);
      return;
    }

    const code = randomCode(6);
    setRoomCode(code);
    setStatus('正在建立房间…', 'is-waiting');
    setStartEnabled(false);
    if (resync) resync.hidden = true;

    try {
      peer = new Peer(PREFIX + code.toLowerCase(), { debug: 1 });
    } catch (e) {
      setStatus('无法初始化联机组件', 'is-error');
      return;
    }

    peer.on('open', () => {
      setStatus('等待玩家 2 加入 · 扫码或输入房间码', 'is-waiting');
    });

    peer.on('connection', wireConnection);

    peer.on('error', (err) => {
      const type = err && err.type;
      if (type === 'peer-unavailable') {
        setStatus('玩家 2 尚未加入，请重试', 'is-error');
      } else if (type === 'unavailable-id' && peerRetry < 3) {
        peerRetry++;
        try { peer.destroy(); } catch (e) {}
        peer = null;
        setTimeout(createRoom, 350);
      } else if (type === 'network' || type === 'server-error' || type === 'socket-error') {
        setStatus('无法连接配对服务器，请检查网络后重新打开联机', 'is-error');
        setStartEnabled(false);
      } else if (type === 'webrtc') {
        setStatus('视频同步失败；数据连接仍可用于操控', 'is-error');
      } else {
        setStatus(`联机错误：${type || 'unknown'}`, 'is-error');
      }
    });

    peer.on('disconnected', () => {
      if (peer && !peer.destroyed) {
        setStatus('配对服务器连接断开，正在重连…', 'is-error');
        setTimeout(() => {
          if (peer && !peer.destroyed) { try { peer.reconnect(); } catch (e) {} }
        }, 1200);
      }
    });
  }

  function destroySession(showMessage = true) {
    cleanupMedia();
    if (conn) { try { conn.close(); } catch (e) {} conn = null; }
    if (peer) { try { peer.destroy(); } catch (e) {} peer = null; }
    connected = false;
    started = false;
    roomCode = '';
    joinUrl = '';
    if (watchdog) { clearInterval(watchdog); watchdog = 0; }
    clearInterval(stateTimer);
    stateTimer = 0;
    api.setRemoteMode(false);
    safeClearInput();
    setStartEnabled(false);
    setBadge(false);
    if (resync) resync.hidden = true;
    setRoomCode('');
    setStatus('联机已断开', '');
    if (hostWakeLock) { try { hostWakeLock.release(); } catch (e) {} hostWakeLock = null; }
    if (showMessage) showToast('已断开手机联机');
  }

  function openLobby() {
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('online-open');
    if (startBtn) startBtn.textContent = started ? '重新开始 2P 联机对战' : '开始 2P 联机对战';
    if (!peer || peer.destroyed) createRoom();
    else if (connected) setStartEnabled(true);
    setTimeout(() => { try { closeBtn && closeBtn.focus(); } catch (e) {} }, 50);
  }

  function closeLobby() {
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('online-open');
    try { openBtn.focus({ preventScroll: true }); } catch (e) {}
  }

  function startOnlineGame() {
    if (!connected) return;
    const stageText = document.getElementById('stage-select')?.textContent || '01';
    const stageNumber = parseInt(stageText, 10);
    const stageIndex = Number.isFinite(stageNumber) ? Math.max(0, Math.min(34, stageNumber - 1)) : 0;
    api.setRemoteMode(true);
    api.clearRemoteInput();
    startVideoCall();
    api.start(2, stageIndex);
    started = true;
    setBadge(true);
    setStatus('联机对战进行中 · P2 已连接', 'is-connected');
    startStateUpdates();
    closeLobby();
    try { document.activeElement && document.activeElement.blur(); } catch (e) {}
    if (window.matchMedia('(max-width: 1120px)').matches) {
      document.querySelector('.cabinet')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    keepHostAwake();
    showToast('联机对战开始 · P1 本机 / P2 副机');
  }

  async function copyLink() {
    if (!joinUrl) return;
    try {
      await navigator.clipboard.writeText(joinUrl);
      showToast('邀请链接已复制');
    } catch (e) {
      try {
        urlEl.focus(); urlEl.select();
        document.execCommand('copy');
        showToast('邀请链接已复制');
      } catch (err) {
        showToast('复制失败，请手动选择链接', true);
      }
    }
  }

  async function shareLink() {
    if (!joinUrl) return;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'BATTLE CITY 双人联机', text: '用这台手机加入我的坦克大战房间', url: joinUrl });
        return;
      } catch (e) {
        if (e && e.name === 'AbortError') return;
      }
    }
    copyLink();
  }

  openBtn.addEventListener('click', openLobby);
  closeBtn.addEventListener('click', closeLobby);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeLobby(); });
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && modal.classList.contains('is-open')) closeLobby();
  });
  startBtn.addEventListener('click', startOnlineGame);
  disconnect.addEventListener('click', () => {
    destroySession(true);
    closeLobby();
  });
  copyBtn.addEventListener('click', copyLink);
  shareBtn.addEventListener('click', shareLink);
  if (resync) resync.addEventListener('click', () => {
    if (!connected) return;
    setStatus('正在重新同步画面…', 'is-waiting');
    startVideoCall();
    showToast('已请求重新同步画面');
  });

  // If P2 goes quiet while the link is live, release their controls so a
  // dropped Wi-Fi packet cannot leave a tank driving forever.
  watchdog = setInterval(() => {
    if (connected && api.isRemoteMode() && lastRemoteAt && Date.now() - lastRemoteAt > 900) {
      safeClearInput();
    }
  }, 350);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && started && connected) keepHostAwake();
  });

  window.addEventListener('pagehide', () => { disposed = true; destroySession(false); });

  // Expose a tiny diagnostic surface for the page shell / debugging.
  window.BattleCityOnline = {
    isConnected: () => connected,
    getRoom: () => roomCode,
    open: openLobby,
    close: closeLobby,
    start: startOnlineGame
  };
})();
