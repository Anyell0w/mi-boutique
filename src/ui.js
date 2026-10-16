import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import {
  createIcons, ShoppingBag, Wallet, History, Package, Users, Search, Plus, Minus, X, Check, ChevronRight,
  ChevronDown, LogOut, Settings, Trash2, Pencil, Camera, Banknote, Smartphone, Lock, LockOpen, Receipt,
  TrendingUp, TrendingDown, TriangleAlert, Delete, Download, Upload, Store, Coins, ArrowLeft, Tag, Calendar,
  CircleCheck, Crown, User, Percent, Eye, Sparkles, KeyRound, ImagePlus, CircleAlert, UserPlus, PackagePlus,
  Ban, Clock, ArrowUpRight, ArrowDownRight, ShoppingCart, Shirt, Hash,
} from 'lucide';

const ICONS = {
  ShoppingBag, Wallet, History, Package, Users, Search, Plus, Minus, X, Check, ChevronRight, ChevronDown,
  LogOut, Settings, Trash2, Pencil, Camera, Banknote, Smartphone, Lock, LockOpen, Receipt, TrendingUp,
  TrendingDown, TriangleAlert, Delete, Download, Upload, Store, Coins, ArrowLeft, Tag, Calendar, CircleCheck,
  Crown, User, Percent, Eye, Sparkles, KeyRound, ImagePlus, CircleAlert, UserPlus, PackagePlus, Ban, Clock,
  ArrowUpRight, ArrowDownRight, ShoppingCart, Shirt, Hash,
};

