// Small DOM helpers: element builder, bottom sheets, confirm dialogs, toasts and icons.

export const $ = (sel, root = document) => root.querySelector(sel);

// Let views pass null/false for "nothing here" to replaceChildren/append, same as h() children.
for (const name of ["replaceChildren", "append"]) {
  const orig = Element.prototype[name];
  Element.prototype[name] = function (...nodes) { return orig.apply(this, nodes.flat(Infinity).filter((n) => n != null && n !== false)); };
}

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else if (k === "style" && typeof v === "object") for (const [sk, sv] of Object.entries(v)) el.style.setProperty(sk.startsWith("--") ? sk : sk.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`), String(sv));
    else if (k === "value") el.value = v;
    else if (k === "checked") el.checked = !!v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const svg = (d, cls = "") => {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 24 24");
  s.setAttribute("aria-hidden", "true");
  if (cls) s.setAttribute("class", cls);
  s.innerHTML = d;
  return s;
};
const P = (d) => `<path d="${d}"/>`;
export const icon = {
  back: () => svg(P("M15.4 7.4 14 6l-6 6 6 6 1.4-1.4L10.8 12z")),
  plus: () => svg(P("M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6z")),
  gear: () => svg(P("M19.14 12.94a7.07 7.07 0 0 0 0-1.88l2.03-1.58a.5.5 0 0 0 .12-.61l-1.92-3.32a.5.5 0 0 0-.59-.22l-2.39.96a7 7 0 0 0-1.62-.94l-.36-2.54A.5.5 0 0 0 13.92 2h-3.84a.5.5 0 0 0-.48.41l-.36 2.54a7 7 0 0 0-1.62.94l-2.39-.96a.5.5 0 0 0-.59.22L2.72 8.47a.5.5 0 0 0 .12.61l2.03 1.58a7.07 7.07 0 0 0 0 1.88l-2.03 1.58a.5.5 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.04.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.48-.41l.36-2.54a7 7 0 0 0 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.5.5 0 0 0-.12-.61zM12 15.6a3.6 3.6 0 1 1 0-7.2 3.6 3.6 0 0 1 0 7.2z")),
  search: () => svg('<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/>'),
  play: () => svg(P("M8 5v14l11-7z")),
  pause: () => svg(P("M6 19h4V5H6zm8-14v14h4V5z")),
  stop: () => svg(P("M6 6h12v12H6z")),
  undo: () => svg(P("M12.5 8c-2.65 0-5.05 1-6.9 2.6L2 7v9h9l-3.62-3.62A7.96 7.96 0 0 1 20.36 16l2.37-.78A10.5 10.5 0 0 0 12.5 8z")),
  mail: () => svg(P("M20 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 4-8 5-8-5V6l8 5 8-5z")),
  chart: () => svg(P("M5 9.2h3V19H5zM10.6 5h2.8v14h-2.8zm5.6 8H19v6h-2.8z")),
  check: () => svg(P("M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z")),
  edit: () => svg(P("M3 17.25V21h3.75L17.81 9.94l-3.75-3.75zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75z")),
  trash: () => svg(P("M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6zM19 4h-3.5l-1-1h-5l-1 1H5v2h14z")),
  chevron: () => svg(P("M10 6 8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"), "chev"),
  clock: () => svg(P("M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z")),
  close: () => svg(P("M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z")),
  list: () => svg(P("M3 13h2v-2H3zm0 4h2v-2H3zm0-8h2V7H3zm4 4h14v-2H7zm0 4h14v-2H7zM7 7v2h14V7z")),
};

// ---------- toast ----------
let toastTimer;
export function toast(message, ms = 2400) {
  let t = $("#toast");
  if (!t) { t = h("div", { id: "toast", class: "toast", role: "status" }); document.body.append(t); }
  t.textContent = message;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), ms);
}

// ---------- bottom sheet ----------
// sheet(title, body, { onClose }) → { close, el }. Body may be a Node or a function(close) → Node.
export function sheet(title, body, opts = {}) {
  const backdrop = h("div", { class: "sheet-backdrop" });
  const panel = h("div", { class: `sheet ${opts.className || ""}`, role: "dialog", "aria-modal": "true", "aria-label": title });
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    backdrop.classList.remove("open");
    panel.classList.remove("open");
    setTimeout(() => { backdrop.remove(); panel.remove(); }, 260);
    opts.onClose?.();
  };
  backdrop.addEventListener("click", () => { if (!opts.modal) close(); });
  panel.append(
    h("div", { class: "sheet-grip" }),
    h("div", { class: "sheet-head" },
      h("h2", {}, title),
      opts.modal ? null : h("button", { class: "sheet-close", onclick: close, "aria-label": "Close" }, icon.close())),
    h("div", { class: "sheet-body" }, typeof body === "function" ? body(close) : body),
  );
  document.body.append(backdrop, panel);
  requestAnimationFrame(() => { backdrop.classList.add("open"); panel.classList.add("open"); });
  return { close, el: panel };
}

export function confirmSheet(title, message, okLabel = "OK", { danger = false } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    const s = sheet(title, (close) => h("div", {},
      h("p", { class: "muted" }, message),
      h("div", { class: "stack" },
        h("button", { class: `btn big ${danger ? "danger-fill" : "primary"}`, onclick: () => { answered = true; resolve(true); close(); } }, okLabel),
        h("button", { class: "btn big ghost", onclick: () => close() }, "Cancel"))),
    { onClose: () => { if (!answered) resolve(false); } });
    return s;
  });
}

// ---------- form helpers ----------
export const field = (label, input, hint) =>
  h("label", { class: "field" }, h("span", { class: "field-label" }, label), input, hint ? h("span", { class: "field-hint" }, hint) : null);

export function segmented(options, value, onchange, cls = "") {
  const wrap = h("div", { class: `segmented ${cls}`, role: "tablist" });
  const render = (v) => {
    wrap.replaceChildren(...options.map(([key, label]) => h("button", {
      class: key === v ? "on" : "", role: "tab", "aria-selected": key === v ? "true" : "false", type: "button",
      onclick: () => { render(key); onchange(key); },
    }, label)));
  };
  render(value);
  return wrap;
}

// Brief full-screen edge glow, used as the interval cue (silent).
export function flash() {
  const f = $("#flash");
  if (!f) return;
  f.classList.remove("on");
  void f.offsetWidth; // restart the animation
  f.classList.add("on");
}

// Avatar colour from the school initial so a school's clients share a colour.
const HUES = [172, 205, 262, 330, 20, 42, 140, 190, 285, 0];
export function hueFor(s) {
  let n = 0;
  for (const ch of String(s)) n = (n * 31 + ch.charCodeAt(0)) >>> 0;
  return HUES[n % HUES.length];
}

export function download(blob, filename) {
  const a = h("a", { href: URL.createObjectURL(blob), download: filename });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

// Share a file through the iOS share sheet; falls back to downloading it.
export async function shareFile(file, title) {
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return "shared";
    } catch (err) {
      if (err?.name === "AbortError") return "cancelled";
      if (err?.name === "NotAllowedError") return "retry";
      throw err;
    }
  }
  download(file, file.name);
  return "downloaded";
}
