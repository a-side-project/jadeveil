/**
 * HUD —— 全英文界面，文字一律由位图像素字体绘制。
 */
import { CAMERA_LABELS } from "../player/controller.js";
import { Minimap } from "./minimap.js";
import { setPixelText, attachPixelText } from "./pixelfont.js";

export const BRAND = "JADEVEIL";
export const TAGLINE = "A VOXEL REALM OF MIST AND JADE";

const C = {
  gold: "#ffe08a",
  goldDeep: "#a8731f",
  bone: "#f2e6cf",
  jade: "#6fc0ae",
  dim: "#8b93a0",
};

/** 快捷方式：把元素内容设为像素文本 */
const say = (id, text, opts = {}) => setPixelText(document.getElementById(id), text, { color: C.bone, scale: 2, ...opts });

export class HUD {
  constructor(atlas, player, daynight, interaction, world) {
    this.atlas = atlas;
    this.player = player;
    this.daynight = daynight;
    this.interaction = interaction;
    this.world = world;

    this.el = {
      hud: document.getElementById("hud"),
      overlay: document.getElementById("overlay"),
      pause: document.getElementById("pause"),
      crosshair: document.getElementById("crosshair"),
      hotbar: document.getElementById("hotbar"),
      itemname: document.getElementById("itemname"),
      minimap: document.getElementById("minimap"),
      chunkprog: document.getElementById("chunkprog"),
      loading: document.getElementById("loading"),
      loadbar: document.getElementById("loadbar"),
      slider: document.getElementById("timeslider"),
    };

    this.hidden = false;
    this._nameTimer = 0;
    this.audio = null; // 由 main.js 注入，用于 UI 音效
    this.speeds = [1, 4, 12, 40];
    this.speedIndex = 0;

    this.inventory = null; // 由 main.js 注入：数字键 / 滚轮切换快捷栏
    this.mount = null; // 骑乘时数字键归技能栏，滚轮不切换物品

    this._buildStaticLabels();
    this._bindTime();
    this._bindKeys();

    const mmCanvas = document.getElementById("minimap-canvas");
    this.minimap = world ? new Minimap(world, player, mmCanvas) : null;
  }