export const ic = (name, cls = '') => `<i data-lucide="${name}" class="${cls}"></i>`;
export const paintIcons = (root = document) => createIcons({ icons: ICONS, root, attrs: { 'stroke-width': 2 } });

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const money = n => `S/ ${(Number(n) || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const initials = name => String(name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
export const fmtFecha = ts => new Date(ts).toLocaleDateString('es-PE', { day: 'numeric', month: 'short' });
export const fmtHora = ts => new Date(ts).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
export const fmtFull = ts => `${fmtFecha(ts)}, ${fmtHora(ts)}`;

// ---------- Hápticos (silenciosos en web) ----------
export const haptic = {
  tap: () => Haptics.impact({ style: ImpactStyle.Light }).catch(() => {}),
  medium: () => Haptics.impact({ style: ImpactStyle.Medium }).catch(() => {}),
  ok: () => Haptics.notification({ type: NotificationType.Success }).catch(() => {}),
  err: () => Haptics.notification({ type: NotificationType.Error }).catch(() => {}),
};

// ---------- Toasts ----------
export function toast(msg, type = 'ok') {
  const root = document.getElementById('toast-root');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  const icon = type === 'ok' ? 'Check' : type === 'bad' ? 'X' : 'Sparkles';
  el.innerHTML = `<span class="ti">${ic(icon)}</span><span>${esc(msg)}</span>`;
  root.appendChild(el);
  paintIcons(el);
  if (type === 'bad') haptic.err();
  setTimeout(() => { el.classList.add('leaving'); setTimeout(() => el.remove(), 300); }, 2600);
}

// ---------- Bottom sheets & diálogos ----------
const stack = [];
export function openSheet({ title = '', subtitle = '', body = '', foot = '', dialog = false, onMount, onClose } = {}) {
  const root = document.getElementById('sheet-root');
  const bd = document.createElement('div');
  bd.className = 'backdrop';
  const sh = document.createElement('div');
  sh.className = `sheet${dialog ? ' dialog' : ''}`;
  sh.innerHTML = `
    ${dialog ? '' : '<div class="grab"></div>'}
    ${title ? `<div class="sh-head"><div><h2>${title}</h2>${subtitle ? `<p>${subtitle}</p>` : ''}</div>
      <button class="icon-btn sm" data-close>${ic('X')}</button></div>` : ''}
    <div class="sh-body">${body}</div>
    ${foot ? `<div class="sh-foot">${foot}</div>` : ''}`;
  root.append(bd, sh);
  paintIcons(sh);
  const entry = { bd, sh, onClose };
  stack.push(entry);
  bd.addEventListener('click', () => closeSheet(entry));
  sh.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => closeSheet(entry)));
  enableDrag(sh, entry);
  onMount?.(sh, () => closeSheet(entry));
  return { el: sh, close: () => closeSheet(entry) };
}
export function closeSheet(entry = stack[stack.length - 1]) {
  if (!entry) return false;
  const i = stack.indexOf(entry);
  if (i < 0) return false;
  stack.splice(i, 1);
  entry.bd.classList.add('leaving');
  entry.sh.classList.add('leaving');
  entry.sh.style.transform = '';
  setTimeout(() => { entry.bd.remove(); entry.sh.remove(); }, 300);
  entry.onClose?.();
  return true;
}
export const hasSheet = () => stack.length > 0;

// Arrastrar hacia abajo para cerrar (solo sheets inferiores)
function enableDrag(sh, entry) {
  if (sh.classList.contains('dialog')) return;
  const handle = sh.querySelector('.grab');
  const head = sh.querySelector('.sh-head');
  let y0 = null, dy = 0;
  const start = e => { y0 = e.touches[0].clientY; dy = 0; sh.style.transition = 'none'; };
  const move = e => {
    if (y0 === null) return;
    dy = Math.max(0, e.touches[0].clientY - y0);
    sh.style.transform = `translateY(${dy}px)`;
  };
  const end = () => {
    if (y0 === null) return;
    sh.style.transition = 'transform .35s cubic-bezier(.32,.72,0,1)';
    if (dy > 110) closeSheet(entry); else sh.style.transform = '';
    y0 = null;
  };
  [handle, head].filter(Boolean).forEach(h => {
    h.addEventListener('touchstart', start, { passive: true });
    h.addEventListener('touchmove', move, { passive: true });
    h.addEventListener('touchend', end);
  });
}

export function confirmDialog({ title, message, ok = 'Confirmar', danger = false, icon = 'CircleAlert' }) {
  return new Promise(resolve => {
    let done = false;
    const s = openSheet({
      dialog: true,
      body: `
        <div style="padding:22px 4px 4px;text-align:center">
          <div class="tile" style="width:52px;height:52px;border-radius:16px;margin:0 auto 12px;background:${danger ? 'var(--bad-50)' : 'var(--brand-50)'};color:${danger ? 'var(--bad)' : 'var(--brand)'}">${ic(icon)}</div>
          <h3 style="margin:0 0 6px;font-size:18px;font-weight:650;letter-spacing:-.02em">${title}</h3>
          <p style="margin:0;color:var(--muted);font-size:14px">${message}</p>
        </div>
        <div class="row" style="margin-top:20px">
          <button class="btn ghost grow" data-no>Cancelar</button>
          <button class="btn ${danger ? 'dark' : 'primary'} grow" data-yes style="${danger ? 'background:var(--bad);box-shadow:none' : ''}">${ok}</button>
        </div>`,
      onClose: () => { if (!done) resolve(false); },
      onMount: (el, close) => {
        el.querySelector('[data-no]').onclick = () => close();
        el.querySelector('[data-yes]').onclick = () => { done = true; resolve(true); close(); };
      },
    });
    paintIcons(s.el);
  });
}

// Contador animado para KPIs
export function countUp(root = document) {
  root.querySelectorAll('[data-count]').forEach(el => {
    const to = Number(el.dataset.count);
    const isMoney = el.dataset.money !== undefined;
    const fmt = v => isMoney ? money(v) : Math.round(v).toString();
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || to === 0) { el.textContent = fmt(to); return; }
    const t0 = performance.now(), dur = 650;
    const tick = t => {
      const p = Math.min(1, (t - t0) / dur);
      const e = 1 - Math.pow(1 - p, 3);
      el.textContent = fmt(to * e);
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

// Segmented control con "thumb" animado
export function mountSeg(el) {
  if (!el) return;
  let thumb = el.querySelector('.thumb');
  if (!thumb) { thumb = document.createElement('span'); thumb.className = 'thumb'; el.prepend(thumb); }
  const on = el.querySelector('button.on') || el.querySelector('button');
  const place = () => {
    thumb.style.width = `${on.offsetWidth}px`;
    thumb.style.transform = `translateX(${on.offsetLeft}px)`;
  };
  requestAnimationFrame(place);
}

// Compresión de imagen a JPEG
export function comprimirImagen(file, max = 900, q = 0.72) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = ev => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        let w = img.width, h = img.height;
        const k = Math.min(1, max / Math.max(w, h));
        w = Math.round(w * k); h = Math.round(h * k);
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL('image/jpeg', q));
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });
}
