/* ============================================================
   BATTLE CITY · Player 2 link controller
   Connects to the host lobby with PeerJS, receives the live
   canvas video feed, and streams P2 input back over a data channel.
   ============================================================ */
(() => {
  'use strict';

  const PREFIX = 'bcity2p-';
  const ROOM_RE = /^[2-9A-HJ-NP-Z]{6}$/;
  const $ = (sel) => document.querySelector(sel);

  const joinPanel     = $('#join-panel');
  const controller    = $('#controller-panel');
  const joinForm      = $('#join-form');
  const roomInput     = $('#room-input');
  const joinBtn       = $('#join-btn');
  const joinStatus    = $('#join-status');
  const joinStatusTxt = $('#join-status-text');
  const roomPill      = $('#room-pill');
  const roomPillCode  = $('#room-pill-code');
  const disconnectBtn = $('#remote-disconnect');
  const disconnect2   = $('#remote-disconnect-2');
  const video         = $('#game-video');
  const placeholder   = $('#video-placeholder');
  const placeholderText = $('#video-placeholder-text');
  const videoPlay     = $('#video-play');
  const videoRetry    = $('#video-retry');
  const dpad          = $('#dpad');
  const fireBtn       = $('#btn-fire');
  const pauseBtn      = $('#btn-pause');
  const linkState     = $('#link-state');
  const toast         = $('#remote-toast');

  let peer = null;
  let peerPromise = null;
  let conn = null;
  let mediaCall = null;
  let room = '';
  let connected = false;
  let connecting = false;
  let connectTimer = 0;
  let sendTimer = 0;
  let toastTimer = 0;
  let wakeLock = null;
  let dummyStream = null;

  const input = { up: false, down: false, left: false, right: false, fire: false };
  let dpadPointerId = null;
  let dpadReleaseTimer = 0;
  let fireReleaseTimer = 0;

  function showToast(message, isError = false) {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.toggle('error', !!isError);
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 3000);
  }

  function setJoinStatus(text, state = '') {
    if (joinStatusTxt) joinStatusTxt.textContent = text;
    if (joinStatus) {
      joinStatus.classList.remove('is-waiting', 'is-error', 'is-connected');
      if (state) joinStatus.classList.add(state);
    }
  }

  function setConnecting(on) {
    connecting = on;
    if (joinBtn) joinBtn.disabled = on;
    if (roomInput) roomInput.disabled = on;
  }

  function validRoom(code) {
    return ROOM_RE.test(String(code || '').toUpperCase());
  }

  function sanitizeRoom(value) {
    return String(value || '').toUpperCase().replace(/[^2-9A-HJ-NP-Z]/g, '').slice(0, 6);
  }

  function sendInput() {
    if (!connected || !conn || !conn.open) return;
    try { conn.send({ t: 'input', ...input }); } catch (e) {}
  }

  function clearInput(immediate = false) {
    input.up = input.down = input.left = input.right = input.fire = false;
    clearTimeout(dpadReleaseTimer);
    clearTimeout(fireReleaseTimer);
    document.querySelectorAll('.dpad-arr.active').forEach(el => el.classList.remove('active'));
    fireBtn && fireBtn.classList.remove('pressed');
    if (immediate) sendInput();
  }

  function resetVideo() {
    if (mediaCall) { try { mediaCall.close(); } catch (e) {} mediaCall = null; }
    if (video) {
      try { video.pause(); } catch (e) {}
      video.srcObject = null;
    }
    if (placeholder) {
      placeholder.hidden = false;
      if (placeholderText) placeholderText.textContent = '已连接，等待主机开始…';
    }
    if (videoPlay) videoPlay.hidden = true;
    if (videoRetry) videoRetry.hidden = true;
  }

  function dismissDisconnected(message) {
    connected = false;
    clearTimeout(connectTimer);
    clearTimeout(sendTimer);
    if (conn) { try { conn.close(); } catch (e) {} conn = null; }
    clearInput(true);
    resetVideo();
    if (roomPill) roomPill.hidden = true;
    if (disconnectBtn) disconnectBtn.hidden = true;
    if (disconnect2) disconnect2.hidden = true;
    if (controller) controller.hidden = true;
    if (joinPanel) joinPanel.hidden = false;
    setConnecting(false);
    if (message) setJoinStatus(message, 'is-error');
    try { joinBtn && joinBtn.focus({ preventScroll: true }); } catch (e) {}
  }

  function handlePeerError(err) {
    const type = err && err.type;
    if (type === 'peer-unavailable') {
      dismissDisconnected('房间不存在或主机尚未创建联机房间');
    } else if (type === 'network' || type === 'server-error' || type === 'socket-error') {
      dismissDisconnected('无法连接配对服务器，请检查网络后重试');
    } else if (type === 'unavailable-id') {
      // Random controller IDs should be unique; recreate once if needed.
      peer = null; peerPromise = null;
      dismissDisconnected('连接标识冲突，请重试');
    } else if (type === 'webrtc') {
      showToast('画面同步失败，但控制仍可用', true);
    } else if (type !== 'peer-unavailable') {
      dismissDisconnected(`联机错误：${type || 'unknown'}`);
    }
  }

  function ensurePeer() {
    if (peer && !peer.destroyed) {
      if (peer.open) return Promise.resolve(peer);
      return peerPromise || new Promise((resolve, reject) => {
        const to = setTimeout(() => reject(new Error('timeout')), 10000);
        peer.once('open', () => { clearTimeout(to); resolve(peer); });
      });
    }
    if (!window.Peer) return Promise.reject(new Error('no-peerjs'));
    if (!window.isSecureContext) return Promise.reject(new Error('insecure'));
    peerPromise = new Promise((resolve, reject) => {
      try { peer = new Peer({ debug: 1 }); }
      catch (e) { reject(e); return; }
      const to = setTimeout(() => reject(new Error('timeout')), 12000);
      peer.once('open', () => { clearTimeout(to); resolve(peer); });
      peer.on('error', handlePeerError);
      peer.on('disconnected', () => {
        if (peer && !peer.destroyed) setTimeout(() => { try { peer.reconnect(); } catch (e) {} }, 1000);
      });
      peer.on('call', onIncomingCall);
    });
    return peerPromise;
  }

  function makeDummyStream() {
    if (dummyStream) return dummyStream;
    try {
      const c = document.createElement('canvas');
      c.width = 2; c.height = 2;
      if (c.captureStream) dummyStream = c.captureStream(1);
    } catch (e) {}
    return dummyStream;
  }

  function markVideoPlaying() {
    if (placeholder) placeholder.hidden = true;
    if (videoPlay) videoPlay.hidden = true;
    if (videoRetry) videoRetry.hidden = true;
    if (linkState) linkState.textContent = '画面已同步';
  }

  function showPlayPrompt() {
    if (placeholder) placeholder.hidden = true;
    if (videoPlay) videoPlay.hidden = false;
    if (linkState) linkState.textContent = '点击播放画面';
  }

  function attemptVideoPlay() {
    if (!video || !video.srcObject) return;
    video.muted = true;
    try {
      const p = video.play();
      if (p && typeof p.then === 'function') {
        p.then(markVideoPlaying).catch(showPlayPrompt);
      } else if (!video.paused) {
        markVideoPlaying();
      } else {
        showPlayPrompt();
      }
    } catch (e) {
      showPlayPrompt();
    }
  }

  function onIncomingCall(call) {
    if (mediaCall) { try { mediaCall.close(); } catch (e) {} }
    mediaCall = call;

    // Register stream handling BEFORE answering: some mobile WebRTC stacks can
    // deliver the remote stream immediately after answer().
    call.on('stream', (stream) => {
      if (!video) return;
      video.srcObject = stream;
      video.muted = true;
      if (placeholder) placeholder.hidden = true;
      attemptVideoPlay();
      // Some browsers only allow MediaStream playback after a tap; retry once
      // the next frame has arrived as well.
      setTimeout(attemptVideoPlay, 500);
    });
    call.on('close', () => {
      if (placeholder) {
        placeholder.hidden = false;
        if (placeholderText) placeholderText.textContent = '画面同步已停止';
      }
      if (videoPlay) videoPlay.hidden = true;
      if (videoRetry) videoRetry.hidden = false;
      if (linkState) linkState.textContent = '画面中断';
    });
    call.on('error', () => {
      if (placeholder) {
        placeholder.hidden = false;
        if (placeholderText) placeholderText.textContent = '画面同步失败';
      }
      if (videoPlay) videoPlay.hidden = true;
      if (videoRetry) videoRetry.hidden = false;
      if (linkState) linkState.textContent = '画面同步失败';
    });

    // Prefer a receive-only answer. If this PeerJS build insists on an answer
    // stream, fall back to a tiny muted canvas stream.
    try {
      call.answer();
    } catch (e) {
      try { call.answer(makeDummyStream() || undefined); } catch (err) {}
    }
  }

  video && video.addEventListener('playing', markVideoPlaying);
  video && video.addEventListener('loadeddata', () => {
    if (!video.paused) markVideoPlaying();
  });
  video && video.addEventListener('pause', () => {
    if (connected && video.srcObject) showPlayPrompt();
  });
  video && video.addEventListener('click', attemptVideoPlay);
  videoRetry && videoRetry.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!connected || !conn || !conn.open) return;
    try { conn.send({ t: 'video-request' }); } catch (err) {}
    if (placeholderText) placeholderText.textContent = '已请求主机重新同步画面…';
    if (videoRetry) videoRetry.hidden = true;
    if (linkState) linkState.textContent = '请求同步中';
    setTimeout(() => { if (!video || !video.srcObject) { if (videoRetry) videoRetry.hidden = false; } }, 4000);
  });

  videoPlay && videoPlay.addEventListener('click', (e) => {
    e.stopPropagation();
    attemptVideoPlay();
    setTimeout(() => {
      if (video && !video.paused) markVideoPlaying();
      else showToast('无法自动播放，请刷新页面后重试', true);
    }, 450);
  });

  function goOnline() {
    connected = true;
    setConnecting(false);
    clearTimeout(connectTimer);
    if (joinPanel) joinPanel.hidden = true;
    if (controller) controller.hidden = false;
    if (roomPill) { roomPill.hidden = false; roomPillCode.textContent = room; }
    const deckRoom = document.getElementById('deck-room');
    if (deckRoom) deckRoom.textContent = `ROOM ${room}`;
    if (disconnectBtn) disconnectBtn.hidden = false;
    if (disconnect2) disconnect2.hidden = false;
    if (placeholder) { placeholder.hidden = false; if (placeholderText) placeholderText.textContent = '已连接，等待主机开始…'; }
    if (videoPlay) videoPlay.hidden = true;
    if (videoRetry) videoRetry.hidden = true;
    if (linkState) linkState.textContent = '已连接 · 等待画面';
    setJoinStatus('已连接到主机', 'is-connected');
    clearTimeout(sendTimer);
    sendTimer = setInterval(sendInput, 33);
    requestWakeLock();
    showToast('已连接主机，等待开始');
  }

  function joinRoom(code) {
    const wanted = sanitizeRoom(code);
    if (!validRoom(wanted)) {
      setJoinStatus('请输入 6 位房间码', 'is-error');
      roomInput && roomInput.focus();
      return;
    }
    if (connecting || connected) return;
    room = wanted;
    if (roomInput) roomInput.value = wanted;
    setConnecting(true);
    setJoinStatus(`正在加入 ${wanted}…`, 'is-waiting');

    ensurePeer().then((p) => {
      if (connected) return;
      let c;
      try {
        c = p.connect(PREFIX + wanted.toLowerCase(), { reliable: true, serialization: 'json' });
      } catch (e) {
        setConnecting(false);
        setJoinStatus('无法创建连接，请重试', 'is-error');
        return;
      }
      conn = c;
      c.on('open', () => {
        if (conn !== c) return;
        clearTimeout(connectTimer);
        goOnline();
      });
      c.on('data', (msg) => {
        if (!msg || typeof msg !== 'object') return;
        if (msg.t === 'state') {
          if (msg.paused) linkState && (linkState.textContent = '主机已暂停');
          else if (msg.phase === 'play') {
            if (!video || !video.srcObject) {
              if (placeholder) placeholder.hidden = false;
              if (placeholderText) placeholderText.textContent = '主机已开始，正在同步画面…';
              if (videoRetry) videoRetry.hidden = false;
              if (linkState) linkState.textContent = '正在同步画面';
            }
          }
          else if (msg.phase === 'title') linkState && (linkState.textContent = '等待主机开始');
        }
      });
      c.on('close', () => {
        if (conn === c) {
          conn = null;
          dismissDisconnected('与主机的连接已断开，请重新加入');
          showToast('连接已断开', true);
        }
      });
      c.on('error', () => {
        if (conn === c) {
          conn = null;
          dismissDisconnected('连接失败，请确认房间码后重试');
        }
      });
      connectTimer = setTimeout(() => {
        if (conn && !conn.open) {
          try { conn.close(); } catch (e) {}
          conn = null;
          dismissDisconnected('主机未响应，请确认房间码或让主机重新创建房间');
        }
      }, 12000);
    }).catch((err) => {
      setConnecting(false);
      if (peer) { try { peer.destroy(); } catch (e) {} peer = null; }
      peerPromise = null;
      if (String(err && err.message) === 'insecure') {
        setJoinStatus('联机需要 HTTPS 页面（GitHub Pages 可直接使用）', 'is-error');
      } else if (String(err && err.message) === 'no-peerjs') {
        setJoinStatus('PeerJS 未载入，无法联机', 'is-error');
      } else {
        setJoinStatus('连接配对服务器超时，请检查网络后重试', 'is-error');
      }
    });
  }

  function disconnect() {
    if (conn) { try { conn.close(); } catch (e) {} conn = null; }
    if (peer) { try { peer.destroy(); } catch (e) {} peer = null; peerPromise = null; }
    if (wakeLock) { try { wakeLock.release(); } catch (e) {} wakeLock = null; }
    dismissDisconnected('已断开，可重新输入房间码加入');
    showToast('已断开联机');
  }

  async function requestWakeLock() {
    if (!('wakeLock' in navigator) || wakeLock) return;
    try { wakeLock = await navigator.wakeLock.request('screen'); } catch (e) {}
  }

  // ── D-pad (P2) ─────────────────────────────────────────────────────
  const dirKeys = ['up', 'down', 'left', 'right'];
  const arrEls = {
    up: dpad && dpad.querySelector('.up'), down: dpad && dpad.querySelector('.dn'),
    left: dpad && dpad.querySelector('.lt'), right: dpad && dpad.querySelector('.rt')
  };

  function setDirection(dir) {
    dirKeys.forEach(k => { input[k] = k === dir; });
    Object.entries(arrEls).forEach(([k, el]) => el && el.classList.toggle('active', k === dir));
    sendInput();
  }

  function clearDirectionsSoon() {
    clearTimeout(dpadReleaseTimer);
    dpadReleaseTimer = setTimeout(() => {
      dirKeys.forEach(k => { input[k] = false; });
      Object.values(arrEls).forEach(el => el && el.classList.remove('active'));
      sendInput();
    }, 60);
  }

  function applyPointer(clientX, clientY) {
    if (!dpad) return;
    const r = dpad.getBoundingClientRect();
    const dx = clientX - (r.left + r.width / 2);
    const dy = clientY - (r.top + r.height / 2);
    if (Math.hypot(dx, dy) < r.width * 0.12) {
      dirKeys.forEach(k => { input[k] = false; });
      Object.values(arrEls).forEach(el => el && el.classList.remove('active'));
      sendInput();
      return;
    }
    const a = Math.atan2(dy, dx) * 180 / Math.PI;
    if (a >= -135 && a < -45) setDirection('up');
    else if (a >= -45 && a < 45) setDirection('right');
    else if (a >= 45 && a < 135) setDirection('down');
    else setDirection('left');
  }

  if (dpad) {
    dpad.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (dpadPointerId !== null) return;
      dpadPointerId = e.pointerId;
      try { dpad.setPointerCapture(e.pointerId); } catch (err) {}
      clearTimeout(dpadReleaseTimer);
      applyPointer(e.clientX, e.clientY);
    });
    dpad.addEventListener('pointermove', (e) => {
      if (e.pointerId !== dpadPointerId) return;
      e.preventDefault();
      clearTimeout(dpadReleaseTimer);
      applyPointer(e.clientX, e.clientY);
    });
    const end = (e) => {
      if (dpadPointerId !== null && e.pointerId !== dpadPointerId) return;
      dpadPointerId = null;
      clearDirectionsSoon();
    };
    dpad.addEventListener('pointerup', end);
    dpad.addEventListener('pointercancel', end);
    dpad.addEventListener('lostpointercapture', end);
  }

  if (fireBtn) {
    const releaseFire = (e) => {
      if (fireBtn._pointerId !== undefined && e && e.pointerId !== fireBtn._pointerId) return;
      fireBtn._pointerId = undefined;
      clearTimeout(fireReleaseTimer);
      fireReleaseTimer = setTimeout(() => {
        input.fire = false;
        fireBtn.classList.remove('pressed');
        sendInput();
      }, 90);
    };
    fireBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      fireBtn._pointerId = e.pointerId;
      try { fireBtn.setPointerCapture(e.pointerId); } catch (err) {}
      clearTimeout(fireReleaseTimer);
      input.fire = true;
      fireBtn.classList.add('pressed');
      sendInput();
      if (navigator.vibrate) { try { navigator.vibrate(8); } catch (err) {} }
    });
    fireBtn.addEventListener('pointerup', releaseFire);
    fireBtn.addEventListener('pointercancel', releaseFire);
    fireBtn.addEventListener('lostpointercapture', releaseFire);
  }

  if (pauseBtn) {
    pauseBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (connected && conn && conn.open) conn.send({ t: 'action', action: 'pause' });
      showToast('已发送暂停/继续');
    });
  }

  // ── Form / connection UI ──────────────────────────────────────────
  roomInput && roomInput.addEventListener('input', () => {
    roomInput.value = sanitizeRoom(roomInput.value);
  });

  joinForm && joinForm.addEventListener('submit', (e) => {
    e.preventDefault();
    joinRoom(roomInput.value);
  });

  [disconnectBtn, disconnect2].forEach(btn => {
    if (!btn) return;
    btn.addEventListener('click', disconnect);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      clearInput();
      sendInput();
    } else if (connected) {
      requestWakeLock();
    }
  });

  window.addEventListener('pagehide', () => {
    if (conn) { try { conn.close(); } catch (e) {} }
    if (peer) { try { peer.destroy(); } catch (e) {} }
  });

  // Auto-join from the QR / shared invite link.
  const params = new URLSearchParams(location.search);
  const auto = sanitizeRoom(params.get('room') || '');
  if (auto && validRoom(auto)) {
    roomInput.value = auto;
    setTimeout(() => joinRoom(auto), 120);
  } else {
    setJoinStatus('等待输入房间码');
  }
})();