  /* ---------------- 静态标签 ---------------- */
  _buildStaticLabels() {
    // 统计面板
    say("t-brand", BRAND, { color: C.gold, scale: 2 });
    say("k-fps", "FPS", { color: C.dim, scale: 1 });
    say("k-pos", "POS", { color: C.dim, scale: 1 });
    say("k-view", "VIEW", { color: C.dim, scale: 1 });
    say("k-chunk", "CHUNKS", { color: C.dim, scale: 1 });
    this.dyn = {
      fps: attachPixelText(document.getElementById("s-fps"), { color: C.gold, scale: 1, initial: "--" }),
      pos: attachPixelText(document.getElementById("s-pos"), { color: C.gold, scale: 1, initial: "--" }),
      mode: attachPixelText(document.getElementById("s-mode"), { color: C.gold, scale: 1, initial: "FIRST PERSON" }),
      chunk: attachPixelText(document.getElementById("s-chunk"), { color: C.gold, scale: 1, initial: "--" }),
      clock: attachPixelText(document.getElementById("t-clock"), { color: C.gold, scale: 2, initial: "06:00" }),
      chunkprog: attachPixelText(document.getElementById("chunkprog"), { color: C.jade, scale: 1, initial: "" }),
      itemname: attachPixelText(document.getElementById("itemname"), { color: C.gold, scale: 2, initial: "" }),
      loadmsg: attachPixelText(document.getElementById("loadmsg"), { color: C.jade, scale: 1, initial: "PREPARING..." }),
    };

    // 时间面板
    say("t-time", "TIME OF DAY", { color: C.gold, scale: 2 });
    say("b-dawn", "DAWN", { scale: 1 });
    say("b-noon", "NOON", { scale: 1 });
    say("b-dusk", "DUSK", { scale: 1 });
    say("b-night", "NIGHT", { scale: 1 });
    this.btnCycle = document.getElementById("btn-cycle");
    this.btnSpeed = document.getElementById("btn-speed");
    this._refreshTimeButtons();


    // 小地图
    say("t-map", "MAP", { color: C.gold, scale: 1 });

    // 操作提示
    say("h-move-l", "MOVE", { color: C.gold, scale: 1 });
    say("h-move-v", "WASD  SPACE  SHIFT", { scale: 1 });
    say("h-view-l", "VIEW", { color: C.gold, scale: 1 });
    say("h-view-v", "MOUSE   V   F", { scale: 1 });
    say("h-build-l", "BUILD", { color: C.gold, scale: 1 });
    say("h-build-v", "LMB BREAK  RMB PLACE  1-9", { scale: 1 });
    say("h-world-l", "WORLD", { color: C.gold, scale: 1 });
    say("h-world-v", "T TIME  B BOB  O SET  M MAP  H HIDE", { scale: 1 });
    say("h-esc", "ESC - RELEASE MOUSE", { color: C.jade, scale: 1 });

    // 开场页
    setPixelText(document.getElementById("o-title"), BRAND, { color: C.gold, outline: C.goldDeep, shadow: "#000", scale: 6, tracking: 2, center: true });
    setPixelText(document.getElementById("o-sub"), TAGLINE, { color: C.jade, scale: 2, tracking: 1, center: true });
    setPixelText(document.getElementById("o-k1"), "WASD MOVE   SPACE JUMP   SHIFT SPRINT", { scale: 2, center: true });
    setPixelText(document.getElementById("o-k2"), "LMB BREAK BLOCK   RMB PLACE BLOCK", { scale: 2, center: true });
    setPixelText(document.getElementById("o-k3"), "F FLY   V CAMERA   T TIME OF DAY", { scale: 2, center: true });
    setPixelText(document.getElementById("o-cta"), "CLICK TO ENTER", { color: C.gold, outline: C.goldDeep, scale: 3, tracking: 1, center: true });
    setPixelText(document.getElementById("o-credit"), "CRIMSON WALLS - GILDED ROOFS - LANTERN STREETS", { color: C.dim, scale: 1, center: true });

    // 暂停页
    setPixelText(document.getElementById("p-title"), "PAUSED", { color: C.gold, outline: C.goldDeep, shadow: "#000", scale: 5, tracking: 2, center: true });
    setPixelText(document.getElementById("p-sub"), BRAND, { color: C.jade, scale: 2, center: true });
    setPixelText(document.getElementById("p-k1"), "WASD MOVE   SPACE JUMP   SHIFT SPRINT", { scale: 2, center: true });
    setPixelText(document.getElementById("p-k2"), "LMB BREAK   RMB PLACE   1-9 SELECT", { scale: 2, center: true });
    setPixelText(document.getElementById("p-k3"), "F FLY   V CAMERA   O SETTINGS   M MAP", { scale: 2, center: true });
    setPixelText(document.getElementById("p-cta"), "CLICK TO RESUME", { color: C.gold, scale: 3, center: true });

    // 加载页
    setPixelText(document.getElementById("load-glyph"), BRAND, { color: C.gold, outline: C.goldDeep, shadow: "#000", scale: 4, tracking: 2, center: true });
  }

  _refreshTimeButtons() {
    const playing = this.daynight.playing;
    setPixelText(this.btnCycle, playing ? "CYCLE ON" : "CYCLE OFF", { color: playing ? C.gold : C.dim, scale: 1 });
    this.btnCycle.classList.toggle("on", playing);
    setPixelText(this.btnSpeed, `SPEED x${this.speeds[this.speedIndex]}`, { color: C.bone, scale: 1 });
  }

  showItemName(text) {
    this.dyn.itemname.set(text);
    const el = this.el.itemname;
    el.classList.add("show");
    this._nameTimer = 1.6;
  }

