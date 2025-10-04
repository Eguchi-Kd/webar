// js/webar-enhancements.js
// Usage: call initEnhancements(options) after your AR page has created renderer/camera/scene or model-viewer.
// options: {
//   renderer: THREE.WebGLRenderer (optional, for three.js preview and AR canvas screenshot/gestures),
//   camera: THREE.Camera (optional, for possible camera-relative behaviors),
//   getPlacedObject: ()=>THREE.Object3D|null (function; should return the currently placed model in scene),
//   modelViewerEl: HTMLElement (optional; <model-viewer> element if used on page),
//   uiRoot: HTMLElement (optional) - parent where to append buttons (defaults document.body)
// }

export function initEnhancements({
  renderer = null,
  camera = null,
  getPlacedObject = null,
  modelViewerEl = null,
  uiRoot = document.body
} = {}) {
  // --- small helpers ---
  function createEl(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }

  // --- CSS for controls (inject once) ---
  if (!document.getElementById('webar-enh-style')) {
    const style = createEl('style', '', `
      #webar-ui { position: fixed; right: 12px; top: 50%; transform: translateY(-50%); z-index: 99999; display:flex; flex-direction:column; gap:8px; pointer-events:auto; }
      #webar-ui .webar-btn { background: rgba(0,0,0,0.6); color:#fff; border:1px solid rgba(255,255,255,0.08); padding:8px 10px; border-radius:8px; font-size:14px; }
      #webar-ui .webar-btn.ghost { background:transparent; border:1px dashed rgba(255,255,255,0.12); }
      /* top log reposition (if present on page) */
      #webar-top-log { position: fixed; left: 12px; top: 12px; z-index: 99999; max-width: 60%; pointer-events:none; color:#fff; font-size:13px; }
      /* hide UI when .ui-hidden is set on html/doc */
      .ui-hidden #webar-ui > .hidable { display:none !important; }
    `);
    style.id = 'webar-enh-style';
    document.head.appendChild(style);
  }

  // --- build UI ---
  const root = createEl('div', '');
  root.id = 'webar-ui';
  // persistent toggle (must remain visible to re-show)
  const btnToggle = createEl('button', 'webar-btn', 'UI 表示/非表示');
  // hidable area
  const hidableWrapper = createEl('div', 'hidable', '');
  const btnScreenshot = createEl('button', 'webar-btn', 'スクリーンショット');
  btnScreenshot.title = '表示中の画面を保存します（Quick Look中は制約あり）';
  hidableWrapper.appendChild(btnScreenshot);

  root.appendChild(btnToggle);
  root.appendChild(hidableWrapper);

  // optional top log
  const topLog = createEl('div', 'webar-top-log');
  topLog.id = 'webar-top-log';
  uiRoot.appendChild(topLog);
  uiRoot.appendChild(root);

  function logTop(msg) {
    const d = createEl('div');
    d.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    topLog.prepend(d);
    setTimeout(()=>{ try { d.remove(); } catch(e){} }, 8000);
  }

  // toggle show/hide
  btnToggle.addEventListener('click', () => {
    document.documentElement.classList.toggle('ui-hidden');
    logTop('UI トグル');
  });

  // --- Screenshot implementation ---
  async function screenshotFromRenderer() {
    if (!renderer) throw new Error('renderer not provided');
    // hide UI briefly
    document.documentElement.classList.add('ui-hidden');
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    // try toBlob
    const canvas = renderer.domElement;
    let blob = null;
    if (canvas.toBlob) {
      blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    } else {
      // fallback to toDataURL
      const data = canvas.toDataURL('image/png');
      const arr = data.split(','), mime = arr[0].match(/:(.*?);/)[1], bstr = atob(arr[1]), n = bstr.length, u8 = new Uint8Array(n);
      for (let i=0;i<n;i++) u8[i]=bstr.charCodeAt(i);
      blob = new Blob([u8], { type: mime });
    }
    document.documentElement.classList.remove('ui-hidden');
    return blob;
  }

  async function screenshotFromModelViewer(mv) {
    // Model Viewer exposes screenshot APIs (toBlob/toDataURL) per docs; try toBlob then toDataURL fallback.
    // Reference: model-viewer docs - toDataURL / toBlob exist. :contentReference[oaicite:4]{index=4}
    if (!mv) throw new Error('model-viewer element required');
    // Prefer toBlob (if available)
    if (typeof mv.toBlob === 'function') {
      return await mv.toBlob();
    }
    if (typeof mv.toDataURL === 'function') {
      const data = mv.toDataURL();
      const arr = data.split(','), mime = arr[0].match(/:(.*?);/)[1], bstr = atob(arr[1]), n = bstr.length, u8 = new Uint8Array(n);
      for (let i=0;i<n;i++) u8[i]=bstr.charCodeAt(i);
      return new Blob([u8], { type: mime });
    }
    throw new Error('model-viewer does not expose screenshot API in this environment');
  }

  async function downloadBlob(blob, filename='screenshot.png') {
    if (!blob) throw new Error('no blob');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(()=>URL.revokeObjectURL(url), 10000);
  }

  btnScreenshot.addEventListener('click', async () => {
    logTop('スクリーンショット開始...');
    try {
      let blob = null;
      // priority: renderer canvas (Three.js) -> model-viewer -> fallback: HTML element capture (not implemented)
      if (renderer && renderer.domElement) {
        blob = await screenshotFromRenderer();
      } else if (modelViewerEl) {
        try { blob = await screenshotFromModelViewer(modelViewerEl); } catch(e){ console.warn(e); }
      }
      if (!blob) throw new Error('スクリーンショット失敗 (適切な描画領域が見つかりません)');
      await downloadBlob(blob, 'webar_screenshot.png');
      logTop('スクリーンショット完了');
    } catch (e) {
      console.error('screenshot error', e);
      logTop('スクリーンショット失敗: ' + (e.message || e));
    }
  });

  // --- Gesture handling for model scale/rotation ---
  // Works by calling getPlacedObject() to obtain current model object (THREE.Object3D).
  // getPlacedObject must be provided by integrator code and return the currently interactable object (or null).
  if (!getPlacedObject || typeof getPlacedObject !== 'function') {
    logTop('ジェスチャー: getPlacedObject 関数が未提供。スワイプ/ピンチは無効。');
  } else {
    const el = renderer && renderer.domElement ? renderer.domElement : (modelViewerEl || document.body);
    // pointer-based gesture state
    const pointers = new Map();
    let gestureState = {
      mode: 'none', // 'none' | 'rotate' | 'pinch'
      startX:0, startY:0, startDist:0, startScale:1, startRotationY:0
    };

    function getDistance(p1,p2){ const dx=p2.x-p1.x, dy=p2.y-p1.y; return Math.hypot(dx,dy); }

    function onPointerDown(e){
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      try{ e.target.setPointerCapture(e.pointerId); }catch(e){}
      pointers.set(e.pointerId, { x:e.clientX, y:e.clientY, type:e.pointerType });
      const placed = getPlacedObject();
      if (!placed) return;
      if (pointers.size === 1) {
        gestureState.mode = 'rotate';
        const p = pointers.values().next().value;
        gestureState.startX = p.x; gestureState.startY = p.y;
        gestureState.startRotationY = placed.rotation ? placed.rotation.y : 0;
      } else if (pointers.size === 2) {
        gestureState.mode = 'pinch';
        const it = pointers.values(); const pA = it.next().value; const pB = it.next().value;
        gestureState.startDist = getDistance(pA,pB);
        const placed = getPlacedObject();
        gestureState.startScale = placed && placed.scale ? placed.scale.x : 1;
      }
    }
    function onPointerMove(e){
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x:e.clientX, y:e.clientY, type:e.pointerType });
      const placed = getPlacedObject();
      if (!placed) return;
      if (gestureState.mode === 'rotate' && pointers.size === 1) {
        const p = pointers.values().next().value;
        const dx = p.x - gestureState.startX;
        const ROT_SPEED = 0.01; // adjust sensitivity
        const newY = gestureState.startRotationY - dx * ROT_SPEED;
        if (placed.rotation) placed.rotation.y = newY;
      } else if (gestureState.mode === 'pinch' && pointers.size === 2) {
        const it = pointers.values(); const pA = it.next().value; const pB = it.next().value;
        const curDist = getDistance(pA,pB);
        if (gestureState.startDist > 0) {
          const ratio = curDist / gestureState.startDist;
          const newScale = Math.max(0.05, Math.min(8, gestureState.startScale * ratio));
          if (placed.scale) placed.scale.setScalar(newScale);
        }
      }
    }
    function onPointerUp(e){
      try{ e.target.releasePointerCapture(e.pointerId); }catch(e){}
      pointers.delete(e.pointerId);
      if (pointers.size === 0) gestureState.mode = 'none';
      else if (pointers.size === 1) {
        const p = pointers.values().next().value;
        gestureState.mode = 'rotate';
        gestureState.startX = p.x; gestureState.startY = p.y;
        const placed = getPlacedObject();
        gestureState.startRotationY = placed && placed.rotation ? placed.rotation.y : 0;
      }
    }

    el.addEventListener('pointerdown', onPointerDown, { passive:false });
    el.addEventListener('pointermove', onPointerMove, { passive:false });
    el.addEventListener('pointerup', onPointerUp, { passive:false });
    el.addEventListener('pointercancel', onPointerUp, { passive:false });
    // prevent page scrolling while interacting
    el.addEventListener('touchstart', (ev)=>{ /* only if interacting on canvas */ }, { passive:false });

    logTop('ジェスチャー: 有効 (ピンチで拡大/縮小、単指で回転)');
  }

  // return programmatic handle
  return {
    uiRoot: root,
    btnToggle,
    btnScreenshot,
    logTop,
    destroy(){
      try{ root.remove(); topLog.remove(); }catch(e){}
    }
  };
}
