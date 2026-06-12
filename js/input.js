'use strict';
/* ============ Teclado y ratón ============ */

const Input = {
  keys: {},
  mx: 0, my: 0,     // posición del ratón en píxeles internos del canvas
  mdown: false,     // botón izquierdo mantenido
};

function setupInput(canvas) {
  window.addEventListener('keydown', e => {
    // escribiendo en el chat o en un campo de texto
    if (e.target && e.target.tagName === 'INPUT') {
      if (e.target.id === 'chat-input') {
        if (e.key === 'Enter') { UI.submitChat(); e.preventDefault(); }
        if (e.key === 'Escape') UI.closeChatInput();
      }
      return;
    }
    const k = e.key.toLowerCase();
    if (k === ' ') e.preventDefault();
    Input.keys[k] = true;
    if (e.repeat || !G.running) return;
    if (k === 'e' || k === 'i' || k === 'c') UI.togglePanel();
    else if (k === 'h') UI.toggleHelp();
    else if (k === 't' || k === 'enter') {
      if (typeof Net !== 'undefined' && Net.online) {
        UI.openChatInput();
        e.preventDefault();
      }
    } else if (k === 'escape') UI.closeAll();
    else if (k === 'm') {
      const muted = Sfx.toggleMute();
      UI.toast(muted ? 'Sonido silenciado' : 'Sonido activado');
    } else if (k >= '1' && k <= '9') {
      Inv.sel = +k - 1;
      UI.refreshHotbar();
      if (UI.panelOpen) UI.refreshInv();
    }
  });

  window.addEventListener('keyup', e => {
    Input.keys[e.key.toLowerCase()] = false;
  });

  window.addEventListener('blur', () => {
    Input.keys = {};
    Input.mdown = false;
  });

  canvas.addEventListener('mousemove', e => {
    const r = canvas.getBoundingClientRect();
    Input.mx = (e.clientX - r.left) * (canvas.width / r.width);
    Input.my = (e.clientY - r.top) * (canvas.height / r.height);
  });

  canvas.addEventListener('mousedown', e => {
    Sfx.init();
    Sfx.resume();
    if (!G.running) return;
    if (e.button === 0) Input.mdown = true;
    if (e.button === 2) tryUseItem();
  });

  window.addEventListener('mouseup', e => {
    if (e.button === 0) {
      Input.mdown = false;
      player.breaking = null;
    }
  });

  canvas.addEventListener('contextmenu', e => e.preventDefault());

  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    // deltaY === 0: scroll horizontal de trackpad, no debe cambiar la selección
    if (!G.running || e.deltaY === 0) return;
    Inv.sel = (Inv.sel + (e.deltaY > 0 ? 1 : 8)) % 9;
    UI.refreshHotbar();
    if (UI.panelOpen) UI.refreshInv();
  }, { passive: false });
}
