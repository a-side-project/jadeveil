/**
 * 玩家生命系统 —— 血量、氧气、受伤、死亡、回血。数值沿用 Minecraft 的手感：
 *
 *   · 20 点血（10 颗心）；摔落伤害 = 下落格数 - 3（落进水里、从龙背上被放下不算）
 *   · 氧气 10 秒；耗尽后每秒扣 2 点（溺水）
 *   · 脱离伤害 6 秒后开始自然回血，每 2 秒 1 点
 *   · 受伤后 0.5 秒无敌帧，避免同一来源一帧内重复结算
 *   · 掉出世界直接死亡
 *
 * 只产生数据和事件（player:damage / player:heal / player:death / player:respawn），
 * 闪红、音效、死亡界面都由订阅方处理。
 */
import { events } from "./events.js";

export const MAX_HP = 20;
export const MAX_AIR = 10;
const REGEN_DELAY = 6;
const REGEN_INTERVAL = 2;
const INVULN = 0.5;
const DROWN_INTERVAL = 1;
const DROWN_DAMAGE = 2;
const SAFE_FALL = 3;

/** 死因 → 死亡界面上的一行字。 */
export const DEATH_TEXT = {
  fall: "FELL FROM A HIGH PLACE",
  drown: "DROWNED",
  void: "FELL OUT OF THE WORLD",
  generic: "WAS SLAIN",
};

export class PlayerHealth {
  constructor() {
    this.hp = MAX_HP;
    this.air = MAX_AIR;
    this.dead = false;
    this.cause = null;
    this._sinceHurt = 99;
    this._regenT = 0;
    this._invuln = 0;
    this._drownT = 0;
  }

  get maxHp() { return MAX_HP; }

  /**
   * 受到伤害。返回实际扣除的血量。
   * @param {number} amount
   * @param {string} cause  fall | drown | void | generic
   */
  damage(amount, cause = "generic", opts = {}) {
    if (this.dead || amount <= 0) return 0;
    if (this._invuln > 0 && !opts.bypassInvuln) return 0;
    const dealt = Math.min(this.hp, Math.round(amount));
    if (dealt <= 0) return 0;
    this.hp -= dealt;
    this._sinceHurt = 0;
    this._invuln = INVULN;
    events.emit("player:damage", { amount: dealt, cause, hp: this.hp });
    if (this.hp <= 0) this.kill(cause);
    return dealt;
  }

  heal(amount) {
    if (this.dead || this.hp >= MAX_HP) return 0;
    const h = Math.min(MAX_HP - this.hp, amount);
    this.hp += h;
    events.emit("player:heal", { amount: h, hp: this.hp });
    return h;
  }

  kill(cause = "generic") {
    if (this.dead) return;
    this.hp = 0;
    this.dead = true;
    this.cause = cause;
    events.emit("player:death", { cause, text: DEATH_TEXT[cause] || DEATH_TEXT.generic });
  }

  respawn() {
    this.hp = MAX_HP;
    this.air = MAX_AIR;
    this.dead = false;
    this.cause = null;
    this._sinceHurt = 99;
    this._invuln = 2; // 重生后的短暂保护
    events.emit("player:respawn", {});
  }

  /** 落地时调用：fall 为本次下落的格数。 */
  onLand(fall, player) {
    if (player.safeFall) {
      player.safeFall = false;
      return 0;
    }
    if (player.inWater || player.swimming) return 0;
    const dmg = Math.floor(fall - SAFE_FALL);
    return dmg > 0 ? this.damage(dmg, "fall", { bypassInvuln: true }) : 0;
  }

  update(dt, player) {
    this._invuln = Math.max(0, this._invuln - dt);
    if (this.dead) return;
    this._sinceHurt += dt;

    // ---- 氧气 / 溺水（骑龙时头不会在水下，自然不触发） ----
    if (player.headUnderwater) {
      this.air = Math.max(0, this.air - dt);
      if (this.air <= 0) {
        this._drownT -= dt;
        if (this._drownT <= 0) {
          this._drownT = DROWN_INTERVAL;
          this.damage(DROWN_DAMAGE, "drown", { bypassInvuln: true });
        }
      } else {
        this._drownT = 0;
      }
    } else {
      this.air = Math.min(MAX_AIR, this.air + dt * 5);
      this._drownT = 0;
    }

    // ---- 自然回血 ----
    if (this._sinceHurt > REGEN_DELAY && this.hp < MAX_HP) {
      this._regenT += dt;
      if (this._regenT >= REGEN_INTERVAL) {
        this._regenT = 0;
        this.heal(1);
      }
    } else {
      this._regenT = 0;
    }
  }

  serialize() {
    return { hp: this.hp, air: +this.air.toFixed(2) };
  }

  load(d) {
    if (!d) return;
    this.hp = Math.max(1, Math.min(MAX_HP, d.hp | 0 || MAX_HP));
    this.air = Math.max(0, Math.min(MAX_AIR, +d.air || MAX_AIR));
    this.dead = false;
  }
}
