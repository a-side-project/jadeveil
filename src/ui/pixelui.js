/**
 * 像素风界面系统 —— 所有 UI 纹理用 Canvas 逐像素生成 → dataURL。
 *
 * 设计原则：
 *  · 零外链资源，离线可用
 *  · 9-slice 边框（border-image）+ 平铺底纹（background-repeat）
 *  · 硬边、无圆角、无模糊、无平滑渐变；台阶式切角
 *  · 配色：墨底 / 琉璃金 / 朱红 / 青玉
 *  · 文字全部由位图像素字体（pixelfont.js）绘制，此处只管框架
 */

const P = {
  ink0: [10, 14, 18],
  ink1: [20, 26, 32],
  ink2: [30, 38, 46],
  ink3: [46, 56, 66],
  gold: [232, 180, 74],
  goldDeep: [168, 115, 31],
  goldLit: [255, 224, 138],
  crimson: [192, 57, 43],
  crimsonDeep: [142, 42, 32],
  jade: [74, 158, 143],
};

function px(w, h, draw) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(w, h);
  const set = (x, y, col, a = 255) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = (y * w + x) * 4;
    img.data[i] = col[0]; img.data[i + 1] = col[1]; img.data[i + 2] = col[2]; img.data[i + 3] = a;
  };
  const rect = (x, y, rw, rh, col, a = 255) => {
    for (let j = y; j < y + rh; j++) for (let i = x; i < x + rw; i++) set(i, j, col, a);
  };
  draw(set, rect, w, h);
  ctx.putImageData(img, 0, 0);
  return c.toDataURL();
}

function makeFrame({ edge = P.gold, edgeDeep = P.goldDeep, edgeLit = P.goldLit, fill = P.ink1, inner = P.ink0 } = {}) {
  const S = 24, corner = 3;
  return px(S, S, (set, rect) => {
    rect(0, 0, S, S, fill, 240);
    rect(0, 0, S, 1, edgeDeep); rect(0, S - 1, S, 1, edgeDeep);
    rect(0, 0, 1, S, edgeDeep); rect(S - 1, 0, 1, S, edgeDeep);
    rect(1, 1, S - 2, 1, edge); rect(1, S - 2, S - 2, 1, edgeDeep);
    rect(1, 1, 1, S - 2, edge); rect(S - 2, 1, 1, S - 2, edgeDeep);
    rect(2, 2, 5, 1, edgeLit); rect(2, 2, 1, 5, edgeLit);
    rect(3, 3, S - 6, 1, inner, 190); rect(3, S - 4, S - 6, 1, inner, 190);
    rect(3, 3, 1, S - 6, inner, 190); rect(S - 4, 3, 1, S - 6, inner, 190);
    for (let i = 0; i < corner; i++) {
      for (let j = 0; j < corner - i; j++) {
        set(i, j, fill, 240); set(S - 1 - i, j, fill, 240);
        set(i, S - 1 - j, fill, 240); set(S - 1 - i, S - 1 - j, fill, 240);
      }
      set(i + 1, i, edgeDeep); set(S - 2 - i, i, edgeDeep);
      set(i + 1, S - 2 - i, edgeDeep); set(S - 2 - i, S - 2 - i, edgeDeep);
    }
  });
}

function makeFill(base = P.ink1, speck = P.ink2, size = 16) {
  return px(size, size, (set) => {
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        let c = base;
        if ((x + y) % 2 === 0 && ((x * 7 + y * 13) % 11) === 0) c = speck;
        if ((x * 3 + y * 5) % 17 === 0) c = speck;
        set(x, y, c, 240);
      }
  });
}

