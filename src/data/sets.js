/* PS.SetData —— 武器羁绊(套装)数据 + 计数 (v5.7, 主程新建)
 * =============================================================================
 * 「机制」来源是**反编译源代码里的事实**(只搬机制/公式/信息架构, 不搬任何美术·音频·文案·数值):
 *   · 武器实例带套装    src-remote/weapons/weapon.gd        var weapon_sets: Array = []
 *                       (player.gd 复制武器时 instance.weapon_sets = weapon.sets)
 *   · 套装定义          src-remote/items/sets/set_data.gd   my_id / name / set_bonuses
 *                       —— 每个**内层数组**是一档的 effect 列表
 *   · 计数与激活        src-remote/singletons/run_data.gd:1043 update_sets()
 *                       对每把持有武器, 给它身上的**每一个**套装 +1(同件同族也各算一份);
 *                       仅当 active_sets[key] >= 2 才激活;
 *                       档位下标 = min(计数 - 2, 档数 - 1)  ⇒ 阈值隐式为 2 / 3 / 4 / ...
 *   · 羁绊面板          src-remote/ui/menus/shop/synergy_panel.gd
 *                       档位前缀 "(i+2)"; 已达成那档高亮、未达成整段置灰; 只列身上**有**的套装
 *   · 商店偏向          src-remote/singletons/item_service.gd:330-390
 *                       CHANCE_SAME_WEAPON_SET = 0.35 · BONUS_CHANCE_SAME_WEAPON_SET = 0.2 ·
 *                       MAX_WAVE_ONE_WEAPON_GUARANTEED = 5
 *                       rand < chance_same_weapon      -> 池筛成"玩家已有的 weapon_id"
 *                       elif rand < chance_same_weapon_set -> 池筛成"身上已有套装的武器"
 *                       (本作按同一衰减窗实现, 见 balance.js 的 sameWeaponSetChance)
 *
 * 「数据」是本作**自主设计**的 —— 源里没有可搬的:
 *   源 extract-weapons.json 里**没有** set 字段; 套装归属存在 .tres 资源里, 不在反编译产物内。
 *   所以分组与档位数值均为原创, 命名/题材全部走本作的蔬菜世界观(不回译源的套装名)。
 *   分组: 61 个武器族按**形制**分成 8 套(两两不重叠, 并集 = 全部 61 族);
 *         另加 1 套按**元素属性**的交叉套 primal —— 那几个族**同时**属于形制套与 primal,
 *         这正是源「一件武器可属于多个套装」的用法(源 weapon_sets 本来就是数组)。
 *
 * 档位数值的定标锚点(用源自己的刻度, 不拍脑袋; 详见 balance.md):
 *   · 一只精英/Boss 血量 = 750 × hpW 倍于 T1「芽芽怪」(hpW = 2) ⇒ 1 只精英 ≈ 375 只 T1 怪的等效价值;
 *     一局约 10 只精英 + 1 Boss ⇒ 一局总承伤面就在"11 只精英"的量级。
 *   · 本作 6 个武器槽 ⇒ 最高档只能是 (4+): 把 6 件全押一套才拿得满, 这是个**有代价**的选择。
 *   · 量级锚点: 最高档 ~ 1~1.5 件普通道具的收益(不改变一局的强度量级, 只给"堆同系"一条明确回报线);
 *     最低档 = 小甜头, 目的是让玩家**发现**套装存在(源的 (2) 档也是这个作用)。
 *   · 通道名必须与 core/stats.js 的 FLAT / PCT 逐字一致 —— 写错的通道会被静默丢弃。
 *     qa/verify-weapon-sets.cjs 第 3 条挡住这件事; 特别地 elePct / engPct 是**死通道**(无消费者),
 *     本文件一律不用。
 *
 * 文案: 一律由 modText() 按 mods **现算**, 本文件不存任何手写数值串(门禁第 5 条)。
 * 视觉: color 只被美术层读(v-字段规矩), 不参与任何判定。
 */
