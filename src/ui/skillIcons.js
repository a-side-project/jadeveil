/**
 * 像素图标 —— 技能栏、触屏环形技能盘、触屏系统按钮共用。
 * 每个图标是 12×12 的字符画，配一张调色板；pixelCanvas 按整数倍放大绘制。
 */

export function pixelCanvas(rows, legend, scale = 3) {
  const h = rows.length, w = rows[0].length;
  const c = document.createElement("canvas");
  c.width = w * scale;
  c.height = h * scale;
  const ctx = c.getContext("2d");
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      const col = legend[ch];
      if (!col) return;
      ctx.fillStyle = col;
      ctx.fillRect(x * scale, y * scale, scale, scale);
    });
  });
  c.style.imageRendering = "pixelated";
  return c;
}

/* ---------------- 末影龙技能（紫） ---------------- */
export const DRAGON_LEGEND = { P: "#9b3fe0", H: "#e7a6ff", W: "#ffffff", p: "#5e1f99" };
export const DRAGON_ICONS = {
  breath: [
    "............", "...PP.......", "..PHHP..pp..", ".PHHHHPppp..", ".PHHHHHPPPp.", "..PHHHHHHPPp",
    "..PHHHHHHPPp", ".PHHHHHPPPp.", ".PHHHHPppp..", "..PHHP..pp..", "...PP.......", "............",
  ],
  fireball: [
    "............", "....pppp....", "..ppPPPPpp..", "..pPHHHHPp..", ".pPHHWWHHPp.", ".pPHWWWWHPp.",
    ".pPHWWWWHPp.", ".pPHHWWHHPp.", "..pPHHHHPp..", "..ppPPPPpp..", "....pppp....", "............",
  ],
  dash: [
    "............", "..P.....P...", "..PP....PP..", "..PHP...PHP.", "..PHHP..PHHP", "..PHHHP.PHHH",
    "..PHHHP.PHHH", "..PHHP..PHHP", "..PHP...PHP.", "..PP....PP..", "..P.....P...", "............",
  ],
  roar: [
    "............", "........p...", "......p..p..", "..PP...p..p.", ".PHHP...p.p.", "PHHHHP..p..p",
    "PHHHHP..p..p", ".PHHP...p.p.", "..PP...p..p.", "......p..p..", "........p...", "............",
  ],
};

/* ---------------- 人物技能（玉） ---------------- */
export const JADE_LEGEND = { J: "#3fbf9f", L: "#bff5e4", W: "#ffffff", d: "#1d6b5c", G: "#e8b44a", B: "#7a5228" };
export const PLAYER_ICONS = {
  slash: [
    "...........W", "..........WL", ".........WLJ", "........WLJ.", ".......WLJ..", "......WLJ...",
    ".....WLJ....", "..GGWLJ.....", "...GBJ......", "...BGG......", "..BB.G......", ".BB.........",
  ],
  lunge: [
    "............", "......L.....", "......LL....", "JJJJJJLLL...", "dddddJLLLL..", "JJJJJJLLLLW.",
    "dddddJLLLL..", "JJJJJJLLL...", "......LL....", "......L.....", "............", "............",
  ],
  whirl: [
    "....LLLL....", "..LL....JJ..", ".L........J.", ".L...WW...J.", "L...W..W...d", "L..W....W..d",
    "J..W....W..d", "J...W..W...d", ".J...WW...d.", ".J........d.", "..JJ....dd..", "....dddd....",
  ],
  crescent: [
    "............", "....LLL.....", "..LLJJ......", ".LJJ........", ".LJ.........", "LJ..........",
    "LJ..........", ".LJ.........", ".LJJ........", "..LLJJ......", "....LLL.....", "............",
  ],
  mend: [
    "............", ".....JJ.....", ".....LJ.....", ".....LJ.....", ".JJJJLJJJJJ.", ".LLLLWLLLLJ.",
    ".JJJJLJJJJJ.", ".....LJ.....", ".....LJ.....", ".....JJ.....", "............", "............",
  ],
  evade: [
    "............", "...LLLL.....", "..L....L....", ".L......J...", ".L.......J..", "..........J.",
    "....JJJJ.JJ.", "...J....JJJ.", "..J.....JJJ.", ".d......dd..", ".d..........", "............",
  ],
};

