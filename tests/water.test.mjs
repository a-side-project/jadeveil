/**
 * 水体 / 游泳测试
 *
 * 覆盖用户报告的问题：
 *   「到水面下向上看，水面整个消失」—— 水面材质被反射逻辑隐藏且未恢复
 * 以及新实现的游泳系统：
 *   入水浮力、主动上/下潜、上岸恢复步行、化身游泳姿势
 *
 * 全部断言都是行为性的（位置、状态、可见性），不做「不超过 X」式的弱断言。
 */
export const WATER_TEST_SOURCE = `
(() => {
  const P = window.__pandaria;
  if (!P) return { error: "window.__pandaria not ready" };
  const { world, player, avatar, renderer } = P;
  const BLOCKS = P.BLOCKS;
  const AIR = 0;
  const WATER_ID = BLOCKS.findIndex((b) => b && b.name === "water");
  const results = [];

  /* 找一根露天水柱：水面之上是空气，水下连续，底部是实心 */
  function findWater() {
    for (let x = -70; x <= 70; x += 2) {
      for (let z = -70; z <= 70; z += 2) {
        let top = -1;
        for (let y = 48; y >= 26; y--) {
          if (world.get(x, y, z) === WATER_ID) { top = y; break; }
        }
        if (top < 0) continue;
        if (world.get(x, top + 1, z) !== AIR) continue;
        let bottom = top;
        while (bottom > 0 && world.get(x, bottom - 1, z) === WATER_ID) bottom--;
        // 底部必须是实心，否则玩家会一直往下掉，测不出悬浮
        const under = world.get(x, bottom - 1, z);
        if (under === AIR || under === WATER_ID) continue;
        if (top - bottom < 2) continue;
        return { x: x, z: z, top: top, bottom: bottom, surface: top + 1 };
      }
    }
    return null;
  }

  /* 在附近找一块干燥陆地：地面实心、上方两格空气 */
  function findLand(px, pz, surfaceY) {
    for (let r = 3; r < 60; r++) {
      for (let a = 0; a < 32; a++) {
        const th = (a / 32) * Math.PI * 2;
        const x = Math.round(px + Math.cos(th) * r);
        const z = Math.round(pz + Math.sin(th) * r);
        // 岸可能比水面高不少（山地湖岸），所以纵向范围要给足
        for (let y = surfaceY + 18; y >= surfaceY - 8; y--) {
          const under = world.get(x, y - 1, z);
          if (under === AIR || under === WATER_ID) continue;
          if (world.get(x, y, z) === AIR && world.get(x, y + 1, z) === AIR) {
            return { x: x, z: z, y: y };
          }
        }
      }
    }
    return null;
  }

  function place(x, y, z) {
    player.position.set(x, y, z);
    player.velocity.set(0, 0, 0);
    player.flying = false;
    player.onGround = false;
    player.keys.clear();
    player.pitch = 0;
    player.targetPitch = 0;
  }

  function run(frames) {
    for (let i = 0; i < frames; i++) player.update(1 / 60);
  }

  /* 与 main.js 相同的驱动方式，让化身姿势跟上玩家状态 */
  function stepAvatar(dt) {
    avatar.setMode("third");
    avatar.placeTo(player.position);
    avatar.update(dt, {
      swimming: player.swimming,
      submersion: player.submersion,
      onGround: player.onGround,
      speed: Math.hypot(player.velocity.x, player.velocity.z),
      sprinting: player.sprinting,
      flying: player.flying,
      yaw: player.yaw,
    });
  }

  const spot = findWater();

  // ---------- 1. 潜水时水面依旧可见（用户报告的 bug） ----------
  {
    const detail = [];
    if (!spot) {
      detail.push({ pass: false, reason: "no water column found" });
    } else {
      const L = renderer.waterLevel;
      const saved = renderer.camera.position.clone();
      // 把相机放到水面之下，并让水下混合量收敛
      renderer.camera.position.set(spot.x + 0.5, L - 2, spot.z + 0.5);
      for (let i = 0; i < 90; i++) renderer.updateWaterView(1 / 60);
      renderer.renderReflection();
      detail.push({
        cameraY: +(L - 2).toFixed(2),
        waterLevel: L,
        surfaceMaterialVisible: renderer.matWater.visible,
        underwaterBlend: +renderer.underwaterBlend.toFixed(2),
        fogColor: "#" + renderer.scene.fog.color.getHexString(),
        pass: renderer.matWater.visible === true && renderer.underwaterBlend > 0.9,
      });
      // 还原
      renderer.camera.position.copy(saved);
      for (let i = 0; i < 90; i++) renderer.updateWaterView(1 / 60);
    }
    results.push({
      test: "Water surface stays visible while submerged (reported bug)",
      detail,
      pass: detail.every((d) => d.pass),
    });
  }

  // ---------- 2. 从空中落入水中 → 浮在水面，头露出水面 ----------
  {
    const detail = [];
    if (!spot) {
      detail.push({ pass: false, reason: "no water column found" });
    } else {
      place(spot.x + 0.5, spot.surface + 7, spot.z + 0.5);
      run(600); // 10 秒
      const y = player.position.y;
      const vy = Math.abs(player.velocity.y);
      const headAbove = player.eyePosition.y > spot.surface;
      const submerged = player.submersion >= 0.65 && player.submersion <= 0.98;
      const settled = vy < 0.6;
      const aboveBottom = y >= spot.bottom - 0.05;
      const stillInWater = player.swimming === true;
      detail.push({
        dropFrom: spot.surface + 7,
        surfaceY: spot.surface,
        pondBottom: spot.bottom,
        settledY: +y.toFixed(2),
        submersion: +player.submersion.toFixed(2),
        vy: +vy.toFixed(2),
        headAboveWater: headAbove,
        swimming: stillInWater,
        pass: settled && headAbove && submerged && aboveBottom && stillInWater,
      });
    }
    results.push({
      test: "Falling into water settles afloat with head above the surface",
      detail,
      pass: detail.every((d) => d.pass),
    });
  }

  // ---------- 3. 主动下潜 / 上浮 ----------
  {
    const detail = [];
    if (!spot) {
      detail.push({ pass: false, reason: "no water column found" });
    } else {
      // 先在水面稳定
      place(spot.x + 0.5, spot.surface - 1, spot.z + 0.5);
      run(360);
      const yFloat = player.position.y;

      // Ctrl 下潜
      player.keys.add("ControlLeft");
      run(150);
      const yDown = player.position.y;
      const headUnder = player.headUnderwater;
      player.keys.clear();

      // 沉到水底，再用 Space 上浮
      place(spot.x + 0.5, spot.bottom + 0.4, spot.z + 0.5);
      run(20);
      const yDeep = player.position.y;
      player.keys.add("Space");
      run(150);
      const yUp = player.position.y;
      player.keys.clear();
      run(240);

      detail.push({
        floatY: +yFloat.toFixed(2),
        afterDiveY: +yDown.toFixed(2),
        diveDelta: +(yDown - yFloat).toFixed(2),
        headUnderwaterWhileDiving: headUnder,
        deepY: +yDeep.toFixed(2),
        afterAscendY: +yUp.toFixed(2),
        ascendDelta: +(yUp - yDeep).toFixed(2),
        // 下潜必须真的下去，上浮必须真的上去
        pass: yDown < yFloat - 0.5 && yUp > yDeep + 0.5,
      });
    }
    results.push({
      test: "Ctrl dives and Space surfaces",
      detail,
      pass: detail.every((d) => d.pass),
    });
  }

  // ---------- 4. 上岸后恢复步行（不再处于游泳状态） ----------
  {
    const detail = [];
    const land = spot ? findLand(spot.x, spot.z, spot.surface) : null;
    if (!land) {
      detail.push({ pass: false, reason: "no land column found near water" });
    } else {
      place(land.x + 0.5, land.y + 1.2, land.z + 0.5);
      run(240);
      detail.push({
        landAt: [land.x, land.y, land.z],
        settledY: +player.position.y.toFixed(2),
        onGround: player.onGround,
        swimming: player.swimming,
        inWater: player.inWater,
        pass: player.swimming === false && player.onGround === true &&
              Math.abs(player.position.y - land.y) < 0.6,
      });
    }
    results.push({
      test: "Leaving the water restores normal walking",
      detail,
      pass: detail.every((d) => d.pass),
    });
  }

  // ---------- 5. 化身姿势：水中放平，陆上直立 ----------
  {
    const detail = [];
    if (!spot) {
      detail.push({ pass: false, reason: "no water column found" });
    } else {
      // 水中
      place(spot.x + 0.5, spot.surface - 1.2, spot.z + 0.5);
      run(240);
      for (let i = 0; i < 240; i++) stepAvatar(1 / 60);
      const swimRot = avatar.body.rotation.x;
      const swimBlend = avatar._swim;

      // 陆上：站到真正的岸上，而不是水面正上方（否则会再掉回水里）
      const shore = findLand(spot.x, spot.z, spot.surface);
      if (!shore) {
        detail.push({ pass: false, reason: "no land column found for standing pose" });
      } else {
        place(shore.x + 0.5, shore.y + 1.2, shore.z + 0.5);
        for (let i = 0; i < 300; i++) {
          player.update(1 / 60);
          stepAvatar(1 / 60);
        }
        const landRot = avatar.body.rotation.x;
        const landBlend = avatar._swim;

        detail.push({
          swimBodyPitch: +swimRot.toFixed(2),
          swimBlend: +swimBlend.toFixed(2),
          shoreY: shore.y,
          standingY: +player.position.y.toFixed(2),
          onGround: player.onGround,
          landBodyPitch: +landRot.toFixed(2),
          landBlend: +landBlend.toFixed(2),
          // 游泳时身体放平（明显前倾），陆上基本直立
          pass: swimRot < -1.0 && swimBlend > 0.8 &&
                player.onGround === true &&
                Math.abs(landRot) < 0.30 && landBlend < 0.15,
        });
      }
    }
    results.push({
      test: "Avatar lies flat while swimming, stands upright on land",
      detail,
      pass: detail.every((d) => d.pass),
    });
  }

  // 还原：把玩家放回岸边，避免影响后续测试
  if (spot) {
    const land = findLand(spot.x, spot.z, spot.surface);
    if (land) place(land.x + 0.5, land.y + 1.05, land.z + 0.5);
  }
  avatar.setMode("first");

  const failed = results.filter((r) => !r.pass);
  return {
    total: results.length,
    passed: results.length - failed.length,
    failed: failed.length,
    results,
  };
})()
`;
