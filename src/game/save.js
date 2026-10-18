/**
 * 存档系统 —— 纯本地单机：
 *
 *   · 主存储：IndexedDB（容量大、异步、不阻塞渲染），单槽位 "main"
 *   · 自动存档：每 30 秒 + 切走 / 关闭页面时（visibilitychange → hidden）
 *   · 导出：下载一个 .jadeveil 文件（JSON）；导入：读文件 → 校验 → 写回 IndexedDB → 重载并直接进入
 *   · 版本号 + 迁移：SAVE_VERSION 变化时在 migrate() 里升级旧存档，读不懂的字段一律丢弃而不是崩
 *
 * 存档内容只有「状态」：玩家、背包、时间、世界差量（WorldEdits）、地上掉落物。
 * 世界本身由固定种子重新生成，所以文件通常只有几 KB。
 */
const DB_NAME = "jadeveil";
const STORE = "saves";
const SLOT = "main";
export const SAVE_VERSION = 1;
const AUTOSAVE_INTERVAL = 30;
/** 读档后直接进入游戏的一次性标记（导入存档后页面会重载） */
const AUTOLOAD_FLAG = "jadeveil.autoload";

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idb(mode, fn) {
  const db = await openDB();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req && req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const isInt = (v) => Number.isInteger(v);
const isStr = (v) => typeof v === "string" && v.length > 0 && v.length < 80;

/**
 * 存档结构校验 —— 读档 / 导入的唯一入口，在任何系统读取之前执行。
 *
 *   · 结构性错误（缺字段、类型不对、坐标不是数字）：整个存档拒绝，世界一个字节都不改
 *     （旧版逐个系统 load，前面的世界差量已经重放了，后面的背包才抛错 —— 留下半读的世界）
 *   · 条目级错误（某一格物品、某个掉落物坏了）：只丢弃那一条，其余照常读
 * 返回一份干净的副本。
 */
export function validateSave(d) {
  const bad = (what) => { throw new Error(`SAVE IS DAMAGED (${what})`); };
  const p = d.player;
  if (!p || !Array.isArray(p.pos) || p.pos.length !== 3 || !p.pos.every(isNum)) bad("PLAYER POSITION");
  const out = { ...d };
  out.player = {
    pos: p.pos.slice(),
    yaw: isNum(p.yaw) ? p.yaw : 0,
    pitch: isNum(p.pitch) ? Math.max(-1.55, Math.min(1.55, p.pitch)) : 0,
    mode: ["first", "third", "orbit"].includes(p.mode) ? p.mode : "first",
  };
  const h = d.health || {};
  out.health = { hp: isNum(h.hp) ? Math.max(0, Math.min(20, Math.round(h.hp))) : 20, air: isNum(h.air) ? Math.max(0, Math.min(10, h.air)) : 10 };
  const inv = d.inventory;
  if (inv && typeof inv === "object") {
    if (!Array.isArray(inv.slots)) bad("INVENTORY");
    out.inventory = {
      selected: isInt(inv.selected) && inv.selected >= 0 && inv.selected < 9 ? inv.selected : 0,
      slots: inv.slots.slice(0, 36).map((s) => (Array.isArray(s) && isStr(s[0]) && isInt(s[1]) && s[1] > 0 && s[1] <= 64 ? [s[0], s[1]] : null)),
    };
  }
  const wd = d.world;
  if (wd) {
    if (!Array.isArray(wd.palette) || !Array.isArray(wd.list) || wd.list.length % 4 !== 0) bad("WORLD EDITS");
    if (!wd.palette.every(isStr) || !wd.list.every(isInt)) bad("WORLD EDITS");
    if (wd.list.some((v, i) => i % 4 === 3 && (v < 0 || v >= wd.palette.length))) bad("WORLD EDITS");
    out.world = { palette: wd.palette.slice(), list: wd.list.slice() };
  }
  out.drops = Array.isArray(d.drops) ? d.drops.filter((e) => Array.isArray(e) && isStr(e[0]) && isInt(e[1]) && e[1] > 0 && isNum(e[2]) && isNum(e[3]) && isNum(e[4])) : [];
  out.time = isNum(d.time) ? ((d.time % 1440) + 1440) % 1440 : 420;
  out.playTime = isNum(d.playTime) && d.playTime >= 0 ? d.playTime : 0;
  out.mode = d.mode === "build" ? "build" : "adventure";
  const sk = d.skills;
  out.skills = sk && Array.isArray(sk.learned) ? { learned: sk.learned.filter(isStr), practice: isInt(sk.practice) && sk.practice >= 0 ? sk.practice : 0 } : null;
  return out;
}

/** 旧版本存档升级到当前版本（目前只有 v1），并做结构校验。 */
function migrate(data) {
  if (!data || typeof data !== "object") throw new Error("NOT A SAVE FILE");
  if (data.game !== "jadeveil") throw new Error("NOT A JADEVEIL SAVE");
  if (!(data.version >= 1)) throw new Error("UNKNOWN SAVE VERSION");
  if (data.version > SAVE_VERSION) throw new Error("SAVE IS FROM A NEWER VERSION");
  return validateSave(data);
}

export class SaveManager {
  /**
   * @param {() => object} collect  采集当前游戏状态（由 main.js 提供）
   */
  constructor(collect) {
    this.collect = collect;
    this.enabled = false; // 进入游戏之后才开始自动存档（标题页不存）
    this._t = 0;
    this._saving = false;
    this.lastSavedAt = 0;
    this.onSaved = null;

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden" && this.enabled) this.save();
    });
  }

  /** 读取存档（不存在返回 null；损坏的存档抛错由调用方提示）。 */
  async load() {
    const raw = await idb("readonly", (s) => s.get(SLOT));
    return raw ? migrate(raw) : null;
  }

  /** 只取存档摘要（标题页显示「继续」按钮用）。 */
  async peek() {
    try {
      const d = await this.load();
      return d ? { savedAt: d.savedAt, playTime: d.playTime || 0, edits: d.world?.list?.length / 4 || 0 } : null;
    } catch (err) {
      return { corrupt: true, error: String(err.message || err) };
    }
  }

  async save() {
    // 正在存：等它存完再存一次最新状态（旧版直接返回 false —— 紧接着导出会拿到旧存档）
    if (this._saving) return this._savePromise.then(() => this.save());
    this._saving = true;
    let done;
    this._savePromise = new Promise((r) => (done = r));
    try {
      const data = {
        game: "jadeveil",
        version: SAVE_VERSION,
        savedAt: Date.now(),
        ...this.collect(),
      };
      await idb("readwrite", (s) => s.put(data, SLOT));
      this.lastSavedAt = data.savedAt;
      this.onSaved?.(data);
      return true;
    } catch (err) {
      console.error("[save] failed", err);
      return false;
    } finally {
      this._saving = false;
      done();
    }
  }

  async wipe() {
    await idb("readwrite", (s) => s.delete(SLOT));
  }

  update(dt) {
    if (!this.enabled) return;
    this._t += dt;
    if (this._t >= AUTOSAVE_INTERVAL) {
      this._t = 0;
      this.save();
    }
  }

  /** 导出：先存一次（保证是最新状态），再下载 JSON 文件。 */
  async exportFile() {
    if (this.enabled) await this.save();
    const data = await this.load();
    if (!data) return false;
    const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
    const a = document.createElement("a");
    const stamp = new Date(data.savedAt).toISOString().slice(0, 16).replace(/[:T]/g, "-");
    a.href = URL.createObjectURL(blob);
    a.download = `jadeveil-${stamp}.jadeveil`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 1000);
    return true;
  }

  /**
   * 导入：弹文件选择框 → 校验 → 覆盖本地存档 → 重载页面并直接读档进入。
   * 重载而不是原地替换：世界差量必须重放在「干净的」生成世界上。
   */
  importFile() {
    return new Promise((resolve, reject) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".jadeveil,.json,application/json";
      input.onchange = async () => {
        const file = input.files && input.files[0];
        if (!file) return resolve(false);
        const wasEnabled = this.enabled;
        try {
          const data = migrate(JSON.parse(await file.text()));
          this.enabled = false; // 防止重载前的自动存档把刚导入的存档覆盖掉
          await idb("readwrite", (s) => s.put(data, SLOT));
          sessionStorage.setItem(AUTOLOAD_FLAG, "1");
          location.reload();
          resolve(true);
        } catch (err) {
          this.enabled = wasEnabled; // 导入失败：恢复自动存档（旧版会一直关着，直到刷新页面）
          reject(err);
        }
      };
      input.click();
    });
  }

  /** 页面重载后是否应该跳过标题页直接读档（导入之后）。 */
  static consumeAutoload() {
    try {
      const v = sessionStorage.getItem(AUTOLOAD_FLAG);
      sessionStorage.removeItem(AUTOLOAD_FLAG);
      return v === "1";
    } catch {
      return false;
    }
  }
}
