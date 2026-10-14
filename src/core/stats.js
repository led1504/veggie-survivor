/* PS.Stats v2 —— 属性聚合（新增近战/远程分类乘区）
 * compute(ch, items, weapons, levelups, extraMods, ctx) → 面板
 * v5.5(道具机制): 新增**第二遍** —— 道具的 `scale`(缩放型) / `cond`(条件型) 词条。
 *   源证据: effects/items/gain_stat_for_every_stat_effect.gd(注册 stat_links) +
 *   singletons/run_data.gd:1853 get_scaling_bonus —— `int(value * (actual_nb_scaled / nb_stat_scaled))`;
 *   条件型见 entities/units/player/player.gd:215(静止) 与 :1073(每 interval 秒)。
 *   ctx = { notMoving, waveSeconds, livingEnemy, burningEnemy, gold } —— **可选第 6 参**,
 *   缺省 = 安全值(notMoving:false, waveSeconds:0, 其余计数 0); 既有 5 参调用点不受影响。
 */
(function (global) {
  'use strict';
  var PS = global.PS || {};
  /* v2.3 上限表 —— 用户反馈「暴击伤害无上限, 随便几百万伤害」。
   * 根因: 通用%/分类%/暴击/攻速 是各自独立的乘区, 每个都能无限叠加, 叠加后又互相作乘法。
   * 处理: ① 暴击伤害改为**固定值** —— 从 FLAT 里移除 critDmg, 道具/升级给的 critDmg 修饰一律忽略;
   *       ② 百分比池设硬上限, 溢出部分不再计入面板;
   *       ③ 战斗公式把「通用%」与「分类%」合并进同一个加法池(见 combat.js weaponRaw)。 */
  /* v3.0: rangeFlat —— 源 stat_range 的单位是**射程绝对值(px)**(源 21 条词条 ±10~80px, 中位 -5; 源武器
 *   射程中位 175~200px), 本作 1:1 沿用 px ⇒ 必须走 FLAT 通道累加, 不用 rangePct 承载(见 balance.md §13.3)。
 *   消费点: combat.js 的 `var range = (def.range + stats.rangeFlat) * stats.rangeMul;` */
  /* v3.0 新增通道(源道具词条 1:1 落位用; 名字与 items.js 的 key **必须逐字一致**):
   *   FLAT: knockback(叠加到武器击退) · rangeFlat(px, 累加到武器 range) · freeRerolls(免费刷新次数)
   *         dodgeCap / hpCap / speedCap(源上限覆盖件, ghost_outfit/handcuffs/shackles) ·
   *         bounce(弹射次数) · pierceBonus(穿透次数)
   *   语义: **只做求和, 不做任何合并/特判**; 与既有上限(B.dodgeCap / CAPS)的关系由消费方决定。 */
  var FLAT = ['maxHp', 'dmgFlat', 'armor', 'dodge', 'crit', 'luck', 'harvest', 'lifesteal', 'regen', 'pickup', 'thorns', 'rangeFlat',
    /* v3.4(主程) 源保真: 源 translations.csv 的官方效果串——
     *   stat_melee_damage    → "<!MissingKey:366>Your melee attacks deal {0} additional damage>"
     *   stat_ranged_damage   → "Your ranged attacks deal {0} additional damage"
     *   stat_elemental_damage→ "Elemental damage is increased by {0}"
     *   stat_engineering     → "Engineering"(源塔防/结构体专属固定值)
     *   四个标签在 CSV 里**都没有 %**(对照 STAT_PERCENT_DAMAGE="% Damage") ⇒ 走加法通道。
     *   改前它们被放在 PCT 里 /100 使用, 把 "+2 点伤害" 当成 "+2%" ⇒ 比源弱约 10 倍(源武器基础伤害 8~30)。 */
    'meleeDmg', 'rangedDmg', 'eleDmg', 'engDmg',
    /* v3.2: 源消耗品通道 —— consumable_heal(单颗果实额外回复量) / enemy_fruit_drops(果实掉落率加成) */
    'consumableHeal', 'fruitDrops',
    'knockback', 'freeRerolls', 'dodgeCap', 'hpCap', 'speedCap', 'bounce', 'pierceBonus',
    /* v3.5(源对齐) 两条**此前未接线**的源通道(源 items/upgrades 里有实体, 但本作没有消费点):
     *   accuracy   —— 源 weapon_service.gd:256 `new_stats.accuracy += stat_accuracy/100`;
     *                 源 weapon.gd:354 散布 = rand_range(-1+accuracy, 1-accuracy), 基础值 1.0 的武器无散布。
     *                 本作只有多弹武器有锥形散布 ⇒ 折算成 accFactor = clamp(1 - accuracy/100, 0, 1) 由 combat.js 收紧锥角。
     *   weaponSlot —— 源 player_run_data.gd:434 基准 6, 升级卡 +1; 本作原先把 6 写死在 balance.js,
     *                 现改为"基准 6 + 词条", 由 game.js / ui.js / bot 统一读 s.weaponSlot。 */
    'accuracy', 'weaponSlot',
    /* v3.8: 商店刷新费减免(固定值, 直接减在 B.rerollPrice 的结果上, 下限 0)。
     *   来源: 角色「南瓜」的特长「商店刷新费 -1」原先 passive.mods 为空 = 卡面印了但没效果。 */
    'rerollDiscount',
    /* v6.4(Wave 2) 源 lose_hp_per_second —— 每秒直扣的**点数**(不是 %)。源 player.gd:125/:834-839:
     *   LoseHealthTimer(1 秒) 到点就 take_damage(v, {dodgeable=false, armor_applied=false,
     *   bypass_invincibility=true}) ⇒ 不吃闪避/护甲/无敌帧。消费点 src/core/game.js 的 update(dt)。 */
    'hpLossPerSec',
    /* v6.7(Wave 3) —— 45 件缺口道具带来的通道（源 key 到通道 的映射见 qa/v3-item-map.md 第 1 节）:
     *   燃烧（源 effects/burning_data.gd）：burnDmg 每次结算的固定伤害 · burnDur 持续秒数 · burnSpread 扩散只数。
     *   结构体（源 effects/items/structure_effect.gd 与 turret_effect.gd）：每条 struct 前缀通道的值就是**持有数量**
     *     （源 value=1 即生成 1 座, 见 game.js 的 spawnStructures）；structCrit 是结构体的暴击开关（源 structures_can_crit）;
     *     structAtkSpdPct 是结构体攻速乘区, 放 PCT。
     *   树木（源 global/entity_spawner.gd:172 tree_modifier）：trees 加在每组的 NEUTRAL 数量上;
     *     oneShotTrees 一击即倒（neutral.gd:30-33）; treeTurrets 每倒一棵树补一座哨戒炮（main.gd:585-588）。
     *   波次/经济：extraEnemiesNextWave 下波额外怪组 · extraLootNextWave 下波额外掠夺组 ·
     *     randomPrimaryOnWave 开波随机主属性（main.gd:250-260）· hourglassFlag 时光倒流（base_shop.gd:209-212）。
     *   战斗：minWeaponCd 武器最短攻击间隔(**秒**, 源 45 帧除以 60; weapon_service.gd:574-599）·
     *     hitProtection 每波前 N 次受击免伤（player.gd:32 与 take_damage 的 elif 分支）·
     *     torture 每秒苦修回血（player.gd:582/706）· eyes 环身眼豆数量（player.gd:on_alien_eyes_timeout）·
     *     slowOnHit 与 slowOnHitMax 是**百分数**, 放 PCT。
     *   **死通道**（本作没有对应机制, 贡献恒为 0; 持有件已 pool:false 不上架, 不许当永久属性发出去）:
     *     crateGold 本作无箱子 · projOnDeath 玩家死亡即终局, 没有「倒下吐弹」的战场。 */
    'burnDmg', 'burnDur', 'burnSpread',
    'structTurret', 'structTurretFlame', 'structTurretHealing', 'structTurretLaser', 'structTurretRocket',
    'structTyler', 'structGarden', 'structBot', 'structLandmines',
    'structCrit', 'trees', 'oneShotTrees', 'treeTurrets',
    'extraEnemiesNextWave', 'extraLootNextWave', 'randomPrimaryOnWave',
    'minWeaponCd', 'hitProtection', 'torture', 'eyes',
    'hourglassFlag', 'crateGold', 'projOnDeath'];
  /* v3.4(主程) 源保真修正: 只有 dmgPct(源 stat_percent_damage)是乘区; melee/ranged/elemental/engineering
   *   是**固定值**加法通道(源标签无 %, 效果串是 "deal {0} additional damage"), 故从 CAPS 里移除。 */
  var CAPS = { dmgPctSum: 200, atkSpdSum: 150, speedPctSum: 150, rangePctSum: 150 };
  /* v2.3: 这三个是「以整数百分点表示」的属性 —— 升级卡里被误标为 pct:true, 会被累加进
   * critSum/dodgeSum, 而 compute() 只读 crit/dodge, 结果"点了升级卡完全没效果"(Pauli 实测)。
   * 这里强制走 flat 通道, 无论调用方怎么标 pct。 */
  /* v3.0: 去掉 critDmg —— 引擎已改用武器自带 critMul(combat.js:36), stats 侧不再有任何 critDmg 通道。 */
  var FLAT_FORCE = { crit: 1, dodge: 1 };
  /* v3.5: **标记型 key** —— 它们出现在 items.js 的 mods 里, 但**不是属性通道**, 而是"取得那一刻
   *   把某个上限锁死为当前值"的一次性标记(game.js 的 gainItem 读它, 把 hpCapAt/speedCapAt 记进道具实例)。
   *   源语义: handcuffs/speed 类道具的 "set_cap_to_current_stat"(见 stats.js compute 里的 hpCap/speedCap 段)。
   *   单独登记的原因: 若不登记, applyMods 的未知 key 判定会在 STRICT_STATS 下把它当"改名残痕"抛错,
   *   而它其实是被正确消费的。 */
  /* v6.7(Wave 3): fogVisPct（源 fog_visibility, campfire 50 / candle 25 / greek_fire 75）——
   *   本作**没有雾/视野机制**, 无消费点; 但键不可映射会让这三件被整件丢弃。
   *   故按「无消费点静默通道」登记在这里: applyMods 直接跳过（值原样留在 items.js 的 mods 里）, 面板与描述都不出。 */
  var MARKER = ['hpCapCurrent', 'speedCapCurrent', 'fogVisPct'];
  /* v3.0: 上限取源自己的值。源 extract-items.json 里只有三个 cap 词条(它们的 value 就是上限值):
 *   ghost_outfit.dodge_cap=70 / handcuffs.hp_cap=0 / shackles.speed_cap=0;
 *   **没有** crit_chance_cap 道具 ⇒ 暴击保持 100% 上限(源 stat_crit_chance 词条上限 15%)。
 *   armor: 源里无 cap(源描述串只有"护甲"标签、无 %) ⇒ 自然也就不设上限; 承伤系数 = B.armorCoef,
 *     直译源式(源 singletons/run_data.gd:1352/1359) 10/(10 + |armor|/1.5), armor<0 时 (1-c)+1 越负越痛、不封顶。
 *     正护甲下它与本文档旧写的 armor/(armor+15) 数学恒等; 负护甲旧的 -armor*0.04 + 0.5 上限无出处, 已删。 */
  var CRIT_CAP = 100;          // 暴击率上限(%); 源无 crit_chance_cap 道具 → 保持 100
  /* v3.0 新增百分比通道(源词条 1:1; 全部走 s.<key>Sum, 默认 0, 求和后由消费方 /100 使用):
   *   elePct(元素系武器伤害) · engPct(环绕/哨戒/召唤类"结构体"武器伤害) · xpPct(经验获取)
   *   shopPricePct(商店价格, 负 = 更便宜) · harvestingGrowth(收获每波增长) · dmgVsBossPct(对精英/Boss 伤害)
   *   enemySpdPct(敌人移速, 负 = 更慢) */
  var PCT  = ['dmgPct', 'atkSpd', 'speedPct', 'rangePct', 'maxHpPct',
    'xpPct', 'shopPricePct', 'harvestingGrowth', 'dmgVsBossPct', 'enemySpdPct',
    /* v5.11(G2): 敌人侧的**百分比**通道（源词条 enemy_health / enemy_damage）。
     *   源语义是**百分比修正**, 不是「加 N 点」—— 逐字证据（反编译源 ref/src-remote/）:
     *     singletons/entity_service.gd:37  `1.0 + Utils.sum_all_player_stats(Keys.enemy_health_hash) / 100.0`
     *     singletons/entity_service.gd:15  `1.0 + Utils.sum_all_player_stats(Keys.enemy_damage_hash) / 100.0`
     *   消费点: entities/units/unit/unit.gd:103 `reset_health_stat()` / :108 `reset_damage_stat()`
     *     （每次 init_current_stats 都按它算）、entities/units/enemies/enemy.gd:148/162（远程怪弹道伤害）;
     *   落值公式: entity_service.gd:30 `round(from_value * factor * boost)`（:49 同形）。
     *   方向: **正 = 敌人更强 = 对玩家是代价**; 源 3 件的 `.tres` effect_sign 都标 1(=NEGATIVE)。
     *   消费方: src/core/game.js 的 spawnEnemy / spawnEnemyAt（刷怪时乘上去, 与 enemySpdPct 同构）。 */
    'enemyHpPct', 'enemyDmgPct',
    /* v3.8: 击退**百分比**乘区。源 knockback 只有固定值通道(无 % 口径), 而角色「甜菜根」的特长
     *   卡面写的是「击退 +20%」—— 先把乘区接上, 文案才成立(原先 passive.mods 为空 = 死效果)。 */
    'knockPct',
    /* v3.2: 源 hp_start_next_wave —— 每波开始恢复的生命(占 maxHp 百分比)。
     *   源基准 = 100(每波开始回满): 依据见 balance.md §14 与 v3-port-spec.md §2.7 的证据链 ——
     *   3 件交易型道具(hourglass / broken_hourglass / weird_ghost)的该词条值恒为 -100, 文案是
     *   "Start the next wave with 1 HP"; 百分比修正项必须有百分比基准才成立, 且 -100 正好等于"不回血(下限 1)"。 */
    'hpStartNextWavePct',
    /* v6.4(Wave 2) 六条百分比通道（全部**保留原始百分数**, 由消费方自己 /100, 与 xpPct 同口径）:
     *   enemyCountPct    源 number_of_enemies  —— entity_spawner.gd:171/180 刷怪量乘区（**正 = 更多敌人 = 代价**）
     *   hpStartWavePct   源 hp_start_wave     —— main.gd:1358 开波时**设定**生命（基准 100 = 满血）
     *   goldAttractPct   源 instant_gold_attracting —— main.gd:738-743 材料掉落后掷骰直接飞向玩家
     *   doubleGoldPct    源 chance_double_gold —— run_data.gd:829-834 拾金价值翻倍
     *   healOnGoldPct    源 heal_when_pickup_gold —— main.gd:812-813 拾金时掷骰回 1 点
     *   healOnCritPct    源 heal_on_crit_kill —— unit.gd:373-374 暴击击杀时掷骰回 1 点 */
    'enemyCountPct', 'hpStartWavePct', 'goldAttractPct', 'doubleGoldPct', 'healOnGoldPct', 'healOnCritPct',
    /* v6.7(Wave 3) 百分比通道（与 xpPct 同口径: 值就是源里的百分数, 由消费方自己除以 100）:
     *   structAtkSpdPct 源 structure_attack_speed（clockwork_wasp +10; weapon_service.gd:apply_structure_attack_speed_effects）
     *   explodeDmgPct 源 explosion_damage（weapon_service.gd:249/:286 —— 爆炸伤害的**加法**乘区）
     *   explodeSizePct 源 explosion_size（player_explosion.gd:set_area —— 范围 = area 乘（1 加 v 除以 100））
     *   explodeOnDeathPct 源 explode_on_death 的 chance（main.gd:533）· explodeOnConsumablePct 源 explode_on_consumable 的 chance（main.gd:692）
     *   burnChancePct 源 burn_chance 的 chance · burnHpPct 源 burning_enemy_hp_percent_damage（enemy.gd:296-304）
     *   burnCdPct 源 burning_cooldown_reduction（unit.gd:67-71 —— 燃烧节拍时间乘（1 减去 v 除以 100））
     *   burnScalePct 源 burning_data.scaling_stats 的元素系数乘 100（本作燃烧 DoT 真会乘上它; 面板不显示）
     *   goldOnCritPct 源 gold_on_crit_kill（unit.gd:367-371）· goldStartWavePct 源 gain_pct_gold_start_wave（main.gd:1384-1394）
     *   recycleGainPct 源 recycling_gains（item_service.gd:732-742 —— 回收比例 = clamp(0.25 加 v 除以 100)）
     *   extraEliteChancePct 源 extra_elite_next_wave_chance（base_shop.gd:213-215）
     *   pierceDmgPct 源 piercing_damage（weapon_service.gd:99-103 —— 穿透衰减减去 v 除以 100）
     *   giantCritPct 源 giant_crit_damage（enemy.gd:285-294 —— 暴击时额外造成敌人**当前生命**的 v%）
     *   slowOnHit 与 slowOnHitMax 源 remove_speed（enemy.gd:254-256 —— 每次命中扣敌人**最大移速**的 v%,
     *     下限为最大移速的 slowOnHitMax 百分点之内的剩余部分; 两个值都是百分数）
     *   regenLowHpPct 源 hp_regen_bonus（player.gd:693-704 —— 生命低于上限 50% 时回复量乘（1 加 v 除以 100）） */
    'structAtkSpdPct', 'explodeDmgPct', 'explodeSizePct', 'explodeOnDeathPct', 'explodeOnConsumablePct',
    'burnChancePct', 'burnHpPct', 'burnCdPct', 'burnScalePct',
    'goldOnCritPct', 'goldStartWavePct', 'recycleGainPct', 'extraEliteChancePct',
    'pierceDmgPct', 'giantCritPct', 'slowOnHit', 'slowOnHitMax', 'regenLowHpPct'];

  /* v5.5: GDScript `int()` 的**向零截断**语义(源 run_data.gd:1890) —— 不是 floor:
   *   int(-2.4) === -2, 而 Math.floor(-2.4) === -3。负数词条(如小仙灵的 −3/件)正好踩到这个差别。
   *   等价于 JS 的 Math.trunc, 但这里手写以保持本文件一致的 ES5 写法。 */
  function trunc0(v) { return v < 0 ? Math.ceil(v) : Math.floor(v); }
  /* v5.5: 外部上下文/数据里的数字一律收敛成**有限数** —— undefined / NaN / Infinity 都当 0,
   *   否则一处 NaN 会顺着求和通道毒化整块面板(HUD 显示 NaN/NaN 的历史事故)。 */
  function ctxNum(v) { return (typeof v === 'number' && isFinite(v)) ? v : 0; }
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  /* v5.5: 把一笔第二遍贡献落到**原始累加对象**上 —— 落点规则与 applyMods 逐字相同
   *   (百分比通道进 <ch>Sum, 其余进 <ch>); 未知通道静默忽略, 与 applyMods 的 v3.0 防线同口径
   *   (数据改名不许把面板毒成 NaN)。 */
  function addChannel(s, ch, amount) {
    if (!amount || !isFinite(amount)) return;
    if (PCT.indexOf(ch) >= 0 && !FLAT_FORCE[ch]) { if (own(s, ch + 'Sum')) s[ch + 'Sum'] += amount; }
    else if (own(s, ch)) s[ch] += amount;
  }

  PS.Stats = {
    blank: function () {
      var s = {}, i;
      for (i = 0; i < FLAT.length; i++) s[FLAT[i]] = 0;
      for (i = 0; i < PCT.length; i++) s[PCT[i] + 'Sum'] = 0;
      s.crit = PS.Balance.PLAYER.crit;
      s.pickup = PS.Balance.PLAYER.pickup;
      return s;
    },
    applyMods: function (s, mods, sign) {
      sign = sign || 1;
      if (!mods) return;
      for (var k in mods) {
        if (MARKER.indexOf(k) >= 0) continue;   /* v3.5: 标记型 key, 不是属性通道(见 MARKER 注释) */
        var v = mods[k] * sign;
        /* v3.0 防线: 未知/已删除的属性 key 必须**忽略**, 不能凭空造出字段。
         *   背景: critDmg 已从引擎下架(改成武器自带 critMul), 若数据表/存档里还残留 critDmg,
         *   旧写法 s['critDmg'] += v 会先得到 undefined+5000 = NaN, 把整个面板毒化成 NaN(HUD 显示 NaN/NaN)。
         *   PCT 侧同理: 只有 blank() 已建好的 '<key>Sum' 才允许累加。 */
        var known = false;
        if (PCT.indexOf(k) >= 0 && !FLAT_FORCE[k]) { if ((k + 'Sum') in s) { s[k + 'Sum'] += v; known = true; } }
        else if (k in s) { s[k] += v; known = true; }
        /* v3.4(主程): 未知 key 的"静默忽略"是**改名后遗痕**的温床 —— 通道名写错时数值凭空消失且不报错。
         *   严格模式下直接抛错, 由 qa/verify-stat-channels.cjs 与 unit-core-v3 打开。 */
        if (!known && PS.STRICT_STATS) throw new Error('未知属性通道: ' + k);
        /* v3.0: 三个"上限覆盖"词条是**求和通道**, 而源里 handcuffs.hp_cap=0 / shackles.speed_cap=0
         *   是真实存在的"上限归零"梗件 —— 0 与"未提供"在求和通道里无法区分, 故单独记一次出现标记,
         *   由 compute() 决定是否覆盖(见那里的注释)。只记标记, 不做任何合并。 */
        if ((k === 'dodgeCap' || k === 'hpCap' || k === 'speedCap') && (k in s)) s[k + 'Set'] = true;
      }
    },
    compute: function (ch, items, weapons, levelups, extraMods, ctx) {
      var s = this.blank();
      var B = PS.Balance, i;
      s.maxHp = ch.hp;
      s.speed = B.PLAYER.speed;
      this.applyMods(s, ch.mods);
      this.applyMods(s, ch.passive && ch.passive.mods);   // 角色特长
      for (i = 0; i < items.length; i++) {
        var it = PS.ItemData.byId(items[i].id || items[i]);
        if (it) this.applyMods(s, it.mods);
      }
      for (i = 0; i < weapons.length; i++) {
        var w = weapons[i];
        var def = PS.WeaponData.list[w.key || w];
        if (def && def.mods) this.applyMods(s, def.mods);
      }
      for (i = 0; i < levelups.length; i++) {
        var lv = levelups[i];
        /* v3.0 防线: 同 applyMods —— 升级卡里出现未知/已下架属性(如老的 critDmg 卡)时忽略, 不生成 NaN 字段。 */
        if (lv.pct && !FLAT_FORCE[lv.stat]) { if ((lv.stat + 'Sum') in s) s[lv.stat + 'Sum'] += lv.v; }
        else if (lv.stat in s) s[lv.stat] += lv.v;
      }
      /* v3.5(源对齐): 源 main.gd:872 —— **每次升级固定 +1 最大生命**(自动项)。
       *   levelups.length 恒等于"已发生的升级次数"(game.js 的 gainXp 里每次 g.level++ 恰好压入一条),
       *   故这里不需要额外传 level。它必须加在 maxHpPct 乘区之前(与源的"加到 stat 上"同语义)。
       *   缺这条会让血池少 (等级-1) 点, 是"第 8 波一次接触掉 44% 血"的根因。 */
      s.maxHp += levelups.length * B.LEVEL_HP_PER_LEVEL;
      if (extraMods) this.applyMods(s, extraMods);
      /* v5.6(G1): 触发型词条的面板贡献（记账在 game.js 的 PS.ItemTriggers）。放在**第一遍**里:
       *   源的 add_stat 与 mods 落进同一个 effects 桶 ⇒ 缩放/条件词条的 drive:'stat:<ch>' 快照、
       *   maxHpPerm（game.js 的「上限提高才回血」判定基）都必须看得见它。 */
      this.applyTriggers(s, ctx);
      /* v6.1(源对齐): 两类**此前本作没有**的角色/道具效果。顺序是契约:
       *   · 必须在第一遍累加**全部完成之后**（源 run_data.gd:1305 `get_stat = get_player_effect(stat) * get_stat_gain(stat)`
       *     —— 收益修正作用在该属性的**整份累加值**上, 不是再加一条词条）;
       *   · 必须在 `snapshot(first)` **之前** —— 否则 `drive:'stat:<ch>'` 的缩放型道具读到的是未修正值。 */
      this.applyPerLevel(s, ch, levelups.length);
      this.applyGainPct(s, ch, items);
      if (ch && ch.convert && ctx && ctx.halfWave) this.applyConvert(s, ch.convert);
      /* ================= v5.5 第二遍: 道具的 scale / cond =================
       * 执行序(契约, 必须照做):
       *   ① 第一遍 = 上面这些行(只加 mods / 升级卡 / extraMods);
       *   ② 快照 first ← 第一遍**原始累加值** —— scale 的 drive:'stat:<ch>' 只读它(不受第二遍影响);
       *   ③ permMax ← 第一遍面板的最大生命(见 maxHpOf 的说明);
       *   ④ 第二遍 applyDynamics 把贡献**直接累加到原始通道**上, 位置就在下面的 CAPS 钳制之前
       *      ⇒ 第二遍同样被上限表钳住(否则会出现「面板被钳住但实际生效」的不一致);
       *   ⑤ 下面的收尾段(CAPS / 百分比落盘 / 上限覆盖 / weaponSlot / accFactor)只跑一次。
       * 为什么单独记 maxHpPerm: game.js 的 recalc 有「上限提高才回血」逻辑, 它的判定基必须只含**永久**
       *   词条 —— 否则 padding(源: 每 80 金币 +1 生命上限)这类缩放件会在金币来回波动时反复把血顶上去。 */
      var first = this.snapshot(s);
      var permMax = this.maxHpOf(s);
      this.applyDynamics(s, items, weapons, ctx, first);
      /* v2.3: 百分比池硬上限(防无限叠加导致的指数级膨胀) */
      for (var ck in CAPS) { if (s[ck] > CAPS[ck]) s[ck] = CAPS[ck]; }
      // 百分比落盘
      s.dmgPct = s.dmgPctSum / 100;
      s.atkSpdMul = Math.max(0.35, 1 + s.atkSpdSum / 100);
      s.speedMul = Math.max(0.5, 1 + s.speedPctSum / 100);
      s.rangeMul = Math.max(0.5, 1 + s.rangePctSum / 100);
      s.knockMul = Math.max(0, 1 + s.knockPctSum / 100);   /* v3.8: 击退乘区(见 PCT 的 knockPct); 默认 1 = 与源一致 */
      /* v3.0 新通道落盘: **保留原始百分数**(+20% → s.xpPct === 20), 由消费方自己 /100。
       *   契约来源: combat.js 读 st0.dmgVsBossPct/100、game.js 读 xpPct / shopPricePct / enemySpdPct。
       *   注意与老通道(dmgPct/meleePct/rangedPct, 已 /100)不同 —— 别混。 */
      s.xpPct = s.xpPctSum;
      s.shopPricePct = s.shopPricePctSum;
      s.harvestingGrowth = s.harvestingGrowthSum;
      s.dmgVsBossPct = s.dmgVsBossPctSum;
      s.enemySpdPct = s.enemySpdPctSum;
      /* v5.11(G2): 与 enemySpdPct 同一口径 —— **保留原始百分数**（+10% → s.enemyHpPct === 10）,
       *   由消费方自己 /100（game.js 刷怪处）。 */
      s.enemyHpPct = s.enemyHpPctSum;
      s.enemyDmgPct = s.enemyDmgPctSum;
      /* v3.2: 语义与其它通道不同 —— 它自带基准 100(回满), 词条是可正可负的**加减项**。 */
      s.hpStartNextWavePct = 100 + s.hpStartNextWavePctSum;
      /* v6.4(Wave 2): hp_start_wave 与 hp_start_next_wave 同构 —— 同样自带基准 100（源
       *   player_run_data.gd:474/475 两条基准都是 100）, 词条是可正可负的加减项。 */
      s.hpStartWavePct = 100 + s.hpStartWavePctSum;
      /* v6.4(Wave 2): 其余五条与 enemySpdPct 同口径 —— **保留原始百分数**（+25% → s.goldAttractPct === 25）。 */
      s.enemyCountPct = s.enemyCountPctSum;
      s.goldAttractPct = s.goldAttractPctSum;
      s.doubleGoldPct = s.doubleGoldPctSum;
      s.healOnGoldPct = s.healOnGoldPctSum;
      s.healOnCritPct = s.healOnCritPctSum;
      /* v6.7(Wave 3): 18 条百分比通道 —— 与 enemySpdPct 同口径（保留原始百分数, 消费方自己除以 100）。 */
      s.structAtkSpdPct = s.structAtkSpdPctSum;
      s.explodeDmgPct = s.explodeDmgPctSum;
      s.explodeSizePct = s.explodeSizePctSum;
      s.explodeOnDeathPct = s.explodeOnDeathPctSum;
      s.explodeOnConsumablePct = s.explodeOnConsumablePctSum;
      s.burnChancePct = s.burnChancePctSum;
      s.burnHpPct = s.burnHpPctSum;
      s.burnCdPct = s.burnCdPctSum;
      s.burnScalePct = s.burnScalePctSum;
      s.goldOnCritPct = s.goldOnCritPctSum;
      s.goldStartWavePct = s.goldStartWavePctSum;
      s.recycleGainPct = s.recycleGainPctSum;
      s.extraEliteChancePct = s.extraEliteChancePctSum;
      s.pierceDmgPct = s.pierceDmgPctSum;
      s.giantCritPct = s.giantCritPctSum;
      s.slowOnHit = s.slowOnHitSum;
      s.slowOnHitMax = s.slowOnHitMaxSum;
      s.regenLowHpPct = s.regenLowHpPctSum;
      s.maxHp = Math.round(s.maxHp * (1 + s.maxHpPctSum / 100));
      /* v3.8(修死效果): 源 dodge_cap / hp_cap / speed_cap 是**上限替换**语义, 不是"取较小值"。
       *   旧写法把 `Math.min(B.dodgeCap, s.dodge)` 放在覆盖件**之前**: ghost_outfit 的 dodge_cap=70
       *   先被默认上限 60 钳住, 再 Math.min(60, 70) 恒等于 60 ⇒ 该词条**永远是死效果**
       *   (实测 44 张闪避卡下 dodge 恒 60, 而卡面承诺「闪避上限 +70」)。
       *   现在: 先把上限替换成道具值(无道具则用默认 B.dodgeCap), 再做钳制 —— 顺序正是原实现写反之处。
       *   hp_cap / speed_cap 传 0 时旧写法碰巧也对, 这里统一成同一语义, 不保留两套。 */
      s.dodge = Math.min(s.dodgeCapSet ? s.dodgeCap : B.dodgeCap, s.dodge);
      s.crit = Math.max(0, Math.min(CRIT_CAP, s.crit));
      if (s.hpCapSet) s.maxHp = Math.min(s.maxHp, s.hpCap);
      if (s.speedCapSet) s.speed = Math.min(s.speed, s.speedCap);
      s.maxHp = Math.max(1, s.maxHp);
      /* v3.5(源对齐): 武器槽 = 源基准 6(player_run_data.gd:434) + 升级卡词条(源 weapon_slot 家族 +1)。
       *   消费方一律读 s.weaponSlot; 不再直接读常量 B.WEAPON_SLOTS。 */
      s.weaponSlot = B.WEAPON_SLOTS + s.weaponSlot;
      /* v3.5(源对齐): 命中/散布。源 accuracy 1.0 = 零散布(绝大多数武器的基础值), 玩家词条按
       *   weapon_service.gd:256 加在武器 accuracy 上; 溢出到 >=1 时散布必然为 0 ⇒ 这里夹在 [0,1]。 */
      s.accFactor = Math.max(0, Math.min(1, 1 - s.accuracy / 100));
      /* v5.5: 第一遍(不含 scale/cond)的最大生命 —— 供 game.js 的「上限提高才回血」判定。 */
      s.maxHpPerm = permMax;
      return s;
    },

    /* ---------- v5.6(G1): 触发型词条的面板落点 ----------
     * 记账方是 src/core/game.js 的 PS.ItemTriggers（在触发点上累加, 这里**不重算**语义, 只合成）:
     *   · ctx.trigMods —— **永久**累积:
     *       stats_end_of_wave（源 main.gd:1189-1195 波末 add_stat, 永久）;
     *       stats_on_level_up（源 main.gd:872-875 升级 add_stat）;
     *       gain_stat_for_equipped_item_with_stat（源 run_data.gd:1895-1909, 装备使 stat 上升 → ch += per）。
     *   · ctx.trigTemp —— **每波清零**的临时累积: temp_stats_on_hit（源 player.gd:487-489;
     *       波末 main.gd:1232 的 TempStats.reset() 清掉, 见 game.js 的 onWaveEnd）。
     *   · ctx.trigNext —— **只在被兑现的那一波生效**的一次性累积: stats_next_wave
     *       （源 main.gd:1399-1405 波次开始 add_stat 后立刻 clear; 波末 :1232 的 TempStats.reset() 收走）。
     * 两张表都是「通道 → 值」的求和表, 走与 mods **完全相同**的通道语义（applyMods: PCT → <ch>Sum, 值域/
     *   标记型 key 一律照旧）—— 不另开一套口径, 也不在这里做任何钳制（钳制只在 compute 收尾段做一次）。
     * 未接线的家族（武器侧 / 无燃烧 / 无消耗品 …）见 tools/port-source.cjs 的 TRIG_FAM 注释与台账 §8.3。 */
    applyTriggers: function (s, ctx) {
      if (!ctx) return;
      this.applyMods(s, ctx.trigMods);
      this.applyMods(s, ctx.trigTemp);
      /* v5.11(G2): stats_next_wave 的层 —— 由 game.js 的 PS.ItemTriggers.onWaveStart 在波次开始装进来,
       *   波末 onWaveEnd 清掉（源 main.gd:1399-1405 装 / :1232 TempStats.reset() 清）。 */
      this.applyMods(s, ctx.trigNext);
    },

    /* ---------- v6.1(源对齐): 属性收益修正 / 每级词条 / 半波转换 ----------
     * 三者的源证据（反编译源 ref/src-remote/，逐行可查）:
     *   ① effect_increase_stat_gains / effect_reduce_stat_gains
     *      effects/items/stat_gains_modification_effect.gd:apply —— 把 value 加进 `gain_<stat>` 桶;
     *      singletons/run_data.gd:1305/1309 `get_stat()` / `get_stat_gain()`:
     *          get_stat(stat)      = get_player_effect(stat) * get_stat_gain(stat)
     *          get_stat_gain(stat) = 1.0 + (effects["gain_" + stat] / 100.0)
     *      ⇒ **乘在整份累加值上**, 不是一条独立词条。持有者: 角色 engineer(+25% 结构伤害) /
     *        cyborg(+200% 远程伤害, -75% 结构伤害, -100% 近战+元素) / mage(-50% 结构伤害)。
     *   ② stats_on_level_up —— main.gd:872-875 每次升级 add_stat ⇒ 永久累积。
     *      持有者: character_apprentice(近战+2/远程+1/元素+1/结构+1/生命上限-2 每级)。
     *      本作 `levelups.length` 恒等于「已发生的升级次数」(game.js 每次 g.level++ 恰好压一条), 故直接乘。
     *   ③ convert_stats_half_wave —— 源文案 EFFECT_CONVERT_STAT_TEMP_HALF_WAVE
     *      「{0} of your {1} are temporarily converted into {2} halfway through a wave ({3} {1} = {4} {2})」;
     *      持有者: character_cyborg(pct_converted=100.0, to_stat=stat_engineering, to_value=2)。
     *      本作的触发点是 condCtx().halfWave(game.js), 只在战斗过半之后为真 —— 商店/升级预览恒为假。
     * 数据形态(纯新增字段, 不改既有语义):
     *   ch/it.gain  = [{ ch: [通道…], v: 百分数, label: 卡面显示名 }]  —— 成组的理由是**源卡面把它显示成一条**
     *                 (engineer 的「伤害」覆盖 8 个源通道, 本作落到 dmgPct/meleeDmg/rangedDmg/eleDmg 四条);
     *   ch.perLevel = { 通道: 每级增量 };
     *   ch.convert  = { from: 通道, to: 通道, pct: 百分比, val: 兑换倍率 }。
     * ⚠ 口径差异(已量化, 不是隐患): 源只对**词条累加值**乘收益修正, 本作乘的是整条通道(含 ch.hp /
     *   B.PLAYER.speed / 每级固定生命这三个基准项)。当前数据里 gain 只落在 meleeDmg/rangedDmg/eleDmg/
     *   engDmg/dmgPct 五条**纯词条通道**上, 基准项不在其中 ⇒ 与源逐位一致; 若将来给 maxHp/speed 加收益修正,
     *   必须先补基准项分离, 否则会把基准也一起乘掉。 */
    applyPerLevel: function (s, ch, n) {
      var pl = ch && ch.perLevel;
      if (!pl || !n) return;
      for (var k in pl) {
        var v = pl[k] * n;
        if (PCT.indexOf(k) >= 0 && !FLAT_FORCE[k]) { if ((k + 'Sum') in s) s[k + 'Sum'] += v; }
        else if (k in s) s[k] += v;
        else if (PS.STRICT_STATS) throw new Error('perLevel 未知属性通道: ' + k);
      }
    },
    applyGainPct: function (s, ch, items) {
      var mult = {}, list = [], i, j, t;
      if (ch && ch.gain) list.push(ch.gain);
      for (i = 0; i < items.length; i++) {
        var it = PS.ItemData.byId(items[i].id || items[i]);
        if (it && it.gain) list.push(it.gain);
      }
      for (i = 0; i < list.length; i++) {
        for (j = 0; j < list[i].length; j++) {
          var e = list[i][j];
          for (t = 0; t < e.ch.length; t++) mult[e.ch[t]] = (mult[e.ch[t]] || 0) + e.v;
        }
      }
      for (var k in mult) {
        var f = 1 + mult[k] / 100;
        if (PCT.indexOf(k) >= 0 && !FLAT_FORCE[k]) { if ((k + 'Sum') in s) s[k + 'Sum'] *= f; }
        else if (k in s) s[k] *= f;
        else if (PS.STRICT_STATS) throw new Error('gain 未知属性通道: ' + k);
      }
    },
    applyConvert: function (s, c) {
      var from = c.from, to = c.to;
      var amt = (s[from] || 0) * (c.pct / 100);
      if (!amt) return;
      s[from] = (s[from] || 0) - amt;
      s[to] = (s[to] || 0) + amt * c.val;
    },
    /* ---------- v5.5: 第一遍面板的最大生命 ----------
     * 与 compute 收尾段的 maxHp 三行**逐行同式**, 唯一差别是入参取「第二遍写入之前」的原始累加值:
     *   s.maxHp = Math.round(s.maxHp * (1 + s.maxHpPctSum / 100));
     *   if (s.hpCapSet) s.maxHp = Math.min(s.maxHp, s.hpCap);
     *   s.maxHp = Math.max(1, s.maxHp);
     * 改收尾段而漏改这里 ⇒ s.maxHpPerm 与 s.maxHp 脱节。qa/verify-item-mechanics.cjs 的 [D] 段
     * 用「合成 maxHpPct + 合成 notMoving 上限」把两者的精确数值钉死了。 */
    maxHpOf: function (raw) {
      var mv = Math.round(raw.maxHp * (1 + raw.maxHpPctSum / 100));
      if (raw.hpCapSet) mv = Math.min(mv, raw.hpCap);
      return Math.max(1, mv);
    },

    /* ---------- v5.5: 第一遍通道快照 ----------
     * 口径 = **原始累加值**(只含 mods / 升级卡 / extraMods): 不做 CAPS 钳制, 也没有百分比落盘与派生乘区。
     * 依据: 源 run_data.gd:1305 get_stat() 返回的就是永久词条累加和(get_player_effect × gain),
     *   源里没有任何钳制 —— 源的上限一律在**消费端**处理。 */
    snapshot: function (raw) {
      var out = {}, i;
      for (i = 0; i < FLAT.length; i++) out[FLAT[i]] = raw[FLAT[i]];
      for (i = 0; i < PCT.length; i++) out[PCT[i]] = raw[PCT[i] + 'Sum'];
      return out;
    },

    /* ---------- v5.5: 第二遍 —— 道具的 scale(缩放型) / cond(条件型) ----------
     * 源公式(逐字): effects/items/gain_stat_for_every_stat_effect.gd 把
     *   [key, value, stat_scaled, nb_stat_scaled, perm_stats_only] 注册进 stat_links;
     *   run_data.gd:1853 get_scaling_bonus 求值 `int(value * (actual_nb_scaled / nb_stat_scaled))`。
     *   计数口径: run_data.gd:1479 get_nb_different_items_of_tier(同名只算一次) ·
     *     1493 get_duplicate_items_count(总数 − 去重数) · 1257 get_free_weapon_slots(槽位上限 − 武器数)。
     *   条件口径: player.gd:215 check_not_moving_stats(静止时 add_stat / 移动时 remove_stat) ·
     *     player.gd:1073 _on_OneSecondTimer_timeout(每 interval 秒 add 一次, 不衰减) —— 本作按
     *     「v × floor(本波秒数 / every)」一次算清, 每波开始清零(见 game.js 的 startWave)。
     * permOnly: 本作没有 TempStats 分层 ⇒ 一律按 true 处理(= 读第一遍快照), 不写分支。
     * 不满足条件就**不发值**(绝不退化成常驻加成): 未知通道 / nb 缺失或 0(源里是除零) / every<=0 /
     *   本作未实现的 kind。 */
    applyDynamics: function (s, items, weapons, ctx, first) {
      var list = items || [], wp = weapons || [], i, j, d, it, sc, cd, ch, drv, nb, every, n, actual;
      ctx = ctx || {};
      /* 计数类 drive: 在 compute 内部自己算(items 自己带, 契约不依赖 ctx)。
       * 按**道具实例**逐个走, 以 id 去重; byId 取不到定义的实例既不计数也不发值。 */
      var seen = {}, nbTotal = 0, nbDiff = 0, nbCommon = 0, nbLegend = 0;
      for (i = 0; i < list.length; i++) {
        it = PS.ItemData.byId(list[i].id || list[i]);
        if (!it) continue;
        nbTotal++;
        if (own(seen, it.id)) continue;
        seen[it.id] = 1;
        nbDiff++;
        if (it.rarity === 1) nbCommon++;
        else if (it.rarity === 4) nbLegend++;
      }
      var counters = {
        commonItem: nbCommon,
        legendaryItem: nbLegend,
        differentItem: nbDiff,
        duplicateItem: nbTotal - nbDiff,
        /* freeWeaponSlots: 源 run_data.gd:1257 是 `effects[weapon_slot_hash] − weapons.size()`, 而 effects
         *   里存的是**含基准槽位**的上限。本作 s.weaponSlot 的「+= B.WEAPON_SLOTS」落盘在 compute 收尾段
         *   (此刻还没执行) ⇒ 这里必须自己按同一公式补回基准, 否则每件都少算 6 个槽。 */
        freeWeaponSlots: (PS.Balance.WEAPON_SLOTS + ctxNum(s.weaponSlot)) - wp.length,
        livingEnemy: ctxNum(ctx.livingEnemy),
        burningEnemy: ctxNum(ctx.burningEnemy),   /* v6.7(Wave 3): **真数** —— 由 game.js 的 burningCount(en)
                                                   *   数「燃烧中且存活」的怪（旧注释「本作无燃烧机制 ⇒ 恒传 0」已作废） */
        gold: ctxNum(ctx.gold)
      };
      for (i = 0; i < list.length; i++) {
        it = PS.ItemData.byId(list[i].id || list[i]);
        if (!it) continue;
        sc = it.scale;
        for (j = 0; sc && j < sc.length; j++) {
          d = sc[j];
          if (!d || !d.ch) continue;
          nb = ctxNum(d.nb);
          if (!nb) continue;
          ch = d.ch; drv = d.drive;
          /* drive:'stat:<ch>' 读第一遍快照; 其余是计数器。未知 drive → 0(不发值)。 */
          if (typeof drv === 'string' && drv.indexOf('stat:') === 0) {
            actual = own(first, drv.slice(5)) ? ctxNum(first[drv.slice(5)]) : 0;
          } else {
            actual = own(counters, drv) ? counters[drv] : 0;
          }
          addChannel(s, ch, trunc0(ctxNum(d.per) * (actual / nb)));
        }
        cd = it.cond;
        for (j = 0; cd && j < cd.length; j++) {
          d = cd[j];
          if (!d || !d.ch) continue;
          if (d.kind === 'notMoving') {
            if (ctx.notMoving) addChannel(s, d.ch, ctxNum(d.v));
          } else if (d.kind === 'interval') {
            every = ctxNum(d.every);
            if (every > 0) {
              n = Math.floor(ctxNum(ctx.waveSeconds) / every);
              if (n > 0) addChannel(s, d.ch, ctxNum(d.v) * n);
            }
          }
          /* 源里还有 temp_stats_on_hit / stats_end_of_wave / stats_next_wave / unique_weapon_effects / … 等条件族。
           * v5.6(G1) 起: 其中**本作有机制**的家族落在 it.trig[]（见本文件 applyTriggers + game.js 的 PS.ItemTriggers）,
           * 不再走 cond; 仍未接线的家族（武器侧 / 无燃烧 / 无消耗品 / 商店侧 / 唯一持有者已整件丢弃）见台账 §8.3。 */
        }
      }
    }
  };
})(typeof GameGlobal !== 'undefined' ? GameGlobal : (typeof window !== 'undefined' ? window : globalThis));
