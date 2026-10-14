/* PS.StructureData v1 -- 结构体表（源 entities/structures/*；Wave 3 的 11 件道具的唯一落点）
 * 存在理由：Wave 3 补进来的 11 件道具（turret / turret_flame / turret_healing / turret_laser /
 *   turret_rocket / tyler / garden / wandering_bot / landmines / tree / pocket_factory）在源里的效果是
 *   「在场上生成一个结构体 / 中性物」—— 没有这张表它们就没有落点，会变成「卡面有字、买了没反应」。
 *
 * 数值逐条来自反编译源（每条自带 src 出处，可逐项回溯）:
 *   结构体数值   ref/cache-structures/entities/structures/**（*_stats.tres）
 *                landmine: ref/cache-items/Brotato__items__all__landmines__landmine_stats.tres
 *   道具侧数值   ref/cache-structures/items/all/**(tree / garden / tyler / wandering_bot / landmines)
 * 单位换算：源的 cooldown 单位是**帧**(60fps) ⇒ 秒 = 帧 / 60。对 8 个结构体全部适用。
 *
 * 与源不同之处（逐条写明，不许静默）:
 *   ① 源的结构体是**场景节点**（实体池 + 碰撞体 + 动画），本作是纯数据 + game.js 的 spawnStructures /
 *      updateStructures ⇒ 这里只落「开火判定真正要用的数」：cd / dmg / range / scaling / projSpd /
 *      pierce / count / spread。源的 sprite 缩放(struct_range)、turret_highlighting、boost、curse
 *      粒子属于表现层或本作没有的系统，不落。
 *   ② 爆炸半径：源写在**二进制场景** projectiles/explosion.tscn 的 Hitbox 里（ref/ 下只有
 *      player_explosion.gd，没有那个 .tscn）⇒ 读不出来。本作把「基准半径」提成唯一旋钮
 *      B.EXPLOSION.baseR，而源 .tres 里可实读的 `scale` 字段严格照搬
 *      （rip_and_tear 0.65 / landmine 1.75 / spicy_sauce 1.25 / turret_rocket 1.0）。
 *   ③ 结构体攻速：源 weapon_service.gd 的 apply_structure_attack_speed_effects 是 `cd / (1 + v/100)`
 *      （下限 MIN_COOLDOWN），由 game.js 消费 structAtkSpdPct。
 *   ④ 结构体暴击：源 weapon_service.gd:252 只在 structures_can_crit 为真时才把玩家暴击率加给结构体
 *      ⇒ 本作由 stats.structCrit 决定（pile_of_books +1）。
 */
