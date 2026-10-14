/**
 * 小地图 —— 俯视渲染玩家周围的地形高度与地标。
 * 用离屏 canvas 缓存地形，只在玩家跨区块时重绘。
 */
import { ID } from "../world/blocks.js";
import { CW } from "../world/voxelWorld.js";

const PALETTE = {
  [ID.grass]: "#74ab4d",
  [ID.dirt]: "#6b543c",
  [ID.rock]: "#7d8286",
  [ID.stone_dark]: "#4a545a",
  [ID.moss_stone]: "#5d8b45",
  [ID.slate]: "#6e7a80",
  [ID.marble]: "#ded7c6",
  [ID.sand]: "#d9c290",
  [ID.water]: "#3e7c8c",
  [ID.wall_red]: "#c0392b",
  [ID.wall_base]: "#8e2a20",
  [ID.pillar_red]: "#c0392b",
  [ID.roof_gold]: "#e8b44a",
  [ID.roof_gold_ridge]: "#ffe08a",
  [ID.roof_eave]: "#e8b44a",
  [ID.roof_corner]: "#ffd98a",
  [ID.roof_ink]: "#3a4a52",
  [ID.roof_ink_eave]: "#3a4a52",
  [ID.jade_block]: "#4a9e8f",
  [ID.bamboo]: "#7fa650",
  [ID.bamboo_leaf]: "#a8cb70",
  [ID.pine_leaf]: "#3f6b3a",
  [ID.lantern]: "#ffb35c",
  [ID.glow]: "#ffe9b0",
  [ID.gold_brick]: "#a8731f",
  [ID.beam_painted]: "#4a9e8f",
  [ID.wood_beam]: "#6d4c31",
  [ID.railing_marble]: "#ded7c6",
  [ID.cloud]: "#f2f6fa",
};

export class Minimap {
  constructor(world, player, canvas) {
    this.world = world;
    this.player = player;
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.size = canvas.width;
    this.range = 72;
    this._lastCx = null;
    this._lastCz = null;
    this._buf = document.createElement("canvas");
    this._buf.width = this.size;
    this._buf.height = this.size;
    this._bctx = this._buf.getContext("2d");
    this.visible = true;
  }

  _renderTerrain(px, pz) {
    const ctx = this._bctx;
    const S = this.size;
    const R = this.range;
    ctx.fillStyle = "#0b1014";
    ctx.fillRect(0, 0, S, S);

    const step = (R * 2) / S;
    for (let sy = 0; sy < S; sy++) {
      for (let sx = 0; sx < S; sx++) {
        const wx = Math.round(px - R + sx * step);
        const wz = Math.round(pz - R + sy * step);
        const h = this.world.groundHeight(wx, wz);
        if (h < 0) continue;
        const id = this.world.get(wx, h, wz);
        let color = PALETTE[id];
        if (!color) {
          const t = Math.min(1, Math.max(0, (h - 20) / 60));
          const v = Math.round(60 + t * 90);
          color = `rgb(${v},${v + 8},${v - 6})`;
        }
        ctx.fillStyle = color;
        ctx.fillRect(sx, sy, 1, 1);
      }
    }
  }

  update(force = false) {
    if (!this.visible) return;
    const p = this.player.position;
    const cx = Math.floor(p.x / CW);
    const cz = Math.floor(p.z / CW);
    if (force || cx !== this._lastCx || cz !== this._lastCz) {
      this._lastCx = cx;
      this._lastCz = cz;
      this._renderTerrain(p.x, p.z);
    }

    const ctx = this.ctx;
    const S = this.size;
    ctx.clearRect(0, 0, S, S);
    ctx.drawImage(this._buf, 0, 0);

    ctx.save();
    ctx.translate(S / 2, S / 2);
    ctx.rotate(-this.player.yaw + Math.PI);
    ctx.fillStyle = "#ffe9b8";
    ctx.strokeStyle = "rgba(0,0,0,0.7)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.lineTo(4.5, 5);
    ctx.lineTo(0, 2.5);
    ctx.lineTo(-4.5, 5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    ctx.strokeStyle = "rgba(232,180,74,0.35)";
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, S - 1, S - 1);
  }
}
