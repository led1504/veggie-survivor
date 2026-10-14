/* PS.Characters v2 —— 20 名角色（全原创 / 蔬菜化: 菜园抵抗军）
 * 每人: 初始武器(家族1阶) + 属性修正 + 被动特长 + 解锁条件。
 * mods 里 pct 键为百分比值; unlock: null=默认 / wave=n / win=n / kills=n。
 * id 为存档/UI 主键, 蔬菜化只改 name/desc/color, 数值字段一律不动。
 * v3.0 源原生刻度(1:1): hp 与 HP 族词条(maxHp/regen/lifesteal/thorns)与 Brotato 同刻度
 *   (源 base maxHp = 10, stat_max_hp 词条 -5~15/中位 3) —— 见 balance.md §13 与 ref/brotato-numbers.md §8。
 *   空间类词条(pickup/speed)仍用本作世界刻度(本作世界 2240x1560, 源竞技场约 1000x600)。
 * v7.6(2026-09-30): 新增「默认档」口径 —— defaultStartIdx(defaultStartKey) 决定玩家**不碰**
 *   底部选择器时实际到手的那一件 = 池里第一件主伤害通道未被本角色自身 gain 归零的武器。
 *   源里没有这个概念(源武器选择界面必须玩家自己点, 见 weapon_selection.gd), 属本作收窄设计。
 */
