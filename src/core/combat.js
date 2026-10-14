/* PS.Combat v2 —— 武器开火/弹道/近战/环绕星
 * 相对 v1 新增: 散弹扇形(spread)、环绕星(orbit 常驻体)、光束弹(beam 视觉)、
 *   近战吸血(lifestealHit)、击退抗性(knockRes)、职业×分类乘区(meleePct/rangedPct)。
 */
(function (global) {
  'use strict';
  var PS = global.PS || {};
  var C = PS.Combat = {};
  /* ---- 视觉态契约(与 src/ui/art.js 的 drawWeaponRing / drawWeaponIcon 对齐) ----
   * 开火/挥击时往 slot 上写这几个字段, 美术层据此把武器"真的抡过去 / 转向目标 / 后坐"。
   * 它们**只被美术层读**, 不参与任何数值计算 —— 缺了顶多没有动画, 判定与数值一字不变。
   * (历史教训: 视觉字段一旦参与判定, "改画法"就会变成"改平衡"。这里从接口上禁止。) */
  var V_AIM = 0.5, V_FIRE = 0.12;
  /** 交给特效层的"这把武器长什么样"; 形状类由 art.js 单点判定, 特效层只消费不判断 */
  function weaponInfo(def, slot, extra) {
    var o = {
      shape: (PS.Art && PS.Art.weaponShape) ? PS.Art.weaponShape(def) : null,
      /* v5.19: family 是特效层选**招式**的主键(见 src/ui/fx.js 五·A 的 MEL_FAMILY)。
       * 只是一条只读身份, 不参与任何数值 —— 与本节开头「视觉字段不进判定」的纪律一致。 */
      family: def.family,
      elem: !!def.elem, tier: (slot && slot.tier) || def.tier || 1, cls: def.cls
    };
    if (extra) for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) o[k] = extra[k];
    return o;
  }
  C.weaponInfo = weaponInfo;   /* game.js 的环绕体(圆盘锯/穿心钻)要用同一份身份 */

  C.findTarget = function (game, wx, wy, range, mode) {
    var best = null, bestD = Infinity, i, e, d;
    for (i = 0; i < game.enemies.length; i++) {
      e = game.enemies[i];
      if (e.dead || e.spawnT > 0) continue;
      d = PS.util.dist(wx, wy, e.x, e.y);
      if (mode === 'nearest') { if (d <= range && d < bestD) { bestD = d; best = e; } }
      else if (mode === 'farthest') { if (d <= range && d > (best ? bestD : -1)) { bestD = d; best = e; } }
    }
    if (!best && mode === 'random') {
      var pool = [];
      for (i = 0; i < game.enemies.length; i++) {
        e = game.enemies[i];
        if (!e.dead && e.spawnT <= 0 && PS.util.dist(wx, wy, e.x, e.y) <= range) pool.push(e);
      }
      if (pool.length) best = pool[(Math.random() * pool.length) | 0];
    }
    return best;
  };

  C.dealDamage = function (game, e, raw, opts) {
    opts = opts || {};
    /* v3.0 源对齐(见 qa/v3-port-spec.md §2.6): 暴击倍率取**武器自带 critMul**(源武器表 1.25~4.0; 实取值 1.25/1.5/1.75/2/2.15/2.3/2.5/3/3.5/4),
     *   全局"固定暴击伤害"不再参与 —— 玩家侧没有暴击伤害成长项(用户要求)。
     *   对精英/Boss 的 dmgVsBossPct 也在这里结账。 */
    var st0 = game.stats || {};
    /* v6.7(Wave 3) 中性物（树苗）: 源 neutral.gd:20-35 take_damage —— 伤害值**不进任何乘区**,
     *   只把"被打中的次数" +1; 第 number_of_hits_before_dying(8) 次、或持有 one_shot_trees 时一次即倒。
     *   所以这里不走暴击/吸血/承伤加成那一整套, 只扣次数。 */
    if (e.neutral) {
      e.hp -= ((st0.oneShotTrees || 0) > 0) ? 99 : 1;
      e.hitT = 0.12;
      game.onDamage(e, 1, false, opts);
      if (e.hp <= 0 && !e.dead) { e.dead = true; game.onKill(e, opts); }
      return 1;
    }
    var critMul = opts.crit ? (opts.critMul || 1.5) : 1;
    if (e.elite || e.boss) critMul *= 1 + (st0.dmgVsBossPct || 0) / 100;
    /* v5.6(G1): enemy_percent_damage_taken —— 源 unit.gd:500 `dmg = round(dmg * (1 + bonus/100))`,
     *   加在**护甲之前**的原始伤害上（本作敌人护甲恒 0, 见 tools/port-source.cjs 的 buildEnemies 断言）。
     *   bonus 来自该敌人身上还没超时的层（源 behavior 的 _percent_damage_taken）, 由 game.js 记账。 */
    if (PS.ItemTriggers) raw = PS.ItemTriggers.damageVsTarget(e, raw);
    /* v6.7(Wave 3) 源 enemy.gd:285-294 giant_crit_damage —— 暴击时额外加上**敌人当前生命**的 v%。
     *   源收尾还有一句 clamp(giant_bonus, 0, max(0, hp - dmg)); 本作下面 max(1, ·) 已兜底, 不重复夹。 */
    if (opts.crit && (st0.giantCritPct || 0) > 0)
      raw += Math.floor(Math.max(0, e.hp) * st0.giantCritPct / 100);
    var dmg = Math.max(1, Math.round(raw * (0.92 + Math.random() * 0.16) * critMul));
    e.hp -= dmg;
    e.hitT = 0.12;
    // 击退(带抗性)
    var res = 1 - (e.def && e.def.knockRes || 0);
    e.kx = (e.kx || 0) + (opts.kx || 0) * res;
    e.ky = (e.ky || 0) + (opts.ky || 0) * res;
    game.onDamage(e, dmg, opts.crit, opts);
    /* v5.6(G1): 命中后挂层 —— 源的 on_hurt 由 take_damage 的 took_damage 信号驱动（挂在取伤之后）,
     *   所以本帧这次命中用的是**挂层之前**的 bonus, 新层只影响后续命中。 */
    /* v6.7(Wave 3) 源 enemy.gd:254-256 remove_speed —— 每次命中把敌人当前移速扣掉**最大移速**的 v%,
     *   但不得低于 最大移速 × (1 - max_value/100)。两个通道都是百分数。
     *   注: 源只在统计重算(init_current_stats)时把速度还原, 本作同样不做逐帧回弹 —— 与源同向。 */
    if ((st0.slowOnHit || 0) > 0 && e.maxSpd > 0) {
      var floorSpd = e.maxSpd * Math.max(0, 1 - (st0.slowOnHitMax || 0) / 100);
      if (e.spd > floorSpd) e.spd = Math.max(floorSpd, e.spd - e.maxSpd * st0.slowOnHit / 100);
    }
    if (PS.ItemTriggers) PS.ItemTriggers.onHitEnemy(game, e, opts);
    /* v6.7(Wave 3) 源 unit.gd:581-583 —— 燃烧在**每次命中**掷一次。opts.hit 标记"这次伤害来自一次
     *   武器命中"; 燃烧 tick / 反伤 / 触发型伤害都不带它（源里那些路径也不带 burning_data）。 */
    if (opts.hit && !opts.burn && !e.dead && game.tryBurn) game.tryBurn(e, opts.burnSrc || null);
    if (e.hp <= 0 && !e.dead) { e.dead = true; game.onKill(e, opts); }
    return dmg;
  };

  /* 单发伤害公式: (面板dmg × 职业修正 + 固定值) × (1 + 通用% + 分类%)
   * v2.3: 通用%与分类%合并为**同一个加法池** —— 改前两个乘区互乘, 配合无限升级会导致
   * 伤害指数级膨胀(用户反馈「随便几百万伤害」)。加法池 + stats.js 的池上限 = 有界增长。 */
  C.weaponRaw = function (def, stats) {
    var clsMul = PS.WeaponData.classDmg[def.cls] || 1;
    /* v3.4(主程) 源保真修正: melee / ranged / elemental / engineering 是**固定值**词条, 不是百分比乘区。
     *   源证据(translations.csv):
     *     "<!MissingKey:366>Your melee attacks deal {0} additional damage>"
     *     "Your ranged attacks deal {0} additional damage" / "Elemental damage is increased by {0}"
     *     STAT_MELEE_DAMAGE="Melee Damage"(无 %) 对照 STAT_PERCENT_DAMAGE="% Damage"
     *   **唯一**的百分比伤害乘区是 dmgPct(源 stat_percent_damage)。
     *   改前写法 (def.dmg*clsMul + dmgFlat) * (1 + dmgPct + cat + spec) 把 "+2 点近战伤害" 当成 "+2%",
     *   而源武器基础伤害是 8~30 ⇒ 量级差约 10 倍, 是"数值不平衡"的最后一块结构性根因。
     *   标记来自 weapons.js: elem(火/冰/雷/等离子/幽灵/核家族) / structure(targeting==='orbit')。 */
    var flat = (stats.dmgFlat || 0);
    if (def.cls === 'melee') flat += (stats.meleeDmg || 0);
    else flat += (stats.rangedDmg || 0);
    if (def.elem) flat += (stats.eleDmg || 0);
    if (def.structure) flat += (stats.engDmg || 0);
    return (def.dmg * clsMul + flat) * (1 + stats.dmgPct);
  };

  /** 这把武器的**出膛口**(世界坐标)。几何算在 art.js 的 ringSlot 里 —— 与画面上那把武器共用
   *   同一份布局, 所以"子弹从枪口出"不是靠巧合, 是同一个函数算出来的。
   *   美术层缺失/抛错时退回旧的"身前 16px", 判定绝不受影响。
   *   ⚠ 调用前必须**先**把 vAng/vAim 写进 slot: ringSlot 读的就是这两个字段, 顺序反了会取到上一帧的枪口。 */
  function muzzleOf(g, wi, ang) {
    if (PS.Art && PS.Art.ringSlot) {
      try {
        var ms = PS.Art.ringSlot(g, wi);
        if (ms && isFinite(ms.tipX) && isFinite(ms.tipY)) return { x: ms.tipX, y: ms.tipY };
      } catch (e) { /* 退回兜底 */ }
    }
    return { x: g.player.x + Math.cos(ang) * 16, y: g.player.y + Math.sin(ang) * 16 };
  }

  C.fire = function (game, slot, stats, slotIdx) {
    var g = game, p = g.player;
    var def = PS.WeaponData.list[slot.key];
    /* 槽位下标: ringSlot 靠第几把武器定位出膛口。调用方直接传最省事; 没传时按对象查
     *   (工具/存档/调试路径可能只给 slot)。 */
    var wi = (slotIdx == null) ? (g.weapons || []).indexOf(slot) : slotIdx;
    if (!def) return;
    var raw = C.weaponRaw(def, stats);
    /* v3.0 源对齐: stat_range 的单位是 px(绝对射程), 走 rangeFlat 加法通道; rangePct 仍是乘区。
     *   同理 knockback 是 FLAT 加在武器击退上。 */
    var range = (def.range + (stats.rangeFlat || 0)) * stats.rangeMul;
    /* v3.8: 末尾的 knockMul 是角色特长「击退 +20%」的乘区(源无该口径, 本作新增; 默认 1 ⇒ 与源逐位一致)。 */
    var knockTotal = ((def.knock || 0) + (stats.knockback || 0)) * (stats.knockMul || 1);
    var critRoll = Math.random() * 100 < stats.crit;
    var i, ang, t, e, d, ea, dd;

    /* ---- 环绕星: 不开火, 常驻体在 game.updateOrbits 里驱动 ---- */
    if (def.targeting === 'orbit') return;

    if (def.targeting === 'arc') {
      t = C.findTarget(g, p.x, p.y, range + 50, 'nearest');
      ang = t ? Math.atan2(t.y - p.y, t.x - p.x) : (p.aimAng || 0);
      /* 挥击态: 时长跟着**实际攻速**走 —— 攻速越高抡得越快, 不会出现"刀抡完了但人还没打完" */
      slot.vAng = ang; slot.vAim = V_AIM;
      slot.vSwingDur = Math.min(0.22, Math.max(0.09, def.atkCd / Math.max(0.2, stats.atkSpdMul) * 0.55));
      slot.vSwing = slot.vSwingDur; slot.vSwingAng = ang; slot.vSwingArc = def.arc || 1.4;
      /* v5.19 近战挥击交**招式层**(fx.js 五·A): 旧实现在这里写死 '#e8c76a' 一道金色月牙, 于是锤/矛/
       * 拳套/镰/钻/剪刀 等 36 个近战家族打出来是同一张图 —— 与「61 族武器全长成一把铲子」同源。
       * 颜色也交回招式表(元素武器用元素色); 这里只负责报"我是谁"。 */
      if (def.cls === 'melee' && g.fx.strike) g.fx.strike(p.x, p.y, ang, range, def.arc || 1.4, weaponInfo(def, slot));
      else g.fx.swing(p.x, p.y, ang, range, def.arc || 1.4, def.cls === 'melee' ? '#e8c76a' : '#fff');
      PS.Sound.play(def.sfx);
      var hitAny = false, hxLast = 0, hyLast = 0;
      for (i = 0; i < g.enemies.length; i++) {
        e = g.enemies[i];
        if (e.dead || e.spawnT > 0) continue;
        d = PS.util.dist(p.x, p.y, e.x, e.y);
        if (d > range + e.r) continue;
        ea = Math.atan2(e.y - p.y, e.x - p.x);
        dd = Math.abs(((ea - ang + Math.PI * 3) % PS.TAU) - Math.PI);
        if (dd <= (def.arc || 1.4) / 2) {
          hitAny = true;
          /* 记下**真正被打中**的那一只 —— 打击反馈要落在它身上(见下方 if (hitAny) 段) */
          hxLast = e.x; hyLast = e.y;
          C.dealDamage(g, e, raw, {
            crit: critRoll, critMul: def.critMul,
            kx: Math.cos(ea) * knockTotal, ky: Math.sin(ea) * knockTotal, src: slot.key,
            elem: !!def.elem,   /* v5.6(G1): enemy_percent_damage_taken 的命中过滤依据 */
            hit: true           /* v6.7(Wave 3): 这是一次"武器命中" ⇒ 允许掷燃烧 */
          });
          // 近战吸血(每击)
          if (def.lifestealHit > 0) {
            g.player.hp = Math.min(g.stats.maxHp, g.player.hp + def.lifestealHit);
          }
          if (def.aoe && !e.dead) {
            g.aoeDamage(e.x, e.y, def.aoe, raw * 0.45, { crit: critRoll, critMul: def.critMul, src: slot.key, skip: e, knock: knockTotal * 0.35, elem: !!def.elem });
            g.fx.ring(e.x, e.y, '#d97b4a');
          }
        }
      }
      if (hitAny) {
        /* v5.5: 打击反馈落在**实际被打中那只敌人**的位置。旧实现固定写 range*0.6(射程的六成),
         *   贴脸打时火花飘在敌人外侧、长兵器落在敌人之前 —— 与「刀砍在怪身上」的因果对不上。
         *   (x,y) 就是命中点: PS.FX.weaponHit 的刀痕 / PS.FX.hitSpark 的火花都以它为圆心。 */
        g.fx.hitSpark(hxLast, hyLast, '#ffd24a');
        if (PS.FX && PS.FX.weaponHit) PS.FX.weaponHit(hxLast, hyLast, ang, weaponInfo(def, slot, { crit: critRoll }));
      }
      return;
    }

    /* ---- 远程 ---- */
    var target = C.findTarget(g, p.x, p.y, range, def.targeting === 'spread' ? 'nearest' : def.targeting);
    if (!target) return;
    var count = def.projCount || 1;
    var tAng = Math.atan2(target.y - p.y, target.x - p.x);
    /* 视觉态**先写**: ringSlot 读的就是 vAim/vAng —— 先写后取, 出膛口才落在"已经转向目标"的枪口上。
     *   顺序反过来会取到上一帧的枪口, 子弹就从枪管旁边飞出来。 */
    slot.vAng = tAng; slot.vAim = V_AIM; slot.vFire = V_FIRE; slot.vRecoil = V_FIRE;
    /* 弹体从**枪口**出(用户诉求), 不再从角色中心 16px 处出。
     *   散布弹(霰弹/连发)共用同一个枪口 —— 一枪多丸, 弹丸各飞各的角度。 */
    var mz = muzzleOf(g, wi, tAng);
    /* ---- v5.3 修「打空气」(用户实测: 武器贴着怪开火却打空) ----
     * 上面那一行的 tAng 是从**角色中心**量到目标的角度, 而弹体出生在**枪口**——两者不是同一个点。
     * 武器环绕在角色身边(ringBuild: R = 角色半径+5+件数, 整圈朝向还跟着鼠标 aimAng),
     * 所以"枪口→目标"与"角色中心→目标"这两条线之间有横向偏移, 最多可达 2R(≈46px)。
     * 弹体沿偏移后的平行线飞 ⇒ 半径 9~12px 的小怪被整发打空。
     * 实测(work/probe-airshot.cjs): 落空弹丸里有 17.9% 全程贴到怪 25px 以内却没判定命中。
     * 修法: 拿到枪口之后, **再按"枪口→目标"重算一次角度**(并从新角度重取枪口位置) ——
     * 这样弹道起点在枪口、且这条线**必然穿过目标圆心**, 偏移归零。两次足够收敛
     * (枪口只随枪的朝向移动, 不随角色位置移动; 第二次迭代的位移是二阶小量)。
     * 注意: 这**不改任何数值**(伤害/射速/射程/散布都不动), 只是把"已经算出来的那把枪"
     * 对准它本来就要打的那只怪 —— 命中率上升是"本该命中"的部分, 不是加强。 */
    var tdx = target.x - p.x, tdy = target.y - p.y;
    var dTar = Math.sqrt(tdx * tdx + tdy * tdy);
    var mdx0 = mz.x - p.x, mdy0 = mz.y - p.y;
    var dMuz0 = Math.sqrt(mdx0 * mdx0 + mdy0 * mdy0);
    if (dTar > 1e-6 && dMuz0 > dTar) {
      /* ---- v61 退化几何: 枪口**已经越过目标圆心** ----
       * 背景(实测, 不是推断): 修好 art.js 的 wP(P.k) 之后各族的**真实头长**才进 WREACH 表
       *   (fireball 的出膛口 0.94L → 2.68L), 而武器是环绕在角色身边的:
       *   枪口离角色中心的距离 = 环半径 R + tip。贴脸打 60px 的怪时这个距离**会超过怪物圆心**
       *   ⇒ 下面那次「按枪口→目标重算角度」出来的其实是 atan2(0, 负数) = **π**(指向身后),
       *   并且第二次取枪口会顺着 π 把枪口**转到身后**, 弹体于是从怪身上往反方向飞。
       * 实测症状(修正前): qa/verify-airshot.cjs「贴脸 60px」场景里 fireball_t2/t3/t4 与
       *   shuriken_t1~t4 命中恒为 0 —— 这就是用户报过的「武器索敌打空气」在贴身距离上的复活。
       * 修法: 只处理这个退化点 —— 把这一发的出生点拉回**目标近侧**(沿 角色中心→目标圆心 的线),
       *   发射角取「角色中心→目标圆心」⇒ 弹道必然朝前, 且出生点落在怪的近半侧,
       *   同一帧的「先判定后移动」就命中(见 updateProjectiles 的 CCD 段)。
       * 边界: dMuz0 <= dTar 时**一个像素都不动** ⇒ 出生点仍逐位等于出膛口(用户诉求「子弹从武器出」)。
       *   瞄准不变量的最坏几何是 R=46 / D>=50, 永远走不到这个分支。
       * 为什么不改门禁判据: 这是「贴身时枪口比怪还远」的几何事实, 与武器长度 / 环半径 / 怪半径
       *   三者都有关, 放宽判据只会把缺陷藏起来。 */
      var back = Math.max(0, dTar - Math.max(2, (target.r || 0) * 0.5));
      mz = { x: p.x + tdx / dTar * back, y: p.y + tdy / dTar * back };
      tAng = Math.atan2(tdy, tdx);
      slot.vAng = tAng;                         /* 视觉与弹道同源: 枪也朝这只怪 */
    } else {
      var tAngM = Math.atan2(target.y - mz.y, target.x - mz.x);
      if (isFinite(tAngM)) {
        tAng = tAngM;
        slot.vAng = tAng;                      /* 枪口视觉也再对齐一次(与弹道同源) */
        var mz2 = muzzleOf(g, wi, tAng);
        if (mz2 && isFinite(mz2.x) && isFinite(mz2.y)) mz = mz2;
      }
    }    for (i = 0; i < count; i++) {
      /* v3.5(源对齐) accuracy 的消费点 —— 见 stats.js 的 accFactor 注释(源 weapon_service.gd:256 +
       *   weapon.gd:354)。单发武器没有锥形散布, 与源里 accuracy 基础值 1.0 的武器等价 ⇒ 不受影响。 */
      var spread = count > 1 ? (i - (count - 1) / 2) * (def.spread || 0.2) * (stats.accFactor == null ? 1 : stats.accFactor) : 0;
      ang = tAng + spread;
      g.projectiles.push({
        x: mz.x, y: mz.y,
        ang: ang, spd: def.projSpd, r: def.beam ? 4 : 5 + slot.tier,
        dmg: raw, crit: critRoll, critMul: def.critMul,
        range: range * 1.2, travel: 0,
        /* v3.0: pierceBonus(源道具 piercing)/bounce(源道具 bounce) 由道具提供 */
        pierce: (def.pierce || 0) + (stats.pierceBonus || 0),
        bounce: (stats.bounce || 0), hitList: [],
        knock: knockTotal, color: def.beam ? '#9ac0e8' : '#e8b45a',
        boomerang: !!def.boomerang, back: false, beam: def.beam,
        key: slot.key,
        shp: weaponInfo(def, slot).shape, elem: !!def.elem, tier: slot.tier, cls: def.cls
      });
    }
    PS.Sound.play(def.sfx);
    g.fx.muzzle(mz.x, mz.y, tAng, def.beam ? '#b0d0f0' : '#e8b45a');
    if (PS.FX) {
      var winf = weaponInfo(def, slot, { crit: critRoll });
      if (def.beam && PS.FX.weaponBeam) PS.FX.weaponBeam(mz.x, mz.y, tAng, range, winf);
      if (PS.FX.weaponShot) PS.FX.weaponShot(mz.x, mz.y, tAng, winf);
      /* 高速弹(狙击/聚光/湮光)额外留一道拖尾: 弹速 1200px/s 以上单帧位移 >20px,
       *   没有拖尾就只看到"一个点闪过去", 看不出打的是哪条线。 */
      if (!def.beam && def.projSpd >= 1200 && PS.FX.weaponTrail) {
        PS.FX.weaponTrail(mz.x, mz.y, tAng, Math.min(40, def.projSpd * 0.02), winf);
      }
    }
  };

  C.updateProjectiles = function (game, dt) {
    var g = game, i, j, pr, e;
    /* v3.2 修复(主程): 源武器弹速最高 2500px/s, 单帧位移 41.7px 远大于命中半径
     *   (e.r + pr.r ≈ 18px) ⇒ 旧的"逐帧单点检测"让整发弹体从怪身上穿过去
     *   (实测: 第 1 波 5 发开火 0 命中, 玩家因此完全打不动怪 → 怪堆到同屏 18 只把人咬死)。
     *   现按"每段位移 <= SUB_PX"细分, 每次细分先做一次圆-圆判定 ⇒ 等价连续碰撞检测(CCD)。
     *   细分在"移动前"判定, 保证出生点即与怪重叠时也能命中(贴身怪不再免疫)。 */
    var SUB_PX = 8;
    for (i = g.projectiles.length - 1; i >= 0; i--) {
      pr = g.projectiles[i];
      var step = pr.spd * dt;
      var nSub = Math.max(1, Math.ceil(step / SUB_PX));
      var subStep = step / nSub;
      var gone = false;
      for (var si = 0; si < nSub; si++) {
        /* --- 先判定: 当前位置是否压到怪 --- */
        var stop = false;
        for (j = 0; j < g.enemies.length; j++) {
          e = g.enemies[j];
          if (e.dead || e.spawnT > 0) continue;
          if (pr.hitList.indexOf(e) >= 0) continue;
          var rr = e.r + pr.r;
          if (PS.util.dist2(pr.x, pr.y, e.x, e.y) < rr * rr) {
            pr.hitList.push(e);
            var ea = Math.atan2(e.y - pr.y, e.x - pr.x);
            C.dealDamage(g, e, pr.dmg, {
              crit: pr.crit, critMul: pr.critMul,
              kx: Math.cos(ea) * pr.knock, ky: Math.sin(ea) * pr.knock, src: pr.key,
              elem: !!pr.elem,  /* v5.6(G1): enemy_percent_damage_taken 的命中过滤依据 */
              hit: true,        /* v6.7(Wave 3): 武器命中 ⇒ 允许掷燃烧 */
              burnSrc: pr.burnSrc || null   /* 弹药自带的燃烧（结构体喷火哨座） */
            });
            g.fx.hitSpark(pr.x, pr.y, pr.color);
            /* v6.7(Wave 3) 命中即炸（源 turret_rocket_exploding_effect / landmine_exploding_effect,
             *   两者 chance 都是 1.0）。直击目标吃的是本条弹体自己的伤害, 故爆炸用 skip 把它排除,
             *   免得同一只怪在这一次命中里吃两遍。 */
            if (pr.boom && game.explodeAt) {
              game.explodeAt(e.x, e.y, { dmg: pr.dmg, scale: 0, stat: "dmgFlat", r: pr.boom.r, src: pr.key, skip: e });
            }
            if (PS.FX && PS.FX.weaponHit) {
              PS.FX.weaponHit(pr.x, pr.y, ea, { shape: pr.shp, elem: pr.elem, tier: pr.tier, cls: pr.cls, crit: pr.crit });
            }
            PS.Sound.play('hit');
            /* v3.0 源对齐: bounce(暴击弹射, 源道具 bounce) 优先于穿透 —— 暴击时把弹道指向下一个
             *   未命中的敌人并保留弹体; 否则按 pierce 递减, 用尽即销毁。 */
            if (pr.bounce > 0 && pr.crit) {
              var nextT = null, bestD2 = Infinity;
              for (var bi = 0; bi < g.enemies.length; bi++) {
                var be = g.enemies[bi];
                if (be.dead || be.spawnT > 0 || pr.hitList.indexOf(be) >= 0) continue;
                var dd2 = PS.util.dist2(pr.x, pr.y, be.x, be.y);
                if (dd2 < bestD2) { bestD2 = dd2; nextT = be; }
              }
              if (nextT && bestD2 < 420 * 420) {
                pr.bounce--;
                pr.ang = Math.atan2(nextT.y - pr.y, nextT.x - pr.x);
                g.fx.ring(pr.x, pr.y, pr.color);
                stop = true;
              }
            }
            if (!stop) {
              if (pr.pierce > 0) {
                pr.pierce--;
                /* v6.7(Wave 3) 源 ranged_weapon_stats.gd:7 的 piercing_dmg_reduction 基础值 0.5,
                 *   weapon_service.gd:99-103 用 clamp(0.5 - piercing_damage/100, 0, 1) 收紧;
                 *   player_projectile.gd:116 `dmg = max(1, dmg - dmg * reduction)` ⇒ 存活因子 = 1 - reduction。 */
                var sf = Math.min(1, Math.max(0, 0.5 + (((game.stats || {}).pierceDmgPct) || 0) / 100));
                pr.dmg = Math.max(1, pr.dmg * sf);
              } else { g.projectiles.splice(i, 1); gone = true; stop = true; }
            }
            break;
          }
        }
        if (gone || stop) break;

        /* --- 移动一个细分段 --- */
        pr.x += Math.cos(pr.ang) * subStep;
        pr.y += Math.sin(pr.ang) * subStep;
        pr.travel += subStep;
        if (pr.boomerang && !pr.back && pr.travel >= pr.range * 0.5) pr.back = true;
        if (pr.back) {
          pr.ang = PS.util.angleTo(pr.x, pr.y, g.player.x, g.player.y);
          if (PS.util.dist(pr.x, pr.y, g.player.x, g.player.y) < 20) { g.projectiles.splice(i, 1); gone = true; break; }
        } else if (pr.travel >= pr.range) { g.projectiles.splice(i, 1); gone = true; break; }
        var W = PS.Balance.WORLD;
        if (pr.x < -40 || pr.x > W.w + 40 || pr.y < -40 || pr.y > W.h + 40) { g.projectiles.splice(i, 1); gone = true; break; }
      }
    }
  };
})(typeof GameGlobal !== 'undefined' ? GameGlobal : (typeof window !== 'undefined' ? window : globalThis));
