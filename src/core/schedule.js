/**
 * 系统调度表 —— 每种游戏状态下，哪些系统在跑。
 *
 * 主循环不再到处写 `if (playing)`：每帧先按当前状态查这张表，再按系统组决定更新与否。
 * 新增状态或系统时只改这里，不会再出现「暂停了角色还在往下掉」「死了还在自动存档」这类状态泄漏。
 *
 *   sim     玩家物理、坐骑、战斗、技能、方块物理、掉落物、火把、生命（摔落 / 溺水 / 回血）、游玩时长
 *   input   接受玩家操作（移动按键、出招、挖放、技能）
 *   npcs    居民
 *   clock   昼夜时间推进
 *   save    自动存档计时
 */
export const SCHEDULE = {
  //            sim    input  npcs   clock  save
  title:     { sim: false, input: false, npcs: true, clock: true, save: false },
  play:      { sim: true, input: true, npcs: true, clock: true, save: true },
  // 开场巡游镜头：世界在动，但玩家还不能操作
  cinematic: { sim: true, input: false, npcs: true, clock: true, save: false },
  // 背包与 Minecraft 一致：世界不暂停（打开背包时仍可能被攻击、溺水）
  inventory: { sim: true, input: false, npcs: true, clock: true, save: true },
  // 暂停与设置：整个世界静止（进入暂停时立即存一次档，见 main.js pauseGame）
  paused:    { sim: false, input: false, npcs: false, clock: false, save: false },
  settings:  { sim: false, input: false, npcs: false, clock: false, save: false },
  // 死亡：身体不动、不存档（避免把「死在水底」存进档里），世界照常
  dead:      { sim: false, input: false, npcs: true, clock: true, save: false },
  // 自动化测试：测试脚本自己驱动玩家，主循环不叠加输入与存档
  test:      { sim: true, input: false, npcs: true, clock: true, save: false },
};

/** 当前帧的调度（未知状态按暂停处理 —— 宁可静止，也不能让世界在看不见的状态里跑）。 */
export function scheduleFor(mode, cinematic) {
  if (mode === "play" && cinematic) return SCHEDULE.cinematic;
  return SCHEDULE[mode] || SCHEDULE.paused;
}
