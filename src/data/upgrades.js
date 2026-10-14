/* PS.UpgradeData -- 升级池数值表(源 items/upgrades 逐条 1:1; 名字与描述为本作原创)
 * ★ 生成物: 由 tools/gen-upgrades.cjs 解析反编译源生成, 不要手改。
 * 源事实: items/upgrades 下每个 <家族>_data.tres 给出 tier / max_nb, 配对 *_effect.tres 给出
 *   key(源属性名)与 value(效果幅度); weapon_slot 家族无 tier 子目录。
 *   源共 78 个 _data.tres = 池内 77 条 + 1 条根目录占位件(无 my_id / 无 effect, 不入池)。
 * 家族 → 本作词条键映射表(键名取自 src/core/stats.js 的 FLAT / PCT 与 balance.js 的 LEVELUP_POOL):
 *
 *   家族(源目录)          源 effect key         本作词条键   通道    说明
 *   accuracy              stat_accuracy         accuracy     flat    v3.5 接线: stats.js 折算成 accFactor, 由 combat.js 收紧多弹锥角(源 weapon_service.gd:256)
 *   armor                 stat_armor            armor        flat
 *   attack_speed          stat_attack_speed     atkSpd       pct
 *   crit_chance           stat_crit_chance      crit         flat    stats.js 的 FLAT_FORCE 强制整数百分点累加(标记仍写 pct)
 *   crit_damage           stat_crit_damage      -            -       整族不进池: 用户要求暴击伤害不进升级选项
 *   damage                stat_damage           dmgFlat      flat
 *   dodge                 stat_dodge            dodge        flat    stats.js 的 FLAT_FORCE 强制整数百分点累加(标记仍写 pct)
 *   elemental_damage      stat_elemental_damage eleDmg       flat
 *   engineering           stat_engineering      engDmg       flat
 *   harvesting            stat_harvesting       harvest      flat
 *   health                stat_max_hp           maxHp        flat    源 key 与目录名不同名
 *   health_regeneration   stat_hp_regeneration  regen        flat    源 key 与目录名不同名
 *   lifesteal             stat_lifesteal        lifesteal    flat
 *   luck                  stat_luck             luck         flat
 *   melee_damage          stat_melee_damage     meleeDmg     flat
 *   percent_damage        stat_percent_damage   dmgPct       pct
 *   range                 stat_range            rangeFlat    flat    源单位是射程绝对值, 走加法通道(见 stats.js 的 rangeFlat 注释)
 *   ranged_damage         stat_ranged_damage    rangedDmg    flat
 *   speed                 stat_speed            speedPct     pct
 *   weapon_slot           weapon_slot           weaponSlot   flat    v3.5 接线: 源基准 6(player_run_data.gd:434) + 词条, 消费方统一读 stats.weaponSlot
 * 字段: id 本作自定 upg_<家族>_<tier+1> · stat 本作词条键(null = 未接线, 消费方须跳过) ·
 *   tier 源 tier(0~3, 越大越强) · value 源效果幅度(配对 effect 的 value) · max 源 max_nb(-1 = 不限) ·
 *   pct 是否百分比通道(与 balance.js LEVELUP_POOL 同口径) · srcKey 源 effect key ·
 *   name / desc 本作原创(源 name 是翻译键, 未取) · src 源相对路径(供门禁逐行回查)
 * LEVEL_HP: 每次升级额外固定 +1 生命上限(源 main.gd:872 RunData.add_stat(stat_max_hp, 1))。
 */
