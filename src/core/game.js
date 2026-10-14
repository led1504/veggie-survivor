/* PS.Game v2 —— 对局状态机（横屏大世界版）
 * 相对 v1: 世界坐标(2240x1560)+镜头跟随 / 3 模式 / 6 武器槽 / 环绕星常驻体 /
 *   敌人新AI(caller/splitter/necro) / 商店锁定 / 4选1升级 / 怪潮波 / 精英三档 / Boss双形态。
 * 状态: menu → mode → char → play ↔ pause → levelup/shop → over
 */
(function (global) {
  'use strict';
  var PS = global.PS || {};
  var B = PS.Balance;
  /* v5.2(用户要求「战斗过程中应该加入设置按钮, 方便退出到主菜单」): 新增 PAUSE。
   *   它是**真冻结**而不是遮罩: update() 开头就是 `if (g.state !== State.PLAY) return;`,
   *   所以一进 PAUSE, 波次计时/刷怪/受击/开火全部停摆(旧版没有任何暂停途径, 只能等死或刷新页面)。 */
  var State = { MENU: 'menu', MODE: 'mode', CHAR: 'char', PLAY: 'play', PAUSE: 'pause', LEVELUP: 'levelup', SHOP: 'shop', OVER: 'over' };
  PS.State = State;
  /* v6.7(Wave 3): 燃烧中的敌人数 —— 给条件词条 condCtx.burningEnemy 用。
   *   源口径: unit.gd:717-727 set_burning 在挂/摘燃烧时增减 RunData.current_burning_enemies;
   *   本作把"燃烧态"存在 e.burn 上(burnTick 结算, duration 是**次数**), 所以只数 dur > 0 且没死的。 */
  function burningCount(en) {
    var n = 0, i, e;
    for (i = 0; i < (en ? en.length : 0); i++) {
      e = en[i];
      if (e && !e.dead && e.burn && e.burn.dur > 0) n++;
    }
    return n;
  }

  /* ==================== v5.6(G1): 条件/触发型道具 effect 的派发层 ====================
   * 源 484 条 effect 行里 36 条带 custom_key（19 家族）; v5.5 只接线了 2 个（temp_stats_while_not_moving /
   * temp_stats_per_interval → stats.js 的 cond 通道）。其余家族用 `skipped` 丢掉 ⇒ 那些件的正收益凭空消失。
   * 本命名空间的职责 = 把**本作有对应机制**的家族在触发点上兑现。载荷逐字来自源 .tres,
   * 由生成器落成 src/data/items.js 的 `it.trig[]`（逐件逐字段可回溯, 见 qa/source-port-items.md §8）。
   *
   * 家族 → 源派发点（行号逐条可查）:
   *   stats_end_of_wave    main.gd:1189-1195（波末 add_stat, 永久累积; TempStats.reset() 在 :1232）
   *   stats_on_level_up    main.gd:872-875（升级时 add_stat, 永久累积）
   *   temp_stats_on_hit    player.gd:487-489（受击 TempStats.add_stat）; main.gd:1232 波末 reset ⇒ 每波清零
   *   stats_next_wave      main.gd:1399-1405（**波次开始**时 TempStats.add_stat 后**立刻** clear ⇒ 只兑现
   *                        下一波一次; 该波末 :1232 的 TempStats.reset() 收走 —— 与 stats_end_of_wave 的永久累积不同）
   *   gain_stat_for_equipped_item_with_stat  run_data.gd:1895-1909（装备使某 stat 上升 → ch += per）
   *   dmg_when_pickup_gold main.gd:815-817 → handle_stat_damages(main.gd:1498-1561)
   *   dmg_when_death       main.gd:499-501 → 同上
   *   dmg_on_dodge         player.gd:444-457（目标是**打中你的那只怪**, 公式见 dodgeDamage）
   *   heal_on_dodge        player.gd:459-466（**闪避成功**时逐条 randf() < chance/100 ⇒ 回 v 点生命;
   *                        与 dmg_on_dodge 在源里是同一段 if is_dodge 代码, 差别只有「打谁 vs 回自己」）
   *   enemy_percent_damage_taken  effect_behaviors/enemies/percent_damage_taken_enemy_effect_behavior.gd
   *                        （:50-62 命中过滤 / :72-118 挂层 / :126-143 超时） + unit.gd:500（受伤 ×(1+pct/100)）
   *
   * 仍未接线的家族（继续 skipped + pool:false 或整件丢弃）见 qa/source-port-items.md §8.3 ——
   *   武器侧的 unique_weapon_effects / weapon_scaling_stats（落点在 src/data/weapons.js）;
   *   商店侧的 upgrade_random_weapon。
   *   v6.7(Wave 3) 起两条旧口径已作废: ①「结构体 / 消耗品 / 燃烧机制」本作已实现（见下方燃烧 / 爆炸 /
   *   结构体各段）; ② heal_on_dodge 已由 onDodgeHeal 兑现（唯一持有者 adrenaline 上架）。
   *   gold_on_crit_kill **不是**本派发层的家族 —— 它由生成器落成永久通道 goldOnCritPct（hunting_trophy）。
   *
   * 记账口径: 触发点只往 g.trigMods（永久）/ g.trigTemp（每波清零）/ g.trigNext（下一波一次, 波末清）
   *   三张「通道 → 值」表里累加, 面板由 stats.js 的 applyTriggers 在读面板时合成 ——
   *   与源「add_stat 累加进 effects 桶」同构。
   */
  var ItemTriggers = PS.ItemTriggers = {
    /* 对局开始 / 放弃本局时清账（与 g.condT / g.wasMoving 同一处复位）。 */
    reset: function (g) { g.trigMods = {}; g.trigTemp = {}; g.trigNext = {}; g.trigNextArmed = {}; },

    /* 装备道具的 trig 条目遍历器（只读; 定义表是常量, 每帧重取只做一次 byId 查找）。 */
    eachTrig: function (g, fn) {
      var list = g.items || [], i, j, it, tg;
      for (i = 0; i < list.length; i++) {
        it = PS.ItemData.byId(list[i].id || list[i]);
        if (!it || !it.trig) continue;
        for (j = 0; j < it.trig.length; j++) {
          tg = it.trig[j];
          if (fn(it, tg) === false) return;
        }
      }
    },
    addTo: function (tab, ch, v) {
      if (!tab || !ch || !v) return;
      tab[ch] = (tab[ch] || 0) + v;
    },

    /* ---------- 波末 / 升级 / 装备（面板侧） ---------- */
    /* 源 main.gd:1189-1195: 波末 `RunData.add_stat(stat, value)` —— 永久累积。
     * 同一处（:1232）执行 `TempStats.reset()` ⇒ temp_stats_on_hit 的累积**每波清零**。 */
    onWaveEnd: function (g) {
      var self = this;
      g.trigMods = g.trigMods || {};
      this.eachTrig(g, function (it, tg) {
        if (tg.fam === 'stats_end_of_wave') self.addTo(g.trigMods, tg.ch, tg.v);
      });
      g.trigTemp = {};
      /* v5.11(G2): 源 main.gd:1232 的 `TempStats.reset()` 把 stats_next_wave 的临时层一并收走 ——
       *   所以这份加成只活在"被兑现的那一波"里, 到波末就没了。 */
      g.trigNext = {};
    },

    /* 源 main.gd:1399-1405（在 `_on_EntitySpawner_players_spawned` —— **波次开始**）:
     *   `for stat_next_wave in effects[stats_next_wave_hash]: TempStats.add_stat(ch, v)` 之后**立刻**
     *   `effects[stats_next_wave_hash].clear()` ⇒ 一次性。
     * 本作: 备货在 onEquip（取得那一刻, 与源"effect 进桶"同一时刻）, 兑现在这里（波次开始）。 */
    onWaveStart: function (g) {
      g.trigNext = g.trigNextArmed || {};
      g.trigNextArmed = {};
    },

    /* 源 main.gd:872-875: 升级时 `add_stat(stat, value)` —— 永久累积。
     * 触发时机: 源在 level_up 事件里结算; 本作的升级在该局里由 takeLevelup() 兑现（g.levelups 增长处,
     * 与 stats.js 里 `maxHp += levelups.length * LEVEL_HP_PER_LEVEL` 的口径一致）⇒ 挂在那里。 */
    onLevelUp: function (g) {
      var self = this;
      g.trigMods = g.trigMods || {};
      this.eachTrig(g, function (it, tg) {
        if (tg.fam === 'stats_on_level_up') self.addTo(g.trigMods, tg.ch, tg.v);
      });
    },

    /* 源 run_data.gd:1177-1183 apply_item_effects: 逐条 effect 比 `effects[key]` 前后值, **上升了**才调用
     *   `_apply_gain_stat_for_equipped_item_with_stat_effects`（:1895-1909）; 后者对每件带该家族的装备
     *   检查 `item_stat == 上升的那个 stat` ⇒ `ch += per`。
     * 本作挂在 gainItem()（入包之后调用）: `raised` = 刚入包的这件**自身**抬高的通道（值 > 0）。
     * 源对 UpgradeData 有 `not item_data is UpgradeData` 的排除 ⇒ 升级卡**不**触发（本作同样不在 takeLevelup 里触发）。
     * 与武器无关（源按 item effects 判定）, 所以换武器不触发。 */
    onEquip: function (g, itemId) {
      var self = this, def = PS.ItemData.byId(itemId), raised = {}, k;
      if (!def) return;
      /* v5.11(G2): stats_next_wave 的**备货** —— 源里这条 effect 在取得那一刻就进了玩家的 effects 桶,
       *   直到下一次波次开始才被 main.gd:1399-1405 搬进 TempStats 并 `clear()`（一次性）。这里同样不动面板,
       *   只把载荷记进 g.trigNextArmed, 由 onWaveStart 兑现。
       *   ⚠ 必须在下面 `if (!def.mods) return;` **之前** —— celery_tea 的 mods 是空对象（收益全在 trig 上）。 */
      if (def.trig) {
        g.trigNextArmed = g.trigNextArmed || {};
        for (k = 0; k < def.trig.length; k++) {
          if (def.trig[k].fam === 'stats_next_wave') self.addTo(g.trigNextArmed, def.trig[k].ch, def.trig[k].v);
        }
      }
      if (!def.mods) return;
      for (k in def.mods) if (Object.prototype.hasOwnProperty.call(def.mods, k) && def.mods[k] > 0) raised[k] = 1;
      var any = false;
      for (k in raised) if (Object.prototype.hasOwnProperty.call(raised, k)) { any = true; break; }
      if (!any) return;
      g.trigMods = g.trigMods || {};
      this.eachTrig(g, function (it, tg) {
        if (tg.fam === 'gain_stat_for_equipped_item_with_stat' && raised[tg.stat]) self.addTo(g.trigMods, tg.ch, tg.per);
      });
    },

    /* 源 player.gd:487-489: `if dmg_taken > 0` 段里 for temp_stats_on_hit → `TempStats.add_stat(ch, v)`。
     * 受击才触发; 每波末由 onWaveEnd 清零（源 main.gd:1232）。 */
    onPlayerHit: function (g) {
      var self = this, changed = false;
      g.trigTemp = g.trigTemp || {};
      this.eachTrig(g, function (it, tg) {
        if (tg.fam === 'temp_stats_on_hit' && tg.v) { self.addTo(g.trigTemp, tg.ch, tg.v); changed = true; }
      });
      return changed;   /* 是否真的记了账 —— 调用方据此决定要不要重算面板 */
    },

    /* ---------- 通用「按 stat 缩放的一次性伤害」 ---------- */
    /* 纯函数（不碰游戏状态, 只掷骰 + 算值）—— 门禁逐字核对公式用的就是它。
     * 源 main.gd:1516 `if randf() >= stat_dmg[2]/100.0: continue` ⇒ **命中率 = chance%**（方向别写反）。
     * 源 main.gd:1526-1527 `base = floor(max(1, (pct/100)*stat))` → `dmg = round(base * (1+dmgPct/100))`。
     * dodge 分支（player.gd:451-452 + weapon_service.gd:493-495）不 floor, 且外层再夹一次 max(1, ·)。 */
    scaledDamage: function (statValue, pct, dmgPct) {
      var base = Math.floor(Math.max(1, (pct / 100) * statValue));
      return Math.round(base * (1 + dmgPct));
    },
    dodgeDamage: function (statValue, pct, dmgPct) {
      var from = Math.max(1, (pct / 100) * statValue);
      return Math.max(1, Math.round(Math.max(1, from) * (1 + dmgPct)));
    },
    /* 掷骰并求出本次总伤害（可能为 0 = 全部没掷中）。dmgPct 传 stats.dmgPct（已是小数, 源 /100 后同值）。 */
    rollStatDamage: function (g, fam) {
      var self = this, s = g.stats || {}, dmgPct = s.dmgPct || 0, total = 0;
      this.eachTrig(g, function (it, tg) {
        if (tg.fam !== fam) return;
        if (Math.random() * 100 >= tg.chance) return;   /* 源 randf() >= chance/100 ⇒ continue */
        var stat = (typeof s[tg.ch] === 'number') ? s[tg.ch] : 0;
        total += (fam === 'dmg_on_dodge') ? self.dodgeDamage(stat, tg.pct, dmgPct)
                                           : self.scaledDamage(stat, tg.pct, dmgPct);
      });
      return total;
    },
    /* 源 main.gd:1508 `Utils.get_rand_element(enemies)` —— 从**全部存活怪**里随机挑一只（源 :1509 里
     *   无效/已死就整次不结算）。本作没有「魅惑怪」概念, include_charmed_enemies=false 直接对应存活怪。
     * 取随机而不是取最近: 这是源的语义（payload 不带方向/来源信息, 也不该凭空获得瞄准能力）。 */
    randomTarget: function (g) {
      var en = g.enemies || [], pool = [], i, e;
      for (i = 0; i < en.length; i++) { e = en[i]; if (!e.dead && e.spawnT <= 0) pool.push(e); }
      return pool.length ? pool[(Math.random() * pool.length) | 0] : null;
    },
    /* 结算一次：挑目标 → 掷骰求和 → 一次性打在那一只身上（源 :1547 `other_enemy.take_damage(total)`）。
     * dmg_on_dodge 的目标是**打中你的那只怪**（player.gd:445/456）: `from` 无效就整段不结算, 不改成随机挑。 */
    statDamages: function (g, fam, target) {
      var e;
      if (fam === 'dmg_on_dodge') {
        e = target;
        if (!e || e.dead || e.spawnT > 0 || e.hp <= 0) return 0;
      } else {
        e = (target && !target.dead && target.spawnT <= 0 && target.hp > 0) ? target : this.randomTarget(g);
        if (!e) return 0;
      }
      var total = this.rollStatDamage(g, fam);
      if (total <= 0) return 0;
      PS.Combat.dealDamage(g, e, total, { src: 'trigger:' + fam, crit: false });
      return total;
    },
    onPickupGold: function (g) { return this.statDamages(g, 'dmg_when_pickup_gold', null); },
    onPlayerDeath: function (g) { return this.statDamages(g, 'dmg_when_death', null); },
    onDodge: function (g, from) { return this.statDamages(g, 'dmg_on_dodge', from); },
    /* 源 player.gd:459-466（同一个 if is_dodge 段里, 紧跟 dmg_on_dodge 之后）:
     *   for heal_on_dodge in effects: if randf() < heal_on_dodge[2]/100.0: total_to_heal += heal_on_dodge[1]
     *   var _healed = on_healing_effect(total_to_heal, Keys.item_adrenaline_hash, false)
     * 载荷(唯一持有者 adrenaline 的 adrenaline_effect_1.tres 逐字): value 5 / chance 50 /
     *   custom_key heal_on_dodge / effect_sign 3(FROM_VALUE)。
     * 与 dmg_on_dodge 的差别只有两点: 目标是**自己**(回血)而不是打你的那只怪; 不需要 hitbox.from。
     * 回血出口与 torture / regen 一致: Math.min(maxHp, hp + total) + 一次 fx.heal。 */
    onDodgeHeal: function (g) {
      var total = 0;
      this.eachTrig(g, function (it, tg) {
        if (tg.fam !== 'heal_on_dodge') return;
        var chance = (typeof tg.chance === 'number') ? tg.chance : 0;
        if (Math.random() * 100 >= chance) return;
        if (typeof tg.v === 'number' && isFinite(tg.v)) total += tg.v;
      });
      if (total > 0) {
        var s = g.stats || {}, cur = g.player.hp + total;
        var cap = (typeof s.maxHp === 'number') ? s.maxHp : cur;
        g.player.hp = Math.min(cap, cur);
        g.fx.heal(g.player.x, g.player.y - 20, total);
      }
      return total;
    },

    /* ---------- enemy_percent_damage_taken（敌人侧） ---------- */
    /* 源 percent_damage_taken_enemy_effect_behavior.gd:
     *   :50-62 on_hurt —— 逐条 effect, 只有 `find_scaling_stat(effect[1], hitbox.scaling_stats)` 命中才挂层;
     *   :72-118 add_active_effect —— max_procs 用尽即 return（新建时不判）; 已存在则刷新计时 / 取最大 pct 与栈上限,
     *     未满栈再 +1 层并累加 total; :126-143 超时把 total 扣掉。
     *   unit.gd:500 受伤 `dmg = round(dmg * (1 + bonus/100))`。
     * 本作映射: 武器表没有 `scaling_stats` 字段 ⇒ 用**武器的 elem 标记**当「这次伤害按 stat_elemental_damage 缩放」
     *   的等价物（stats.js/combat.js 里 eleDmg 只加在 elem 武器上, 口径一致）。 */
    onHitEnemy: function (g, e, opts) {
      var self = this;
      if (!e || !opts || !opts.elem) return;
      this.eachTrig(g, function (it, tg) {
        if (tg.fam !== 'enemy_percent_damage_taken' || tg.ch !== 'eleDmg') return;
        self.addTaken(e, it.id, tg);
      });
    },
    addTaken: function (e, srcKey, tg) {
      e.pctTaken = e.pctTaken || {};
      var a = e.pctTaken[srcKey];
      if (a) {
        a.maxStacks = Math.max(a.maxStacks, tg.maxStacks);
        a.dur = Math.max(a.dur, tg.dur);
        a.pct = Math.max(a.pct, tg.pct);
        a.timer = a.dur;
        if (a.maxProcs !== -1 && a.procs >= a.maxProcs) return;
        if (a.stacks >= a.maxStacks) return;
        a.stacks++; a.procs++; a.total += a.pct;
        return;
      }
      e.pctTaken[srcKey] = {
        pct: tg.pct, dur: tg.dur, timer: tg.dur, stacks: 1,
        maxStacks: tg.maxStacks, procs: 1, maxProcs: tg.maxProcs, total: tg.pct
      };
    },
    takenBonus: function (e) {
      var b = 0, k, t;
      if (!e || !e.pctTaken) return 0;
      for (k in e.pctTaken) if (Object.prototype.hasOwnProperty.call(e.pctTaken, k)) { t = e.pctTaken[k]; b += t.total; }
      return b;
    },
    /* 消费点 1: combat.js 的 dealDamage —— 源 unit.gd:500 的乘区（在护甲之前; 本作敌人护甲恒 0）。 */
    damageVsTarget: function (e, raw) {
      var b = this.takenBonus(e);
      return b ? raw * (1 + b / 100) : raw;
    },
    /* 消费点 2: 每帧推进层计时（源 behavior 的 _process(delta)）。 */
    updateStacks: function (g, dt) {
      var en = g.enemies || [], i, k, e, a;
      for (i = 0; i < en.length; i++) {
        e = en[i];
        if (!e.pctTaken) continue;
        for (k in e.pctTaken) {
          if (!Object.prototype.hasOwnProperty.call(e.pctTaken, k)) continue;
          a = e.pctTaken[k];
          a.timer -= dt;
          if (a.timer <= 0) delete e.pctTaken[k];   /* :126-143 超时摘层 */
        }
      }
    }
  };
  PS.Game = {
    state: State.MENU,
    mode: 'standard',
    diff: 'easy',          /* v8.3: 本局难度挡位(与模式正交, 见 balance.js::B.DIFFS) */

    /* ---------- 对局 ---------- */
    newRun: function (charId, mode, opts) {
      var g = this;
      /* v3.5 BUG#1(主程): 「干净开局」—— 旧 newRun 只清了它自己赋值过的字段, 而 PS.Game 是
       *   **长驻单例**, 其余可变字段(harvestMul / harvestBonus / luckDropItem / freeRerolls /
       *   shopCards / lockedCards / levelupChoices / eliteSpawned ...)会跨局残留。
       *   实测后果: 同一构造下"第 N 局"带着上一局的收获复利倍率继续滚 —— 无浏览器扫描器
       *   连跑 14 个 seed 时出现 LV240 / 余料 319 万(同一个 seed 单跑只有 LV8 / 余料 164),
       *   玩家点「再来一局」同样会中招。这里按字段表做**全量归零**, 保证「新一局 = 干净状态」。 */
      g.cam = null; g.char = null; g.drops = []; g.eliteAlive = false; g.eliteSpawned = false;
      g.enemies = []; g.enemyProj = []; g.freeRerolls = 0; g.fruitsThisWave = 0; g.fx = null;
      g.harvestBonus = 0; g.harvestMul = 1; g.healWinT = 0; g.hitStop = 0; g.horde = false;
      g.iframesT = 0; g.items = []; g.kills = 0; g.level = 1; g.levelupChoices = null; g.levelupPrevIds = null;
      g.levelupPhase = null; g.levelups = []; g.lifestealHealed = 0; g.lockedCards = null;
      g.luckDropItem = null; g.material = 0; g.orbitPhase = 0; g.pendingLevelups = 0;
      /* v7.9: 波末掉落待裁决队列 + 当前正在裁决的那一件(源 item_box 的 to_be_processed_at_end_of_wave)。
       *   两者都是**跨局必须归零**的长驻字段 —— qa/verify-clean-run.cjs 的 C 段(逐字段毒化)会把漏掉的抓出来。 */
      g.pendingBoxes = []; g.boxItem = null;
      g.charDetail = null;                              /* v7.11: 点卡面开的选人详情页 —— 跨局必须归零, 同 shopDetail */
      g.player = null; g.projectiles = []; g.regenT = 0; g.rerolls = 0; g.levelupRerolls = 0; g.shake = 0;
      g.shopCards = []; g.spawnIdx = 0; g.spawnT = 0; g.stats = null; g.sweepT = 0;
      g.timeInWave = 0; g.wave = 0; g.waveBanner = 0; g.waveDuration = 0; g.waveState = 'idle';
      g.condT = 0; g.wasMoving = false;                 /* v5.5: 条件词条的 1 秒节拍 / 静止状态记忆(见 update) */
      PS.ItemTriggers.reset(g);                         /* v5.6(G1): 触发型词条的累积账(跨局不许残留) */
      g.weapons = []; g.win = false; g.xp = 0;
      /* v6.7(Wave 3): 结构体 / 地雷 / 眼豆节拍 / 波内受击保护 / 爆炸递归深度 / 鬼火累积 ——
       *   全部跨局归零(与上面那张字段表同一个理由: PS.Game 是长驻单例)。 */
      g.structs = []; g.mines = []; g.mineT = 0; g.eyesT = 0;
      g.waveHitProt = 0; g.expDepth = 0; g.wispN = 0; g.wispP = 0;
      g.mode = mode || 'standard';
      /* v8.3: 挡位从 opts.diff 取, 没给就看模式页选的那个(g.pendingDiff), 再没有就是 easy。
       *   为什么走 pendingDiff 而不给 newRun 加第 4 个实参: qa/verify-start-weapon.cjs 逐字钉着
       *   `PS.Game.newRun(g.pendingChar, g.pendingMode || 'standard', self.startWeaponOpt(selChd))`。
       *   (g.diff 是 PS.Game 的自有字段 => qa/verify-clean-run.cjs 的 C 段毒化会盯住它, 下面这行就是归零。) */
      g.diff = (opts && opts.diff) || g.pendingDiff || 'easy';
      var i;
      g.char = null;
      for (i = 0; i < PS.Characters.list.length; i++) if (PS.Characters.list[i].id === charId) g.char = PS.Characters.list[i];
      if (!g.char) g.char = PS.Characters.list[0];

      g.wave = 0;
      g.material = 0;
      g.level = 1;
      g.xp = 0;
      g.pendingLevelups = 0;
      g.levelupPhase = null;
      g.kills = 0;
      g.timeInWave = 0;
      g.rerolls = 0;
      g.win = false;
      g.eliteAlive = false;

      g.items = [];
      /* v5.1（修「同名武器合不了」）: 起始武器的 key 必须**归一成正典 key**。
       *   characters.js 里存的还是旧别名（wren/swift1），商店卖的是正典 key（smg_t1）: 两件在武器栏并排
       *   显示成「连发短铳 I」，但 tryFuse 按 key 字符串找同名片 ⇒ 永远找不到。玩家看到的就是「两把同名同阶却合不了」。
       *   归一后 tier 语义不变（别名与正典指向同一个 def 对象, drill_t4 仍是 T4）。 */
      /* v7.4(2026-09-30 修用户报的「学徒葱开局初始武器每次都不一样」)——
       *   源里 startingWeapons 确实是**候选池**, 但选哪一把是**玩家点出来的**, 不是抽签:
       *   ui/menus/run/weapon_selection.gd 的 _on_element_pressed 拿玩家点的那一格;
       *   池里另有一枚 is_random 的「?」格子(`element.is_random → Utils.get_rand_element`)——
       *   也就是说「随机」在源里是玩家**显式选中**的一个选项, 而不是默认行为。
       *   本作把那个界面收进选人页底栏的「初始武器」选择器, 于是 core 侧只认**显式传入**的一件:
       *     opts.weapon      = 指定的武器 key(归一成正典后使用, 不认得的 key 直接忽略)
       *     opts.randomStart = 玩家显式点了「随机」=> 这时才抽签
       *   两个都没有 => 有池的角色用**池里第一件**(= 源里第一个格子), 无池的用 characters.js 的 weapon。
       *   旧写法是无条件 `iwPool[(Math.random()*n)|0]`: 卡面写「铁指拳套 I」而开局给的却是别的,
       *   卡面就是在骗人 —— 用户报的正是这个。机制上锁死: 抽签只可能发生在 randomStart 分支里。 */
      var iwOpts = opts || {}, iwKey = null;
      if (iwOpts.weapon) {
        var iwWant = PS.WeaponData.canon ? PS.WeaponData.canon(iwOpts.weapon) : iwOpts.weapon;
        if (PS.WeaponData.list[iwWant]) iwKey = iwWant;   /* 认得出才采纳, 否则回落卡面那件 */
      }
      if (!iwKey && iwOpts.randomStart) {
        var iwPool = (g.char.weaponPool && g.char.weaponPool.length) ? g.char.weaponPool : [g.char.weapon];
        iwKey = iwPool[(Math.random() * iwPool.length) | 0];
      }
      /* 兜底档(v7.5 起 = 池首, v7.6 起 = **默认档**): 唯一真源是 PS.Characters.defaultStartKey ——
       *   「有池 → 池里第一件主伤害通道没被本角色自己 gain 归零的武器; 无池 → 声明的那件」。
       *   不能再用 char.weapon: 对 cyborg 那件是「保底件」, 拿它当兜底会开出「minigun + minigun」两把一样的。
       *   也不能再写死 pool[0]: 铁皮冬瓜的池首是近战, 而它 gain 把 meleeDmg 归零 ⇒ 默认会给一个永远不长的格子。
       *   ui 的默认档走同一个函数, 所以「界面显示的那件」与「真的到手的那件」不会各说各话。 */
      if (!iwKey) iwKey = PS.Characters.defaultStartKey(g.char);
      /* v3.8(修元数据矛盾): 初始武器的阶必须取**武器表里的真实阶**, 不许硬写 1。
       *   大蒜的初始武器 orbiter1 是 weapons.js 的别名 → drill_t4(钻心锥家族在源里只有 4 阶), 硬写 tier:1 的
       *   后果: 商店格标成 "T1"、卖出只按 T1 计价(4 而非 36), 且该件永远显示不出升阶状态。 */
      if (PS.WeaponData.canon) iwKey = PS.WeaponData.canon(iwKey);
      var iwDef = PS.WeaponData.list[iwKey];
      /* v7.5(补源的第二件): 角色除了「池里点的那件」, 还能由**角色 effect** 带一把保底起手武器 ——
       *   源 run_data.gd:1551-1557 add_starting_items_and_weapons() 对 effects[starting_weapon] 逐件 add_weapon()。
       *   执行序**照源**: 先放玩家点的那件(源 weapon_selection.gd:148 先 add_weapon 玩家点的), 再追加保底件。
       *   会被算进来的两名角色(逐条读自源 .tres, 也见 ref/source-characters.json 的 effects[].customKey):
       *     engineer ← engineer_effect_2.tres  weapon_wrench_1   -> wrench_t1
       *     cyborg   ← cyborg_effect_0b.tres  weapon_minigun_3   -> minigun_t3
       *   同一 key 出现两次**不合并** —— 源就是两次 add_weapon(螺丝椒选扳手时确实拿两把扳手), 合并反而与源不符。
       *   保底件经过 canon 归一与存在性校验: 数据表里查不到就跳过, 绝不让开局「少一把」变成静默 NaN。
       *   顺序后果(有意): g.weapons[0] 永远是**玩家点/默认**的那件(= 默认档), 保底件排在它后面;
       *     卡面展示的是保底件 ⇒ 「卡面那件 ∈ 武器栏」是硬约束, 由 56 号门禁的 [1d]/[1e] 钉住。 */
      var iwList = [{ key: iwKey, tier: (iwDef && iwDef.tier) || 1, cd: 0.3, angle: Math.random() * PS.TAU }];
      var iwGuar = (g.char.startWeapons || []);
      for (var ig = 0; ig < iwGuar.length; ig++) {
        var gk = PS.WeaponData.canon ? PS.WeaponData.canon(iwGuar[ig]) : iwGuar[ig];
        var gd = PS.WeaponData.list[gk];
        if (gd) iwList.push({ key: gk, tier: gd.tier || 1, cd: 0.3, angle: Math.random() * PS.TAU });
      }
      g.weapons = iwList;
      g.levelups = [];

      g.recalc();
      g.player = {
        x: B.WORLD.w / 2, y: B.WORLD.h / 2, hp: g.stats.maxHp,
        aimAng: 0, walkT: 0, moving: false
      };
      g.cam = { x: g.player.x - B.VIEW.w / 2, y: g.player.y - B.VIEW.h / 2 };   // 镜头(左上角): 视口对齐玩家中心
      g.enemies = [];
      g.projectiles = [];
      g.enemyProj = [];
      g.drops = [];
      g.orbitPhase = 0;
      g.spawnT = 1;
      g.waveState = 'idle';
      g.iframesT = 0;
      g.hitStop = 0;
      g.shake = 0;
      g.regenT = 0;
      g.regenT = 0;                              // v2.8: regen 的 5 秒 tick 计时(源口径)
      g.healWinT = 0;                            // v2.8: 吸血“每秒上限”的窗口计时
      g.lifestealHealed = 0;                     // v2.8: 本秒内已通过吸血回复的点数
      g.setState(State.PLAY);
      g.fx = PS.FX;                              // 战斗层特效引用(newRun 必自检项, v1 教训)
      PS.FX.init();
      /* v2.3: 升级统一在「波末结算」—— 战斗中不再弹强化窗(用户要求)。
       * 开局赠送的 1 次强化在进入第 1 波前立刻结算; 之后每波结束先补齐本波累积的强化, 再进商店。 */
      g.pendingLevelups = 1;
      g.levelupPhase = 'prewave';
      g.startWave(1);
      if (g.pendingLevelups > 0) g.resolveLevelup();
      if (g.onRunStart) g.onRunStart();
    },

    setState: function (s) { this.state = s; if (this.onState) this.onState(s); },

    /* ---------- 暂停 / 退出到主菜单 ----------
     * 状态语义:
     *   ① 只有 PLAY 能进 PAUSE。商店/升级/结算页各自压着一层 scrim, 不允许再叠第二层设置页。
     *   ② 暂停期间**不推进**任何战斗状态(见 State 声明处)。进 PAUSE 时清输入, 否则恢复后会
     *      朝「暂停前那一刻」的方向继续跑(玩家点的是右上角的齿轮, 不该顺带把角色往上拽)。
     *   ③ 退出到主菜单 = **放弃本局**, 必须把对局数据清干净: 不清就会留下上一局的怪/特效/背包,
     *      而且回到 MENU 后 HUD 虽然不画了, 下一次进 PLAY 之前 g.stats 仍指着上一局的对象。
     *   ④ 退出是两步确认(第一次点只把按钮切成「确认退出」): 一次误触不该毁掉一局。
     *   ⑤ 不作弊: 这里不写存档、不给材料、不改 wave —— 纯状态迁移。 */
    pauseGame: function () {
      var g = this;
      if (g.state !== State.PLAY || !g.player) return false;
      g.input = { x: 0, y: 0 };
      g.pauseConfirm = false;
      g.setState(State.PAUSE);
      return true;
    },
    resumeGame: function () {
      var g = this;
      if (g.state !== State.PAUSE) return false;
      g.pauseConfirm = false;
      g.setState(State.PLAY);
      return true;
    },
    /** 放弃本局: 清战斗实体与背包, 保留 char/mode(菜单与选人页还要用) */
    abandonRun: function () {
      var g = this;
      g.enemies = []; g.enemyProj = []; g.projectiles = []; g.drops = [];
      g.player = null; g.stats = null; g.weapons = []; g.items = [];
      g.shopCards = []; g.lockedCards = null; g.levelupChoices = null; g.levelupPhase = null;
      g.shopDetail = null; g.charDetail = null;      /* v7.11: 点卡面开的详情页(商店 / 选人) */
      g.pendingLevelups = 0; g.eliteAlive = false; g.eliteSpawned = false;
      g.pendingBoxes = []; g.boxItem = null;              /* v7.9: 放弃本局 = 待裁决队列一起清掉 */
      g.waveState = 'idle'; g.timeInWave = 0; g.waveBanner = 0; g.shake = 0; g.hitStop = 0;
      g.condT = 0; g.wasMoving = false;                 /* v5.5: 放弃本局时一并清掉条件词条的节拍/记忆 */
      PS.ItemTriggers.reset(g);                         /* v5.6(G1): 触发型词条的累积账 */
      g.iframesT = 0; g.horde = false; g.fruitsThisWave = 0;
      if (PS.FX && PS.FX.init) PS.FX.init();
      return true;
    },
    quitToMenu: function () {
      var g = this;
      if (g.state !== State.PAUSE) return false;
      g.abandonRun();
      g.setState(State.MENU);
      if (PS.Sound && PS.Sound.play) PS.Sound.play('click');
      return true;
    },

    recalc: function () {
      var g = this;
      /* v5.5(道具机制): 面板现在分两遍 —— 第一遍(mods/升级) 与第二遍(道具的 scale/cond)。
       *   「上限提高才回血」的判定基必须只用**第一遍**的最大生命(maxHpPerm): 缩放/条件词条
       *   (如 padding「每 80 金币 +1 生命上限」)会随金币、静止状态来回波动, 用它做判定基就会
       *   反复触发回血 = 凭空回血。血量上限仍按最终面板钳制(见本函数末尾)。 */
      var oldMax = (g.stats && typeof g.stats.maxHpPerm === 'number') ? g.stats.maxHpPerm
                 : ((g.stats && typeof g.stats.maxHp === 'number') ? g.stats.maxHp : 0);
      /* v5.7(武器羁绊): 已激活的套装档位并成一份 extraMods, 走 compute 的**既有第 5 参**
       *   (契约见 stats.js 头注释; 走它就不需要改 stats.js, 风险最低)。
       *   计数口径与源 run_data.gd:1043 update_sets() 逐字一致 —— 见 src/data/sets.js 头注释。
       *   结果同时挂到 g.sets 给 UI 读(商店羁绊面板), 免得每帧重算。 */
      g.sets = PS.SetData.ofWeapons(g.weapons);
      g.stats = g.statsWith(g.items, g.weapons, g.levelups, g.sets);
      /* v3.2(主程): 源 stat_cap_effect 的 `set_cap_to_current_stat` ——
       *   handcuffs 的 hp_cap / shackles 的 speed_cap 语义是「把上限锁死在**取得那一刻的当前值**」
       *   (源文案 EFFECT_HP_CAP_AT_CURRENT_VALUE = "你的最大生命值现在以[当前值]为上限"), 不是「上限=0」。
       *   旧映射把词条里的 0 当成真上限 ⇒ 买到手 maxHp 被钳到 1, 变成一个"买即自杀"的道具(实测第 2 波暴毙)。 */
      var hpAt = null, spAt = null, ii;
      for (ii = 0; ii < g.items.length; ii++) {
        var it = g.items[ii];
        if (it.hpCapAt != null) hpAt = (hpAt == null) ? it.hpCapAt : Math.min(hpAt, it.hpCapAt);
        if (it.speedCapAt != null) spAt = (spAt == null) ? it.speedCapAt : Math.min(spAt, it.speedCapAt);
      }
      if (hpAt != null) g.stats.maxHp = Math.max(1, Math.min(g.stats.maxHp, hpAt));
      if (spAt != null) g.stats.speed = Math.max(1, Math.min(g.stats.speed, spAt));
      var newMax = (typeof g.stats.maxHpPerm === 'number') ? g.stats.maxHpPerm : g.stats.maxHp;
      if (oldMax && newMax > oldMax && g.player) g.player.hp += newMax - oldMax;
      if (g.player) g.player.hp = Math.min(g.player.hp, g.stats.maxHp);
    },

    /* v5.5(道具机制): 第二遍(scale/cond)的运行时上下文 —— 只给 stats.compute 用, 不落任何状态。
     *   · notMoving  —— 玩家当前是否静止(源 player.gd:219 以输入向量是否为 0 判定);
     *   · waveSeconds —— 本波已过秒数(interval 词条按 floor(它 / every) 累加到当前波);
     *   · livingEnemy —— 当前存活敌人数(源 run_data.gd:1864 current_living_enemies);
     *   · burningEnemy —— **真的数**(源 run_data.gd:1864 current_burning_enemies):
     *       v6.7(Wave 3) 起本作有燃烧机制(见本文件的 burnData / applyBurn / burnTick),
     *       于是 fried_rice 那条「每只燃烧怪 生命恢复 +1」的缩放词条有了真实的驱动量;
     *   · gold —— 当前金币(源 run_data.gd:1858 get_player_gold)。
     *   ⑤ v5.6(G1): trigMods / trigTemp —— 触发型词条的累积账（**只读**; 记账在 PS.ItemTriggers）。
     *      trigMods = 永久累积（stats_end_of_wave / stats_on_level_up / gain_stat_for_equipped_item_with_stat）,
     *      trigTemp = 每波清零的临时累积（temp_stats_on_hit）;
     *      trigNext = **只在"被兑现的那一波"生效**的一次性累积（stats_next_wave, 源 main.gd:1399-1405）。
     *   由 stats.js 的 applyTriggers 合成进面板。
     * 缺省值(无 player / 无字段)一律给安全值, 与 stats.js 的缺省口径一致。 */
    /* ==================== 面板聚合的**唯一真源** (v5.19) ====================
     * 事故(用户逐字): 「这个伤害78%-58%显示不对, 但不会有实际影响」。
     *   根因: 商店/升级卡上的「当前 → 买下之后」预览**自己又拼了一遍** compute 的入参, 只传了前 4 个,
     *   漏掉第 5 参(武器羁绊 extraMods)与第 6 参(condCtx 条件上下文)。于是身上只要有一套羁绊生效,
     *   每个 "→" 预览都凭空少一截 —— 实测 铁匠火器 4/4 + 爆裂工坊 2/4 时 伤害 73% → 58%(假跌 15%)。
     *   买下去走的是 recalc(), 参数是全的, 所以**显示错、手感对**(与用户的描述一致)。
     * 修法: 把入参拼装收进这一个函数, recalc 与所有预览都必须走它。
     *   ——「预览 = 真值」从此是**同一个函数**的两次调用, 而不是两处各自拼装。
     * weapons 必须把"买下之后"的武器表整体传进来: 新增一把可能**激活/升档**羁绊, 用旧的 g.sets 一样会少算。
     * sets 可选 —— recalc 已经算过就复用, 免得每帧把 ofWeapons 跑两遍。
     * 谁调用 PS.Stats.compute 只允许这一处, qa/verify-stat-preview.cjs 会断言这一点。 */
    statsWith: function (items, weapons, levelups, sets) {
      var st = sets || PS.SetData.ofWeapons(weapons);
      return PS.Stats.compute(this.char, items, weapons, levelups || [],
        PS.SetData.modsFrom(st), this.condCtx());
    },

    condCtx: function () {
      var g = this, en = g.enemies || [], n = 0, i;
      for (i = 0; i < en.length; i++) if (!en[i].dead) n++;
      return {
        notMoving: !!(g.player && !g.player.moving),
        waveSeconds: g.timeInWave || 0,
        livingEnemy: n,
        burningEnemy: burningCount(en),
        gold: g.material || 0,
        /* v6.1(源对齐): convert_stats_half_wave 的触发点 —— 源文案是「halfway through a wave」,
         *   故只在**战斗中且本波已过半**时为真。商店/升级/暂停期间 waveState != 'fighting' ⇒ 恒假,
         *   所以所有 "→" 预览都按"未转换"算(与源一致: 预览发生在波间)。 */
        halfWave: !!(g.waveState === 'fighting' && g.waveDuration > 0 && g.timeInWave >= g.waveDuration * 0.5),
        trigMods: g.trigMods || null,
        trigTemp: g.trigTemp || null,
        trigNext: g.trigNext || null
      };
    },

    /* ---------- 波次 ---------- */
    startWave: function (w) {
      var g = this;
      g.wave = w;
      g.timeInWave = 0;
      /* v5.5(道具机制): interval 类条件词条**每波清零** —— 源的 1 秒累加器随每波重开归零
       *   (player.gd:1073 _on_OneSecondTimer_timeout 的 _one_second_timeouts 计数)。
       *   本作的 interval 贡献 = v × floor(本波秒数 / every), 秒数上一行刚清零 ⇒ 必须**立刻**重算一次,
       *   否则新一波会带着上一波攒下的加成开场, 还会经下面的 hpStartNextWavePct 让玩家凭空多回血。 */
      g.condT = 0;
      /* v5.11(G2): 波次开始 → 兑现 stats_next_wave（源 main.gd:1399-1405, 在 players_spawned 这个
       *   "本波开始"的时刻）。必须在下面的 g.recalc() **之前** —— 否则本波第一帧的面板看不到它。 */
      PS.ItemTriggers.onWaveStart(g);
      g.recalc();
      g.waveState = 'fighting';
      g.spawnT = 0.6;
      g.spawnIdx = 0;                              // v3.4: 源时刻表游标(见 update() 的排班刷怪)
      g.waveBanner = 2.2;                          // 波次横幅计时
      g.waveDuration = B.waveDuration(w, g.mode);
      /* v3.2(主程) 源 hp_start_next_wave: 每波开始按该百分比恢复生命(基准 100 = 回满)。
       *   证据链: 源 3 件交易型道具的 hp_start_next_wave 恒为 -100, 文案 "Start the next wave with 1 HP"。
       *   它同时修掉实测到的死亡螺旋: 旧逻辑把残血带进下一波, 探针 bot 第 1 波末 1/11 血 → 第 2 波必死。 */
      /* v6.4(Wave 2) 源 hp_start_wave（通道 hpStartWavePct）—— main.gd:1358:
       *   `health = max(1, max_stats.health * (effects[hp_start_wave] / 100.0))` —— 是**设定**整条血, 不是回血;
       *   :1360-1362 只有当 hp_start_next_wave != 100 时才**再覆盖一次**（并把它重置回 100）。
       *   源里两条基准都是 100（player_run_data.gd:474/475）⇒ sad_tomato 的 -50 = 开波只带半血。 */
      var hpWave = (g.stats.hpStartWavePct == null) ? 100 : g.stats.hpStartWavePct;
      g.player.hp = Math.max(1, Math.min(g.stats.maxHp, g.stats.maxHp * hpWave / 100));
      var hpPct = (g.stats.hpStartNextWavePct == null) ? 100 : g.stats.hpStartNextWavePct;
      if (hpPct !== 100) g.player.hp = Math.max(1, Math.min(g.stats.maxHp, g.stats.maxHp * hpPct / 100));
      g.fruitsThisWave = 0;
      g.horde = B.isHorde(w);
      if (g.horde) PS.Sound.play('horde');
      else PS.Sound.play('wave');
      /* ==================== v6.7(Wave 3): 开波时的结构体 / 中性物 / 波级被动 ==================== */
      /* 源 main.gd:1384-1394 gain_pct_gold_start_wave —— 开波按**当前金币**的 v% 直接进钱。
       *   走 addGold(只加钱、不给经验), 与源 add_gold 语义一致。 */
      if ((g.stats.goldStartWavePct || 0) > 0) g.addGold(Math.floor((g.material || 0) * g.stats.goldStartWavePct / 100));
      /* 源 player.gd:32 + take_damage 的 `elif _hit_protection > 0` 分支: 该计数**每波重置**。 */
      g.waveHitProt = Math.max(0, Math.floor(g.stats.hitProtection || 0));
      /* 源 main.gd:536-544 的两个计数器(counter/procs)在 run_data.gd:239-244 每波清零。 */
      g.wispN = 0; g.wispP = 0;
      /* 源 main.gd:250-260 gain_random_primary_stats_on_go_to_next_wave —— 开波随机挑 N 项主属性, 每项 +1。
       *   主属性表 = src/data/structures.js 的 primaryStats(源 run_data.gd:31-48 的 16 项, 逐字照搬)。 */
      var nRnd = Math.max(0, Math.floor(g.stats.randomPrimaryOnWave || 0));
      if (nRnd > 0) {
        var rp = PS.StructureData.primaryStats, ri;
        for (ri = 0; ri < nRnd; ri++) PS.ItemTriggers.addTo(g.trigMods, rp[(Math.random() * rp.length) | 0], 1);
        g.recalc();
      }
      /* 源 entity_spawner.gd:526-542: 开波按面板值把结构体**全部重建**一遍。 */
      g.spawnStructures();
      /* v7.1(源对齐, 用户「原版有树木 / 树木在地图中生成」) —— 树**不再**在开波时一次性撒
       *   stats.trees 棵(那是本作旧写法, 且 stats.trees 默认 0 ⇒ 不带道具时一棵都没有)。
       *   原版是 zones/zone_1/000_all/group_1.tres 那个 neutral 组: spawn_timing 10 秒刷第一批,
       *   之后每 repeating_interval = 10 秒一批(wave_manager.gd:175-186 按 wave_timer 触发)。
       *   这里只重置排班计时与波内白送道具计数, 真正的投产在 update() 的 fighting 分支。 */
      g.treeNext = B.TREE.timing;
      g.treeBursts = 0;
      g.itemsSpawnedThisWave = 0;
      g.eyesT = 0;                       /* 眼豆的 3 秒节拍随开波重置(源里定时器挂在 player 节点上) */
      g.spawnWaveExtras();               /* 源 wave_manager.gd:58-70/114-127 的"下波额外"在这里兑现 */
      if (this.onWaveStart) this.onWaveStart(w);
    },

    /* ---------- 主更新 ---------- */
    update: function (dt) {
      var g = this;
      if (g.state !== State.PLAY) return;
      if (g.hitStop > 0) { g.hitStop -= dt; dt *= 0.06; }
      var p = g.player, s = g.stats;
      if (g.waveBanner > 0) g.waveBanner -= dt;

      /* 波次推进 */
      g.timeInWave += dt;
      /* v5.5(道具机制): 条件词条的重算节拍。
       *   · interval 类: 每满 1 秒重算一次面板(源 player.gd:1073 的 1 秒定时器) —— 一波 90s 最多 90 次,
       *     可接受; 绝不能每帧 recalc(那是性能事故: art-perf 卡的是单帧 JS 耗时)。
       *   · notMoving(静止)类不在这一支, 见下面的「静止状态翻转」。
       * recalc 会换掉 g.stats, 故这里同步刷新局部变量 s(后面移速/开火读的都是它)。 */
      g.condT += dt;
      if (g.condT >= 1) { g.condT -= 1; g.recalc(); s = g.stats; }
      /* v5.6(G1): enemy_percent_damage_taken 的层计时（源 behavior 的 _process(delta), dur 秒后摘层）。
       *   只推进计时, 不改面板 —— 放在这里等于「PLAY 期间才走」, 商店/升级/暂停都不推进（与源一致）。 */
      PS.ItemTriggers.updateStacks(g, dt);
      if (g.waveState === 'fighting') {
        /* v6.4(Wave 2) 源 lose_hp_per_second（通道 hpLossPerSec）—— player.gd:125 起 LoseHealthTimer
         *   （wait_time 1 秒）, 到点 :834-839 `take_damage(v, {dodgeable=false, armor_applied=false,
         *   bypass_invincibility=true})` ⇒ **每秒直扣 v 点, 不吃闪避、不吃护甲、无视无敌帧**。
         *   放在 fighting 分支: 源里这个定时器挂在 player 节点上, 只在这局进行期间走。 */
        if ((g.stats.hpLossPerSec || 0) > 0) {
          g.hpLossT = (g.hpLossT || 0) + dt;
          while (g.hpLossT >= 1) {
            g.hpLossT -= 1;
            g.player.hp -= g.stats.hpLossPerSec;
            if (g.player.hp <= 0) { PS.ItemTriggers.onPlayerDeath(g); g.player.hp = 0; g.finish(false); return; }
          }
        } else if (g.hpLossT) g.hpLossT = 0;
        g.spawnT -= dt;
        /* v3.2(主程): **纯时刻表刷怪** —— 删掉旧的"同屏不足 minAlive 就立刻补怪"规则。
         *   理由(实测): 那条规则让刷怪量正比于**玩家 DPS**(清得越快补得越快), 于是收入∝DPS ⇒ 滚雪球,
         *   并且让"每波刷怪量"变成不可预测的量(标定时 W9 实测 390 只, 而时刻表只排了 132 只)。
         *   现在的语义与原作一致: 每波按时刻表投放固定数量, 清得快就空场, 清不动就堆积到 enemyCap。 */
        /* v3.4(源对齐): **源时刻表刷怪** —— 事件表来自 src/data/waves.js(由 tools/gen-waves.cjs
         *   从源 zones/zone_1 的 wave_N / group_* / unit_*.tres 生成: 每个事件的触发秒 t 与只数区间
         *   [min,max] 全是源值, 逐事件可回溯到源文件)。
         *   删掉的旧机制 spawnInterval / spawnBatch / hordeMul 的"定时批量"是我方自制: 它再与源的
         *   排班量相乘, 会把刷怪量放大 2~6 倍 —— 材料、经验、帧率三头同时爆(用户投诉的「卡顿」与
         *   「材料掉太多」在数据上是同一件事)。
         *   保留的两个本作机制: 同屏上限(enemyCap 内嵌在 spawnEnemy)与波次精英事件。 */
        var sched = PS.WaveData ? PS.WaveData.forWave(g.wave, g.mode) : null;
        if (sched) {
          var evs = sched.events;
          while (g.spawnIdx < evs.length && evs[g.spawnIdx].t <= g.timeInWave) {
            var ev0 = evs[g.spawnIdx++];
            /* v3.5(源对齐): 源里"组基准点"**每个事件只算一次**(get_group_pos + get_group_pos_away_from_players),
             *   成员再在基准点 ±area/2 内散布。area = -1 的组没有基准点(每只都在全图独立取点)。 */
            var evBase = (ev0.area > 0) ? g.spawnBase(ev0.area) : null;
            for (var ui = 0; ui < ev0.units.length; ui++) {
              var uu = ev0.units[ui];
              /* v6.4(Wave 2) 源 number_of_enemies（通道 enemyCountPct）—— entity_spawner.gd:171/180:
               *   `enemy_modifier = sum_all_player_effects(number_of_enemies) / 100.0`
               *   `number = max(1.0, number + number * enemy_modifier)`（:178 只对 ENEMY 生效, 对树 NEUTRAL 走 trees）
               *   源随后 :185-187 先 floor、再把小数部分当掷骰概率补一只 —— 这里逐字照搬。
               *   方向: **正值 = 更多敌人 = 对玩家是代价**（源 candle -10 / white_flag -5 为负值）。 */
              var nuF = uu[1] + Math.floor(Math.random() * (uu[2] - uu[1] + 1));
              nuF = Math.max(1, nuF * (1 + (g.stats.enemyCountPct || 0) / 100));
              var nu = Math.floor(nuF);
              if (Math.random() < (nuF - nu)) nu++;
              for (var uj = 0; uj < nu; uj++) g.spawnEnemy(uu[0], ev0.edge, ev0.area, evBase);
            }
          }
        }
        /* v7.1(源对齐): 树的**重复刷新** —— 源 group_1.tres(spawn_timing 10 / repeating 999 /
         *   repeating_interval 10) 由 wave_manager.gd:175-186 的 wave_timer 驱动。无道具时每批
         *   期望 0.495 棵 ⇒ 60 秒的波约 3 棵; item「速生树苗」+1 是加在**每批**的 n 上(源 :182)。 */
        g.treeNext -= dt;
        while (g.treeNext <= 0) {
          g.treeNext += Math.max(0.1, B.TREE.interval);
          g.treeBursts = (g.treeBursts || 0) + 1;
          if (g.treeBursts > B.TREE.repeatMax) break;
          g.spawnTreeBurst();
        }
        var elite = PS.EnemyData.eliteAt(g.wave, g.mode);
        if (elite && !g.eliteSpawned && g.timeInWave > g.waveDuration * 0.45) {
          g.eliteSpawned = true;
          g.spawnEnemy(elite, false, -1, null);   /* v3.5: 精英走"全图随机 + 离玩家 >=300px"(源 boss 组同口径) */
          g.eliteAlive = true;
          PS.Sound.play('boss');
          g.fx.ring(p.x, p.y, '#ffd24a');
        }
        if (g.timeInWave >= g.waveDuration) {
          /* v5.19c(Codex, 2026-09-29): 波末通关走**唯一判据**(见 src/data/balance.js 的 B.isFinalWave)。
           *   旧写法在这里是对的, 但 onKill 里另有一份**不带模式**的判据 -- 两份口径正是
           *   「无尽第 20 波直接通关」的土壤(用户实测), 现在两处合并成同一个函数调用。 */
          if (B.isFinalWave(g.wave, g.mode)) { g.finish(true); return; }
          g.waveState = 'sweep';
          g.sweepT = 0.9;
          g.sweepAll();
          /* v3.4(源对齐): 删掉 v2.1 的「每 3 波白送 1 次强化」——源里没有这条补偿机制,
           *   它在 20 波内白送 6 个强化档, 是「角色太强」的固定来源之一。 */
        }
      } else if (g.waveState === 'sweep') {
        g.sweepT -= dt;
        if (g.sweepT <= 0) g.beginIntermission();
      }
      /* shop/levelup 期间冻结战斗 */

      /* 玩家移动(世界坐标) */
      var ix = g.input ? g.input.x : 0, iy = g.input ? g.input.y : 0;
      var mag = Math.sqrt(ix * ix + iy * iy);
      p.moving = mag > 0.15;
      /* v5.5(道具机制): 静止状态**翻转**时重算一次(对应源 player.gd:215 的 add_stat / remove_stat)。
       *   只在翻转那一帧调, 不是每帧 —— 翻转频率 <= 1 次/帧, 且实际只在起步/停步时发生。 */
      if (p.moving !== g.wasMoving) { g.wasMoving = p.moving; g.recalc(); s = g.stats; }
      if (p.moving) {
        var spd = s.speed * s.speedMul * Math.min(1, mag);
        p.x += ix / mag * spd * dt;
        p.y += iy / mag * spd * dt;
        p.aimAng = Math.atan2(iy, ix);
        p.walkT += dt * 9;
      }
      var A = B.ARENA;
      p.x = PS.util.clamp(p.x, A.x + 14, A.x + A.w - 14);
      p.y = PS.util.clamp(p.y, A.y + 14, A.y + A.h - 14);

      /* 镜头跟随(带平滑) */
      g.cam.x = PS.util.lerp(g.cam.x, p.x - B.VIEW.w / 2, Math.min(1, dt * 6));
      g.cam.y = PS.util.lerp(g.cam.y, p.y - B.VIEW.h / 2, Math.min(1, dt * 6));
      g.cam.x = PS.util.clamp(g.cam.x, 0, Math.max(0, B.WORLD.w - B.VIEW.w));
      g.cam.y = PS.util.clamp(g.cam.y, 0, Math.max(0, B.WORLD.h - B.VIEW.h));

      /* 武器开火(6 槽) */
      for (var wi = 0; wi < g.weapons.length; wi++) {
        var slot = g.weapons[wi];
        var def = PS.WeaponData.list[slot.key];
        /* v5.5 视觉态**必须按 dt 递减**(纯美术: combat.js:14-17 已声明这些字段不进判定)。
         *   art.js:3168-3176 把它们当**倒计时**读 —— pr = clamp(1 - vSwing/vSwingDur, 0, 1);
         *   rot = vSwingAng + (pr - 0.5) * vSwingArc。只写不减 ⇒ pr 恒为 0 ⇒ 近战武器永远钉在
         *   「攻击角 − arc/2」(arc 1.35 时偏 39°), 既不抡也不朝目标; vAim 不减 ⇒ 瞄准插值恒为 1;
         *   vRecoil 不减 ⇒ 枪永远保持满后座。实测(work/fx-melee-weaponvis.cjs): vSwing 40/40 帧
         *   ≡ vSwingDur, 扫过角 0 rad(设计值 1.35)。只减这四个字段, 不碰 cd / 不碰任何判定。 */
        if (slot.vSwing > 0) slot.vSwing = Math.max(0, slot.vSwing - dt);
        /* v5.5: **抡击期间 vAim 不动** —— 否则收尾会跳。art.js:3169 的瞄准分支算的是
         *   angMix(rest, vAng, vAim/0.45), 而抡击分支(:3173)算的是 vSwingAng + (pr-0.5)*arc。
         *   两个分支都抢 rot, 切换瞬间必须落在同一点上才不跳: 冻结 vAim 后, 抡击末帧 rot = vAng + arc/2,
         *   下一帧瞄准分支给出 angMix(rest, vAng, 1) = vAng ⇒ 单帧跳 arc/2(39°), 读作收手;
         *   不冻结则瞄准分支给到 angMix(rest, vAng, 0.59), 单帧跳 1.63 rad(93°) —— 实测见
         *   work/fx-melee-weaponvis.cjs 的逐帧 rot。随后 vAim 照常衰减 0.45s 回到待机角。 */
        else if (slot.vAim > 0) slot.vAim = Math.max(0, slot.vAim - dt);
        if (slot.vFire > 0) slot.vFire = Math.max(0, slot.vFire - dt);
        if (slot.vRecoil > 0) slot.vRecoil = Math.max(0, slot.vRecoil - dt);
        if (!def) continue;
        if (def.targeting === 'orbit') { slot.cd = 0; continue; }   // 环绕星由 updateOrbits 驱动
        slot.cd -= dt;
        if (slot.cd <= 0) {
          /* v6.7(Wave 3) 源 weapon_service.gd:574-599 的 MIN_COOLDOWN 下限 —— 通道值是**秒**
           *   (源 45 帧 / 60)。缺省 0 ⇒ 与改动前逐位一致。 */
          slot.cd = Math.max(def.atkCd / s.atkSpdMul, s.minWeaponCd || 0);
          PS.Combat.fire(g, slot, s, wi);
        }
      }

      /* v6.7(Wave 3) 帧内顺序: 结构体(会生成弹体) → 眼豆(同上) → 既有弹道 → 环绕体 →
       *   燃烧 tick → 敌人 AI。燃烧放在敌人之前, 是为了让"这只怪本帧被烧死了"在同一帧的 AI
       *   循环里就按 dead 跳过(否则烧死的怪还会再走一帧)。 */
      g.updateStructures(dt);
      g.updateEyes(dt);
      PS.Combat.updateProjectiles(g, dt);
      g.updateOrbits(dt);
      g.updateBurns(dt);
      g.updateEnemies(dt);

      /* v2.8 玩家恢复口径按源落地(balance.md §10, 源=反编译 translations.csv 的官方说明串):
       *   ① regen: "You regenerate {0} HP every 5 seconds" → 每 REGEN_TICK 秒恢复 regen 点
       *      (= regen×0.2 HP/s)。改前按 HP/s 连续回血 ⇒ 比源强 5 倍(实测 regen 20.6 ⇒ 20.6 HP/s)。
       *   ② 吸血: "Your attacks have a {0} chance to heal you for 1 HP. Max: {1} HP/second"
       *      → 每次命中以 lifesteal% 概率回 1 点, 与伤害量无关, 另有每秒上限(见 onDamage)。
       * 这两条是用户反馈「角色太强 / 打不死」的引擎级根因 —— 不是敌人伤害不够。 */
      g.healWinT += dt;
      if (g.healWinT >= 1) { g.healWinT -= 1; g.lifestealHealed = 0; }   // 吸血每秒窗口
      /* v6.7(Wave 3) 源 player.gd:582/706-712 torture —— 「每秒苦修回血」在源里是**另一个 1 秒定时器**
       *   (wait_time 就是 1 秒), 不是叠在 5 秒节拍上的加成 ⇒ 本作让它取代 regen 节拍。
       * 源 player.gd:693-704 hp_regen_bonus: 生命低于上限 50%(potion_effect_1.tres 的 value2)时
       *   regen 的回复量 ×(1 + v/100) ⇒ 阈值走 B.REGEN_LOW_HP_PCT。 */
      g.regenT += dt;
      if ((s.torture || 0) > 0) {
        if (g.regenT >= 1) {
          g.regenT -= 1;
          if (p.hp < s.maxHp) {
            var tv = Math.max(1, Math.round(s.torture));
            g.player.hp = Math.min(s.maxHp, g.player.hp + tv);
            g.fx.heal(p.x, p.y - 20, tv);
          }
        }
      } else if (g.regenT >= B.REGEN_TICK) {
        g.regenT -= B.REGEN_TICK;
        if (s.regen > 0 && p.hp < s.maxHp) {
          var rv = Math.max(1, Math.round(s.regen));
          if (s.maxHp > 0 && p.hp < s.maxHp * (B.REGEN_LOW_HP_PCT / 100))
            rv = Math.round(rv * (1 + (s.regenLowHpPct || 0) / 100));
          g.player.hp = Math.min(s.maxHp, g.player.hp + rv);
          g.fx.heal(p.x, p.y - 20, rv);
        }
      }
      if (g.iframesT > 0) g.iframesT -= dt;
      if (g.shake > 0) g.shake = Math.max(0, g.shake - dt * 30);

      g.updateDrops(dt);

      /* v2.3: 战斗中不再弹出强化窗(用户要求: 升级放到每波结束之后)。
       * 波内累积的 pendingLevelups 交给波末 beginIntermission() 统一结算, 战斗节奏不再被打断。 */
    },

    /* ---------- 环绕星(常驻体, 对接触敌人结算) ---------- */
    updateOrbits: function (dt) {
      var g = this, p = g.player;
      g.orbitPhase += dt;
      for (var wi = 0; wi < g.weapons.length; wi++) {
        var slot = g.weapons[wi];
        var def = PS.WeaponData.list[slot.key];
        if (!def || def.targeting !== 'orbit') continue;
        var n = def.orbitCount;
        for (var k = 0; k < n; k++) {
          var a = g.orbitPhase * def.orbitSpd + k * PS.TAU / n + wi;
          var ox = p.x + Math.cos(a) * def.orbitR;
          var oy = p.y + Math.sin(a) * def.orbitR;
          for (var j = 0; j < g.enemies.length; j++) {
            var e = g.enemies[j];
            if (e.dead || e.spawnT > 0 || e.orbitCd > 0) continue;
            var rr = e.r + 10;
            if (PS.util.dist2(ox, oy, e.x, e.y) < rr * rr) {
              e.orbitCd = 0.35;                      // 同一敌人短冷却
              var raw = PS.Combat.weaponRaw(def, g.stats);
              /* v6.7(Wave 3) 源 weapon_service.gd:252-253 —— 环绕星在源里是 **structure**（def.structure,
               *   由 weapons.js 按 targeting=orbit 标记）: structures_can_crit 为假时**根本不给暴击率**,
               *   为真才把玩家的 stat_crit_chance 加上去。本作对齐: 没开词的环绕体永不暴击。 */
              var orbitCrit = (!def.structure || g.stats.structCrit) && Math.random() * 100 < g.stats.crit;
              PS.Combat.dealDamage(g, e, raw, {
                crit: orbitCrit, critMul: def.critMul,
                kx: Math.cos(a) * def.knock, ky: Math.sin(a) * def.knock, src: slot.key,
                elem: !!def.elem,       /* v5.6(G1): enemy_percent_damage_taken 的命中过滤依据 */
                hit: true               /* v6.7(Wave 3): 一次武器命中 ⇒ 允许掷燃烧 */
              });
              g.fx.hitSpark(ox, oy, '#e8c76a');
              /* v5.5: 环绕星(saw_t2/t3/t4 · drill_t4)是 4 把**没有挥击弧**的近战 ——
               *   combat.js:117 对 orbit 直接 return, 它们此前只有接触火花, 连一条攻击图元都没有。
               *   这里用**真实轨道角 a** 补一条切向短弧; 每 3 次接触才画一条, 防高攻速下的图元预算被吃光。 */
              slot.vOrbitN = (slot.vOrbitN || 0) + 1;
              /* v5.19: 环绕族(圆盘锯/穿心钻)也报身份 —— 招式表给它们的是一排**齿弧**(MEL.spin),
               * 不再是通用月牙。shape='saw' 由 art.js 的 weaponShape 按 targeting=orbit 判定。 */
              if (slot.vOrbitN % 3 === 0 && g.fx.strike) {
                g.fx.strike(ox, oy, a + Math.PI * 0.5, (def.orbitR || 90) * 0.55, 0.9,
                  PS.Combat.weaponInfo(def, slot));
              }
              /* 环绕体接触火花: 用**真实轨道角 a**, 于是特效方向与击退方向一致 */
              if (PS.FX && PS.FX.weaponOrbit) {
                PS.FX.weaponOrbit(ox, oy, a, { shape: 'saw', elem: !!def.elem, tier: slot.tier || 1, cls: def.cls, crit: false });
              }
            }
          }
        }
      }
      // 衰减敌人环绕冷却
      for (var i = 0; i < g.enemies.length; i++) {
        if (g.enemies[i].orbitCd > 0) g.enemies[i].orbitCd -= dt;
      }
    },

    /* ---------- 敌人 ---------- */
    /* v3.5(源对齐): 源 global/entity_spawner.gd:236-255 的"组基准点"算法 ——
     *   全图随机取点, 直到离玩家 >= 300 + area/2; 每次失败 min_dist -5(下限 25), 最多重掷若干次。 */
    spawnBase: function (area) {
      var g = this, md = B.SPAWN.minDistFromPlayer + area / 2, t = 0, x = 0, y = 0;
      do {
        x = B.ARENA.x + Math.random() * B.ARENA.w;
        y = B.ARENA.y + Math.random() * B.ARENA.h;
        t++;
        if (PS.util.dist(x, y, g.player.x, g.player.y) >= md) break;
        md = Math.max(B.SPAWN.retryFloor, md - B.SPAWN.retryStep);
      } while (t < 40);
      return { x: x, y: y };
    },

    spawnEnemy: function (key, edge, area, basePos) {
      var g = this, def = PS.EnemyData.list[key], W = B.WORLD;
      if (!def) return null;
      /* v2.3 同屏上限护栏(唯一入口)。此前只有主刷怪循环在"批次之前"查了一次 enemyCap,
       * 而批次本身最多 9 只(怪潮 ×3), 召唤者/死灵/分裂怪又各自 push → 高峰仍能越过上限(Plato 审计)。
       * 精英与 Boss 豁免: 它们是波次事件, 被上限挡掉会导致"Boss 不出 → 波次永不完结"。 */
      if (!def.elite && !def.boss && g.liveEnemies() >= B.enemyCap(g.wave, g.mode)) return null;
      var w1 = g.wave;
      /* v3.5(源对齐) 出生几何 —— 1:1 复刻 entity_spawner.gd:468-477 / 200-209:
       *   spawn_edge_of_map = true → 随机一条地图边, 距边界 EDGE_MAP_DIST(64) 处出生   (utils.gd:32)
       *   area = -1               → **全图均匀随机取点**, 重掷到离玩家 >= 300px 为止
       *                             (INITIAL_MIN_DIST_FROM_PLAYER=300, 每次失败 -5, 下限 25)
       *   area = N > 0            → 组基准点全图随机(离玩家 >= 300 + N/2), 成员在基准点 ±N/2 内散布
       *   ------------------------------------------------------------------
       *   历史 bug(本版修复): 旧写法读 ev.edge(undefined) 且生成器从未落 area ⇒ 所有怪都退化成
       *   "玩家周围 300~620px 环带"。源竞技场 = 32x24 x TILE_SIZE 64 = 2048x1536(zone_1_data.tres),
       *   与本作 ARENA 2160x1480 同尺 ⇒ "全图均匀"与"300px 环带"的期望出生距离差一倍以上,
       *   那正是"怪物一进场就贴脸 / 一波被围死"的直接来源。 */
      var x, y;
      if (edge) {
        var E = B.SPAWN.edgeDist, side = Math.floor(Math.random() * 4);
        var alongX = B.ARENA.x + E + Math.random() * Math.max(1, B.ARENA.w - E * 2);
        var alongY = B.ARENA.y + E + Math.random() * Math.max(1, B.ARENA.h - E * 2);
        if (side === 0) { x = B.ARENA.x + E; y = alongY; }
        else if (side === 1) { x = B.ARENA.x + B.ARENA.w - E; y = alongY; }
        else if (side === 2) { x = alongX; y = B.ARENA.y + E; }
        else { x = alongX; y = B.ARENA.y + B.ARENA.h - E; }
      } else if (area > 0) {
        var bp = basePos || g.spawnBase(area), half = area / 2;
        x = bp.x + (Math.random() * 2 - 1) * half;
        y = bp.y + (Math.random() * 2 - 1) * half;
      } else {
        var md = B.SPAWN.minDistFromPlayer, tries = 0;
        do {
          x = B.ARENA.x + Math.random() * B.ARENA.w;
          y = B.ARENA.y + Math.random() * B.ARENA.h;
          tries++;
          if (PS.util.dist(x, y, g.player.x, g.player.y) >= md) break;
          md = Math.max(B.SPAWN.retryFloor, md - B.SPAWN.retryStep);
        } while (tries < 40);
      }
      x = PS.util.clamp(x, B.ARENA.x + def.r, B.ARENA.x + B.ARENA.w - def.r);
      y = PS.util.clamp(y, B.ARENA.y + def.r, B.ARENA.y + B.ARENA.h - def.r);

      var isElite = !!def.elite;
      var wI = B.enemyWaveIdx(g.wave, g.mode);
      /* v5.11(G2): 敌人侧两个百分比通道（源 enemy_health / enemy_damage; 见 stats.js 的 PCT 注释）。
       *   源把它包在 unit.gd:103/108 每次属性重算的外面（entity_service.gd:33-49）, 公式
       *   `round(from_value * (1 + sum/100))` —— 与这两行逐字同形（源另乘 difficulty/coop/endless
       *   因子, 那几项不是道具词条, 不移植）。alien_baby / peacock 对玩家是"以难度换收益" ⇒ 敌人**真的会变强**。 */
      /* v7.12: 源 entity_service.gd 的难度因子 —— 本作此前唯独缺 endless 那一项(见 balance.js 同名函数)。
       *   wI 是**取表用的波序**(疾速翻倍), 难度曲线吃的是真实波次 g.wave。 */
      var DIF = B.diffOf(g.diff);   /* v8.3: 难度挡位(easy 三项恒 1.0 => 旧路径逐值不变) */
      var eHp = Math.round(B.enemyHp(def.hp, def.hpW, wI) * (1 + (g.stats.enemyHpPct || 0) / 100) * B.enemyHpEndlessMul(g.wave) * DIF.hpMul);
      var eDmg = Math.round(B.enemyDmg(def.dmg, def.dmgW, wI) * (1 + (g.stats.enemyDmgPct || 0) / 100) * B.enemyDmgEndlessMul(g.wave) * DIF.dmgMul);
      /* v6.7(Wave 3): 移速单独算一遍存进 e.spd / e.maxSpd ——
       *   源 enemy.gd:254-256 的减速判据是 `current_stats.speed > max_stats.speed * (1 - max_value/100)`,
       *   即需要"原始最大移速"这个基准, 故 maxSpd 必须跟着落。 */
      var eSpd = def.spd * B.enemySpdMul(g.wave) * (1 + (g.stats.enemySpdPct || 0) / 100) * (isElite ? 0.92 : 1) * B.enemySpdEndlessMul(g.wave) * DIF.spdMul;
      g.enemies.push({
        key: key, def: def, elite: isElite, boss: !!def.boss,
        x: x, y: y, r: def.r,
        hp: eHp, maxHp: eHp,
        dmg: eDmg,
        /* v3.0 源对齐: 源 enemy.speed 的单位就是 px/s(值域 0/120~425), 与玩家 250px/s 同一把尺子,
         *   1:1 直用(def.spd)。旧的 spdPix*250 / spd*0.4 都是自制缩放, 会让怪追不上玩家(=用户说的"怪物太弱")。
         *   enemySpdPct 通道来自源道具 stat(enemy_speed)。 */
        spd: eSpd, maxSpd: eSpd,
        kx: 0, ky: 0, hitT: 0, dead: false,
        spawnT: 0.4, shootT: def.shootCd ? def.shootCd * (0.4 + Math.random() * 0.6) : 0,
        dashT: def.dashCd ? def.dashCd * Math.random() : 0, dashVX: 0, dashVY: 0,
        callT: def.callCd ? def.callCd * 0.6 : 0,
        necroT: def.necroCd ? def.necroCd * 0.5 : 0,
        orbitCd: 0, hitCd: 0,
        eid: (g.eidSeq = (g.eidSeq || 0) + 1), healBy: 0,
        windT: 0, windAng: 0, bst: 0
      });
      return g.enemies[g.enemies.length - 1];
    },

    updateEnemies: function (dt) {
      var g = this, p = g.player, i, e;
      for (i = g.enemies.length - 1; i >= 0; i--) {
        e = g.enemies[i];
        if (e.dead) { g.enemies.splice(i, 1); continue; }
        if (e.spawnT > 0) { e.spawnT -= dt; continue; }
        if (e.hitT > 0) e.hitT -= dt;
        /* v6.7(Wave 3) 源 neutral.gd: 中性物(树苗)不移动、不出招、不结算接触伤害 ——
         *   它只是一块挡路的"按命中次数掉血"的障碍, 等被打倒(见 onKill 的 neutral 分支)。 */
        if (e.neutral) continue;
        if (e.hitCd > 0) e.hitCd -= dt;

        var d = PS.util.dist(e.x, e.y, p.x, p.y);
        var ang = PS.util.angleTo(e.x, e.y, p.x, p.y);
        var ai = e.def.ai;

        if (ai === 'chase') {
          /* v2.2 抽搐修复: wobble 只作视觉摆动(不扰动移动方向), 走位方向纯追击 */
          e.x += Math.cos(ang) * e.spd * dt;
          e.y += Math.sin(ang) * e.spd * dt;
          if (e.def.wobble) { e.bob = Math.sin(g.timeInWave * 7 + e.x * 0.5) * 2.5; }
          if (e.def.hop) { e.bob = Math.sin(g.timeInWave * 10) * 3; }
          /* v2.2 分离力单向化: 只推当前怪, 对称力下一帧由对方自然传导 —— 消除互推振荡 */
          for (var oi = i - 1, seen = 0; oi >= 0 && seen < 4; oi--, seen++) {
            var o2 = g.enemies[oi];
            if (o2.dead || o2.spawnT > 0) continue;
            var ddx = e.x - o2.x, ddy = e.y - o2.y;
            var minD = e.r + o2.r;
            var dd2 = ddx * ddx + ddy * ddy;
            if (dd2 < minD * minD && dd2 > 0.01) {
              var dd = Math.sqrt(dd2);
              var push = (minD - dd) * 1.6 * dt;
              e.x += ddx / dd * push; e.y += ddy / dd * push;
            }
          }
        } else if (ai === 'orbit') {
          var want = e.def.orbitR || 260;
          var drift = d > want + 40 ? 1 : (d < want - 40 ? -1 : 0);
          var tang = ang + Math.PI / 2;
          e.x += (Math.cos(ang) * drift + Math.cos(tang) * 0.55) * e.spd * dt;
          e.y += (Math.sin(ang) * drift + Math.sin(tang) * 0.55) * e.spd * dt;
          e.shootT -= dt;
          if (e.shootT <= 0 && d < want + 140) { e.shootT = e.def.shootCd; g.enemyVolley(e, ang); }
        } else if (ai === 'dash') {
          /* v7.10(源 charging_attack_behavior.gd): 冲撞**前先蓄力** —— 源是「播 shoot 动画 →
           *   charge_duration 秒后解锁移动并冲」, 方向在蓄力开始时锁定(target_calculation_timing
           *   = START_SHOOT)。本作把这段做成可见的 wind 秒(站定 + 预警圈), 冲撞因此可读、可闪。 */
          e.dashT -= dt;
          if (e.dashVX || e.dashVY) {
            e.x += e.dashVX * dt; e.y += e.dashVY * dt;
            e.dashVX *= Math.pow(0.004, dt); e.dashVY *= Math.pow(0.004, dt);
            if (Math.abs(e.dashVX) < 22 && Math.abs(e.dashVY) < 22) { e.dashVX = 0; e.dashVY = 0; e.dashT = e.def.dashCd; }
          } else if (e.windT > 0) {
            e.windT -= dt;
            if (e.windT <= 0) {
              var pw = e.spd * 5.2;
              e.dashVX = Math.cos(e.windAng) * pw; e.dashVY = Math.sin(e.windAng) * pw;
              g.fx.dashLine(e.x, e.y, e.windAng);
            }
          } else if (e.dashT <= 0 && d < 420) {
            e.windT = B.DASH.wind; e.windAng = ang;
          } else {
            e.x += Math.cos(ang) * e.spd * 0.55 * dt;
            e.y += Math.sin(ang) * e.spd * 0.55 * dt;
          }
        } else if (ai === 'caller') {
          // 保持中距, 周期召唤蜂鸣虫
          var want2 = 300;
          var drift2 = d > want2 + 40 ? 1 : (d < want2 - 40 ? -1 : 0);
          e.x += Math.cos(ang) * drift2 * e.spd * dt;
          e.y += Math.sin(ang) * drift2 * e.spd * dt;
          e.callT -= dt;
          if (e.callT <= 0 && g.liveEnemies() < B.enemyCap(g.wave, g.mode) - 4) {
            e.callT = e.def.callCd;
            /* v3.5(源对齐): 召唤物出生在**召唤者身边**(源 spawning_attack_behavior 直接 spawn 在父节点位置),
             *   不再用"玩家周围环带" —— 那会让召唤怪凭空出现在玩家背后。 */
            for (var ci = 0; ci < (e.def.callN || 2); ci++) g.spawnEnemyAt(e.def.callKey, e.x + PS.util.randRange(-24, 24), e.y + PS.util.randRange(-24, 24));
            g.fx.ring(e.x, e.y, e.def.color);
          }
        } else if (ai === 'healer') {
          /* v7.10(源 entities/units/enemies/healer/healer.gd:9-11/32-45): 药婆身上的 BoostZone ——
           *   有伤的单位**进入光环时**回一次血: 敌人 min(血 + heal, maxHp), 玩家 on_healing_effect(player_heal)。
           *   判定按源的 body_entered 语义做「从外到内那一帧」, 不是每帧 —— 否则光环会变成站桩奶泉。
           *   heal/player_heal 与两个每波增量都是源 export 的逐字值(见 balance.js 的 B.HEALER)。 */
          e.x += Math.cos(ang) * e.spd * dt;
          e.y += Math.sin(ang) * e.spd * dt;
          var hz = B.HEALER.r;
          var hAmt = B.HEALER.heal + B.HEALER.healW * (g.wave - 1);
          if (d < hz) {
            if (g.healBy !== e.eid && g.player.hp < g.stats.maxHp) {
              var pAmt = B.HEALER.playerHeal + B.HEALER.playerHealW * (g.wave - 1);
              g.player.hp = Math.min(g.stats.maxHp, g.player.hp + pAmt);
              g.fx.heal(g.player.x, g.player.y, Math.round(pAmt));
              PS.Sound.play('pickup');
            }
            g.healBy = e.eid;
          } else if (g.healBy === e.eid) g.healBy = 0;
          for (var hb = 0; hb < g.enemies.length; hb++) {
            var hh = g.enemies[hb];
            if (hh === e || hh.dead || hh.spawnT > 0) continue;
            var hIn = PS.util.dist(e.x, e.y, hh.x, hh.y) < hz + hh.r;
            if (hIn && hh.healBy !== e.eid) {
              if (hh.hp < hh.maxHp) {
                hh.hp = Math.min(hh.maxHp, hh.hp + hAmt);
                g.fx.heal(hh.x, hh.y, Math.round(hAmt));
              }
              hh.healBy = e.eid;
            } else if (!hIn && hh.healBy === e.eid) hh.healBy = 0;
          }
        } else if (ai === 'boss') {
          /* v7.10(源 entities/units/enemies/boss/boss.gd:73-83 + boss_state.gd): Boss 是一台**多状态机** ——
           *   源把 [hp_start, timer_start, movement_behavior, attack_behavior] 存成一张表, CheckStateTimer
           *   每秒查一次 `current.health <= max.health * hp_start || elapsed >= timer_start`, 命中就换
           *   一整套移动 + 攻击。本作落成三档, 触发用两条血线(源的真值在 .tscn 的 hp_start 里, 读不到
           *   ⇒ 65% / 35% 记 [本作自定]):
           *     1 开场 —— 追击 + 三连瞄准弹幕 + 召唤
           *     2 中盘 —— 追击 + **环形八连**弹幕 + 召唤
           *     3 残血 —— 狂暴: 提速 + 五连弹幕 + **蓄力冲撞** + 大量召唤 */
          var bst = e.bst || 0;
          if (bst === 0 && e.hp < e.maxHp * 0.65) bst = 1;
          else if (bst === 1 && e.hp < e.maxHp * 0.35) bst = 2;
          if (bst !== e.bst) {
            e.bst = bst;
            if (bst === 2) e.spd *= 1.25;
            g.shake = B.FX.shakeMax;
            PS.Sound.play('boss');
            g.fx.ring(e.x, e.y, bst === 2 ? '#ff5a5a' : e.def.color);
          }
          bst = e.bst || 0;
          e.shootT -= dt;
          if (e.shootT <= 0) {
            if (bst === 0) { e.shootT = 1.7; g.enemyVolley(e, ang, 3, false, 0.42); }
            else if (bst === 1) { e.shootT = 1.9; g.enemyVolley(e, ang, 8, true); }
            else { e.shootT = 1.2; g.enemyVolley(e, ang, 5, false, 0.3); g.enemyShoot(e, ang + Math.PI, true); }
          }
          e.dashT -= dt;
          if (e.dashT <= 0) {
            e.dashT = bst === 2 ? 4.5 : 7.5;
            var addN = bst === 2 ? 4 : (bst === 1 ? 3 : 2);
            for (var s2 = 0; s2 < addN; s2++) g.spawnEnemyAt('buzzling', e.x + PS.util.randRange(-30, 30), e.y + PS.util.randRange(-30, 30));
            g.fx.ring(e.x, e.y, e.def.color);
          }
          var charging = false;
          if (bst === 2) {
            if (e.dashVX || e.dashVY) {
              charging = true;
              e.x += e.dashVX * dt; e.y += e.dashVY * dt;
              e.dashVX *= Math.pow(0.004, dt); e.dashVY *= Math.pow(0.004, dt);
              if (Math.abs(e.dashVX) < 30 && Math.abs(e.dashVY) < 30) { e.dashVX = 0; e.dashVY = 0; e.bossChargeT = 5; }
            } else if (e.windT > 0) {
              charging = true;
              e.windT -= dt;
              if (e.windT <= 0) {
                var bpw = e.spd * 5.2;
                e.dashVX = Math.cos(e.windAng) * bpw; e.dashVY = Math.sin(e.windAng) * bpw;
                g.fx.dashLine(e.x, e.y, e.windAng);
              }
            } else {
              e.bossChargeT = (e.bossChargeT == null ? 5 : e.bossChargeT) - dt;
              if (e.bossChargeT <= 0) { e.windT = 0.5; e.windAng = ang; g.fx.ring(e.x, e.y, '#ff5a5a'); charging = true; }
            }
          }
          if (!charging) { e.x += Math.cos(ang) * e.spd * dt; e.y += Math.sin(ang) * e.spd * dt; }
        }

        // 击退衰减 + 世界约束
        e.x += e.kx * dt; e.y += e.ky * dt;
        e.kx *= Math.pow(0.001, dt); e.ky *= Math.pow(0.001, dt);
        var A = B.ARENA;
        e.x = PS.util.clamp(e.x, A.x + e.r, A.x + A.w - e.r);
        e.y = PS.util.clamp(e.y, A.y + e.r, A.y + A.h - e.r);

        // 接触伤害(怪海化: 同屏怪多时单次伤害稀释, 走位空间更大)
        var rr = e.r + 14;
        if (d < rr && e.hitCd <= 0) {
          e.hitCd = B.contactHitCd;
          /* v3.0 源对齐: 删掉自制的 crowdDmgMul(怪海稀释) —— 源里没有这个机制, 且它与
           *   全局 iframes + 逐怪 contactHitCd(= 源 attackCd 30 帧 = 0.5s)重复打折。 */
          g.hurtPlayer(e.dmg, ang, e);
          /* v3.0 修复隐藏漏洞: 反伤原先写在接触节流之外, 于是**逐帧**结算(3 点反伤 × 60 帧
           *   = 180 伤害/秒/怪) —— 这是「角色太强」的第二个来源; 源里反伤是「被命中时」触发。
           *   现在与接触伤害共用同一个节流窗口(同一只怪 0.5s 内只反一次)。 */
          if (g.stats.thorns > 0 && !e.dead) {
            PS.Combat.dealDamage(g, e, g.stats.thorns, { src: 'thorns' });
          }
        }
      }
      // 注: Boss 的通关判定**不在这里** -- 唯一入口是 onKill() 末尾的 B.isFinalWave 守卫(见那里)。
    },

    spawnEnemyAt: function (key, x, y) {
      var g = this, def = PS.EnemyData.list[key];
      if (!def) return null;
      if (g.liveEnemies() >= B.enemyCap(g.wave, g.mode)) return null;   // v2.3: 与 spawnEnemy 同口径(分裂/复活/召唤共用一个上限)
                                                                // v6.7: 计数改用 liveEnemies() —— 中性物(树苗)不占敌人名额
      var wI = B.enemyWaveIdx(g.wave, g.mode);
      /* v5.11(G2): 与 spawnEnemy 同一口径 —— 源里 EntityService 是全局的, 分裂/召唤/复活出来的怪同样吃
       *   enemy_health / enemy_damage（unit.gd:103/108 在每次 init_current_stats 时都算一遍）。 */
      var DIF2 = B.diffOf(g.diff);   /* v8.3: 分裂/召唤出来的怪与 spawnEnemy 同一把尺子 */
      var eHp2 = Math.round(B.enemyHp(def.hp, def.hpW, wI) * 0.6 * (1 + (g.stats.enemyHpPct || 0) / 100) * B.enemyHpEndlessMul(g.wave) * DIF2.hpMul);
      var eDmg2 = Math.round(B.enemyDmg(def.dmg, def.dmgW, wI) * (1 + (g.stats.enemyDmgPct || 0) / 100) * B.enemyDmgEndlessMul(g.wave) * DIF2.dmgMul);
      var e = {
        key: key, def: def, elite: !!def.elite, boss: !!def.boss,
        x: PS.util.clamp(x, B.ARENA.x + def.r, B.ARENA.x + B.ARENA.w - def.r),
        y: PS.util.clamp(y, B.ARENA.y + def.r, B.ARENA.y + B.ARENA.h - def.r),
        r: def.r, hp: eHp2, maxHp: eHp2,
        dmg: eDmg2, spd: def.spd * B.enemySpdMul(g.wave) * (1 + (g.stats.enemySpdPct || 0) / 100) * B.enemySpdEndlessMul(g.wave) * DIF2.spdMul,
        kx: 0, ky: 0, hitT: 0, dead: false, spawnT: 0.4,
        shootT: 0, dashT: 0, dashVX: 0, dashVY: 0, callT: 0, necroT: 0, orbitCd: 0, hitCd: 0,
        eid: (g.eidSeq = (g.eidSeq || 0) + 1), healBy: 0, windT: 0, windAng: 0, bst: 0
      };
      g.enemies.push(e);
      return e;
    },

    /* v7.10(源 attack_behaviors/shooting_attack_behavior.gd): 一次射击展开成弹幕 ——
     *   count 发; radial=true 环形均布(源 constant_spread), 否则以 ang 为中的扇形(源 projectile_spread)。
     *   缺省值取敌人表上的 radial / shots(逐怪), 再退回 B.ORBIT —— 1 发 = 旧行为。
     *   音效只在第一发上出, 免得 8 发环形弹幕叠成 8 次 shoot2。 */
    enemyVolley: function (e, ang, count, radial, spread) {
      var def = e.def || {};
      var n = count == null ? (def.shots || 1) : count;
      var isRad = radial == null ? !!def.radial : !!radial;
      var sp = spread == null ? (def.spread == null ? B.ORBIT.spread : def.spread) : spread;
      if (n <= 1) { this.enemyShoot(e, ang); return; }
      for (var i = 0; i < n; i++) {
        var a = isRad ? ang + i * (PS.TAU / n) : ang + (i - (n - 1) / 2) * sp;
        this.enemyShoot(e, a, i > 0);
      }
    },
    enemyShoot: function (e, ang, silent) {
      this.enemyProj.push({
        x: e.x, y: e.y, ang: ang, spd: e.def.projSpd || 270,
        dmg: e.dmg, r: 7, travel: 0, range: 520, color: e.def.color,
        from: e                     /* v5.6(G1): 源 `hitbox.from` —— dmg_on_dodge 的目标 */
      });
      if (this.enemyProj.length > 90) this.enemyProj.shift();
      if (!silent) PS.Sound.play('shoot2');
    },

    /* ---------- 玩家 ---------- */
    /* v5.6(G1): 第 3 参 `from` = 这次伤害的**来源怪**（源 `hitbox.from`）。
     *   闪避分支要用它当 `dmg_on_dodge` 的目标（player.gd:445/456: 打中你的那一只）。 */
    hurtPlayer: function (raw, ang, from) {
      var g = this, s = g.stats;
      if (g.iframesT > 0 || g.state !== State.PLAY) return;
      if (Math.random() * 100 < s.dodge) {
        g.fx.dodge(g.player.x, g.player.y);
        PS.Sound.play('dodge');
        g.iframesT = 0.2;
        /* v5.6(G1): 闪避成功 → dmg_on_dodge（源 player.gd:444-457, 目标是打中你的那只怪）。
         *   注意这一支**不**触发 temp_stats_on_hit —— 源里 temp_stats_on_hit 在 `if dmg_taken > 0` 段内,
         *   闪避成功时 dmg_taken 为 0（player.gd:471 的 `if dmg_taken > 0:` 才是那段）。 */
        PS.ItemTriggers.onDodge(g, from);
        /* v6.7(Wave 3) 源 player.gd:459-466 —— 与 dmg_on_dodge 同一段 if is_dodge 代码。 */
        PS.ItemTriggers.onDodgeHeal(g);
        return;
      }
      /* v6.7(Wave 3) 源 player.gd:32 + `elif _hit_protection > 0`: 命中没被闪掉, 但本波还有次数
       *   ⇒ 本次**完全免伤**并消耗一次。位置在闪避之后、护甲之前(与源逐字同序)。 */
      if (g.waveHitProt > 0) {
        g.waveHitProt--;
        g.fx.dodge(g.player.x, g.player.y);
        PS.Sound.play('dodge');
        g.iframesT = 0.2;
        return;
      }
      /* v3.0 源原生刻度: 伤害必须保持**小数**。源里敌人单次伤害只有 1~2 点, 旧代码的
       *   "min 1 + round" 会把护甲完全吃掉(1 × (1-25%) = 0.75 → round → 1), 堆甲毫无意义。
       *   原作同样以小数结算、只在 UI 取整显示 —— 这里只保留 0.5 的手感下限, 不再 round。 */
      /* v3.6(源对齐): 一行同时覆盖正负护甲 —— B.armorCoef 就是源 run_data.gd:1352/1359 的公式本身:
       *   正护甲(armor>=0) = 1 - 10/(10 + armor/1.5) = armor/(armor+15)(与旧口径恒等, 无行为变化);
       *   负护甲 = (1 - c0) + 1(乘性 > 1)。旧的「(1-dr) + negArmorAmp 加法」在负护甲下是错的, 见 balance.js 对照表。 */
      var dmg = raw * B.armorCoef(s.armor);
      /* [有意偏差, 显式标注] 源 entities/units/player/player.gd:311 是 max(1, round(dmg * coef));
       *   本作**不 round**, 只保留 0.5 的手感下限。理由: 本作敌人单次伤害已按源刻度重标为小数
       *   (见上方 v3.0 注释), 此时再套 round 会被 max(1, ·) 抬成整数 ⇒ 玩家承伤被**抬高**、堆甲收益被抹平。
       *   出处与理由在此留痕; 偏差 = 只有"是否 round", 系数公式本身与源一致。 */
      if (dmg < 0.5) dmg = 0.5;
      g.player.hp -= dmg;
      g.iframesT = B.iframesFor(dmg, g.stats.maxHp, g.wave);   /* v3.4(源对齐): 自适应无敌帧 0.2~0.4s */
      g.shake = Math.min(B.FX.shakeMax, 3 + dmg * 0.18);
      g.fx.hurt(g.player.x, g.player.y, Math.max(1, Math.round(dmg)));
      PS.Sound.play('hurt');
      /* v5.6(G1): 受击 → temp_stats_on_hit（源 player.gd:487-489, 在 `dmg_taken > 0` 段内; 本作这一支
       *   的伤害下限恒 >= 0.5 ⇒ 一定 > 0）。累积存在 g.trigTemp, 波末由 onWaveEnd 清零。
       * 然后: 血尽 → dmg_when_death（源 main.gd:499-501）。源的顺序也是先记 temp、后判死亡。 */
      if (PS.ItemTriggers.onPlayerHit(g)) g.recalc();   /* v5.6(G1): 只有真的记了账才重算面板 —— 盲目无条件 recalc 会覆盖外部对 g.stats 的直接注入 */
      if (g.player.hp <= 0) {
        PS.ItemTriggers.onPlayerDeath(g);
        g.player.hp = 0; g.finish(false);
      }
    },

    /* v6.7(Wave 3): 第 4 参 opts —— 燃烧 tick 走 unit.gd:669-675 的 _take_damage_args_unit(不带 from),
     *   源里它**不触发**暴击/吸血那一路。这里把燃烧 tick 直接挡在门口: 只出数字, 不进暴击块。 */
    onDamage: function (e, dmg, crit, opts) {
      if (opts && opts.burn) { this.fx.dmgNum(e.x, e.y - e.r, dmg, false); return; }
      this.fx.dmgNum(e.x, e.y - e.r, dmg, crit);
      if (crit) { this.hitStop = Math.max(this.hitStop, B.FX.hitStop); PS.Sound.play('crit'); }
        /* v2.8 吸血口径按源落地(源 key 356): 每次命中以 lifesteal% 概率回 perHit 点, 与伤害量无关,
         * 且受 capPerSec 限制。改前 hv = dmg*lifesteal/100 使回血 ∝ 自己的 DPS —— 中后期每击回血
         * 超过单次受击, 于是“永远满血”(探针实测 W10~W11 最低血量 167/173)。 */
        if (this.stats.lifesteal > 0 && Math.random() * 100 < this.stats.lifesteal) {
          var room = B.LIFESTEAL.capPerSec - (this.lifestealHealed || 0);
          if (room >= B.LIFESTEAL.perHit) {
            this.lifestealHealed = (this.lifestealHealed || 0) + B.LIFESTEAL.perHit;
            this.player.hp = Math.min(this.stats.maxHp, this.player.hp + B.LIFESTEAL.perHit);
          }
        }
    },
    /* 溅射伤害: 以 (x,y) 为圆心 radius 为半径结算一次 AOE, 中心满伤 → 边缘 50%。
     * 由 combat.js 的溅射近战(def.aoe, 巨锤族)调用; 击退从爆炸中心向外辐射。
     * 注: v2.2 起 combat.js 一直在调用本方法却从未定义 —— 该类武器每次开火都抛
     * TypeError, 被 web.js 主循环 try/catch 吞掉, 表现为"游戏突然卡死不动"。 */
    aoeDamage: function (x, y, radius, dmg, opts) {
      var g = this, o = opts || {}, i, e, d, a, falloff, r;
      for (i = 0; i < g.enemies.length; i++) {
        e = g.enemies[i];
        if (e.dead || e.spawnT > 0 || e === o.skip) continue;
        r = radius + e.r;
        d = PS.util.dist(x, y, e.x, e.y);
        if (d > r) continue;
        a = d > 0.001 ? Math.atan2(e.y - y, e.x - x) : 0;
        falloff = 1 - 0.5 * PS.util.clamp(d / r, 0, 1);
        PS.Combat.dealDamage(g, e, dmg * falloff, {
          crit: o.crit, critMul: o.critMul, src: o.src, elem: o.elem,
          kx: Math.cos(a) * (o.knock || 0), ky: Math.sin(a) * (o.knock || 0)
        });
      }
    },
    /* v6.4(Wave 2): 第 2 参 opts 由 combat.js:71 传入（含 crit / critMul / src）—— heal_on_crit_kill
     *   的判据就是「这次击杀是不是暴击」, 之前签名只有 (e) 把这信息丢了。 */
    onKill: function (e, opts) {
      var g = this;
      /* v6.7(Wave 3) 源 main.gd:585-588 —— 树苗倒下时: 不算击杀、不掉材料/经验、不触发任何击杀类词条,
       *   只按 treeTurrets 词条在倒树位置补一座哨戒炮(get_spawn_pos_in_area(pos, 200))。 */
      if (e.neutral) {
        g.fx.death(e.x, e.y, (e.def && e.def.color) || '#7a8a4a', e.r);
        PS.Sound.play('kill');
        /* v7.0(源对齐, 用户「原版有树木，砍到树木会掉落大量材料…还有原版的物品掉落机制」) ——
         *   源 main.gd:596-618 spawn_loot: 树的 entity_type 是 NEUTRAL, 而那条
         *   `if entity_type == EntityType.ENEMY and not get_chance_success(spawn_chance): return`
         *   的守卫**只对怪生效** ⇒ 中立物**必定掉金**, 与波次/horde 概率无关。
         *   value = unit.get_stats_value() = tree_stats.tres 的 value = 3(源 unit.gd:99);
         *   gold_spread = clamp((3-1)*25, tree_stats.gold_spread=75, 200) = 75(main.gd:615-616)。
         *   另: tree_stats.base_drop_chance = 1.0 ⇒ 源 item_service.gd:164 的
         *   min(1.0, base_drop_chance*(1+luck)) = 1.0 ⇒ get_chance_success(1.0) 恒真
         *   ⇒ **每棵树必掉一颗 tier 0 的果实**(源 item_service.gd:173-174, min/max_consumable_tier 都是 0)。
         *   旧实现(return 之前什么都不掉)与源不符 —— 这正是用户说的「砍到树木会掉落大量材料」。
         *   注: 源在同函数里还有一条「item_chance 命中就升级成 item_box」的分支, 本作没有箱子道具
         *   ⇒ 只落到果实这一档(见 item_service.gd:176-182 的另一半)。 */
        var tv = (B.TREE && B.TREE.value) || 3;
        g.spawnLootGold(e.x, e.y, tv, Math.max(0, Math.min(200, (tv - 1) * 25)));
        var ucT = B.CONSUMABLE;
        if (ucT && (g.fruitsThisWave || 0) < ucT.maxPerWave) {
          var tbase = (B.TREE && B.TREE.baseDropChance != null) ? B.TREE.baseDropChance : 1;
          var fchT = Math.min(1, tbase * (1 + (g.stats.luck || 0) / 100));
          if (g.wave > ((B.MODES[g.mode] || B.MODES.standard).waves)) fchT /= (1 + B.endlessFactor(g.wave));
          if (Math.random() < fchT) {
            g.fruitsThisWave = (g.fruitsThisWave || 0) + 1;
            var faT = Math.random() * PS.TAU;
            g.drops.push({ x: e.x, y: e.y, kind: 'fruit',
              vx: Math.cos(faT) * PS.util.randRange(30, 80), vy: Math.sin(faT) * PS.util.randRange(30, 80), v: 0 });
          }
        }
        /* v7.1(源对齐, 用户「原版的物品掉落机制…运气属性…重新修改」) 源 get_consumable_to_drop
         *   (singletons/item_service.gd:159-189) 的**第二条**: base_drop_chance 那一关过了之后,
         *   再掷一次 `item_chance = item_drop_chance*(1+luck)/(1+_items_spawned_this_wave)`
         *   (main.gd:627), 命中就把这次掉落**升格**(源 :176-182: Boss 且非无尽 → 传说箱, 否则罕见箱)。
         *   本作没有「箱子」这个中间物 ⇒ 直接兑成那件道具(与波末幸运掉落同一个 gainItem 出口),
         *   品质仍走源的 get_tier_from_wave(B.rollTierFromWave)。
         *   树是源里唯一 item_drop_chance 明显大于 0.01 的单位(tree_stats.tres 的 0.2) ——
         *   这正是「砍树会掉好东西」在原版里的出处。旧实现这条完全没做(注释里写着"本作没有箱子")。 */
        var icap = B.TREE.bonusItemCap || 4;
        if ((g.itemsSpawnedThisWave || 0) < icap) {
          var ich = (typeof B.itemChance === "function")
            ? B.itemChance(g.stats.luck || 0, (B.TREE && B.TREE.itemDropChance) || 0, g.itemsSpawnedThisWave || 0)
            : 0;
          if (Math.random() < ich) {
            var itier = B.rollTierFromWave(g.wave, g.stats.luck || 0, Math.random) + 1;
            var ipool = PS.ItemData.poolByRarity(itier);
            if (!ipool.length) ipool = PS.ItemData.poolByRarity(1);
            if (ipool.length) {
              /* v7.9(用户「把原版道具掉落可自行选择拾取或丢弃机制加进来」): 这里原先直接 gainItem 入包,
               *   现在与波末掉落走**同一条**出口 —— 进待裁决队列, 波末商店上由玩家自选 拾取 / 丢弃。
               *   源: main.gd:635-654 掉 item_box → :657-689 因 to_be_processed_at_end_of_wave 攒着 →
               *   :1139-1157 波末 take(入包) / discard(回收折价)。件的品质/档位口径一字未改。 */
              var itid = PS.util.pick(ipool, Math.random);
              g.pendingBoxes.push({ tier: itier, id: itid, from: "tree" });
              g.itemsSpawnedThisWave = (g.itemsSpawnedThisWave || 0) + 1;
              g.fx.ring(e.x, e.y, "#a8a0e8");
              PS.Sound.play("buy");
            }
          }
        }
        var tn = Math.min(60, Math.floor(g.stats.treeTurrets || 0));
        for (var ti = 0; ti < tn; ti++) g.spawnStructAt('turret', e.x, e.y, B.TREE.turretRadius);
        return;
      }
      g.kills++;
      /* v6.4(Wave 2) 源 heal_on_crit_kill（通道 healOnCritPct）—— unit.gd:373-374: 暴击击杀时
       *   `get_chance_success(v/100)` ⇒ `healing_effect, 1`（回 1 点）; 非暴击击杀一分不回。 */
      if (opts && opts.crit && (g.stats.healOnCritPct || 0) > 0 && Math.random() * 100 < g.stats.healOnCritPct) {
        g.player.hp = Math.min(g.stats.maxHp, g.player.hp + 1);
        g.fx.heal(g.player.x, g.player.y, 1);
      }
      /* v6.7(Wave 3) 源 unit.gd:367-371 gold_on_crit_kill —— 暴击击杀掷骰, 命中 add_gold(1)。
       *   源走的是 add_gold(**只加钱, 不给经验**), 所以不能顺手用 gainMaterial。 */
      if (opts && opts.crit && (g.stats.goldOnCritPct || 0) > 0 && Math.random() * 100 < g.stats.goldOnCritPct) g.addGold(1);
      /* v6.7(Wave 3) 源 main.gd:536-544 gain_stat_for_killed_enemies_while_burning（args.is_burning）。 */
      if (opts && opts.burn) g.onBurnKill();
      /* v6.7(Wave 3) 源 main.gd:533 explode_on_death —— 死亡时按 chance 掷骰补一发爆炸。 */
      g.onDeathExplode(e);
      var m = B.MODES[g.mode];
      /* v3.4(源对齐): 材料 = 概率 x 粒数 x 面值(见 balance.js 的 dropChance/dropCount/dropValue 与
       *   ref/source-econ.md §3)。普通怪: 先掷「整只怪掉不掉」(W1~4 必掉, W5 起 max(0.5, 1-0.015w),
       *   怪潮 x0.65), 再按自身 value 掉 1~10 粒、面值恒 1。精英/Boss 用本作自设的 dropBonus。 */
      var n;
      if (e.elite) n = (e.def.dropBonus || 5);
      else if (e.boss) n = (e.def.dropBonus || 30);
      else n = (Math.random() < B.dropChance(g.wave, g.horde)) ? B.dropCount(e.def, Math.random) : 0;
      /* v3.2(主程) 源 consumable 体系: 怪按概率掉果实(源道具 enemy_fruit_drops 提升概率,
       *   consumable_heal 提升单颗回复量)。果实定位是**波内续航**, 不是主回路 ⇒ 同时限"率"与"量"。 */
      var uc = B.CONSUMABLE;
      if (uc && !e.elite && !e.boss && (g.fruitsThisWave || 0) < uc.maxPerWave) {
        /* v3.4(源对齐): 果实掉落率 = min(cap, base_drop_chance*(1+luck)) + enemy_fruit_drops 通道 */
        var fch = (typeof B.fruitDropChance === 'function')
          ? B.fruitDropChance(g.stats.luck || 0, g.stats.fruitDrops || 0)
          : Math.min(uc.cap, uc.dropChance);
        if (Math.random() < fch) {
          g.fruitsThisWave = (g.fruitsThisWave || 0) + 1;
          var fa = Math.random() * PS.TAU;
          g.drops.push({ x: e.x, y: e.y, kind: 'fruit',
            vx: Math.cos(fa) * PS.util.randRange(30, 80), vy: Math.sin(fa) * PS.util.randRange(30, 80), v: 0 });
        }
      }
      /* v6.4(Wave 2) 源 instant_gold_attracting（通道 goldAttractPct）—— main.gd:738-743: 每粒材料
       *   **掉落时**按 `randf() < v/100` 掷一次, 命中就把它的 attracted_by 设成玩家; item.gd:62-68 随后
       *   每物理帧 `move_toward(玩家, delta * _current_speed)`（初速 500px/s、每帧 +20）⇒ 这粒自己飞过去。 */
      /* v7.0(源对齐): 粒数/上限/散布/吸附全部收进 spawnLootGold(唯一入口), 这里只给 spread ——
       *   spread = clamp((value-1)*25, gold_spread, 200)(源 main.gd:616)。 */
      /* v7.1(源对齐): 源 main.gd:770 的 value = max(value, MIN_GOLD_CHANCE*base) —— 走 balance.js
       *   的 B.goldValue(本作没有 gold_drops 通道, pct 恒 0 ⇒ 今天恒等; 见那里的说明)。 */
      if (n > 0) {
        n = B.goldValue(n, 0);
        g.spawnLootGold(e.x, e.y, n, Math.max(0, Math.min(200, (n - 1) * 25)));
      }
      if (g.drops.length > 420) g.drops.splice(0, g.drops.length - 420);
      g.fx.death(e.x, e.y, e.def.color, e.r);
      PS.Sound.play('kill');
      // 分裂怪
      if (e.def.ai === 'splitter') {
        for (var si = 0; si < (e.def.splitN || 2); si++) g.spawnEnemyAt(e.def.splitInto, e.x + PS.util.randRange(-18, 18), e.y + PS.util.randRange(-18, 18));
      }
      /* v5.19c(Codex, 2026-09-29): 击杀 Boss 的通关判定必须问**唯一判据** B.isFinalWave(本模式最后一波)。
       *   用户实测 bug: 旧写法是「任意 Boss 死 -> finish(true)」, 而无尽浪潮每 5/10/20 波都出 Boss
       *   => 第 20 波杀掉 kingTuber 就**直接结算通关**(与「波次无限」矛盾)。标准 20 / 疾速 10 的魔王
       *   仍在各自最后一波, 行为一字不变。 */
      if (e.boss && B.isFinalWave(g.wave, g.mode)) { g.finish(true); }
    },

    /* ---------- 掉落 ---------- */
    /* v7.0(源对齐) 源 main.gd:698-746 spawn_gold + :704-711 的同屏金粒上限 ——
     *   ① 粒数 = floor(value) + (小数部分按概率 +1)(main.gd:699-701);
     *   ② 同屏金粒到 MAX_GOLDS = 50 时**不再新建粒子**: 随机挑一粒已存在的 +1 面值、
     *      scale +0.05(上限 2.0)(main.gd:704-711) ⇒ 总量守恒, 只是不再往屏幕上堆 draw call;
     *   ③ 每粒落点距离 = rand_range(50, 100 + spread)(main.gd:732), spread = clamp((value-1)*25,
     *      unit.gold_spread, 200)(main.gd:616) —— 由调用方算好传进来;
     *   ④ 每粒掉落时对玩家掷一次 instant_gold_attracting(命中就把这粒设成 attracted_by, :737-745)。
     * 本作把面值存在 d.v 上、拾取时 gainMaterial(d.v)(见 updateDrops), 所以 ② 的守恒与源逐字等价。
     * 单粒面值恒 1(B.dropValue, 源 items/materials/gold.gd:4)。 */
    spawnLootGold: function (x, y, value, spread) {
      var g = this, i, k, a, dist, drop, golds, b;
      var base = Math.round(B.dropValue() * ((B.MODES[g.mode] || {}).matMul || 1));
      var vf = Math.floor(value);
      var cnt = (Math.random() < (value - vf)) ? vf + 1 : vf;
      var cap = B.MAX_GOLDS || 50;
      var attractPct = g.stats.goldAttractPct || 0;
      for (i = 0; i < cnt; i++) {
        golds = [];
        for (k = 0; k < g.drops.length; k++) if (g.drops[k].kind !== 'fruit') golds.push(g.drops[k]);
        if (golds.length >= cap) {
          b = golds[(Math.random() * golds.length) | 0];
          b.v += B.dropValue();
          b.scale = Math.min(2.0, (b.scale || 1) + 0.05);
          continue;
        }
        a = Math.random() * PS.TAU;
        dist = PS.util.randRange(50, 100 + spread);
        drop = { x: x, y: y, vx: Math.cos(a) * dist, vy: Math.sin(a) * dist, v: base, scale: 1 };
        if (attractPct > 0 && Math.random() * 100 < attractPct) { drop.attract = true; drop.aSpd = 500; }
        g.drops.push(drop);
      }
    },

    updateDrops: function (dt) {
      var g = this, p = g.player, pick = g.stats.pickup, i, d;
      for (i = g.drops.length - 1; i >= 0; i--) {
        d = g.drops[i];
        d.x += d.vx * dt; d.y += d.vy * dt;
        d.vx *= Math.pow(0.01, dt); d.vy *= Math.pow(0.01, dt);
        var dd = PS.util.dist(d.x, d.y, p.x, p.y);
        if (d.attract) {
          /* v6.4(Wave 2): 被材料吸附住的这一粒 —— item.gd:67 move_toward, 速度每**物理帧** +20
           *   （60fps ⇒ 每秒 +1200）。被吸住的材料不再需要走进拾取环, 会一路飞到玩家身上。 */
          var aa = PS.util.angleTo(d.x, d.y, p.x, p.y);
          var mv = Math.min(dd, d.aSpd * dt);
          d.x += Math.cos(aa) * mv; d.y += Math.sin(aa) * mv;
          d.aSpd = (d.aSpd || 500) + 1200 * dt;
          dd = PS.util.dist(d.x, d.y, p.x, p.y);
        }
        if (dd < pick) {
          var a = PS.util.angleTo(d.x, d.y, p.x, p.y);
          var pull = 300 * (1 - dd / pick) + 90;
          d.x += Math.cos(a) * pull * dt;
          d.y += Math.sin(a) * pull * dt;
        }
        if (dd < 22) {
          if (d.kind === 'fruit') {
            var uc2 = B.CONSUMABLE, hf = (uc2 ? uc2.healHp : 3) + (g.stats.consumableHeal || 0);
            /* v8.0(W24, 2026-10-01) 源守卫(取证: ref/src-remote/effects/consumables/consumable_healing_effect.gd):
             *   `var total_healing: = max(0, value + consumable_heal_effect)` + `if total_healing <= 0: return`
             *   —— 词条把 consumable_heal_effect 压到 <= -value 时, 这一口**什么都不做**。
             *   本作此前两层全缺: hf 为负会把血**扣下去**(items.js 里 alien_worm 就是 consumableHeal: -1),
             *   hf 为 0 也会白放一次 fx.heal。两处都不是"手感问题", 是与源相反的符号错误。 */
            if (hf > 0) {
              g.player.hp = Math.min(g.stats.maxHp, g.player.hp + hf);
              g.fx.heal(d.x, d.y, hf);
            }
            /* v6.7(Wave 3) 源 player.gd:485-495 explode_on_consumable —— 吃下消耗品时按 chance 掷骰,
             *   在**果实所在点**炸一发(spicy_sauce_stats: dmg 0 / scaling maxHp 1.0 / effect scale 1.25)。 */
            if ((g.stats.explodeOnConsumablePct || 0) > 0 && Math.random() * 100 < g.stats.explodeOnConsumablePct)
              g.explodeAt(d.x, d.y, { dmg: 0, scale: 1.0, stat: 'maxHp', r: 1.25, src: 'spicy_sauce' });
          } else {
            /* v6.4(Wave 2) 源两条都在**拾金**这一支:
             *   chance_double_gold    run_data.gd:829-834 `get_chance_success(v/100) -> boost = 2`
             *   heal_when_pickup_gold main.gd:812-813 `get_chance_success(v/100)` ⇒ `healing_effect, 1`
             * 说明: 本作的 xp 挂在 material 面值上（gainMaterial 内 `xp += v * (1 + xpPct/100)`）,
             *   故翻倍同时翻材料与经验 —— 这是本作既有的「材料=经验」设计, 不是这一批引入的。 */
            var mv2 = d.v;
            if ((g.stats.doubleGoldPct || 0) > 0 && Math.random() * 100 < g.stats.doubleGoldPct) mv2 *= 2;
            if ((g.stats.healOnGoldPct || 0) > 0 && Math.random() * 100 < g.stats.healOnGoldPct) {
              g.player.hp = Math.min(g.stats.maxHp, g.player.hp + 1);
              g.fx.heal(d.x, d.y, 1);
            }
            g.gainMaterial(mv2);
            g.fx.pickup(d.x, d.y);
            /* v5.6(G1): 拾起**材料**触发 dmg_when_pickup_gold（源 main.gd:815-817）。
             *   只挂在这一支: 源的该效果在拾金路径里, 波末收获(main.gd:1265)不走它。 */
            PS.ItemTriggers.onPickupGold(g);
          }
          g.drops.splice(i, 1);
          PS.Sound.play('pickup');
        }
      }
      for (i = g.enemyProj.length - 1; i >= 0; i--) {
        var pr = g.enemyProj[i];
        pr.x += Math.cos(pr.ang) * pr.spd * dt;
        pr.y += Math.sin(pr.ang) * pr.spd * dt;
        pr.travel += pr.spd * dt;
        var hit = PS.util.dist2(pr.x, pr.y, p.x, p.y) < (pr.r + 12) * (pr.r + 12);
        if (hit) { g.hurtPlayer(pr.dmg, pr.ang, pr.from); g.enemyProj.splice(i, 1); }
        else if (pr.travel > pr.range) g.enemyProj.splice(i, 1);
      }
    },

    gainMaterial: function (v) {
      var g = this;
      g.material += v;
      /* v3.0: 源道具 xp_gain → xpPct(%) 通道 */
      g.xp += v * (1 + (g.stats.xpPct || 0) / 100);
      var leveled = false;
      while (g.xp >= B.xpNeed(g.level)) {
        g.xp -= B.xpNeed(g.level);
        g.level++;
        g.pendingLevelups++;
        leveled = true;
      }
      if (leveled) PS.Sound.play('levelup');
    },

    sweepAll: function () {
      var g = this, sum = 0, i;
      for (i = 0; i < g.drops.length; i++) sum += g.drops[i].v;
      if (sum > 0) g.gainMaterial(sum);
      g.drops.length = 0;
      /* v3.4(源对齐) 波末收获 —— 源 main.gd:1265-1269:
       *     val = harvesting_stat + <其它加成> ;  add_gold(val) 并且 add_xp(val)   <-- 同一笔数
       *   源的 harvesting 每波自我增长 ceil(harvesting * growth/100), growth 默认 5
       *   (main.gd:1472 + player_run_data.gd:437)。本作用 harvestMul 复利表达同一件事。
       *   为什么放在这里而不是 openShop(): 这笔记的是**材料 + 经验**, 可能直接把玩家顶升级;
       *   升级必须在本波末(进商店之前)结算 —— 见 beginIntermission() 的 pendingLevelups 分支。 */
      var grow = (B.HARVEST_GROWTH_PCT + (g.stats.harvestingGrowth || 0)) / 100;
      g.harvestBonus = Math.round((g.stats.harvest || 0) * (g.harvestMul || 1)) + B.baseHarvest;
      g.harvestMul = (g.harvestMul || 1) * (1 + grow);
      if (g.harvestBonus > 0) g.gainMaterial(g.harvestBonus);
      else if (g.harvestBonus < 0) g.material = Math.max(0, g.material + g.harvestBonus);
      g.enemies.length = 0;
      g.enemyProj.length = 0;
      g.projectiles.length = 0;
      g.fx.corpses.length = 0;
      /* v5.6(G1): 波末触发结算 —— 源 main.gd:1189-1195 `stats_end_of_wave` 逐条 `add_stat`(永久),
       *   紧接着 :1232 `TempStats.reset()` 把 temp_stats_on_hit 的累积清零。二者都在「一波结束」这一处。
       *   之后必须 recalc: 面板要立刻带上这一波的永久收益（grinds_magical_leaf 的生命上限 +3 会顺带回血,
       *   见 recalc 的「上限提高才回血」—— 源 add_stat(max_hp) 同样回血）。 */
      PS.ItemTriggers.onWaveEnd(g);
      g.recalc();
    },

    /* ---------- 升级 4 选 1 ---------- */
    rollLevelupChoices: function () {
      var g = this, i, out = [], used = {}, cand = null, tries, k;
      var keyOf = function (c) { return c.id || c.stat; };
      /* v7.2(源对齐) 源 item_service.gd:550-556 get_upgrades 的**早退分支**: 有 weapon_slot_upgrades
       *   词条且槽位还没给满时, 强化界面**整页只有那一张**武器槽位卡; 其余任何情况武器槽位都不出现
       *   (用户逐字「升级选项不能有加武器槽位这一选项」)。判据在 balance.js, 这里只是消费点。 */
      if (B.levelupWeaponSlotGate(g.stats)) {
        var wsCard = B.levelupWeaponSlotCard();
        if (wsCard) return [wsCard];
      }
      /* v7.2(源对齐) 源 :558-569 —— number 张卡**各自**掷一次档位(get_upgrade_data 内部调
       *   get_tier_from_wave(玩家等级, 幸运)), 再排除 ①本页已出现的 ②**上一次界面**出现过的
       *   (源 _old_upgrades, 见 ui/menus/ingame/upgrades_ui_player_container.gd:64-66), 最多重掷 50 次。
       *   旧写法是整页共用一次掷 ⇒ 4 张卡永远同档, 手感冒成「一页全传说」。 */
      var lastIds = g.levelupPrevIds || {};
      for (i = 0; i < B.LEVELUP_CHOICES; i++) {
        cand = null;
        for (tries = 0; tries < 50; tries++) {
          var list = B.levelupPoolTier(B.levelupTier(g.level, g.stats.luck, Math.random));
          if (!list.length) list = B.levelupPoolTier(0);
          if (!list.length) break;
          var c0 = list[(Math.random() * list.length) | 0];
          /* v2.3 死卡过滤(保留, 别删): 暴击伤害的生效值已下架, 抽到等于白占一个卡位 */
          if (!c0 || c0.stat === 'critDmg') continue;
          k = keyOf(c0);
          if (used[k] || lastIds[k]) continue;
          cand = c0; break;
        }
        if (!cand) {
          /* 出口保底(用户要求「不得卡死」): 先放开「不许与上一页重复」, 再放开「本页去重」。
           *   有卡可点 严格优于 死锁; critDmg 仍不放行(它在 stats.js 里是无操作)。 */
          var all = B.levelupPoolAll();
          for (var a = 0; a < all.length; a++) {
            if (all[a].stat === 'critDmg' || used[keyOf(all[a])]) continue;
            cand = all[a]; break;
          }
        }
        if (!cand) break;
        used[keyOf(cand)] = 1;
        out.push(cand);
      }
      return out;
    },
    /* 弹一次强化选择(由 takeLevelup 链式驱动, 或波末结算强制触发) */
    resolveLevelup: function () {
      var g = this;
      g.pendingLevelups--;
      /* v7.2(源对齐) 源 upgrades_ui_player_container.gd:64-66 的 `_old_upgrades = upgrades` ——
       *   记下**上一次界面**发出去的那几张, 供 rollLevelupChoices 排除(源最多重掷 50 次),
       *   免得连着两次界面看到同一张卡。 */
      var prevIds = {};
      for (var pi = 0; pi < (g.levelupChoices || []).length; pi++) {
        prevIds[g.levelupChoices[pi].id || g.levelupChoices[pi].stat] = 1;
      }
      g.levelupPrevIds = prevIds;
      g.levelupChoices = g.rollLevelupChoices();
      g.levelupRerolls = 0;   /* v7.0: 刷新计次按「一次强化界面」重置(见 rerollLevelup) */
      g.setState(State.LEVELUP);
      if (g.onLevelup) g.onLevelup();
    },
    takeLevelup: function (choice) {
      var g = this;
      g.levelups.push(choice);
      /* v5.6(G1): 升级 → stats_on_level_up（源 main.gd:872-875）。触发点选在 takeLevelup（本作
       *   兑现升级的唯一入口, 与 stats.js 读 levelups.length 的口径一致）。 */
      PS.ItemTriggers.onLevelUp(g);
      g.recalc();
      PS.Sound.play('click');
      if (g.pendingLevelups > 0) { g.resolveLevelup(); return; }   // 连续强化: 不闪回 play
      var phase = g.levelupPhase;
      g.levelupPhase = null;
      if (phase === 'waveEnd') { g.enterShop(); return; }           // 波末强化做完 → 进商店
      g.setState(State.PLAY);
    },
    /* 强化界面的**出口保底**: 与 takeLevelup 同样的状态迁移, 但**不写 g.levelups**(不计一次强化)。
       只由 UI 在「池为空」这种数据异常下调用 —— 正常局永远走 takeLevelup。 */
    skipLevelup: function () {
      var g = this;
      g.levelupChoices = null;
      PS.Sound.play('click');
      if (g.pendingLevelups > 0) { g.resolveLevelup(); return; }
      var phase = g.levelupPhase;
      g.levelupPhase = null;
      if (phase === 'waveEnd') { g.enterShop(); return; }
      g.setState(State.PLAY);
    },

    /* ---------- 波末结算: 先补齐波内累积的强化, 再进商店 ---------- */
    beginIntermission: function () {
      var g = this;
      if (g.pendingLevelups > 0) { g.levelupPhase = 'waveEnd'; g.resolveLevelup(); return; }
      g.enterShop();
    },

    /* ---------- 商店 ---------- */
    openShop: function () {
      var g = this;
      g.waveState = 'inter';
      /* v3.4(源对齐): 收获的**结算**已提前到 sweepAll()(波内最后一帧) —— 因为它同时给材料与经验,
       *   可能触发升级, 而升级必须在进商店之前落地。这里只保留结算后的快照供 UI 展示。 */
      if (g.harvestBonus == null) g.harvestBonus = 0;
      /* v3.0: 源道具 free_rerolls → 每波免费的刷新次数 */
      g.freeRerolls = Math.max(0, Math.round(g.stats.freeRerolls || 0));
      /* v7.9(用户逐字「把原版道具掉落可自行选择拾取或丢弃机制加进来」)—— 这一段原来是**白送**:
       *   命中就 `g.gainItem(did); g.luckDropItem = did;`。整段已搬进 rollWaveDrop(), 且不再入包:
       *   命中只把那一件推进 g.pendingBoxes, 波末由裁决遮罩让玩家自选 拾取 / 丢弃。
       *   进商店的入口同步换成 enterShop() —— 它先 rollWaveDrop() 再 openShop(), 与源"波末先处理
       *   消耗品、再进商店"同序; **直接**调 openShop() 的探针/工具(probe-fuse-play / verify-fuse-ui /
       *   hitmap-probe)因此不会凭空多出一层遮罩, 那几条门禁的量具保持原样。 */
      g.rerolls = 0;
      if (!g.lockedCards) g.lockedCards = [false, false, false, false];
      g.shopCards = g.rollShop(true);
      /* v7.9: 本波(或本波内砍树)攒下的掉落在这里变成"当前待裁决件" —— 队列空则是 null, 界面上什么都不多画。 */
      this.openBoxDecision();
      this.setState(State.SHOP);
      if (this.onShop) this.onShop();
    },

    /* ==================== v7.9 掉落裁决(源 item_box 的波末三选一) ====================
     * 源链路(逐条读自 ref/src-remote):
     *   · main.gd:635-654  ItemService.get_consumable_to_drop 命中 → 地上掉一个 item_box 消耗品;
     *   · main.gd:657-689  on_consumable_picked_up: 因为 consumable_data.to_be_processed_at_end_of_wave
     *                      (items/consumables/consumable_data.gd:4)为真, **不立刻入包**, 攒进
     *                      _consumables_to_process; item_box 还会计入 _items_spawned_this_wave(:637);
     *   · main.gd:1139-1157 波末 upgrades_ui 上的三个按钮: take = RunData.add_item(真入包);
     *                      discard = ItemService.get_recycling_value(wave, item_data.value, p) → add_gold;
     *                      ban = 折价 + 拉黑 + 扣 ban token。
     * 本作没有"地上那个箱子"这个中间物 ⇒ 掉落**直接进队列**, 裁决界面是波末商店上的一层遮罩
     * (所以裁决期间世界照样是冻结的, 也不需要新的 State)。
     * 用户口径只点名了两条 ——「拾取或丢弃」; 源的第三条 ban 需要一整套 banned 池 + 挑战解锁
     * (run_data.gd:308 uses_ban / :19 BAN_MAX_TOKEN), 本作没有这套东西, **不臆造**。 */
    /* 波末掷一次掉落 —— 只由 enterShop() 调(进商店的唯一波末入口)。 */
    rollWaveDrop: function () {
      var g = this;
      g.luckDropItem = null;
      var luckN = g.stats.luck || 0;
      /* 概率/品质公式优先走 balance.js(Hume 的数值口径): B.luckDropChance(w, luck);
       * 缺失时用本地兜底, 保证本函数永不因缺函数而抛错。 */
      var dch = (typeof B.luckDropChance === 'function') ? B.luckDropChance(g.wave, luckN)
                                                        : Math.min(0.60, 0.08 + 0.004 * luckN);
      if (Math.random() < dch) {
        /* v3.5(源对齐): 走源的逐档判定(与商店/升级池同一个 B.rollTierFromWave), 不自己搭权重。 */
        var dtier = B.rollTierFromWave(g.wave, luckN, Math.random) + 1;
        var dpool = PS.ItemData.poolByRarity(dtier);
        if (!dpool.length) dpool = PS.ItemData.poolByRarity(1);
        if (dpool.length) {
          /* 件在**生成箱子的那一刻**就摇好并连队列一起存(源是在波末 show_consumable_data 里摇);
           *   两条路用的都是本波的 B.rollTierFromWave ⇒ 概率分布逐字相同。 */
          g.pendingBoxes.push({ tier: dtier, id: PS.util.pick(dpool, Math.random), from: 'wave' });
          /* 源 main.gd:637-638: item_box 计入 _items_spawned_this_wave(本波配额)。 */
          g.itemsSpawnedThisWave = (g.itemsSpawnedThisWave || 0) + 1;
          PS.Sound.play('buy');
        }
      }
    },
    /* 波末进商店的唯一入口: 先掷掉落(进队列), 再开商店。 */
    enterShop: function () {
      this.rollWaveDrop();
      this.openShop();
    },
    /* 把队首那件变成"当前待裁决件"。队列空 → boxItem = null(界面什么都不画)。 */
    openBoxDecision: function () {
      var g = this;
      g.boxItem = (g.pendingBoxes && g.pendingBoxes.length) ? g.pendingBoxes[0] : null;
      return g.boxItem;
    },
    /* 这一件丢弃能换回多少材料 —— 源的 get_recycling_value, 公式在 balance.js::B.recycleValue。 */
    boxRecycleValue: function () {
      var g = this;
      if (!g.boxItem) return 0;
      var def = PS.ItemData.byId(g.boxItem.id);
      var base = (def && def.price) || 1;      /* 源 item_data.value == 本表 def.price(见 items.js 头注) */
      return B.recycleValue(base, g.wave, g.stats.recycleGainPct || 0);
    },
    /* 拾取 —— 源 main.gd:1139-1140 on_item_box_take_button_pressed: RunData.add_item(真入包)。 */
    takeBox: function () {
      var g = this;
      if (!g.boxItem) return false;
      var id = g.boxItem.id;
      g.gainItem(id);
      g.luckDropItem = id;      /* 商店右栏「★ 幸运掉落『X』」—— 只有真入包了才配这么写 */
      g.recalc();
      PS.Sound.play('buy');
      this.closeBox();
      return true;
    },
    /* 丢弃 —— 源 main.gd:1143-1147: get_recycling_value → add_gold(本作 add_gold 就是 material)。
     *   注意语义: 丢弃**不拿道具**, 换回材料(这与"卖掉已持有的道具"是两件事, 后者本作没有)。 */
    discardBox: function () {
      var g = this;
      if (!g.boxItem) return false;
      g.material += this.boxRecycleValue();
      PS.Sound.play('sell');
      this.closeBox();
      return true;
    },
    /* 出队 + 顶上下一件。队列清空后**不迁移状态** —— 裁决层只是商店页上的一层遮罩,
     *   撤掉它自然露出下面那家商店(相机/冻结状态全程没动过)。 */
    closeBox: function () {
      var g = this;
      if (g.pendingBoxes && g.pendingBoxes.length) g.pendingBoxes.shift();
      this.openBoxDecision();
    },
    rollShop: function (respectLock) {
      var g = this, w = g.wave, luck = g.stats.luck;
      g.shopDetail = null;                 /* v7.11: 重roll 后旧下标指向别的卡, 详情页必须关掉 */
      /* v3.8(与 openShop:791 同一守卫): `lockedCards` 在 newRun 里被置 null, 只有 openShop 会重建。
       *   非 openShop 路径(工具 / 调试 / 存档迁移)调 rollShop 时它是 null ⇒ 下面 g.lockedCards[i] 抛 TypeError。
       *   buyCard / toggleLock 上一轮已加同一道守卫, rollShop 漏了 —— 本次由 work/probe-auditA-fixes.cjs 抓到。 */
      if (!g.lockedCards) g.lockedCards = [false, false, false, false];
      var cards = [], i;
      /* v3.5(源对齐) 源 singletons/item_service.gd:233-250 的**商店武器保底**:
       *   wave <= 2 → 保底 2 把武器 · wave <= 5 → 保底 1 把 · 其余按 CHANCE_WEAPON = 0.35 掷骰。
       *   旧代码是自制 50/50 且**没有保底** ⇒ 前 5 波可能一把武器都不给(实测 seed 1 到第 5 波只买到
       *   2 把武器、seed 42 只买到 1 把 ⇒ 输出不够, 第 4~5 波暴毙)。 */
      var nbGuaranteed = (w <= 2) ? 2 : (w <= 5 ? 1 : 0);
      var nbWeaponsAdded = 0, nbLockedWeapons = 0;
      if (g.shopCards) {
        for (i = 0; i < B.SHOP_SLOTS; i++) {
          var lc = g.shopCards[i];
          if (respectLock && lc && lc.kind === 'weapon' && !lc.sold && g.lockedCards && g.lockedCards[i]) nbLockedWeapons++;
        }
      }
      for (i = 0; i < B.SHOP_SLOTS; i++) {
        if (respectLock && g.lockedCards[i] && g.shopCards && g.shopCards[i] && !g.shopCards[i].sold) {
          cards.push(g.shopCards[i]);
          continue;
        }
        var isWeapon = (w <= 2)
          ? (nbWeaponsAdded + nbLockedWeapons < nbGuaranteed)
          : ((Math.random() < B.CHANCE_WEAPON) || (nbWeaponsAdded + nbLockedWeapons < nbGuaranteed));
        /* v3.5(源对齐): 源 item_service.gd:303 get_tier_from_wave(wave, luck) -> 逐档判定, 不再走自制权重。 */
        var tier = B.rollTierFromWave(w, luck, Math.random) + 1;
        if (isWeapon) {
          var keys = Object.keys(PS.WeaponData.list);
          var avail = [];
          for (var k = 0; k < keys.length; k++) {
            var wd = PS.WeaponData.list[keys[k]];
            /* aux 行（源里的园圃/弹体 stats）不是武器: 不上架、不参与同武器偏置、不进升阶链。
             *   它们留在表里只是为了 1:1 台账（见 weapons.js 头注释）。 */
            if (wd.aux) continue;
            if (wd.tier === tier && w >= PS.WeaponData.sellableAt(wd.tier)) avail.push(keys[k]);
          }
          if (avail.length) {
            nbWeaponsAdded++;                       /* v3.5: 只统计**真的发出去了**的武器(源 nb_weapons_added 同口径) */
            /* v3.10(源对齐) 同武器偏置 —— 源 item_service.gd:377-386 + :454-461:
             *   rand_wanted < chance_same_weapon => 候选池筛成"玩家已持有的族(weapon_id)", 池空回落全池。
             *   [DERIVED] 源会把**异阶**同名件塞给你, 而它按源规则合不了(源 can_combine 按逐阶 my_id 计数)。
             *   玩家的第一诉求是"买来能升阶", 所以筛完后分两层取序: ①同阶且已持有(买下即合, 真的有用)
             *   ②没有才退到"同族异阶"(与源一致)。偏置窗口与概率不动, 只改池内取序。 */
            var wpool = avail;
            if (Math.random() < B.sameWeaponChance(w)) {
              var ownedFam = {}, ownedSameTier = {}, oi, od;
              for (oi = 0; oi < (g.weapons || []).length; oi++) {
                od = PS.WeaponData.list[g.weapons[oi].key];
                if (!od || !od.family) continue;
                ownedFam[od.family] = 1;
                if (od.tier === tier) ownedSameTier[od.family] = 1;   /* 同名同阶 => 买下即合 */
              }
              var poolFam = [], poolSameTier = [], fi, fd;
              for (fi = 0; fi < avail.length; fi++) {
                fd = PS.WeaponData.list[avail[fi]];
                if (!fd || !ownedFam[fd.family]) continue;
                poolFam.push(avail[fi]);
                if (ownedSameTier[fd.family]) poolSameTier.push(avail[fi]);
              }
              if (poolSameTier.length) wpool = poolSameTier;
              else if (poolFam.length) wpool = poolFam;   /* 源口径; 两者皆空 => 保持 avail(源 backup_pool 回落) */
            } else if (PS.SetData && Math.random() < B.sameWeaponSetChance(w)) {
              /* v5.7(源对齐) 源 item_service.gd:377-390 的同**套装**偏置:
               *   if rand_wanted < chance_same_weapon      -> 池筛成"已有的 weapon_id"
               *   elif rand_wanted < chance_same_weapon_set -> 剔除"族不属于身上任何已有套装"的武器
               *   源是同一个 rand_wanted 的区间判定(两分支互斥) ⇒ 这里写成 else if, 与源同构;
               *   掷骰按卡进行这一点与上面同武器偏置保持一致(源是每轮商店掷一次 [DERIVED])。
               * 判定集 = player_sets = 源 run_data.gd:379 active_sets.keys() ⇒ **身上有的**套装
               *   (count >= 1 就算, 与是否已激活到 2 件无关), 见 sets.js 的 idsHeld。
               * 筛空则保持 avail —— 源 :454-461 的 backup_pool 回落语义。 */
              var heldSets = PS.SetData.idsHeld(g.weapons), poolSet = [];
              if (heldSets.length) {
                var si, sd, sfs, hi, hitSet;
                for (si = 0; si < avail.length; si++) {
                  sd = PS.WeaponData.list[avail[si]];
                  sfs = sd ? PS.SetData.setsOf(sd.family) : [];
                  hitSet = false;
                  for (hi = 0; hi < sfs.length && !hitSet; hi++) if (heldSets.indexOf(sfs[hi]) >= 0) hitSet = true;
                  if (hitSet) poolSet.push(avail[si]);
                }
                if (poolSet.length) wpool = poolSet;
              }
            }
            var wk = PS.util.pick(wpool, Math.random);
            var wprice = B.weaponPrice(PS.WeaponData.list[wk].price, tier, w);
            cards.push({ kind: 'weapon', key: wk, tier: tier, price: Math.max(1, Math.round(wprice * (1 + (g.stats.shopPricePct || 0) / 100))) });
            continue;
          }
          isWeapon = false;
        }
        var rar = tier;
        var pool = PS.ItemData.poolByRarity(rar);
        if (!pool.length) pool = PS.ItemData.poolByRarity(1);
        var iid = PS.util.pick(pool, Math.random);
        var iprice = B.itemPrice(rar, w);
        cards.push({ kind: 'item', id: iid, tier: rar, price: Math.max(1, Math.round(iprice * (1 + (g.stats.shopPricePct || 0) / 100))) });
      }
      return cards;
    },
    /* v7.11(用户「点按卡片能完整显示属性」+「只有点购买按钮才能购买」): 详情页是**纯 UI 状态**,
     *   写在这里而不是 ui.js, 因为它必须与 shopCards 同生命周期(重roll / 换波 / 买掉都要失效)。
     *   openShopDetail 只存下标; drawShopDetail 每帧从 shopCards 现取, 卡没了就自动关。 */
    openShopDetail: function (idx) {
      var c = (this.shopCards || [])[idx];
      if (!c || c.sold) return false;
      this.shopDetail = idx; PS.Sound.play('click'); return true;
    },
    closeShopDetail: function () { this.shopDetail = null; },
    openCharDetail: function (id) { this.charDetail = id; PS.Sound.play('click'); },
    closeCharDetail: function () { this.charDetail = null; },
    toggleLock: function (idx) {
      var g = this, c = g.shopCards[idx];
      if (!c || c.sold) return;
      /* 与 openShop:791 同一守卫 —— `lockedCards` 在 newRun 里被置 null, 只有 rollShop 会重建;
       *   非 openShop 路径(工具 / 存档 / 调试)进入商店时它是 null, 直接按下标写会抛 TypeError。
       *   src/ui/ui.js:1784 早就为同一个数组加过守卫并写明理由, 这两处写入口漏了。 */
      if (!g.lockedCards) g.lockedCards = [false, false, false, false];
      g.lockedCards[idx] = !g.lockedCards[idx];
      PS.Sound.play('click');
    },
    /* v3.2(主程): 道具入包唯一入口 —— 负责在**取得时**记录"锁定当前值"型上限。 */
    gainItem: function (id) {
      var rec = { id: id };
      var def = PS.ItemData.byId(id);
      if (def && def.mods) {
        if (def.mods.hpCapCurrent) rec.hpCapAt = Math.round(this.stats.maxHp);
        if (def.mods.speedCapCurrent) rec.speedCapAt = Math.round(this.stats.speed);
      }
      this.items.push(rec);
      /* v5.6(G1): 源 run_data.gd:1177-1183 —— 装备使某 stat 上升就触发
       *   gain_stat_for_equipped_item_with_stat。**必须在入包之后**调用（源的判定基是 effect.apply 之后的
       *   `effects[key]` 差值）。升级卡不触发（源有 `not item_data is UpgradeData` 的排除）。 */
      PS.ItemTriggers.onEquip(this, id);
      return rec;
    },

    /* 武器栏**满**时这把武器还能不能买 —— 源口径, 不是本作新加:
     *   `ref/src-remote/ui/menus/shop/base_shop.gd:602-615 buy_weapon`:
     *     if not RunData.has_weapon_slot_available(item_data, player_index):
     *         for weapon in weapons:
     *             if weapon.my_id == item_data.my_id and item_data.upgrades_into != null:
     *                 add_weapon(item_data) ; _combine_weapon(...)   # ← 买入后**立即合并**
     *     else: add_weapon(item_data)
     *   `ref/src-remote/ui/menus/shop/shop_items_container.gd:133 _can_weapon_be_bought`:
     *     if player_has_weapon and not weapon_slot_available and weapon_data.upgrades_into != null
     *        and weapon_data.upgrades_into.tier <= max_weapon_tier: return true
     *   ⇒ 栏满**不是**拒绝条件: 只要已持有同名件且该件还能升阶, 买进来的这件会立刻与它合并
     *     (净件数不变, 阶 +1)。
     *   ⚠ 旧实现无条件 `return false` ⇒ 武器栏一满就**永远无法升级同名武器** —— 这正是用户实测
     *     投诉「同名武器无法升级」的根因(与 tools/harness.cjs 那处 `>= 6` 硬编码是两处独立缺陷)。
     *   满阶(tierUp 不存在或 tier>=4)不可升; 此时栏满仍然拒绝, 与源 `upgrades_into == null` 分支一致。 */
    canBuyWhileFull: function (key, tier) {
      var g = this;
      var iwCanon = PS.WeaponData.canon || function (k) { return k; };
      if (!PS.WeaponData.tierUp[iwCanon(key)] || tier >= 4) return false;
      for (var i = 0; i < g.weapons.length; i++) if (iwCanon(g.weapons[i].key) === iwCanon(key)) return true;
      return false;
    },
    buyCard: function (idx) {
      var g = this, c = g.shopCards[idx];
      g.shopDetail = null;               /* v7.11: 买完(或买不成)一律关详情页, 免得停在已售的卡上 */
      if (!c || c.sold || g.material < c.price) return false;
      if (c.kind === 'weapon') {
        var cap = g.stats.weaponSlot || B.WEAPON_SLOTS;                /* v3.5: 源 weapon_slot 词条通道 */
        var full = g.weapons.length >= cap;
        if (full && !g.canBuyWhileFull(c.key, c.tier)) return false;
        g.weapons.push({ key: c.key, tier: c.tier, cd: 0.2, angle: Math.random() * PS.TAU });
        /* 买入即合(源 base_shop.gd:602-615 buy_weapon + :622-627 _on_item_combine_button_pressed):
         *   源在**栏满**时才自动合并; 栏未满时把同名片作为独立一件加入, 由玩家在武器栏点「合」。
         *   本作把这条路收敛成"只要手上已有**同名同阶**件, 买入立刻合并" —— 反复实测的用户反馈是
         *   「购买同名武器还是无法合成」, 死角正是"栏未满 ⇒ 什么都不发生"。
         *   tryFuse 找不到同名片时返回 false 且**不改任何状态**, 所以无条件调用是安全的;
         *   同阶×2 → 净件数不变、阶 +1(与源 _combine_weapon 的 nb_to_remove=2 语义等价)。
         *   注: 源 can_combine(run_data.gd:1317-1326) 按 `my_id` 计数, 而 my_id 是**逐阶**的资源 id
         *   (证据: items/upgrades/ 下各件数据 的 my_id 分别是 upgrade_speed_1/2/3/4, 即一阶一 id; 跨阶靠
         *     weapon_id 关联, 见 item_service.gd:362) ⇒ 合并必须**同阶**, 本作与源一致。 */
        g.tryFuse(g.weapons.length - 1);
      } else {
        g.gainItem(c.id);
      }
      g.material -= c.price;
      c.sold = true;
      if (!g.lockedCards) g.lockedCards = [false, false, false, false];   /* 同 toggleLock / openShop: 非 openShop 路径可能未建 */
      g.lockedCards[idx] = false;
      this.recalc();
      PS.Sound.play('buy');
      if (this.onBuy) this.onBuy(c);
      return true;
    },
    rerollShop: function () {
      var g = this;
      /* v3.8: 刷新费减免(角色「南瓜」的特长; 原先 passive.mods 为空 ⇒ 死效果)。下限 0, 不会出现负价。 */
      var cost = (g.freeRerolls > 0) ? 0 : Math.max(0, B.rerollPrice(g.wave, g.rerolls) - (g.stats.rerollDiscount || 0));
      if (g.material < cost) return false;
      if (g.freeRerolls > 0) g.freeRerolls--;
      g.material -= cost;
      g.rerolls++;
      g.shopCards = g.rollShop(true);
      PS.Sound.play('reroll');
      return true;
    },
    /* v7.0(用户逐字「升级选项，添加刷新按钮，可以花材料刷新」) 强化界面的刷新。
     * 价格复用**商店那条同形公式**(源 item_service.gd:723-729 get_reroll_price → balance.js B.rerollPrice),
     *   只把计次换成强化界面自己的 levelupRerolls; 源里升级界面没有这个按钮, 所以口径按本作自定:
     *   · **不吃 free_rerolls**(那是「每波商店免费刷新」的词条, 拿来白刷升级会无限重掷);
     *   · rerollDiscount 词条照常减免(它是"刷新费减免"本身)。
     * 重置点: resolveLevelup 每开一次强化界面就归零 —— 一次强化界面内的连刷才逐次涨价。 */
    rerollLevelup: function () {
      var g = this;
      var cnt = g.levelupRerolls || 0;
      var cost = Math.max(0, B.rerollPrice(g.wave, cnt) - (g.stats.rerollDiscount || 0));
      if (g.material < cost) return false;
      g.material -= cost;
      g.levelupRerolls = cnt + 1;
      /* 洗牌要**真的换一批**: 池子小的时候纯随机有概率原样返回(玩家会当成"按钮没反应")。
       * 最多重掷 8 次要求"四张卡的 stat 多重集"与上一批不同; 8 次都撞就接受(池子真的只有一种)。 */
      var prev = '', next = '', t0 = 0;
      for (var pi = 0; pi < (g.levelupChoices || []).length; pi++) prev += '|' + g.levelupChoices[pi].stat;
      for (t0 = 0; t0 < 8; t0++) {
        var cand = g.rollLevelupChoices(), sig = '', ci;
        for (ci = 0; ci < cand.length; ci++) sig += '|' + cand[ci].stat;
        next = sig;
        if (sig !== prev || t0 === 7) { g.levelupChoices = cand; break; }
      }
      void(next);
      PS.Sound.play('reroll');
      return true;
    },
    sellWeapon: function (idx) {
      var g = this, slot = g.weapons[idx];
      if (!slot || g.weapons.length <= 1) return false;
      var def = PS.WeaponData.list[slot.key];
      /* v6.7(Wave 3) 源 item_service.gd:732-742 recycling_gains —— 回收比例 = clamp(0.25 + v/100, 0.01, 1.0)。
       *   B.sellRatio 就是源里的 0.25 基准, 词条在**同一条 clamp** 里加(所以堆多了最多 100% 回收)。 */
      var sellR = Math.max(0.01, Math.min(1.0, B.sellRatio + (g.stats.recycleGainPct || 0) / 100));
      var price = Math.max(3, Math.round(def.price * PS.WeaponData.tierPrice[slot.tier - 1] * sellR));
      g.weapons.splice(idx, 1);
      g.material += price;
      this.recalc();
      PS.Sound.play('sell');
      return true;
    },
    tryFuse: function (idx) {
      var g = this, slot = g.weapons[idx];
      if (!slot) return false;
      var up = PS.WeaponData.tierUp[slot.key];
      if (!up || slot.tier >= 4) return false;
      var j, found = -1, canon = PS.WeaponData.canon || function (k) { return k; };
      var myKey = canon(slot.key);
      /* 身份判定必须过 canon(): 「起始武器(别名 swift1)」与「商店正典件(smg_t1)」是同一把武器, 但 key 字符串不同。
       *   旧实现直接比字符串 ⇒ 玩家的两把「连发短铳 I」永远合不了（实测事故）。 */
      for (j = 0; j < g.weapons.length; j++) {
        if (j !== idx && canon(g.weapons[j].key) === myKey) { found = j; break; }
      }
      if (found < 0) return false;
      g.weapons.splice(found, 1);
      slot.key = canon(up);
      slot.tier++;
      slot.cd = 0.2;
      this.recalc();
      PS.Sound.play('fuse');
      if (this.onFuse) this.onFuse(up);
      return true;
    },
    nextWave: function () {
      var g = this;
      if (g.state !== State.SHOP) return;
      /* v7.9 保底(只服务机器/异常路径, 真人到不了这里 —— 裁决遮罩盖住整屏, 出发按钮在那期间点不到):
       *   还有没裁决的掉落, 就按**默认全部拾取**处理掉, 再照原样推进波次 —— 与 v7.9 之前"白送"的
       *   结局一致, 只是把"谁决定"从代码交给了玩家。bot 走的是 harness.cjs:221 的每帧
       *   `if (state === shop) { shopRoutine(); g.nextWave(); }` —— 它在同一帧里先买完(买卡走
       *   g.buyCard, 不经过热区表)再出发, 所以商店一个都不少、难度/经济口径的量具保持原样。 */
      var boxGuard = 0;
      while (g.boxItem && boxGuard++ < 64) { if (!this.takeBox()) break; }
      g.eliteSpawned = false;
      g.eliteAlive = false;
      g.levelupPhase = null;
      /* v6.7(Wave 3) 源 base_shop.gd:209-215/334-337 的 hourglass —— 按持有的时光沙漏件数**回退波号**,
       *   并把那 N 件从背包里**消耗掉**(源是 use_item 式的一次性)。
       * 护栏: 回退后波号不得 < 2(即不许退到开局波之前), 否则按普通推进处理。 */
      var hgN = 0, hgi, hDef;
      for (hgi = 0; hgi < g.items.length; hgi++) {
        hDef = PS.ItemData.byId(g.items[hgi].id);
        if (hDef && hDef.mods && hDef.mods.hourglassFlag) hgN++;
      }
      if (hgN > 0 && g.wave > hgN) {
        var hgUsed = 0;
        for (hgi = g.items.length - 1; hgi >= 0 && hgUsed < hgN; hgi--) {
          hDef = PS.ItemData.byId(g.items[hgi].id);
          if (hDef && hDef.mods && hDef.mods.hourglassFlag) { g.items.splice(hgi, 1); hgUsed++; }
        }
        g.recalc();
        g.setState(State.PLAY);
        g.startWave(g.wave - hgN + 1);
        return;
      }
      g.setState(State.PLAY);
      g.startWave(g.wave + 1);
    },

    /* ==================== v6.7(Wave 3): 燃烧 / 爆炸 / 结构体 / 中性物 / 波次扩展 ====================
     * 本节是本批 45 件道具的**唯一落点**。每一条都给出源出处; 与源不同之处逐条显式标注。
     * 版面: 经济 → 燃烧 → 爆炸 → 结构体 → 中性物(树) → 眼豆 → 波次扩展 → 鬼火。 */

    /* ---------- 经济: 源 run_data.gd 的 add_gold（只加钱, 不给经验） ---------- */
    addGold: function (v) {
      if (!v) return;
      this.material = Math.max(0, (this.material || 0) + v);
    },

    /* 存活敌人数（不含中性物）—— 同屏上限与召唤拥挤判定的唯一口径。 */
    liveEnemies: function () {
      var en = this.enemies || [], n = 0, i;
      for (i = 0; i < en.length; i++) if (!en[i].dead && !en[i].neutral) n++;
      return n;
    },

    /* ---------- 燃烧（源 effects/burning_data.gd + unit.gd:581-727） ---------- */
    /* 源 unit.gd:661-707 的 BurningTimer 节拍: 基准 0.5 秒; burning_cooldown_reduction 让它变快,
     *   下限 0.1 秒（frozen_heart 的 burnCdPct -100 把节拍翻倍到 1.0 秒 —— 与源同向）。 */
    burnWait: function () {
      var s = this.stats || {};
      return Math.max(0.1, B.BURN.tick * (1 - (s.burnCdPct || 0) / 100));
    },
    /* 燃烧参数: 面板词条 + 弹药自带（结构体喷火哨座）。伤害公式逐字照源
     *   weapon_service.gd:288-338 apply_scaling_stats_to_damage（**加法**池）+ apply_damage_bonus（×(1+dmgPct)）。 */
    burnData: function (extra) {
      var s = this.stats || {}, ex = extra || {};
      var scale = Math.max(0, s.burnScalePct || 0) / 100;
      var base = (ex.dmg || 0) + (s.burnDmg || 0) + scale * (s.eleDmg || 0) + (ex.eng || 0) * (s.engDmg || 0);
      return {
        chance: Math.max((s.burnChancePct || 0) / 100, ex.chance || 0),
        dmg: Math.max(1, Math.round(base * (1 + (s.dmgPct || 0)))),
        dur: Math.max(s.burnDur || 0, ex.dur || 0),
        spread: Math.max(0, s.burnSpread || 0),
        hpPct: Math.max(0, s.burnHpPct || 0)
      };
    },
    /* 源 unit.gd:581-583: 每次命中掷一次（chance 命中才点燃; 中性物不烧, 与源 "not hitbox.is_healing" 同向）。 */
    tryBurn: function (e, extra) {
      var g = this;
      if (!e || e.neutral || e.dead) return false;
      var bd = g.burnData(extra);
      if (bd.dur <= 0 || bd.chance <= 0) return false;
      if (Math.random() >= bd.chance) return false;
      g.applyBurn(e, bd, [e]);
      return true;
    },
    /* 源 unit.gd:618-653 apply_burning: 已燃烧时**逐项取 max**（不是叠加）; 新点燃才建层。 */
    applyBurn: function (e, bd, seen) {
      var st = e.burn;
      if (st && st.dur > 0) {
        st.dmg = Math.max(st.dmg, bd.dmg);
        st.hpPct = Math.max(st.hpPct || 0, bd.hpPct || 0);
        st.dur = Math.max(st.dur, bd.dur);
        if (st.t > this.burnWait()) st.t = this.burnWait();
      } else {
        e.burn = { dmg: bd.dmg, hpPct: bd.hpPct || 0, dur: bd.dur, t: this.burnWait(), spread: bd.spread || 0 };
      }
      /* [有意偏差, 显式标注] 源里 spread 只**激活粒子**(unit.gd:651-652), 蔓延由那个粒子场景自己的
       *   碰撞决定, 而 ref/ 下读不到那个 .tscn。本作把它落成"以 ±B.BURN.spreadR 内的未燃烧怪为跳板
       *   逐跳点燃", 每跳预算 -1 ⇒ 蛇形豆荚(+1)只多一跳。数字可测, 不会一次点亮全屏。 */
      if ((bd.spread || 0) > 0) this.spreadBurn(e, bd, Math.min(60, Math.floor(bd.spread)), seen || [e]);
    },
    spreadBurn: function (src, bd, budget, seen) {
      if (budget <= 0) return 0;
      var g = this, en = g.enemies || [], i, e, hits = 0;
      seen = seen || [src];
      for (i = 0; i < en.length && hits < budget; i++) {
        e = en[i];
        if (!e || e.dead || e.neutral || e.spawnT > 0) continue;
        if (seen.indexOf(e) >= 0) continue;
        if (e.burn && e.burn.dur > 0) continue;
        if (PS.util.dist(src.x, src.y, e.x, e.y) > B.BURN.spreadR) continue;
        seen.push(e);
        g.applyBurn(e, { chance: 1, dmg: bd.dmg, dur: bd.dur, hpPct: bd.hpPct, spread: bd.spread - 1 }, seen);
        hits++;
      }
      return hits;
    },
    /* 源 unit.gd:661-707 的一次结算: 伤害 = 固定 dmg（is_burning=true ⇒ enemy.gd:296-304 再加当前生命的
     *   hpPct%, 即火油藤的 burning_enemy_hp_percent_damage）; 结算后 duration -1, <=0 熄灭(源 :702-704)。 */
    burnTick: function (e, dt) {
      var g = this, st = e.burn;
      if (!st) return;
      st.t -= dt;
      if (st.t > 0) return;
      st.t = g.burnWait();
      /* v7.11: 源 enemy.gd:296-304 —— 基数取**最大生命**(current_stats.health), 精英/Boss 再除以
       *   源的 1000/100 除数差(见 B.BURN.hpPctFactor)。旧写法用当前血且不区分 Boss ⇒ 薯王每跳
       *   掉 10% 血, 高 burnCdPct 下 2 秒融化(用户「boss 没撑过 1 秒」)。 */
      var extra = st.hpPct > 0 ? Math.floor(Math.max(0, e.maxHp) * st.hpPct / 100 / B.BURN.hpPctFactor(e) / B.BURN.endlessDiv(g.wave)) : 0;
      PS.Combat.dealDamage(g, e, st.dmg + extra, { burn: true, elem: true, src: "burn" });
      st.dur -= 1;
      if (st.dur <= 0) delete e.burn;
    },
    updateBurns: function (dt) {
      var en = this.enemies || [], i;
      for (i = 0; i < en.length; i++) if (en[i].burn && !en[i].neutral) this.burnTick(en[i], dt);
    },

    /* ---------- 爆炸（源 weapon_service.gd:281-286 + main.gd:533 + player.gd:485-495） ---------- */
    /* dmg = round((固定值 + 缩放项) × (1 + dmgPct + explodeDmgPct/100)) —— 源里 explosion_damage 与
     *   percent_damage 在**同一个加法池**里; 半径 = B.EXPLOSION.baseR × spec.r × (1 + explodeSizePct/100)。 */
    explodeAt: function (x, y, spec) {
      var g = this, s = g.stats || {}, o = spec || {};
      var base = (o.dmg || 0) + (o.scale || 0) * (s[o.stat || "meleeDmg"] || 0);
      var dmg = Math.max(1, Math.round(base * (1 + (s.dmgPct || 0) + (s.explodeDmgPct || 0) / 100)));
      var radius = B.EXPLOSION.baseR * (o.r || 1) * (1 + (s.explodeSizePct || 0) / 100);
      g.fx.ring(x, y, "#e0783a");
      g.aoeDamage(x, y, radius, dmg, { src: o.src || "explosion", crit: false, skip: o.skip });
      return dmg;
    },
    /* 源 main.gd:533 explode_on_death —— 死亡时按 chance（**求和后掷一次**）补一发。
     *   rip_and_tear_stats: 10 / meleeDmg 0.5 / effect scale 0.65。
     *   [有意偏差, 显式标注] 源没有递归护栏; 本作加一条深度上限 6 —— 爆炸链会经 onKill 再触发自己,
     *   不加护栏时"一炸到底"能把调用栈打崩(实测风险), 而源靠 Godot 的物理帧把连锁摊到多帧上。 */
    onDeathExplode: function (e) {
      var g = this, s = g.stats || {};
      if ((s.explodeOnDeathPct || 0) <= 0) return;
      if (Math.random() * 100 >= s.explodeOnDeathPct) return;
      if ((g.expDepth || 0) >= 6) return;
      g.expDepth = (g.expDepth || 0) + 1;
      try { g.explodeAt(e.x, e.y, { dmg: 10, scale: 0.5, stat: "meleeDmg", r: 0.65, src: "rip_and_tear" }); }
      finally { g.expDepth--; }
    },

    /* ---------- 结构体（源 entity_spawner.gd:526-542 + src/data/structures.js 的数值表） ---------- */
    /* 地图随机点（离边界内缩 6%, 与源 get_spawn_pos_in_area 的取点口径同量级）。 */
    /* v7.1(源对齐) 树的取点: 全图随机 + 离玩家 >= B.TREE.minDistFromPlayer(源 entity_spawner.gd:17
     *   INITIAL_MIN_DIST_FROM_PLAYER = 300, 见 :190-205 —— 每次重取把门槛降 5, 直到 25 或命中)。 */
    treeSpawnPos: function () {
      var g = this, d = B.TREE.minDistFromPlayer, pos, guard = 0;
      pos = g.randMapPos();
      while (g.player && guard++ < 40 && PS.util.dist(pos.x, pos.y, g.player.x, g.player.y) < d) {
        d = Math.max(25, d - 5);
        pos = g.randMapPos();
      }
      return pos;
    },
    randMapPos: function () {
      var A = B.ARENA, m = Math.min(A.w, A.h) * 0.06;
      return { x: A.x + m + Math.random() * Math.max(1, A.w - 2 * m),
               y: A.y + m + Math.random() * Math.max(1, A.h - 2 * m) };
    },
    /* 结构体站点: pet 绕玩家(100~200px), 其余在地图上随机。 */
    structPos: function (def) {
      if (def && def.kind === "pet") {
        var p = this.player, a = Math.random() * PS.TAU, d = 100 + Math.random() * 100;
        return { x: p.x + Math.cos(a) * d, y: p.y + Math.sin(a) * d };
      }
      return this.randMapPos();
    },
    makeStruct: function (key, x, y) {
      var def = PS.StructureData.list[key];
      return { key: key, def: def, x: x, y: y, r: def.r,
               cd: def.cd * Math.random(), ang: Math.random() * PS.TAU, petT: Math.random() * PS.TAU,
               shootT: 0 };
    },
    /* 源 entity_spawner.gd:526-542: **开波**按面板值把结构体全部重建一遍（上限 MAX_STRUCTURES=100）。 */
    spawnStructures: function () {
      var g = this, rows = PS.StructureData.counts(g.stats), i, j, pos;
      g.structs = [];
      g.mines = [];
      g.mineT = 0;
      for (i = 0; i < rows.length; i++) {
        if (rows[i].def.kind === "mine") { g.addMine(rows[i].def, rows[i].n); continue; }
        for (j = 0; j < rows[i].n && g.structs.length < B.STRUCT.max; j++) {
          pos = g.structPos(rows[i].def);
          g.structs.push(g.makeStruct(rows[i].key, pos.x, pos.y));
        }
      }
      return g.structs.length;
    },
    /* 地雷: 源 spawn_cooldown = 12 秒, 每次埋一颗, 场上最多留 n 颗。 */
    addMine: function (def, n) {
      var g = this, max = Math.min(60, Math.floor(n));
      g.mines = g.mines || [];
      if (g.mines.length >= max) return null;
      var pos = g.randMapPos();
      g.mines.push({ key: "landmines", def: def, x: pos.x, y: pos.y, r: def.r, armed: 0.4 });
      return g.mines[g.mines.length - 1];
    },
    /* 倒树补炮（源 main.gd:585-588 的 get_spawn_pos_in_area(pos, 200)）。 */
    spawnStructAt: function (key, x, y, radius) {
      var g = this, def = PS.StructureData.list[key], a, d;
      if (!def || !g.structs || g.structs.length >= B.STRUCT.max) return null;
      a = Math.random() * PS.TAU; d = Math.random() * (radius || 0);
      var s = g.makeStruct(key, x + Math.cos(a) * d, y + Math.sin(a) * d);
      g.structs.push(s);
      return s;
    },
    /* 结构体每帧驱动: 游走 / 治疗 / 落果 / 索敌开火 / 地雷补种与踩爆。
     *   暴击开关 = stats.structCrit（源 weapon_service.gd:252 structures_can_crit）。 */
    updateStructures: function (dt) {
      var g = this, s = g.stats || {}, critOn = !!s.structCrit, i, st, def;
      for (i = 0; i < g.structs.length; i++) {
        st = g.structs[i];
        def = st.def;
        if (def.kind === "pet") {
          /* 源 wandering_bot: is_pet, 绕玩家游走; 接触减速见 combat.js 的 dealDamage。 */
          var tg = g.player, d = PS.util.dist(st.x, st.y, tg.x, tg.y);
          var ang = PS.util.angleTo(st.x, st.y, tg.x, tg.y);
          var want = 150, drift = d > want + 30 ? 1 : (d < want - 30 ? -1 : 0);
          st.petT += dt * 1.5;
          st.x += (Math.cos(ang) * drift + Math.cos(st.petT) * 0.35) * 120 * dt;
          st.y += (Math.sin(ang) * drift + Math.sin(st.petT) * 0.35) * 120 * dt;
          /* 源 wandering_bot 的接触效果是 add_decaying_speed(-250)（单位 px/s）。
           *   [有意偏差, 显式标注] 源的实现是"往速度上叠一个会衰减的偏移量"(unit.gd:730-741,
           *   且低于 45%/70% 时还会折半/封顶); 本作落成"贴着就按慢 250px/s 拉低", 下限取最大移速的 30%,
           *   与源 :739 `max(value, -speed * 0.9)` 同量级但更保守 —— 数值可测、不会把怪钉死。 */
          for (var pi2 = 0; pi2 < g.enemies.length; pi2++) {
            var pe = g.enemies[pi2];
            if (pe.dead || pe.neutral || pe.spawnT > 0 || !(pe.maxSpd > 0)) continue;
            if (PS.util.dist(st.x, st.y, pe.x, pe.y) > st.r + pe.r + 6) continue;
            var pf = pe.maxSpd * 0.3;
            if (pe.spd > pf) pe.spd = Math.max(pf, pe.spd - (def.slow || 0) * dt);
          }
          continue;
        }
        /* v6.9 源对齐: 开火后坐力的计时(源 turret_shoot_animation.tres 的 length = 0.3)。
         *   stance 的 ang 只在**生成时**掷一次随机初值, 之后不再变化 —— 它只给 tyler 的全向扇面当相位。 */
        if (st.shootT > 0) st.shootT -= dt;
        if (!isFinite(st.cd)) continue;
        st.cd -= dt;
        if (st.cd > 0) continue;
        st.cd = PS.StructureData.cdOf(def, s);
        if (def.kind === "heal") {
          var hv = PS.StructureData.dmgOf(def, s);
          if (g.player.hp < s.maxHp) { g.player.hp = Math.min(s.maxHp, g.player.hp + hv); g.fx.heal(g.player.x, g.player.y, hv); }
          continue;
        }
        if (def.kind === "garden") {
          /* 源 garden: nb_projectiles = 0, 靠 wanted_to_spawn_fruit 定期落果 —— 落的是消耗品果实。 */
          g.drops.push({ x: st.x, y: st.y, kind: "fruit", vx: PS.util.randRange(-20, 20), vy: PS.util.randRange(-20, 20), v: 0 });
          continue;
        }
        var tgt = PS.Combat.findTarget(g, st.x, st.y, def.range, "nearest");
        if (!tgt) continue;
        var cnt = def.count || 1, base = Math.atan2(tgt.y - st.y, tgt.x - st.x), k, a2;
        for (k = 0; k < cnt; k++) {
          /* 源 tyler 的 spread = 3.142 = 全向一圈 ⇒ 按等分角发射; 其余按 (k 中心偏移) × spread。 */
          if (def.spread && def.spread >= 3) a2 = k * PS.TAU / cnt + st.ang;
          else a2 = base + (cnt > 1 ? (k - (cnt - 1) / 2) * (def.spread || 0.2) : 0);
          g.projectiles.push({
            x: st.x, y: st.y, ang: a2, spd: def.projSpd, r: 5,
            /* 源 weapon_service.gd:252-253: structures_can_crit 为真时把玩家 crit_chance 加给结构体
             *   —— 即"能不能暴击"由词条开关决定, "暴多少"仍是玩家自己的暴击率。 */
            dmg: PS.StructureData.dmgOf(def, s),
            crit: critOn && Math.random() * 100 < (s.crit || 0), critMul: 1.5,
            range: def.range * 1.2, travel: 0, pierce: def.pierce || 0, bounce: 0,
            hitList: [], knock: 0, color: def.color, boomerang: false, back: false, beam: false,
            key: def.ch, shp: null, elem: false, tier: 1, cls: "structure",
            struct: true, burnSrc: def.burn || null, boom: def.boom || null, hit: true
          });
        }
        /* v6.9 源对齐: 开火就是**播一次 0.3 秒的后坐力动画**, 不是原地打转(旧写法 st.ang += 0.4)。 */
        st.shootT = 0.3;
      }
      /* 地雷: 12 秒补一颗（源 spawn_cooldown = 12 秒）; 敌人踩到(r + 14)即爆。 */
      g.mineT = (g.mineT || 0) + dt;
      if (g.mineT >= 12) {
        g.mineT -= 12;
        var rows = PS.StructureData.counts(s), mi;
        for (mi = 0; mi < rows.length; mi++) if (rows[mi].key === "landmines") g.addMine(rows[mi].def, rows[mi].n);
      }
      for (i = g.mines.length - 1; i >= 0; i--) {
        var m = g.mines[i];
        if (m.armed > 0) { m.armed -= dt; continue; }
        var hitE = null;
        for (var j = 0; j < g.enemies.length; j++) {
          var e2 = g.enemies[j];
          if (e2.dead || e2.neutral || e2.spawnT > 0) continue;
          if (PS.util.dist(m.x, m.y, e2.x, e2.y) < m.r + e2.r + 14) { hitE = e2; break; }
        }
        if (hitE) {
          g.explodeAt(m.x, m.y, { dmg: m.def.dmg || 0, scale: (m.def.scale && m.def.scale.eng) || 0, stat: "engDmg", r: (m.def.boom && m.def.boom.r) || 1, src: "landmine" });
          g.mines.splice(i, 1);
        }
      }
    },

    /* ---------- 中性物（树苗）: 源 entity_spawner.gd:172-182 + neutral.gd:8/30-33 ---------- */
    spawnTrees: function (count) {
      var g = this, i, pos;
      var n = (count == null) ? Math.max(0, Math.floor(g.stats.trees || 0)) : Math.max(0, Math.floor(count));
      if (n <= 0) return 0;
      n = Math.min(60, n);
      var hits = Math.max(1, Math.floor(B.TREE.hits));
      var R = 14;
      for (i = 0; i < n; i++) {
        pos = g.treeSpawnPos();
        g.enemies.push({
          key: "tree", neutral: true, x: pos.x, y: pos.y, r: R,
          def: { ai: "idle", r: R, color: "#7a8a4a", hp: 1, dmg: 0, spd: 0 },
          hp: hits, maxHp: hits, dmg: 0, spd: 0, maxSpd: 0,
          kx: 0, ky: 0, hitT: 0, dead: false, spawnT: 0.4, hitCd: 0
        });
      }
      return n;
    },
    /* v7.1(源对齐) 源 global/entity_spawner.gd:181-187 的**一批**树: 数量走 B.treeSpawnCount
     *   (min/max/0.33/trees 全在 balance.js 的 B.TREE), 取点走下面的 treeSpawnPos。 */
    spawnTreeBurst: function () {
      var g = this;
      var n = B.treeSpawnCount(g.stats.trees || 0, Math.random);
      if (n > 0) g.spawnTrees(n);
      return n;
    },

    /* ---------- 眼豆: 源 player.gd on_alien_eyes_timeout + alien_eyes_effect_1.tres ----------
     *   cooldown 3 秒 / dmg 1 / scaling maxHp 0.5 / projSpd 500 —— 每 3 秒朝 eyes 个方向各发一发。 */
    updateEyes: function (dt) {
      var g = this, s = g.stats || {}, n = Math.max(0, Math.floor(s.eyes || 0)), k;
      if (n <= 0) return;
      g.eyesT = (g.eyesT || 0) + dt;
      if (g.eyesT < 3) return;
      g.eyesT -= 3;
      var dmg = Math.max(1, Math.round((1 + 0.5 * (s.maxHp || 0)) * (1 + (s.dmgPct || 0))));
      var p = g.player;
      for (k = 0; k < n; k++) {
        g.projectiles.push({
          x: p.x, y: p.y, ang: k * PS.TAU / n + g.timeInWave, spd: 500, r: 4,
          dmg: dmg, crit: false, critMul: 1, range: 420, travel: 0, pierce: 0, bounce: 0,
          hitList: [], knock: 0, color: "#c8a0e8", boomerang: false, back: false, beam: false,
          key: "alien_eyes", shp: null, elem: false, tier: 1, cls: "ranged", hit: true
        });
      }
    },

    /* ---------- 波次扩展: 源 wave_manager.gd:58-70/114-127 + base_shop.gd:213-215 ----------
     *   三条通道都是「开了这个价, **下一波**才生效」; 本作在开波时兑现(与源"存进 next_wave_* 后消费"同构)。 */
    pickEnemyKey: function () {
      var g = this, sched = PS.WaveData ? PS.WaveData.forWave(g.wave, g.mode) : null, pool = [], i, j;
      if (sched && sched.events) for (i = 0; i < sched.events.length; i++)
        for (j = 0; j < sched.events[i].units.length; j++) pool.push(sched.events[i].units[j][0]);
      return pool.length ? pool[(Math.random() * pool.length) | 0] : "sprout";
    },
    spawnWaveExtras: function () {
      var g = this, s = g.stats || {}, i, pos, mp;
      var ne = Math.max(0, Math.floor(s.extraEnemiesNextWave || 0));
      for (i = 0; i < ne * 6; i++) {
        pos = g.spawnBase(-1);
        if (!g.spawnEnemy(g.pickEnemyKey(), false, -1, pos)) break;   /* 受同屏上限约束, 满了就停 */
      }
      var nl = Math.max(0, Math.floor(s.extraLootNextWave || 0));
      for (i = 0; i < nl * 6; i++) {
        mp = g.randMapPos();
        g.drops.push({ x: mp.x, y: mp.y, vx: 0, vy: 0, v: Math.round(B.dropValue()) });
      }
      var ec = Math.max(0, s.extraEliteChancePct || 0);
      if (ec > 0 && Math.random() * 100 < ec) {
        var ek = PS.EnemyData.eliteAt(g.wave, g.mode);
        if (ek) { g.spawnEnemy(ek, false, -1, null); g.eliteAlive = true; }
      }
    },

    /* ---------- 鬼火: 源 main.gd:536-544 gain_stat_for_killed_enemies_while_burning ----------
     *   effect = [ch, nb, v, maxProcs, counter, procs]: 每烧死 nb 只记一次, procs < maxProcs 才兑现;
     *   两个计数器在 run_data.gd:239-244 每波清零(本作在 startWave 里清零 wispN/wispP)。 */
    onBurnKill: function () {
      var g = this, changed = false;
      g.wispN = (g.wispN || 0) + 1;
      if (!PS.ItemTriggers) return;
      PS.ItemTriggers.eachTrig(g, function (it, tg) {
        if (tg.fam !== 'gain_stat_for_killed_enemies_while_burning') return;   /* 仓库风格: 单引号; qa/verify-item-sign.cjs 的派发点自证按单引号字面量查 */
        var nb = tg.nb || 1, maxP = (tg.maxProcs == null ? -1 : tg.maxProcs);
        if (maxP !== -1 && (g.wispP || 0) >= maxP) return;
        if (g.wispN % nb !== 0) return;
        PS.ItemTriggers.addTo(g.trigMods, tg.ch, tg.v);
        g.wispP = (g.wispP || 0) + 1;
        changed = true;
      });
      if (changed) g.recalc();
    },
    /* ---------- 终局 ---------- */
    finish: function (win) {
      var g = this;
      g.win = win;
      g.waveState = 'idle';
      PS.Sound.play(win ? 'win' : 'lose');
      /* v3.8(防永久卡死): 存档写入在 setState(OVER) **之前** —— 它一旦抛错, 结算界面永远不出现,
       *   而 onFrame 的 try/catch(web.js) 会吞掉异常 ⇒ 玩家看到「死了但画面不动」。
       *   存档是旁路副作用, 不许它阻断状态机。 */
      try { PS.Save.recordRun(g.wave, g.kills, win, g.mode); } catch (e) { /* 存档失败不影响终局 */ }
      this.setState(State.OVER);
      if (this.onOver) this.onOver(win);
    }
  };
})(typeof GameGlobal !== 'undefined' ? GameGlobal : (typeof window !== 'undefined' ? window : globalThis));