(function (global) {
  'use strict';
  var PS = global.PS || (global.PS = {});
  var S = PS.SetData = PS.SetData || {};

  /* 通道 -> 显示名。pct:true 的带 '%'。只列本文件用到的通道。 */
  var LABEL = {
    atkSpd: ['攻速', 1],
    meleeDmg: ['近战伤害', 0],
    rangedDmg: ['远程伤害', 0],
    eleDmg: ['元素伤害', 0],
    crit: ['暴击率', 1],
    dmgFlat: ['伤害', 0],
    dmgPct: ['伤害', 1],
    dmgVsBossPct: ['对精英/Boss 伤害', 1],
    armor: ['护甲', 0],
    maxHp: ['最大生命', 0],
    knockback: ['击退', 0],
    rangeFlat: ['射程', 0],
    pierceBonus: ['穿透', 0],
    bounce: ['弹射', 0],
    lifesteal: ['吸血', 0],
    luck: ['幸运', 0]
  };

  /* ============================== 套装表 ==============================
   * kind: 'form' = 形制套(必须两两不重叠, 并集 = 全部 61 族)
   *       'elem' = 属性套(与形制套交叉计数, 允许重叠)
   * tiers[i].nb **必须等于 i + 2**(源 run_data.gd:1068 的 min(count - 2, ...) 语义), 门禁第 2 条钉死。 */
  var LIST = {
    blade: {
      name: '锋刃架',
      kind: 'form',
      color: '#cfe3f5',
      fams: ['dagger', 'knife', 'hatchet', 'chopper', 'pruner', 'scissors', 'sharp_tooth',
        'circular_saw', 'sword', 'vorpal_sword', 'excalibur', 'scythe'],
      tiers: [
        { nb: 2, mods: { atkSpd: 6 } },
        { nb: 3, mods: { atkSpd: 10, meleeDmg: 3 } },
        { nb: 4, mods: { atkSpd: 16, meleeDmg: 8, crit: 3 } }
      ]
    },
    blunt: {
      name: '工坊重器',
      kind: 'form',
      color: '#dcc9a2',
      fams: ['cactus_mace', 'fighting_stick', 'plank', 'stick', 'wrench', 'spiky_shield',
        'hammer', 'plasma_sledgehammer', 'torch', 'screwdriver'],
      tiers: [
        { nb: 2, mods: { knockback: 3 } },
        { nb: 3, mods: { knockback: 6, armor: 2 } },
        { nb: 4, mods: { knockback: 10, armor: 4, maxHp: 12 } }
      ]
    },
    polearm: {
      name: '长杆阵',
      kind: 'form',
      color: '#c9d9ad',
      fams: ['jousting_lance', 'spear', 'claw', 'dextroyer', 'drill'],
      tiers: [
        { nb: 2, mods: { rangeFlat: 15 } },
        { nb: 3, mods: { rangeFlat: 30, pierceBonus: 1 } },
        { nb: 4, mods: { rangeFlat: 45, pierceBonus: 2, meleeDmg: 6 } }
      ]
    },
    firearm: {
      name: '铁匠火器',
      kind: 'form',
      color: '#e2b39c',
      fams: ['pistol', 'revolver', 'smg', 'double_barrel_shotgun', 'shredder', 'medical_gun',
        'sniper_gun', 'minigun', 'chain_gun'],
      tiers: [
        { nb: 2, mods: { rangedDmg: 3 } },
        { nb: 3, mods: { rangedDmg: 6, atkSpd: 5 } },
        { nb: 4, mods: { rangedDmg: 12, atkSpd: 10 } }
      ]
    },
    ordnance: {
      name: '爆裂工坊',
      kind: 'form',
      color: '#e8a35c',
      fams: ['rocket_launcher', 'potato_thrower', 'nuclear_launcher', 'obliterator',
        'particle_accelerator', 'flamethrower'],
      tiers: [
        { nb: 2, mods: { dmgVsBossPct: 8 } },
        { nb: 3, mods: { dmgVsBossPct: 16, dmgPct: 5 } },
        { nb: 4, mods: { dmgVsBossPct: 30, dmgPct: 10 } }
      ]
    },
    arcana: {
      name: '咒园祭坛',
      kind: 'form',
      color: '#c9a8e8',
      fams: ['wand', 'ghost_scepter', 'icicle', 'laser_gun', 'fireball', 'gatling_laser',
        'ghost_axe', 'ghost_flint', 'thunder_sword', 'lightning_shiv'],
      tiers: [
        { nb: 2, mods: { eleDmg: 3 } },
        { nb: 3, mods: { eleDmg: 6, crit: 2 } },
        { nb: 4, mods: { eleDmg: 10, crit: 4, atkSpd: 8 } }
      ]
    },
    unarmed: {
      name: '徒手拳苑',
      kind: 'form',
      color: '#f0c8a0',
      fams: ['fist', 'hand', 'power_fist', 'flaming_knuckles'],
      tiers: [
        { nb: 2, mods: { atkSpd: 8 } },
        { nb: 3, mods: { atkSpd: 12, lifesteal: 1 } },
        { nb: 4, mods: { atkSpd: 20, lifesteal: 2, meleeDmg: 6 } }
      ]
    },
    thrown: {
      name: '随手家什',
      kind: 'form',
      color: '#b8dcd0',
      fams: ['rock', 'shuriken', 'slingshot', 'crossbow', 'taser'],
      tiers: [
        { nb: 2, mods: { bounce: 1 } },
        { nb: 3, mods: { bounce: 2, luck: 3 } },
        { nb: 4, mods: { bounce: 3, luck: 8, rangedDmg: 6 } }
      ]
    },
    primal: {
      name: '元素炉',
      kind: 'elem',
      color: '#f0a8a0',
      fams: ['fireball', 'flamethrower', 'flaming_knuckles', 'torch', 'icicle',
        'thunder_sword', 'lightning_shiv', 'ghost_flint'],
      tiers: [
        { nb: 2, mods: { eleDmg: 2, crit: 2 } },
        { nb: 3, mods: { eleDmg: 5, crit: 3 } },
        { nb: 4, mods: { eleDmg: 8, crit: 3, atkSpd: 8 } }
      ]
    }
  };

  /* 展示顺序 = 形制套在前面, 属性套垫底(面板按此序排)。 */
  S.order = ['blade', 'blunt', 'polearm', 'firearm', 'ordnance', 'arcana', 'unarmed', 'thrown', 'primal'];
  S.list = LIST;

  /* family -> [setId, ...] 反查表(加载时建一次)。 */
  var FAM_SETS = S.famSets = {};
  (function () {
    for (var i = 0; i < S.order.length; i++) {
      var id = S.order[i], st = LIST[id], j;
      for (j = 0; j < st.fams.length; j++) {
        var f = st.fams[j];
        (FAM_SETS[f] || (FAM_SETS[f] = [])).push(id);
      }
    }
  })();

  S.setsOf = function (fam) { return (fam && FAM_SETS[fam]) || []; };
  S.has = function (id) { return Object.prototype.hasOwnProperty.call(LIST, id); };

  /* ---------- 计数: 复现 run_data.gd:1043 update_sets() ----------
   * 入参 weapons = [{key, tier}, ...]; 返回 { setId: {id, count, idx, set} }。
   * idx = -1 表示未激活(count < 2)。同件同族各算一份(源口径), 不按族去重。 */
  S.ofWeapons = function (weapons) {
    var cnt = {}, i, j, def, fam, ids;
    weapons = weapons || [];
    for (i = 0; i < weapons.length; i++) {
      def = PS.WeaponData && PS.WeaponData.list[weapons[i] && weapons[i].key];
      fam = def && def.family;
      if (!fam) continue;
      ids = FAM_SETS[fam];
      if (!ids) continue;
      for (j = 0; j < ids.length; j++) cnt[ids[j]] = (cnt[ids[j]] || 0) + 1;
    }
    var out = {};
    for (var id in cnt) {
      var st = LIST[id], n = cnt[id];
      out[id] = { id: id, count: n, idx: (n >= 2) ? Math.min(n - 2, st.tiers.length - 1) : -1, set: st };
    }
    return out;
  };

  /* 身上**已有**的套装 id 列表(源 item_service.gd:345 get_player_sets = active_sets.keys(),
   * 即 count >= 1 就算, 与"是否激活"无关)。商店偏向用它。 */
  S.idsHeld = function (weapons) {
    var state = S.ofWeapons(weapons), out = [];
    for (var i = 0; i < S.order.length; i++) if (state[S.order[i]]) out.push(S.order[i]);
    return out;
  };

  /* 把已激活档位的 mods 合并成一份 extraMods(交给 PS.Stats.compute 的第 5 参)。
   * 不同套之间是**相加**; 同一套只取**当前档**那一档(不是逐档累加) —— 源 run_data.gd:1068 就是
   * 只取 set_bonuses[min(...)] 那一个数组, 不是前缀和。无任何激活则返回 null(compute 会跳过)。 */
  S.modsFrom = function (state) {
    var out = null, k;
    for (var id in state) {
      var e = state[id];
      if (!e || e.idx < 0) continue;
      var mods = e.set.tiers[e.idx].mods;
      out = out || {};
      for (k in mods) out[k] = (out[k] || 0) + mods[k];
    }
    return out;
  };

  /* 已激活档位的人类可读串, 由 mods **现算**(例: '攻速 +16% · 近战伤害 +8 · 暴击率 +3%')。
   * 输出顺序 = LABEL 的声明顺序(与对象 key 顺序无关, 保证同 mods 同串)。
   * mods 里出现**没有标签**的通道时它会被静默丢掉 —— 那正说明有人写了错通道,
   * 由 qa/verify-weapon-sets.cjs 第 3 条(每个 mods key 都必须有标签且必须是真通道)挡住。 */
  S.LABEL = LABEL;
  S.modText = function (mods) {
    var parts = [];
    for (var k in LABEL) {
      if (!mods || !mods[k]) continue;
      parts.push(LABEL[k][0] + ' +' + mods[k] + (LABEL[k][1] ? '%' : ''));
    }
    return parts.join(' · ');
  };

  /* 单档文案(面板逐档展示用)。 */
  S.tierText = function (tier) { return S.modText(tier.mods); };
})(typeof window !== 'undefined' ? window : globalThis);