(function (global) {
  'use strict';
  var PS = global.PS || {};
  PS.Characters = {
    list: [
      {
        id: 'popo', name: '小番茄', weapon: 'shredder_t1',
        desc: '菜园抵抗军的万金油新兵，一杆弹弓打遍田埂。全属性均衡。',
        hp: 10, mods: {}, passive: { desc: '拾取范围 +12', mods: { pickup: 12 } },
        unlock: null, color: '#d8382c'
      },
      {
        id: 'brick', name: '甜菜根', weapon: 'cactus_mace_t1',
        desc: '根茎部队的重装兵，挥锤慢但落点深，一动就是半个坑。',
        hp: 12, mods: { meleeDmg: 2, armor: 2, speedPct: -5 },
        passive: { desc: '击退 +20%', mods: { knockPct: 20 } }, unlock: null, color: '#b52a78'
      },
      {
        id: 'wren', name: '玉米', weapon: 'smg_t1',
        desc: '高秆哨兵，穗子当弩机。出手快得像风，秸秆一折就断。',
        hp: 8, mods: { atkSpd: 12, rangedDmg: 2, maxHpPct: -10 },
        passive: { desc: '暴击 +3%', mods: { crit: 3 } }, unlock: null, color: '#f2c73c'
      },
      {
        id: 'comfrey', name: '芦荟', weapon: 'chopper_t1',
        desc: '菜园军的随队军医，刃上抹着自己的汁液。越战越勇。',
        hp: 9, mods: { lifesteal: 1, meleeDmg: 1 },
        passive: { desc: '生命恢复 +1', mods: { regen: 1 } }, unlock: null, color: '#3fc4a0'
      },
      {
        id: 'mandrake', name: '大蒜', weapon: 'drill_t4',
        desc: '坛里腌出来的老蒜，气味就是它的盔甲。让蒜瓣替它打架。',
        hp: 9, mods: { armor: 3, thorns: 2, speedPct: -3 },
        passive: { desc: '反伤 +1', mods: { thorns: 1 } },
        unlock: { type: 'wave', v: 8, text: '单局抵达第 8 波' }, color: '#e4dcc4'
      },
      {
        id: 'nightshade', name: '茄子', weapon: 'laser_gun_t1',
        desc: '只在夜里巡逻的茄科斥候，扛着一台谁也没见过的光炮。',
        hp: 8, mods: { rangedDmg: 3, crit: 8, maxHpPct: -12 },
        passive: { desc: '射程 +30px', mods: { rangeFlat: 30 } },
        unlock: { type: 'kills', v: 800, text: '累计击杀 800' }, color: '#6f3fa8'
      },
      {
        id: 'pumpkin', name: '南瓜', weapon: 'double_barrel_shotgun_t1',
        desc: '菜园抵抗军的火爆炮长，一铳撒一把，讲的就是热闹。',
        hp: 11, mods: { dmgPct: 8, dodge: -3 },
        passive: { desc: '商店刷新费 -1', mods: { rerollDiscount: 1 } },
        unlock: { type: 'win', v: 1, text: '通关任意模式一次' }, color: '#e88a1c'
      },
      {
        id: 'clover', name: '四叶草', weapon: 'circular_saw_t2',
        desc: '据说它出生那天田里只有三叶草。运气越高，商店品质与波末掉落越好。',
        hp: 9, mods: { luck: 15, harvest: 5, maxHpPct: -5 },
        /* v3.8: 原文案「材料面值波次提前 +1」在本作**不可实现** —— 源的单粒材料面值恒为 1
         *   (balance.js 的 B.dropValue() = 1, 出处 items/materials/gold.gd:4), 不存在"随波次抬升的面值曲线",
         *   "提前一波"没有可提前的对象。改为源里真实存在且已被消费的 harvestingGrowth 通道
         *   (game.js 的每波采集复利), 文案同步改成能兑现的说法 —— 卡面不许写做不到的事。 */
        passive: { desc: '每波采集复利 +5%', mods: { harvestingGrowth: 5 } },
        unlock: { type: 'endless10', v: 10, text: '无尽模式抵达第 10 波' }, color: '#46c96e'
      },
      /* ==================== v6.1(Codex, 2026-09-29): 结构伤害（源工程学）三名角色 ====================
       * 用户逐字「结构伤害，有这个属性，但没把角色加进来，把原版游戏这些角色加进来」「结构伤害就是原版的工程学」。
       * 逐条对源 items/characters/<id>/*_effect_*.tres（本机快照 ref/source-characters.json 可查）:
       *   engineer   : stat_engineering +10 · gains(工程学) +25% · 起始长柄扳手 ·
       *                gains(伤害族: stat_percent_damage/melee/ranged/elemental/piercing/explosion/
       *                bounce/damage_against_bosses) -50% · group_structures(结构体成群出现)。
       *   apprentice : stats_on_level_up —— 近战+2 / 远程+1 / 元素+1 / 结构+1 / 生命上限-2（每级）。
       *   cyborg     : 起始多管速射铳 III · gains(远程) +200% · gains(结构) -75% ·
       *                gains(近战/元素) -100% · convert_stats_half_wave(100% 远程 → 2× 结构, 波次过半时)。
       * ⚠ 两条**本作暂无法兑现、故没有写进卡面**的源效果（不写做不到的事）:
       *   · engineer 的 group_structures —— 本作的"结构体"是环绕族武器(圆盘锯/穿心钻), 常驻挂在玩家身上,
       *     没有"落地位置"可成群, 该标记位留白; 待结构体实体落地后一并接线。
       *   · engineer 的-50% 里 piercing/explosion/bounce/damage_against_bosses 四条本作没有对应的
       *     "收益"通道(爆炸/弹射/对 Boss 的**收益修正**不存在), 故卡面只印真实生效的四条伤害通道。
       * 起始武器 —— 源把这件事拆成**两个互不替代的概念**, 本作一一对应(v7.5 补齐第二个):
       *   ① `weaponPool` = 源 character_data.gd 的 starting_weapons: 玩家在武器选择界面**点一件**
       *      (ui/menus/run/weapon_selection.gd 的 _on_element_pressed; 池里另有 is_random 的「?」格子)。
       *   ② `startWeapons` = 角色 **effect** 里 custom_key="starting_weapon" 的武器:
       *      源 run_data.gd:1551-1557 add_starting_items_and_weapons() 把它们**无条件** add_weapon()。
       *      源的角色面板(ui/menus/ingame/character_panel_ui.gd:174-191)展示的正是这一串 —— 也就是本作卡面那件。
       *   两者是**并列叠加**的(源先放玩家点的那件, 再追加保底件); 同一 key 出现两次**不合并**。
       *   因此 `weapon` 的语义 = **卡面展示的那一件 = 开局必定在武器栏里的那一件**:
       *     有 startWeapons(保底) ⇒ weapon = startWeapons[0];
       *     否则(只有池/单件)   ⇒ weapon = weaponPool[0] 或唯一那件。
       *   「卡面写死一件、开局给另一件」这类骗人从此在数据层就不成立(门禁 56 号当场对拍)。 */
      {
        id: 'engineer', name: '螺丝椒', weapon: 'wrench_t1',
        /* 保底起手武器: 源 items/characters/engineer/engineer_effect_2.tres
         *   key="weapon_wrench_1" · custom_key="starting_weapon" · value=1。
         *   于是螺丝椒开局 = 玩家在池里点的那件 **+** 这把保底扳手; 若点的是扳手就是**两把扳手**(源同样如此, 不合并)。
         *   weapon = 保底件 = 卡面那件, 与源角色面板的口径一致。 */
        startWeapons: ['wrench_t1'],
        weaponPool: ['wrench_t1', 'screwdriver_t1', 'plank_t1', 'hammer_t2'],
        desc: '菜园军里修水车的工兵椒，腰间别着一把长柄扳手。搭起来的家伙最狠，别的本事平平。',
        hp: 10, mods: { engDmg: 10 },
        gain: [
          { ch: ['engDmg'], v: 25, label: '结构伤害' },
          { ch: ['dmgPct', 'meleeDmg', 'rangedDmg', 'eleDmg'], v: -50, label: '伤害' }
        ],
        unlock: { type: 'wave', v: 12, text: '单局抵达第 12 波' }, color: '#9aa83c'
      },
      {
        id: 'apprentice', name: '学徒葱', weapon: 'fist_t1',
        /* 候选池 **22 件**, 逐条照抄源的 startingWeapons(顺序也照源, 不许重排):
         *   机器可读 ref/source-characters.json 的 characters[0].startingWeapons ·
         *   人读 ref/source-stats.md 的「apprentice（22）」那一行 ·
         *   源文件 items/characters/apprentice/apprentice_data.tres。
         * v7.4(2026-09-30 修用户报「学徒葱开局初始武器每次都不一样」): 这里原先是**手挑的 12 件**,
         *   少了 ghost_flint / ghost_axe / plank / screwdriver / wrench / medical_gun /
         *   double_barrel_shotgun / icicle / shuriken / ghost_scepter 十件 —— 池子被截断, 于是
         *   「开局可选哪把」与源不一致。engineer 那 4 件与源完全一致, 无需动。
         * weapon(第一项) = 池里第一件 = 卡面展示的那一件 = **不选时的默认**, 三者必须永远是同一个。 */
        weaponPool: ['fist_t1', 'knife_t1', 'lightning_shiv_t1', 'cactus_mace_t1', 'fighting_stick_t1',
          'ghost_flint_t1', 'ghost_axe_t1', 'hatchet_t1', 'torch_t1', 'plank_t1', 'pruner_t1',
          'screwdriver_t1', 'wrench_t1', 'medical_gun_t1', 'smg_t1', 'double_barrel_shotgun_t1',
          'shredder_t1', 'slingshot_t1', 'taser_t1', 'icicle_t1', 'shuriken_t1', 'ghost_scepter_t1'],
        desc: '刚下田的学徒葱，什么兵器都摸一遍。每升一级，四样伤害各长一点，身板也更脆。',
        hp: 10, mods: {},
        /* 源 stats_on_level_up: 每级 add_stat（main.gd:872-875），非技能触发 ⇒ 由 stats.js 的
         *   applyPerLevel 按 levelups.length 乘出来，不走 PS.ItemTriggers 的触发账。 */
        perLevel: { meleeDmg: 2, rangedDmg: 1, eleDmg: 1, engDmg: 1, maxHp: -2 },
        unlock: { type: 'kills', v: 1500, text: '累计击杀 1500' }, color: '#6fd0d8'
      },
      {
        id: 'cyborg', name: '铁皮冬瓜', weapon: 'minigun_t3',
        /* v7.5(修「铁皮冬瓜只移植了一半」): 源里这个角色有**两件东西**, 本作原先只抄了第一件。
         *   ① 保底起手武器 —— items/characters/cyborg/cyborg_effect_0b.tres
         *      key="weapon_minigun_3" · custom_key="starting_weapon" · value=1。
         *      源的角色面板(character_panel_ui.gd:174-191)展示的就是它 ⇒ **卡面那件 = 多管速射铳 III**, 开局必在武器栏里。
         *   ② 候选池 **8 件** —— 源 items/characters/cyborg/cyborg_data.tres 的 starting_weapons, 顺序逐条照抄:
         *      wrench_1 / screwdriver_1 / plank_1 / pistol_1 / smg_1 / revolver_1 /
         *      double_barrel_shotgun_1 / crossbow_1。
         *      源 UI 展示前会过 item_service.gd:1013 get_ordered_starting_weapons(近战全部在前、远程在后),
         *      而上面这个书写顺序**本来就满足**该规则 ⇒ 照抄即可, 不许重排。
         *      机器可读对照: ref/source-characters.json 里 dir='cyborg' 的 startingWeapons / effects。
         *   ① 是保底、② 是玩家额外点的**一件**, 两者并列叠加(源 run_data.gd:1551 的 add_weapon)。
         *   ⓵ 池里前 3 件是近战, 而本角色 gain 把 meleeDmg 归零(见下 gain) ⇒ 若照「池首 = 默认」的老口径,
         *      不碰选择器直接出发就会拿一把**对它永远不长的近战**(v7.6 修)。现行默认档 = pistol_t1,
         *      由 PS.Characters.defaultStartKey 现算(池的顺序仍**逐条照源不许重排**, 只有默认落点位移)。 */
        startWeapons: ['minigun_t3'],
        weaponPool: ['wrench_t1', 'screwdriver_t1', 'plank_t1', 'pistol_t1', 'smg_t1',
          'revolver_t1', 'double_barrel_shotgun_t1', 'crossbow_t1'],
        desc: '半边身子换成零件的铁皮冬瓜。波次打到一半，远程本事全兑换成结构伤害。',
        hp: 10, mods: {},
        gain: [
          { ch: ['rangedDmg'], v: 200, label: '远程伤害' },
          { ch: ['engDmg'], v: -75, label: '结构伤害' },
          { ch: ['meleeDmg', 'eleDmg'], v: -100, label: '近战/元素伤害' }
        ],
        convert: { from: 'rangedDmg', to: 'engDmg', pct: 100, val: 2 },
        convertDesc: '波次过半 远程伤害 → 双倍结构伤害',
        unlock: { type: 'endless10', v: 15, text: '无尽模式抵达第 15 波' }, color: '#91a1b6'
      },
      /* ==================== v6.2(Codex, 2026-09-29): 再补 9 名, 凑 20 ====================
       * 用户逐字「现在加完之后角色一共11名，不多不少，直接再加9名你觉得有特色的角色进来，凑个整数」。
       * 选人标准只有两条: ① 每人必须有**一条别人没有的机制位**; ② 那条机制在本引擎里必须有真实消费点
       *   (卡面不许写做不到的事 —— 与 engineer 的 group_structures 留白同一纪律)。
       * 逐条对应(通道 → 消费点, 都能在 src/ 里 grep 到, 不是文案):
       *   chili       伤害**收益乘区**(gain)        → stats.js applyGainPct → combat.js:89-94 四条伤害通道
       *   onion       每级护甲(perLevel)            → stats.js applyPerLevel → combat.js 承伤系数
       *   lotus       弹射 / 穿透                  → combat.js:245(写入弹体) / :302-313(暴击弹射)
       *   mushroom    元素伤害(eleDmg)             → combat.js:92 `if (def.elem) flat += stats.eleDmg`
       *   beansprout  经验 / 拾取                  → game.js:1127(xpPct) / :1085(pickup)
       *   bittermelon 敌人减速 + 敌人变肉           → game.js:786(enemySpdPct) / :777(enemyHpPct)
       *   sugarcane   果实回复 / 掉落 / 商店折扣    → game.js:1099 / :1056 / :1356
       *   loofah      击退乘区 + 固定击退           → combat.js:123 `knockTotal = (knock + knockback) * knockMul`
       *   greenbean   半波近战→远程转换(convert)    → stats.js applyConvert, 触发点 game.js condCtx().halfWave
       * 数值口径: hp 沿用源刻度(基准 10)。强度一律以**换**的形式给出 —— 每个大加成旁边都有一条真实代价,
       *   不做纯强角色(chili 血 -40% / lotus 近战 -2 / bittermelon 敌人 +25% 血 / beansprout 血 -20%)。
       * 9 人一律不写 passive: 卡面特性区只有 4 行(2 列 × 2 行), 机制行已占满, 再加一行会被静默截掉。 */
      {
        id: 'chili', name: '朝天椒', weapon: 'torch_t1',
        desc: '田里最辣的一角。越辣伤害越高，代价是几乎不经打。',
        hp: 10, mods: { dmgPct: 15, maxHpPct: -40, speedPct: 10 },
        gain: [{ ch: ['dmgPct', 'meleeDmg', 'rangedDmg', 'eleDmg'], v: 40, label: '伤害' }],
        unlock: null, color: '#d4222c'
      },
      {
        id: 'onion', name: '洋葱', weapon: 'spiky_shield_t1',
        desc: '一层包一层，每升一级再厚一层。走得慢，但很难被啃穿。',
        hp: 12, mods: { armor: 3, speedPct: -8 },
        perLevel: { armor: 0.5 },
        unlock: null, color: '#bf87ae'
      },
      {
        id: 'lotus', name: '莲藕', weapon: 'shuriken_t1',
        desc: '藕断丝连：打出去的弹道总要多绕一圈，近身却很吃亏。',
        hp: 9, mods: { bounce: 1, pierceBonus: 1, rangedDmg: 2, meleeDmg: -2 },
        unlock: { type: 'kills', v: 600, text: '累计击杀 600' }, color: '#e2c9a4'
      },
      {
        id: 'mushroom', name: '蘑菇', weapon: 'ghost_flint_t1',
        desc: '长在菜园背阴角的菌菇。孢子落在谁身上，谁就遭雷。',
        hp: 10, mods: { eleDmg: 6, maxHpPct: -10, speedPct: -4 },
        unlock: null, color: '#a08cc8'
      },
      {
        id: 'beansprout', name: '豆芽', weapon: 'fighting_stick_t1',
        desc: '一夜就能蹿起来的新芽：长得快、捡得多，就是命薄。',
        hp: 9, mods: { xpPct: 30, pickup: 25, maxHpPct: -20 },
        unlock: { type: 'kills', v: 300, text: '累计击杀 300' }, color: '#cfe08a'
      },
      {
        id: 'bittermelon', name: '苦瓜', weapon: 'rock_t1',
        desc: '苦味散得满田都是：怪走得慢了，但也被养得更壮。',
        hp: 10, mods: { enemySpdPct: -18, enemyHpPct: 25, harvest: 6 },
        unlock: { type: 'wave', v: 10, text: '单局抵达第 10 波' }, color: '#b4c87f'
      },
      {
        id: 'sugarcane', name: '甘蔗', weapon: 'hatchet_t1',
        desc: '田里的甜杆。果实回得更多、掉得更勤，连商店都便宜些。',
        hp: 11, mods: { consumableHeal: 3, fruitDrops: 25, shopPricePct: -10, speedPct: -5 },
        unlock: null, color: '#c4b083'
      },
      {
        id: 'loofah', name: '丝瓜', weapon: 'claw_t1',
        desc: '老丝瓜晒干就是刷锅的那根。一帚下去，怪全被扫开。',
        hp: 11, mods: { knockPct: 45, knockback: 4, meleeDmg: 2, dodge: -3 },
        unlock: { type: 'endless10', v: 5, text: '无尽模式抵达第 5 波' }, color: '#b7cf8a'
      },
      {
        id: 'greenbean', name: '豆角', weapon: 'slingshot_t1',
        desc: '半场静养、半场爆发：波次过半，近战本事全换成远程。',
        hp: 9, mods: { meleeDmg: 5, atkSpd: 6 },
        convert: { from: 'meleeDmg', to: 'rangedDmg', pct: 100, val: 2 },
        convertDesc: '波次过半 近战伤害 → 双倍远程伤害',
        unlock: { type: 'kills', v: 2500, text: '累计击杀 2500' }, color: '#96c482'
      }
    ],
    isUnlocked: function (ch, save) {
      if (!ch.unlock) return true;
      var s = save || {};
      switch (ch.unlock.type) {
        case 'wave': return (s.best || 0) >= ch.unlock.v;
        case 'win': return (s.wins || 0) >= ch.unlock.v;
        case 'kills': return (s.totalKills || 0) >= ch.unlock.v;
        case 'endless10': return !!(s.endlessBest && s.endlessBest >= ch.unlock.v);
        default: return true;
      }
    },
    /* ================= v7.6(2026-09-30): 「默认档」—— 不碰选择器时实际到手的那一件 =================
     * 源证据: ui/menus/run/weapon_selection.gd **没有默认值** —— _on_element_pressed 取玩家按中的那一格,
     *   _on_element_focused 还会把 _player_weapons[i] 清成 null; 也就是说源要求玩家**必须自己点一件**。
     *   本作把那个界面收窄成选人页底栏一条选择器, 于是「玩家不碰它时给哪一件」是本作自己定的收窄设计,
     *   不是源的概念 ⇒ 可以按本作的引擎事实改进。
     * 规则(唯一真源: core 的兜底档与 ui 的默认档共用这三个函数, 不许各自再写一份):
     *   默认档 = 池里**第一件主伤害通道没被本角色自己的收益修正归零**的武器; 全被归零才回落池首。
     * 为什么: stats.js 的 applyGainPct(381-399) 把角色 gain 的百分数当**乘区**乘到通道上 —— gain -100%
     *   的那条通道恒等于 0, 而近战/远程伤害在本作是**固定值词条**(combat.js:113-117 的 flat 项), 于是该通道
     *   整局攒不出收益 ⇒ 让这样的角色默认拿一把吃该通道的武器 = 给他一个永远不长的格子(铁皮冬瓜: 近战/元素 -100%)。
     * 影响面(现算, 不是估计): 20 名角色里只有 cyborg 有一条 gain ≤ -100%, 且只有它的池首是近战 ⇒ 只有它位移
     *   (wrench_t1 → pistol_t1); 另两名有池的 engineer/apprentice 默认档不动。 */
    zeroChannels: function (ch) {
      var m = {}, out = [], i, j, e, k;
      var gain = (ch && ch.gain) || [];
      for (i = 0; i < gain.length; i++) {
        e = gain[i];
        for (j = 0; j < e.ch.length; j++) m[e.ch[j]] = (m[e.ch[j]] || 0) + e.v;
      }
      for (k in m) if (m[k] <= -100) out.push(k);
      return out;
    },
    startUsableKey: function (ch, key) {
      var W = (PS.WeaponData && PS.WeaponData.list) || {};
      var d = W[key];
      if (!d) return false;                                  /* 数据表里没有 => 算不上可用 */
      var pri = (d.cls === 'melee') ? 'meleeDmg' : 'rangedDmg';
      return this.zeroChannels(ch).indexOf(pri) < 0;
    },
    defaultStartIdx: function (ch) {
      var pool = (ch && ch.weaponPool) || [];
      if (!pool.length) return -1;                           /* 无池角色: 只有声明的那一件 */
      for (var i = 0; i < pool.length; i++) if (this.startUsableKey(ch, pool[i])) return i;
      return 0;                                              /* 全都被归零: 回落池首(仍照源顺序) */
    },
    defaultStartKey: function (ch) {
      var i = this.defaultStartIdx(ch);
      return (i < 0) ? ((ch && ch.weapon) || null) : ch.weaponPool[i];
    }
  };
})(typeof GameGlobal !== 'undefined' ? GameGlobal : (typeof window !== 'undefined' ? window : globalThis));