(function (global) {
  'use strict';
  var PS = global.PS || {};
  PS.UpgradeData = {
    /* 源 items/upgrades 逐条解析; crit_damage 家族按用户要求剔除(见文件头映射表) */
    source: 'brotato items/upgrades (78 个 _data.tres → 池内 77 条, 剔除 crit_damage 4 条 = 73 条)',
    LEVEL_HP: 1,
    list: [
      { id: 'upg_accuracy_1', stat: 'accuracy', tier: 0, value: 4, max: -1, pct: false, srcKey: 'stat_accuracy', name: '精准', desc: '瞄得更准，出手更稳。', src: 'items/upgrades/accuracy/1/accuracy_data.tres' },
      { id: 'upg_accuracy_2', stat: 'accuracy', tier: 1, value: 8, max: -1, pct: false, srcKey: 'stat_accuracy', name: '精准', desc: '瞄得更准，出手更稳。', src: 'items/upgrades/accuracy/2/accuracy_2_data.tres' },
      { id: 'upg_accuracy_3', stat: 'accuracy', tier: 2, value: 12, max: -1, pct: false, srcKey: 'stat_accuracy', name: '精准', desc: '瞄得更准，出手更稳。', src: 'items/upgrades/accuracy/3/accuracy_3_data.tres' },
      { id: 'upg_accuracy_4', stat: 'accuracy', tier: 3, value: 16, max: -1, pct: false, srcKey: 'stat_accuracy', name: '精准', desc: '瞄得更准，出手更稳。', src: 'items/upgrades/accuracy/4/accuracy_4_data.tres' },
      { id: 'upg_armor_1', stat: 'armor', tier: 0, value: 1, max: -1, pct: false, srcKey: 'stat_armor', name: '护甲', desc: '外皮厚一层，挨打轻一点。', src: 'items/upgrades/armor/1/armor_data.tres' },
      { id: 'upg_armor_2', stat: 'armor', tier: 1, value: 2, max: -1, pct: false, srcKey: 'stat_armor', name: '护甲', desc: '外皮厚一层，挨打轻一点。', src: 'items/upgrades/armor/2/armor_2_data.tres' },
      { id: 'upg_armor_3', stat: 'armor', tier: 2, value: 3, max: -1, pct: false, srcKey: 'stat_armor', name: '护甲', desc: '外皮厚一层，挨打轻一点。', src: 'items/upgrades/armor/3/armor_3_data.tres' },
      { id: 'upg_armor_4', stat: 'armor', tier: 3, value: 4, max: -1, pct: false, srcKey: 'stat_armor', name: '护甲', desc: '外皮厚一层，挨打轻一点。', src: 'items/upgrades/armor/4/armor_4_data.tres' },
      { id: 'upg_attack_speed_1', stat: 'atkSpd', tier: 0, value: 5, max: -1, pct: true, srcKey: 'stat_attack_speed', name: '攻击速度', desc: '手腕更活，出手更密。', src: 'items/upgrades/attack_speed/1/attack_speed_data.tres' },
      { id: 'upg_attack_speed_2', stat: 'atkSpd', tier: 1, value: 10, max: -1, pct: true, srcKey: 'stat_attack_speed', name: '攻击速度', desc: '手腕更活，出手更密。', src: 'items/upgrades/attack_speed/2/attack_speed_2_data.tres' },
      { id: 'upg_attack_speed_3', stat: 'atkSpd', tier: 2, value: 15, max: -1, pct: true, srcKey: 'stat_attack_speed', name: '攻击速度', desc: '手腕更活，出手更密。', src: 'items/upgrades/attack_speed/3/attack_speed_3_data.tres' },
      { id: 'upg_attack_speed_4', stat: 'atkSpd', tier: 3, value: 20, max: -1, pct: true, srcKey: 'stat_attack_speed', name: '攻击速度', desc: '手腕更活，出手更密。', src: 'items/upgrades/attack_speed/4/attack_speed_4_data.tres' },
      { id: 'upg_crit_chance_1', stat: 'crit', tier: 0, value: 3, max: -1, pct: true, srcKey: 'stat_crit_chance', name: '暴击率', desc: '更常打中要害。', src: 'items/upgrades/crit_chance/1/crit_chance_data.tres' },
      { id: 'upg_crit_chance_2', stat: 'crit', tier: 1, value: 5, max: -1, pct: true, srcKey: 'stat_crit_chance', name: '暴击率', desc: '更常打中要害。', src: 'items/upgrades/crit_chance/2/crit_chance_2_data.tres' },
      { id: 'upg_crit_chance_3', stat: 'crit', tier: 2, value: 7, max: -1, pct: true, srcKey: 'stat_crit_chance', name: '暴击率', desc: '更常打中要害。', src: 'items/upgrades/crit_chance/3/crit_chance_3_data.tres' },
      { id: 'upg_crit_chance_4', stat: 'crit', tier: 3, value: 9, max: -1, pct: true, srcKey: 'stat_crit_chance', name: '暴击率', desc: '更常打中要害。', src: 'items/upgrades/crit_chance/4/crit_chance_4_data.tres' },
      { id: 'upg_damage_1', stat: 'dmgFlat', tier: 0, value: 1, max: -1, pct: false, srcKey: 'stat_damage', name: '固定伤害', desc: '每一下都实打实多掉一点。', src: 'items/upgrades/damage/1/damage_data.tres' },
      { id: 'upg_damage_2', stat: 'dmgFlat', tier: 1, value: 1, max: -1, pct: false, srcKey: 'stat_damage', name: '固定伤害', desc: '每一下都实打实多掉一点。', src: 'items/upgrades/damage/2/damage_2_data.tres' },
      { id: 'upg_damage_3', stat: 'dmgFlat', tier: 2, value: 2, max: -1, pct: false, srcKey: 'stat_damage', name: '固定伤害', desc: '每一下都实打实多掉一点。', src: 'items/upgrades/damage/3/damage_3_data.tres' },
      { id: 'upg_damage_4', stat: 'dmgFlat', tier: 3, value: 3, max: -1, pct: false, srcKey: 'stat_damage', name: '固定伤害', desc: '每一下都实打实多掉一点。', src: 'items/upgrades/damage/4/damage_4_data.tres' },
      { id: 'upg_dodge_1', stat: 'dodge', tier: 0, value: 3, max: -1, pct: true, srcKey: 'stat_dodge', name: '闪避', desc: '身子一歪就躲过去。', src: 'items/upgrades/dodge/1/dodge_data.tres' },
      { id: 'upg_dodge_2', stat: 'dodge', tier: 1, value: 6, max: -1, pct: true, srcKey: 'stat_dodge', name: '闪避', desc: '身子一歪就躲过去。', src: 'items/upgrades/dodge/2/dodge_2_data.tres' },
      { id: 'upg_dodge_3', stat: 'dodge', tier: 2, value: 9, max: -1, pct: true, srcKey: 'stat_dodge', name: '闪避', desc: '身子一歪就躲过去。', src: 'items/upgrades/dodge/3/dodge_3_data.tres' },
      { id: 'upg_dodge_4', stat: 'dodge', tier: 3, value: 12, max: -1, pct: true, srcKey: 'stat_dodge', name: '闪避', desc: '身子一歪就躲过去。', src: 'items/upgrades/dodge/4/dodge_4_data.tres' },
      { id: 'upg_elemental_damage_1', stat: 'eleDmg', tier: 0, value: 1, max: -1, pct: false, srcKey: 'stat_elemental_damage', name: '元素伤害', desc: '招式里添一把火气。', src: 'items/upgrades/elemental_damage/1/elemental_damage_data.tres' },
      { id: 'upg_elemental_damage_2', stat: 'eleDmg', tier: 1, value: 2, max: -1, pct: false, srcKey: 'stat_elemental_damage', name: '元素伤害', desc: '招式里添一把火气。', src: 'items/upgrades/elemental_damage/2/elemental_damage_2_data.tres' },
      { id: 'upg_elemental_damage_3', stat: 'eleDmg', tier: 2, value: 3, max: -1, pct: false, srcKey: 'stat_elemental_damage', name: '元素伤害', desc: '招式里添一把火气。', src: 'items/upgrades/elemental_damage/3/elemental_damage_3_data.tres' },
      { id: 'upg_elemental_damage_4', stat: 'eleDmg', tier: 3, value: 4, max: -1, pct: false, srcKey: 'stat_elemental_damage', name: '元素伤害', desc: '招式里添一把火气。', src: 'items/upgrades/elemental_damage/4/elemental_damage_4_data.tres' },
      { id: 'upg_engineering_1', stat: 'engDmg', tier: 0, value: 2, max: -1, pct: false, srcKey: 'stat_engineering', name: '结构伤害', desc: '搭起来的家伙更牢更狠。', src: 'items/upgrades/engineering/1/engineering_data.tres' },
      { id: 'upg_engineering_2', stat: 'engDmg', tier: 1, value: 3, max: -1, pct: false, srcKey: 'stat_engineering', name: '结构伤害', desc: '搭起来的家伙更牢更狠。', src: 'items/upgrades/engineering/2/engineering_2_data.tres' },
      { id: 'upg_engineering_3', stat: 'engDmg', tier: 2, value: 4, max: -1, pct: false, srcKey: 'stat_engineering', name: '结构伤害', desc: '搭起来的家伙更牢更狠。', src: 'items/upgrades/engineering/3/engineering_3_data.tres' },
      { id: 'upg_engineering_4', stat: 'engDmg', tier: 3, value: 5, max: -1, pct: false, srcKey: 'stat_engineering', name: '结构伤害', desc: '搭起来的家伙更牢更狠。', src: 'items/upgrades/engineering/4/engineering_4_data.tres' },
      { id: 'upg_harvesting_1', stat: 'harvest', tier: 0, value: 5, max: -1, pct: false, srcKey: 'stat_harvesting', name: '采集', desc: '收成更好，材料更足。', src: 'items/upgrades/harvesting/1/harvesting_data.tres' },
      { id: 'upg_harvesting_2', stat: 'harvest', tier: 1, value: 8, max: -1, pct: false, srcKey: 'stat_harvesting', name: '采集', desc: '收成更好，材料更足。', src: 'items/upgrades/harvesting/2/harvesting_2_data.tres' },
      { id: 'upg_harvesting_3', stat: 'harvest', tier: 2, value: 10, max: -1, pct: false, srcKey: 'stat_harvesting', name: '采集', desc: '收成更好，材料更足。', src: 'items/upgrades/harvesting/3/harvesting_3_data.tres' },
      { id: 'upg_harvesting_4', stat: 'harvest', tier: 3, value: 12, max: -1, pct: false, srcKey: 'stat_harvesting', name: '采集', desc: '收成更好，材料更足。', src: 'items/upgrades/harvesting/4/harvesting_4_data.tres' },
      { id: 'upg_health_1', stat: 'maxHp', tier: 0, value: 3, max: -1, pct: false, srcKey: 'stat_max_hp', name: '生命上限', desc: '把身子养厚实些。', src: 'items/upgrades/health/1/health_data.tres' },
      { id: 'upg_health_2', stat: 'maxHp', tier: 1, value: 6, max: -1, pct: false, srcKey: 'stat_max_hp', name: '生命上限', desc: '把身子养厚实些。', src: 'items/upgrades/health/2/health_2_data.tres' },
      { id: 'upg_health_3', stat: 'maxHp', tier: 2, value: 9, max: -1, pct: false, srcKey: 'stat_max_hp', name: '生命上限', desc: '把身子养厚实些。', src: 'items/upgrades/health/3/health_3_data.tres' },
      { id: 'upg_health_4', stat: 'maxHp', tier: 3, value: 12, max: -1, pct: false, srcKey: 'stat_max_hp', name: '生命上限', desc: '把身子养厚实些。', src: 'items/upgrades/health/4/health_4_data.tres' },
      { id: 'upg_health_regeneration_1', stat: 'regen', tier: 0, value: 2, max: -1, pct: false, srcKey: 'stat_hp_regeneration', name: '生命恢复', desc: '伤口自己慢慢长好。', src: 'items/upgrades/health_regeneration/1/health_regeneration_data.tres' },
      { id: 'upg_health_regeneration_2', stat: 'regen', tier: 1, value: 3, max: -1, pct: false, srcKey: 'stat_hp_regeneration', name: '生命恢复', desc: '伤口自己慢慢长好。', src: 'items/upgrades/health_regeneration/2/health_regeneration_2_data.tres' },
      { id: 'upg_health_regeneration_3', stat: 'regen', tier: 2, value: 4, max: -1, pct: false, srcKey: 'stat_hp_regeneration', name: '生命恢复', desc: '伤口自己慢慢长好。', src: 'items/upgrades/health_regeneration/3/health_regeneration_3_data.tres' },
      { id: 'upg_health_regeneration_4', stat: 'regen', tier: 3, value: 5, max: -1, pct: false, srcKey: 'stat_hp_regeneration', name: '生命恢复', desc: '伤口自己慢慢长好。', src: 'items/upgrades/health_regeneration/4/health_regeneration_4_data.tres' },
      { id: 'upg_lifesteal_1', stat: 'lifesteal', tier: 0, value: 1, max: -1, pct: false, srcKey: 'stat_lifesteal', name: '吸血', desc: '打出来的血，再喝回去。', src: 'items/upgrades/lifesteal/1/lifesteal_data.tres' },
      { id: 'upg_lifesteal_2', stat: 'lifesteal', tier: 1, value: 2, max: -1, pct: false, srcKey: 'stat_lifesteal', name: '吸血', desc: '打出来的血，再喝回去。', src: 'items/upgrades/lifesteal/2/lifesteal_2_data.tres' },
      { id: 'upg_lifesteal_3', stat: 'lifesteal', tier: 2, value: 3, max: -1, pct: false, srcKey: 'stat_lifesteal', name: '吸血', desc: '打出来的血，再喝回去。', src: 'items/upgrades/lifesteal/3/lifesteal_3_data.tres' },
      { id: 'upg_lifesteal_4', stat: 'lifesteal', tier: 3, value: 4, max: -1, pct: false, srcKey: 'stat_lifesteal', name: '吸血', desc: '打出来的血，再喝回去。', src: 'items/upgrades/lifesteal/4/lifesteal_4_data.tres' },
      { id: 'upg_luck_1', stat: 'luck', tier: 0, value: 5, max: -1, pct: false, srcKey: 'stat_luck', name: '运气', desc: '撞上好事的次数多了。', src: 'items/upgrades/luck/1/luck_data.tres' },
      { id: 'upg_luck_2', stat: 'luck', tier: 1, value: 10, max: -1, pct: false, srcKey: 'stat_luck', name: '运气', desc: '撞上好事的次数多了。', src: 'items/upgrades/luck/2/luck_2_data.tres' },
      { id: 'upg_luck_3', stat: 'luck', tier: 2, value: 15, max: -1, pct: false, srcKey: 'stat_luck', name: '运气', desc: '撞上好事的次数多了。', src: 'items/upgrades/luck/3/luck_3_data.tres' },
      { id: 'upg_luck_4', stat: 'luck', tier: 3, value: 20, max: -1, pct: false, srcKey: 'stat_luck', name: '运气', desc: '撞上好事的次数多了。', src: 'items/upgrades/luck/4/luck_4_data.tres' },
      { id: 'upg_melee_damage_1', stat: 'meleeDmg', tier: 0, value: 2, max: -1, pct: false, srcKey: 'stat_melee_damage', name: '近战伤害', desc: '贴上去砍，砍得更狠。', src: 'items/upgrades/melee_damage/1/melee_damage_data.tres' },
      { id: 'upg_melee_damage_2', stat: 'meleeDmg', tier: 1, value: 4, max: -1, pct: false, srcKey: 'stat_melee_damage', name: '近战伤害', desc: '贴上去砍，砍得更狠。', src: 'items/upgrades/melee_damage/2/melee_damage_2_data.tres' },
      { id: 'upg_melee_damage_3', stat: 'meleeDmg', tier: 2, value: 6, max: -1, pct: false, srcKey: 'stat_melee_damage', name: '近战伤害', desc: '贴上去砍，砍得更狠。', src: 'items/upgrades/melee_damage/3/melee_damage_3_data.tres' },
      { id: 'upg_melee_damage_4', stat: 'meleeDmg', tier: 3, value: 8, max: -1, pct: false, srcKey: 'stat_melee_damage', name: '近战伤害', desc: '贴上去砍，砍得更狠。', src: 'items/upgrades/melee_damage/4/melee_damage_4_data.tres' },
      { id: 'upg_percent_damage_1', stat: 'dmgPct', tier: 0, value: 5, max: -1, pct: true, srcKey: 'stat_percent_damage', name: '伤害', desc: '全部输出整体往上抬。', src: 'items/upgrades/percent_damage/1/percent_damage_data.tres' },
      { id: 'upg_percent_damage_2', stat: 'dmgPct', tier: 1, value: 8, max: -1, pct: true, srcKey: 'stat_percent_damage', name: '伤害', desc: '全部输出整体往上抬。', src: 'items/upgrades/percent_damage/2/percent_damage_2_data.tres' },
      { id: 'upg_percent_damage_3', stat: 'dmgPct', tier: 2, value: 12, max: -1, pct: true, srcKey: 'stat_percent_damage', name: '伤害', desc: '全部输出整体往上抬。', src: 'items/upgrades/percent_damage/3/percent_damage_3_data.tres' },
      { id: 'upg_percent_damage_4', stat: 'dmgPct', tier: 3, value: 16, max: -1, pct: true, srcKey: 'stat_percent_damage', name: '伤害', desc: '全部输出整体往上抬。', src: 'items/upgrades/percent_damage/4/percent_damage_4_data.tres' },
      { id: 'upg_range_1', stat: 'rangeFlat', tier: 0, value: 15, max: -1, pct: false, srcKey: 'stat_range', name: '射程', desc: '够得着更远的目标。', src: 'items/upgrades/range/1/range_data.tres' },
      { id: 'upg_range_2', stat: 'rangeFlat', tier: 1, value: 30, max: -1, pct: false, srcKey: 'stat_range', name: '射程', desc: '够得着更远的目标。', src: 'items/upgrades/range/2/range_2_data.tres' },
      { id: 'upg_range_3', stat: 'rangeFlat', tier: 2, value: 45, max: -1, pct: false, srcKey: 'stat_range', name: '射程', desc: '够得着更远的目标。', src: 'items/upgrades/range/3/range_3_data.tres' },
      { id: 'upg_range_4', stat: 'rangeFlat', tier: 3, value: 60, max: -1, pct: false, srcKey: 'stat_range', name: '射程', desc: '够得着更远的目标。', src: 'items/upgrades/range/4/range_4_data.tres' },
      { id: 'upg_ranged_damage_1', stat: 'rangedDmg', tier: 0, value: 1, max: -1, pct: false, srcKey: 'stat_ranged_damage', name: '远程伤害', desc: '隔得远照样疼。', src: 'items/upgrades/ranged_damage/1/ranged_damage_data.tres' },
      { id: 'upg_ranged_damage_2', stat: 'rangedDmg', tier: 1, value: 2, max: -1, pct: false, srcKey: 'stat_ranged_damage', name: '远程伤害', desc: '隔得远照样疼。', src: 'items/upgrades/ranged_damage/2/ranged_damage_2_data.tres' },
      { id: 'upg_ranged_damage_3', stat: 'rangedDmg', tier: 2, value: 3, max: -1, pct: false, srcKey: 'stat_ranged_damage', name: '远程伤害', desc: '隔得远照样疼。', src: 'items/upgrades/ranged_damage/3/ranged_damage_3_data.tres' },
      { id: 'upg_ranged_damage_4', stat: 'rangedDmg', tier: 3, value: 4, max: -1, pct: false, srcKey: 'stat_ranged_damage', name: '远程伤害', desc: '隔得远照样疼。', src: 'items/upgrades/ranged_damage/4/ranged_damage_4_data.tres' },
      { id: 'upg_speed_1', stat: 'speedPct', tier: 0, value: 3, max: -1, pct: true, srcKey: 'stat_speed', name: '移动速度', desc: '脚步更轻快。', src: 'items/upgrades/speed/1/speed_data.tres' },
      { id: 'upg_speed_2', stat: 'speedPct', tier: 1, value: 6, max: -1, pct: true, srcKey: 'stat_speed', name: '移动速度', desc: '脚步更轻快。', src: 'items/upgrades/speed/2/speed_2_data.tres' },
      { id: 'upg_speed_3', stat: 'speedPct', tier: 2, value: 9, max: -1, pct: true, srcKey: 'stat_speed', name: '移动速度', desc: '脚步更轻快。', src: 'items/upgrades/speed/3/speed_3_data.tres' },
      { id: 'upg_speed_4', stat: 'speedPct', tier: 3, value: 12, max: -1, pct: true, srcKey: 'stat_speed', name: '移动速度', desc: '脚步更轻快。', src: 'items/upgrades/speed/4/speed_4_data.tres' },
      { id: 'upg_weapon_slot_1', stat: 'weaponSlot', tier: 0, value: 1, max: -1, pct: false, srcKey: 'weapon_slot', name: '武器槽位', desc: '多插一件武器上阵。', src: 'items/upgrades/weapon_slot/weapon_slot_data.tres' }
    ]
  };
})(typeof GameGlobal !== 'undefined' ? GameGlobal : (typeof window !== 'undefined' ? window : globalThis));