  /* ---------------- 时间控制 ---------------- */
  _bindTime() {
    const dn = this.daynight;
    this.el.slider.addEventListener("input", () => {
      dn.time = Number(this.el.slider.value);
      dn.playing = false;
      this._refreshTimeButtons();
    });
    document.querySelectorAll("#timepanel [data-time]").forEach((btn) => {
      btn.addEventListener("click", () => {
        dn.time = Number(btn.dataset.time);
        this.el.slider.value = String(dn.time);
        this.audio?.uiClick();
      });
    });
    this.btnCycle.addEventListener("click", () => {
      dn.playing = !dn.playing;
      this._refreshTimeButtons();
      this.audio?.uiClick();
    });
    this.btnSpeed.addEventListener("click", () => {
      this.speedIndex = (this.speedIndex + 1) % this.speeds.length;
      dn.speed = this.speeds[this.speedIndex];
      this._refreshTimeButtons();
      this.audio?.uiClick();
    });
  }

  /* ---------------- 键盘 ---------------- */
  // 按键由 core/input.js 的路由统一分发，这里只提供动作；滚轮切换快捷栏仍在这里（不是按键）
  selectHotbar(i) {
    this.inventory?.select(i);
    const def = this.inventory?.selectedItem;
    if (def) this.showItemName(def.label);
    this.audio?.uiSelect();
  }

  toggleHidden() {
    this.hidden = !this.hidden;
    this.el.hud.style.display = this.hidden ? "none" : "";
  }

  toggleDebug() {
    document.body.classList.toggle("debug");
  }

  toggleMinimap() {
    if (!this.minimap) return;
    this.minimap.visible = !this.minimap.visible;
    this.el.minimap.style.display = this.minimap.visible ? "" : "none";
    if (this.minimap.visible) this.minimap.update(true);
  }

  _bindKeys() {
    window.addEventListener("wheel", (e) => {
      if (!this.player.engaged || !this.inventory || (this.mount && this.mount.active) || this.gameMode !== "build") return;
      this.inventory.select(this.inventory.selected + (e.deltaY > 0 ? 1 : -1));
      const def = this.inventory.selectedItem;
      if (def) this.showItemName(def.label);
    }, { passive: true });
  }

  /* ---------------- 每帧刷新 ---------------- */
  update(dt, stats) {
    if (this._nameTimer > 0) {
      this._nameTimer -= dt;
      if (this._nameTimer <= 0) this.el.itemname.classList.remove("show");
    }
    // 调试面板（F3）不显示时不更新它的文字
    if (document.body.classList.contains("debug")) {
      this.dyn.fps.set(String(stats.fps));
      const p = this.player.position;
      this.dyn.pos.set(`${Math.round(p.x)} ${Math.round(p.y)} ${Math.round(p.z)}`);
      this.dyn.mode.set(
        (CAMERA_LABELS[this.player.mode] || this.player.mode).toUpperCase() + (this.player.flying ? " / FLY" : ""),
      );
      this.dyn.chunk.set(`${stats.chunks} / ${Math.round(stats.tris / 1000)}K`);
      this.dyn.clock.set(this.daynight.clockText);
    }
    if (this.daynight.playing) this.el.slider.value = String(Math.floor(this.daynight.time));
    if (this.minimap && (this._mmTick = (this._mmTick || 0) + 1) % 10 === 0) this.minimap.update();
  }

  setChunkProgress(pending) {
    const el = this.el.chunkprog;
    if (pending > 0) {
      this.dyn.chunkprog.set(`BUILDING CHUNKS  ${pending}`);
      el.classList.add("show");
    } else {
      el.classList.remove("show");
    }
  }

  /** 准星：正在操控角色时显示（键鼠 = 指针锁定，触屏 = 游戏进行中）；自由环绕视角不显示。 */
  setLocked(engaged) {
    this.el.crosshair.classList.toggle("hidden", !engaged || this.player.mode === "orbit");
  }

  setLoading(pct, msg) {
    this.el.loadbar.style.width = `${Math.round(pct * 100)}%`;
    if (msg) this.dyn.loadmsg.set(msg);
  }

  hideLoading() {
    this.el.loading.classList.add("hidden");
  }
}