(function (global) {
  'use strict';
  var PS = global.PS || {};
  /* 源 cooldown 的单位是帧（60fps），本作一律落成秒。 */
  var F = 1 / 60;
  /* kind 是本作的**行为分类**（源靠各自的 .gd 脚本区分）:
   *   gun    索敌开火（turret / flame / laser / rocket / tyler）
   *   heal   不伤敌，只给玩家回血（healing_turret / garden 的 is_healing=true）
   *   garden 定期在脚边落一颗果实（源 nb_projectiles = 0 ⇒ 不发射，靠 wanted_to_spawn_fruit）
   *   pet    绕玩家游走，接触敌人时减速（wandering_bot 的 is_pet=true）
   *   mine   定时在地图上埋一颗，踩上就炸（landmine，spawn_cooldown = 12） */
  var LIST = {
    turret: {
      name: '哨戒炮', ch: 'structTurret', kind: 'gun', src: 'entities/structures/turret/turret_stats.tres',
      cd: 32 * F, dmg: 10, range: 300, scale: { eng: 0.8 }, projSpd: 3000, pierce: 0,
      r: 11, color: '#d8a24a'
    },
    turret_flame: {
      name: '喷火哨座', ch: 'structTurretFlame', kind: 'gun', src: 'entities/structures/turret/flame/flame_turret_stats.tres',
      cd: 15 * F, dmg: 1, range: 300, scale: {}, projSpd: 1000, pierce: 99,
      /* 喷火哨座的子弹自带燃烧：源 flame_turret 的 burning_data = chance 1.0 / damage 5 / duration 8 /
       *   scaling_stats [[stat_engineering, 0.33]]（见 summary 的源侧读取记录）。 */
      burn: { chance: 1.0, dmg: 5, dur: 8, eng: 0.33 },
      r: 11, color: '#e08a3a'
    },
    turret_healing: {
      name: '医疗哨座', ch: 'structTurretHealing', kind: 'heal', src: 'entities/structures/turret/healing/healing_turret_stats.tres',
      cd: 120 * F, dmg: 3, range: 400, scale: { eng: 0.05 }, projSpd: 3000,
      r: 11, color: '#9ad8a0'
    },
    turret_laser: {
      name: '激光哨座', ch: 'structTurretLaser', kind: 'gun', src: 'entities/structures/turret/laser/laser_turret_stats.tres',
      cd: 40 * F, dmg: 20, range: 400, scale: { eng: 1.25 }, projSpd: 3000, pierce: 3,
      r: 11, color: '#a8a0e8'
    },
    turret_rocket: {
      name: '火箭哨座', ch: 'structTurretRocket', kind: 'gun', src: 'entities/structures/turret/rocket/rocket_turret_stats.tres',
      cd: 40 * F, dmg: 25, range: 500, scale: { eng: 1.5 }, projSpd: 2000, pierce: 0,
      /* 命中即炸：源 items/all/turret_rocket/turret_rocket_exploding_effect.tres（chance 1.0 / scale 1.0） */
      boom: { chance: 1.0, r: 1.0 },
      r: 12, color: '#e0533f'
    },
    tyler: {
      name: '散射哨座', ch: 'structTyler', kind: 'gun', src: 'entities/structures/turret/tyler/tyler_stats.tres',
      cd: 120 * F, dmg: 12, range: 235, scale: { eng: 0.9, ele: 0.9 }, projSpd: 2000,
      count: 10, spread: 3.142, pierce: 2,
      r: 12, color: '#8fd66b'
    },
    garden: {
      name: '菜圃', ch: 'structGarden', kind: 'garden', src: 'entities/structures/turret/garden/garden_stats.tres',
      cd: 900 * F, dmg: 0, range: 150, scale: {},
      r: 13, color: '#7ed08a'
    },
    wandering_bot: {
      name: '游走铁虫', ch: 'structBot', kind: 'pet', src: 'entities/structures/turret/wandering_bot/wandering_bot_stats.tres',
      cd: Infinity, dmg: 1, range: 0, scale: { eng: 0 }, projSpd: 0,
      /* 源命中效果是 add_decaying_speed(-250)（wandering_bot 的接触减速），单位 px/s。 */
      slow: 250,
      r: 9, color: '#7ea8d8'
    },
    landmines: {
      name: '地雷', ch: 'structLandmines', kind: 'mine', src: 'items/all/landmines/landmine_stats.tres',
      /* spawn_cooldown = 12（秒）—— 源里这个数是**秒**不是帧（structure_effect.spawn_cooldown）。 */
      spawnCd: 12, cd: 2, dmg: 10, range: 0, scale: { eng: 1.0 },
      /* 踩上即炸：源 landmine_exploding_effect.tres（chance 1.0 / scale 1.75） */
      boom: { chance: 1.0, r: 1.75 },
      r: 8, color: '#c8b06a'
    }
  };
  /* 源 run_data.gd:31-48 get_random_primary_stats() 的 16 项主属性 → 本作通道名。
   * 这张表只给糖果袋（candy_bag 的 gain_random_primary_stats_on_go_to_next_wave）用，
   * 口径 = 源逐项对应，不新增也不删减。 */
  var PRIMARY = ['maxHp', 'armor', 'crit', 'luck', 'atkSpd', 'eleDmg', 'regen', 'lifesteal',
                 'meleeDmg', 'dmgPct', 'dodge', 'engDmg', 'rangeFlat', 'rangedDmg', 'speedPct', 'harvest'];

  PS.StructureData = {
    list: LIST,
    primaryStats: PRIMARY,
    /* 结构体攻速乘区：源 cd 在**帧**域被 apply_structure_attack_speed_effects 收紧后再 /60。 */
    cdOf: function (def, stats) {
      var v = (stats && stats.structAtkSpdPct) || 0;
      return def.cd / (1 + v / 100);
    },
    /* 结构体伤害：源 weapon_service.gd:init_structure_stats ——
     *   damage = round((base + sum(scaling_stat × 系数)) × (1 + engPct/100 + 爆炸加成))
     *   本作只有 engPct 通道（结构体的通用百分比就是"结构伤害"这个词条之一），
     *   而 engDmg（固定值）在 combat.js 的 weaponRaw 里已按结构体武器加过 —— 这里同样加上。 */
    dmgOf: function (def, stats) {
      var s = stats || {}, base = def.dmg || 0;
      base += (def.scale.eng || 0) * (s.engDmg || 0);
      base += (def.scale.ele || 0) * (s.eleDmg || 0);
      return Math.max(1, Math.round(base * (1 + (s.dmgPct || 0))));
    },
    /* 面板值 → 本波要生成的结构体清单（源 entity_spawner.gd:526-542 的 `for _i in struct.value`）。 */
    counts: function (stats) {
      var out = [], k, d, n;
      for (k in LIST) {
        if (!Object.prototype.hasOwnProperty.call(LIST, k)) continue;
        d = LIST[k];
        n = (stats && stats[d.ch]) || 0;
        if (n > 0) out.push({ key: k, def: d, n: Math.min(60, Math.floor(n)) });
      }
      return out;
    }
  };
})(typeof GameGlobal !== 'undefined' ? GameGlobal : (typeof window !== 'undefined' ? window : globalThis));