function makeButton(kind) {
  const S = 16;
  const conf = {
    normal: { top: P.goldDeep, bottom: P.ink0, face: P.ink2, faceLit: P.ink3, edge: P.goldDeep },
    hover: { top: P.gold, bottom: P.goldDeep, face: P.ink2, faceLit: P.ink3, edge: P.gold },
    active: { top: P.goldLit, bottom: P.gold, face: P.goldDeep, faceLit: P.gold, edge: P.goldLit },
  }[kind];
  return px(S, S, (set, rect) => {
    rect(0, 0, S, S, conf.face, 244);
    rect(0, 0, S, 1, conf.top); rect(0, 1, S, 1, conf.bottom);
    rect(0, S - 1, S, 1, conf.bottom); rect(0, 0, 1, S, conf.top); rect(S - 1, 0, 1, S, conf.bottom);
    rect(2, 2, S - 4, 1, conf.faceLit, 200);
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3 - i; j++) {
        set(i, j, conf.face, 0); set(S - 1 - i, j, conf.face, 0);
        set(i, S - 1 - j, conf.face, 0); set(S - 1 - i, S - 1 - j, conf.face, 0);
      }
      set(i + 1, i, conf.edge); set(S - 2 - i, i, conf.edge);
      set(i + 1, S - 2 - i, conf.edge); set(S - 2 - i, S - 2 - i, conf.edge);
    }
  });
}

function makeSlot(active) {
  const S = 20;
  const e = active ? P.goldLit : P.ink3;
  const e2 = active ? P.goldDeep : P.ink0;
  return px(S, S, (set, rect) => {
    rect(0, 0, S, S, P.ink0, 210);
    rect(0, 0, S, 1, e); rect(0, 0, 1, S, e);
    rect(0, S - 1, S, 1, e2); rect(S - 1, 0, 1, S, e2);
    if (active) { rect(1, 1, S - 2, 1, P.gold, 220); rect(1, 1, 1, S - 2, P.gold, 220); }
    else { rect(1, 1, S - 2, 1, P.ink2, 190); rect(1, 1, 1, S - 2, P.ink2, 190); }
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < 2 - i; j++) {
        set(i, j, P.ink0, 0); set(S - 1 - i, j, P.ink0, 0);
        set(i, S - 1 - j, P.ink0, 0); set(S - 1 - i, S - 1 - j, P.ink0, 0);
      }
    }
  });
}

function makeCorner() {
  const S = 16;
  return px(S, S, (set, rect) => {
    rect(0, 0, S, 2, P.gold); rect(0, 0, 2, S, P.gold);
    rect(0, 0, S, 1, P.goldLit); rect(0, 0, 1, S, P.goldLit);
    rect(3, 3, S - 3, 1, P.goldDeep, 220); rect(3, 3, 1, S - 3, P.goldDeep, 220);
    rect(6, 6, 4, 1, P.gold, 180); rect(6, 6, 1, 4, P.gold, 180);
    set(9, 3, P.crimson); set(3, 9, P.crimson);
  });
}

function makeScanlines() {
  return px(4, 4, (set) => {
    for (let x = 0; x < 4; x++) {
      set(x, 0, [0, 0, 0], 22);
      set(x, 1, [0, 0, 0], 0);
      set(x, 2, [0, 0, 0], 10);
      set(x, 3, [0, 0, 0], 0);
    }
  });
}

