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

/** 旧版本存档升级到当前版本。目前只有 v1。 */
function migrate(data) {
  if (!data || typeof data !== "object") throw new Error("NOT A SAVE FILE");
  if (data.game !== "jadeveil") throw new Error("NOT A JADEVEIL SAVE");
  if (!(data.version >= 1)) throw new Error("UNKNOWN SAVE VERSION");
  if (data.version > SAVE_VERSION) throw new Error("SAVE IS FROM A NEWER VERSION");
  return data;
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
    if (this._saving) return false;
    this._saving = true;
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
        try {
          const data = migrate(JSON.parse(await file.text()));
          this.enabled = false; // 防止重载前的自动存档把刚导入的存档覆盖掉
          await idb("readwrite", (s) => s.put(data, SLOT));
          sessionStorage.setItem(AUTOLOAD_FLAG, "1");
          location.reload();
          resolve(true);
        } catch (err) {
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