/* ---------------- 触屏系统按钮（金） ---------------- */
export const UI_LEGEND = { G: "#ffe08a", g: "#a8731f", P: "#e08aff", p: "#7a2aa8", J: "#6fc0ae", W: "#f2e6cf" };
export const UI_ICONS = {
  menu: [
    "............", "............", ".GGGGGGGGGG.", ".gggggggggg.", "............", ".GGGGGGGGGG.",
    ".gggggggggg.", "............", ".GGGGGGGGGG.", ".gggggggggg.", "............", "............",
  ],
  bag: [
    "............", "....GGGG....", "...G....G...", "..GGGGGGGG..", ".GgggggggggG", ".Gg..GG..gG.",
    ".Gg..gg..gG.", ".GgggggggggG", ".Gg......gG.", ".GgggggggggG", "..GGGGGGGG..", "............",
  ],
  dragon: [
    "............", ".P......P...", ".PP....PP...", "..PPPPPPPP..", "..PpPPPPpPP.", ".PPWpPPpWPP.",
    ".PPPPPPPPPP.", "..PPppppPPP.", "...PPPPPPP..", "....PppP....", ".....PP.....", "............",
  ],
  view: [
    "............", "............", "...GGGGGG...", "..G......G..", ".G..gGGg..G.", "G..gGWWGg..G",
    "G..gGWWGg..G", ".G..gGGg..G.", "..G......G..", "...GGGGGG...", "............", "............",
  ],
  // 模式：剑（冒险）/ 锤（建造）
  adventure: [
    "..........JW", ".........JW.", "........JW..", ".......JW...", "......JW....", ".....JW.....",
    "..G.JW......", "...GW.......", "...gG.......", "..g..G......", ".g..........", "............",
  ],
  build: [
    "............", "..GGGGGGG...", "..GWWWWWG...", "..GgggggG...", "..GGGGGGG...", ".....g......",
    ".....g......", ".....g......", ".....g......", ".....g......", "....ggg.....", "............",
  ],
  jump: [
    "............", ".....WW.....", "....WWWW....", "...WWWWWW...", "..WW.WW.WW..", ".....WW.....",
    ".....WW.....", ".....WW.....", "............", "..GGGGGGGG..", "..gggggggg..", "............",
  ],
  crouch: [
    "............", "............", "............", ".....WW.....", ".....WW.....", "...WWWWWW...",
    ".....WW.....", "....W..W....", "...WW..WW...", "..GGGGGGGG..", "..gggggggg..", "............",
  ],
  down: [
    "............", "..GGGGGGGG..", "..gggggggg..", ".....WW.....", ".....WW.....", ".....WW.....",
    "..WW.WW.WW..", "...WWWWWW...", "....WWWW....", ".....WW.....", "............", "............",
  ],
  place: [
    "............", "....GGGG....", "...GWWWWG...", "..GWWWWWWG..", "..GgWWWWgG..", "..GggWWggG..",
    "..GgggggggG.", "..GGgggggG..", "....GGGG....", ".....J......", "....JJJ.....", "............",
  ],
  break: [
    "............", ".GGGG.......", ".GWWWG......", ".GWWWWG.....", "..GWWWG.....", "...GGgg.....",
    "......gg....", ".......gg...", "........gg..", ".........gg.", "..........g.", "............",
  ],
  sprint: [
    "............", "..W....W....", "...W....W...", "....W....W..", ".....W....W.", "......W....W",
    ".....W....W.", "....W....W..", "...W....W...", "..W....W....", "............", "............",
  ],
};