export function installPixelUI() {
  const T = {
    frame: makeFrame(),
    frameCrimson: makeFrame({ edge: P.goldLit, edgeDeep: P.gold, edgeLit: P.goldLit, fill: P.crimsonDeep, inner: P.crimsonDeep }),
    fill: makeFill(),
    btn: makeButton("normal"),
    btnHover: makeButton("hover"),
    btnActive: makeButton("active"),
    slot: makeSlot(false),
    slotActive: makeSlot(true),
    corner: makeCorner(),
    scan: makeScanlines(),
  };

  const css = `
* { border-radius: 0 !important; }
body { -webkit-font-smoothing: none; image-rendering: pixelated; }
canvas { image-rendering: pixelated; }

.panel {
  background: url(${T.fill}) repeat !important;
  background-size: 16px 16px !important;
  border-style: solid !important;
  border-width: 10px !important;
  border-image: url(${T.frame}) 8 / 10px repeat !important;
  border-image-repeat: repeat !important;
  backdrop-filter: none !important;
  box-shadow: 4px 4px 0 rgba(0,0,0,0.6) !important;
  padding: 12px 14px !important;
}
#pause .panel, #overlay .panel {
  border-width: 14px !important;
  border-image: url(${T.frameCrimson}) 8 / 14px repeat !important;
  padding: 30px 46px !important;
}
#overlay .panel, #pause .panel { background-color: transparent; }

.btnrow button, #settings .tiers button {
  background: url(${T.btn}) repeat !important;
  background-size: 16px 16px !important;
  border: none !important;
  padding: 6px 4px !important;
  image-rendering: pixelated;
  transition: none !important;
}
.btnrow button:hover, #settings .tiers button:hover {
  background: url(${T.btnHover}) repeat !important; background-size: 16px 16px !important;
}
.btnrow button.on, #settings .tiers button.on {
  background: url(${T.btnActive}) repeat !important; background-size: 16px 16px !important;
}

.slot { background: url(${T.slot}) repeat !important; background-size: 20px 20px !important; border: none !important; box-shadow: none !important; }
.slot.active {
  background: url(${T.slotActive}) repeat !important; background-size: 20px 20px !important;
  transform: translateY(-3px) !important; box-shadow: 3px 3px 0 rgba(0,0,0,0.6) !important;
}

#timeslider, #settings input[type=range] {
  -webkit-appearance: none; appearance: none;
  height: 16px !important;
  background: url(${T.slot}) repeat !important;
  background-size: 20px 20px !important;
  border: none !important; cursor: pointer;
}
#timeslider::-webkit-slider-thumb, #settings input[type=range]::-webkit-slider-thumb {
  -webkit-appearance: none; appearance: none;
  width: 16px; height: 16px;
  background: url(${T.btnActive}) repeat; background-size: 16px 16px;
  border: none; cursor: pointer;
}

#settings .toggle .sw { background: url(${T.slot}) repeat !important; background-size: 20px 20px !important; border: none !important; }
#settings .toggle .sw::after { background: ${`rgb(${P.ink3.join(",")})`} !important; width: 12px !important; height: 12px !important; left: 2px !important; top: 2px !important; }
#settings .toggle.on .sw { background: url(${T.slotActive}) repeat !important; background-size: 20px 20px !important; }
#settings .toggle.on .sw::after { left: 20px !important; background: ${`rgb(${P.goldLit.join(",")})`} !important; }

#loading .bar { background: url(${T.slot}) repeat !important; background-size: 20px 20px !important; }
#loading .bar i { background: url(${T.btnActive}) repeat !important; background-size: 16px 16px !important; }

#pixel-scan {
  position: fixed; inset: 0; z-index: 60; pointer-events: none;
  background: url(${T.scan}) repeat; background-size: 4px 4px;
  mix-blend-mode: multiply; opacity: 0.45;
}

.pixel-corner { position: absolute; width: 16px; height: 16px; background: url(${T.corner}) no-repeat; background-size: 16px 16px; pointer-events: none; }
.pixel-corner.tl { left: 2px; top: 2px; }
.pixel-corner.tr { right: 2px; top: 2px; transform: scaleX(-1); }
.pixel-corner.bl { left: 2px; bottom: 2px; transform: scaleY(-1); }
.pixel-corner.br { right: 2px; bottom: 2px; transform: scale(-1,-1); }
`;

  const style = document.createElement("style");
  style.id = "pixel-ui";
  style.textContent = css;
  document.head.appendChild(style);

  const scan = document.createElement("div");
  scan.id = "pixel-scan";
  document.body.appendChild(scan);

  const decorate = () => {
    document.querySelectorAll(".panel").forEach((el) => {
      if (el.querySelector(":scope > .pixel-corner")) return;
      if (getComputedStyle(el).position === "static") el.style.position = "relative";
      for (const pos of ["tl", "tr", "bl", "br"]) {
        const c = document.createElement("div");
        c.className = `pixel-corner ${pos}`;
        el.appendChild(c);
      }
    });
  };
  decorate();
  setTimeout(decorate, 1000);
  return T;
}
