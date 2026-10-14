/* PS.ItemData v3.0 —— 道具 199 件（全部来自反编译源 extract-items.json 的 1:1 数值移植）
 * 由 tools/port-source.cjs 生成 —— 请勿手改数值；改源数据/映射表后重跑生成器。
 * 口径: qa/v3-port-spec.md §3.4 · 决定表: qa/v3-item-map.md（权威） · 台账: qa/source-port-items.md
 * 源 199 行 = 实体移植 199 件 + 丢弃 0 行（词条不可映射 0 + 源快照 null 空行 0）—— 没有静默丢弃。
 * 决定表 qa/v3-item-map.md §2 的"保留 136" = 实体 134 + null 空行 2（null 行没有 tier/value/effects → 生成不出实体）。
 * 词条 1:1: 源 key → 本作 mods key 的映射表见 qa/v3-item-map.md §1（29 条），负数原样保留。
 * **勘误（2026-09-24, 移植语义事故 F —— 生成器已同步, 全表按源永久词条重算）**:
 *   源 effect 的语义由 `custom_key` + `storage_method` 一起决定: **custom_key == "" 且 storage_method == 0(SUM)**
 *   才是「无条件、永久」的词条; 其余（custom_key 非空）是**条件/触发/临时**效果, 由 ref 的 `effects/items/*.gd`
 *   脚本接管（dmg_on_dodge / heal_on_dodge / temp_stats_while_not_moving / temp_stats_on_hit /
 *   temp_stats_per_interval / stats_end_of_wave / stats_next_wave / stats_on_level_up / weapon_scaling_stats /
 *   unique_weapon_effects / enemy_percent_damage_taken / consumable_stats_while_max / …）—— **它们不进属性面板**。
 *   旧表把 `effects` 全部无条件求和 ⇒ riposte 的「闪避时造成一次 300 伤害」被当成永久 meleeDmg +302
 *   （源永久部分只有 +2, 差 151 倍）; 另有 improved_tools 60→10 · chameleon 23→3 · medikit 12→10 ·
 *   nail 25→5 · spider/statue/will_o_the_wisp 整条条件词条被多算 · triangle_of_power 18→20 · wisdom -10→-15。
 *   现按**源永久部分**重算: 23 件受影响 —— (A) 12 件只保留永久词条; (B) 11 件源里零永久词条 ⇒ `mods: {}`
 *   + `pool: false` **不上架**（本作未实现其触发机制, 不许编数值）。
 *   判定与门禁: tools/parity-source.cjs 的 isPermanentEffect（含 484 个 .tres 的核对证据）;
 *   逐行台账: qa/source-port-items.md §7。
 * ✅ 生成器 tools/port-source.cjs 的这一口径**已同步**（buildItems 只累加 custom === ""）——
 *   本表即重跑生成器的产物; `node tools/port-source.cjs --check` 已注册为门禁（6 个文件逐字节一致）。
 * mods 键名与 PS.Stats 的通道逐字一致（meleeDmg/rangedDmg/eleDmg/engDmg 是**固定值**, 不是 %; rangeFlat/knockback/xpPct/shopPricePct/
 *   freeRerolls/harvestingGrowth/dmgVsBossPct/enemySpdPct/dodgeCap/hpCapCurrent/speedCapCurrent/bounce/pierceBonus 由 Hume 提供）。
 * hp_cap/speed_cap → hpCapCurrent/speedCapCurrent: 源 value=0 是占位（语义是"锁死在取得那一刻的当前值", 无幅度）
 *   → 本作落成**标记位 1**, desc 里以短语呈现（"最大生命值锁定为当前值" / "移速锁定为当前值"）, 尾巴以「…」收尾。
 *   ⚠ dodge_cap(ghost_outfit=70) 是**绝对值**上限覆盖 → 通道名保持 dodgeCap。
 * 新增字段: price(源 value, 售价事实) · src(源 key, 供 parity 门禁逐行核对) —— 消费方见台账 §5。
 * 名称/描述全原创（蔬菜/菜园主题）；描述里的数字由 mods 现算, 不允许手写。
 */
(function (global) {
  'use strict';
  var PS = global.PS || {};
  var D = PS.ItemData = {
    list: [
      /* ---------- rarity 1（源 tier 0）×55 ---------- */
      { id: 'alien_tongue', src: 'alien_tongue', name: '卷舌苗', rarity: 1, color: '#a8c0d8', desc: '伸得老长，捋得动石头。拾取 +30，击退 +1', mods: { pickup: 30, knockback: 1 }, price: 25 },
      { id: 'alien_worm', src: 'alien_worm', name: '地龙萝卜', rarity: 1, color: '#c8c8b0', desc: '根里盘着一条肥虫，伤口合得快，果子吃不干净。生命上限 +3，生命恢复 +2，果实回复 -1', mods: { maxHp: 3, regen: 2, consumableHeal: -1 }, price: 15 },
      { id: 'baby_elephant', src: 'baby_elephant', name: '小象草', rarity: 1, color: '#d8a24a', desc: '鼻子一翘就有好运。拾起余料时，凭运气替你补上一记。…', mods: {}, trig: [{ fam: 'dmg_when_pickup_gold', ch: 'luck', pct: 25, chance: 25 }], price: 22 },
      { id: 'baby_gecko', src: 'baby_gecko', name: '壁虎崽子', rarity: 1, color: '#a8c0d8', desc: '尾巴一甩，土里的材料自己往身上贴。材料吸附 +25%，射程 +10', mods: { rangeFlat: 10, goldAttractPct: 25 }, price: 18 },
/* 不上架（pool:false）: （无拦路者 —— 数据异常）；而本作能算出来的部分里一条正收益都没有 ⇒ 不发值、标 pool:false 不上架。判定见 tools/parity-source.cjs 的 pool 断言与台账 §7.3。 */
            { id: 'bag', src: 'bag', name: '拾荒布兜', rarity: 1, color: '#a8c0d8', desc: '翻箱子时多扒出几份，走路沉一点。开箱材料 +15，移速 -1%，…', mods: { speedPct: -1, crateGold: 15 }, price: 15, pool: false },
      { id: 'bat', src: 'bat', name: '夜蝠藤', rarity: 1, color: '#c8b06a', desc: '夜里吸血，白天偷收成。吸血 +2，采集 -2', mods: { lifesteal: 2, harvest: -2 }, price: 20 },
      { id: 'beanie', src: 'beanie', name: '毛线兜帽', rarity: 1, color: '#a8c0d8', desc: '跑得快，手短一截。射程 -6，移速 +4%', mods: { rangeFlat: -6, speedPct: 4 }, price: 20 },
      { id: 'boiling_water', src: 'boiling_water', name: '滚水壶', rarity: 1, color: '#a8c0d8', desc: '烫得草药冒泡，自己脱水。元素伤害 +2，生命上限 -1', mods: { maxHp: -1, eleDmg: 2 }, price: 30 },
      { id: 'book', src: 'book', name: '农书残页', rarity: 1, color: '#c8b06a', desc: '照着书搭架子。结构伤害 +2，运气 -1，元素伤害 +1', mods: { luck: -1, eleDmg: 1, engDmg: 2 }, price: 15 },
      { id: 'boxing_glove', src: 'boxing_glove', name: '拳套', rarity: 1, color: '#c8b06a', desc: '一拳把人推开。击退 +3，近战伤害 +1', mods: { meleeDmg: 1, knockback: 3 }, price: 18 },
      { id: 'broken_mouth', src: 'broken_mouth', name: '豁口陶罐', rarity: 1, color: '#c8b06a', desc: '能装得多，漏得也快。生命上限 +5，生命恢复 -1', mods: { maxHp: 5, regen: -1 }, price: 25 },
      { id: 'butterfly', src: 'butterfly', name: '菜粉蝶', rarity: 1, color: '#c8b06a', desc: '一沾就吸血，怕冷。吸血 +2，元素伤害 -1', mods: { lifesteal: 2, eleDmg: -1 }, price: 30 },
      { id: 'cake', src: 'cake', name: '胡萝卜糕', rarity: 1, color: '#a8c0d8', desc: '吃饱了长肉，手软一点。生命上限 +3，伤害 -1%', mods: { maxHp: 3, dmgPct: -1 }, price: 15 },
      { id: 'charcoal', src: 'charcoal', name: '炭渣', rarity: 1, color: '#c8c8b0', desc: '火气足，蹭脏了收成。近战伤害 +2，采集 -2，元素伤害 +1', mods: { meleeDmg: 2, harvest: -2, eleDmg: 1 }, price: 20 },
      { id: 'claw_tree', src: 'claw_tree', name: '钩爪枝', rarity: 1, color: '#d8a24a', desc: '专挑要害，扎手。暴击率 +3%，生命上限 -1，近战伤害 +1', mods: { maxHp: -1, crit: 3, meleeDmg: 1 }, price: 20 },
      { id: 'coffee', src: 'coffee', name: '浓煮豆汁', rarity: 1, color: '#a8c0d8', desc: '手快，力气虚。攻速 +10%，伤害 -2%', mods: { dmgPct: -2, atkSpd: 10 }, price: 20 },
      { id: 'coupon', src: 'coupon', name: '菜场劵', rarity: 1, color: '#d8a24a', desc: '摊位前掏出来就便宜。商店价格 -5%', mods: { shopPricePct: -5 }, price: 15 },
      { id: 'cute_monkey', src: 'cute_monkey', name: '机灵猴', rarity: 1, color: '#c8c8b0', desc: '抢到一点零碎，就替你舔一口伤。拾金回血 +8%，远程伤害 -1', mods: { rangedDmg: -1, healOnGoldPct: 8 }, price: 25 },
      { id: 'defective_steroids', src: 'defective_steroids', name: '劣质营养剂', rarity: 1, color: '#c8c8b0', desc: '长肉长劲，手却钝。攻速 -3%，生命上限 +2，近战伤害 +2', mods: { maxHp: 2, meleeDmg: 2, atkSpd: -3 }, price: 20 },
      { id: 'duct_tape', src: 'duct_tape', name: '胶布卷', rarity: 1, color: '#c8c8b0', desc: '缠哪补哪，人薄一层。生命上限 -2，护甲 +1，结构伤害 +1', mods: { maxHp: -2, armor: 1, engDmg: 1 }, price: 20 },
      { id: 'dynamite', src: 'dynamite', name: '硝化萝卜', rarity: 1, color: '#c8c8b0', desc: '炸得开，全靠这口辛辣。爆炸伤害 +15%', mods: { explodeDmgPct: 15 }, price: 20 },
      { id: 'fertilizer', src: 'fertilizer', name: '陈年肥', rarity: 1, color: '#d8a24a', desc: '催收成，手滑一点。采集 +8，近战伤害 -1', mods: { meleeDmg: -1, harvest: 8 }, price: 15 },
      { id: 'fresh_meat', src: 'fresh_meat', name: '鲜肉片', rarity: 1, color: '#d8a24a', desc: '咬得动就回血，伤口慢。吸血 +2，生命恢复 -1', mods: { regen: -1, lifesteal: 2 }, price: 25 },
      { id: 'gentle_alien', src: 'gentle_alien', name: '温驯异种', rarity: 1, color: '#c8b06a', desc: '冲你笑，也把同类都招呼过来。伤害 +5%，敌人数量 +5%，生命上限 +2', mods: { maxHp: 2, dmgPct: 5, enemyCountPct: 5 }, price: 30 },
      { id: 'glasses', src: 'glasses', name: '老花镜', rarity: 1, color: '#d8a24a', desc: '看得更远。射程 +20', mods: { rangeFlat: 20 }, price: 20 },
      { id: 'goat_skull', src: 'goat_skull', name: '羊头骨', rarity: 1, color: '#c8b06a', desc: '近战利器，挑不准要害。近战伤害 +3，暴击率 -2%', mods: { crit: -2, meleeDmg: 3 }, price: 25 },
      { id: 'gummy_berserker', src: 'gummy_berserker', name: '软糖狂徒', rarity: 1, color: '#c8b06a', desc: '手快看得远，皮薄。射程 +25，攻速 +5%，护甲 -1', mods: { armor: -1, rangeFlat: 25, atkSpd: 5 }, price: 25 },
      { id: 'head_injury', src: 'head_injury', name: '脑门旧伤', rarity: 1, color: '#d8a24a', desc: '下手更狠，看得近。射程 -8，伤害 +6%', mods: { rangeFlat: -8, dmgPct: 6 }, price: 25 },
      { id: 'hedgehog', src: 'hedgehog', name: '刺猬', rarity: 1, color: '#c8b06a', desc: '一身刺，止不住血。近战伤害 +2，生命恢复 -1，远程伤害 +1', mods: { regen: -1, meleeDmg: 2, rangedDmg: 1 }, price: 30 },
      { id: 'helmet', src: 'helmet', name: '铁皮帽', rarity: 1, color: '#c8b06a', desc: '结实，就是压头。移速 -2%，护甲 +1', mods: { armor: 1, speedPct: -2 }, price: 15 },
      { id: 'injection', src: 'injection', name: '针剂', rarity: 1, color: '#c8c8b0', desc: '一针下去很狠，身板更薄。伤害 +7%，生命上限 -2', mods: { maxHp: -2, dmgPct: 7 }, price: 20 },
      { id: 'insanity', src: 'insanity', name: '疯长剂', rarity: 1, color: '#c8b06a', desc: '专挑要害，力气散。暴击率 +6%，伤害 -3%', mods: { crit: 6, dmgPct: -3 }, price: 20 },
/* 不上架（pool:false）: `unique_weapon_effects`（武器侧机制, 要改 src/data/weapons.js（不在本轮写权内））；而本作能算出来的部分里一条正收益都没有 ⇒ 不发值、标 pool:false 不上架。判定见 tools/parity-source.cjs 的 pool 断言与台账 §7.3。 */
            { id: 'jelly', src: 'jelly', name: '果冻块', rarity: 1, color: '#d8a24a', desc: '软软一块，垫命。…', mods: {}, price: 15, pool: false },
      { id: 'landmines', src: 'landmines', name: '播种地雷', rarity: 1, color: '#c8b06a', desc: '一路走一路埋，踩上就炸。地雷 +1', mods: { structLandmines: 1 }, price: 15 },
      { id: 'lemonade', src: 'lemonade', name: '酸柠汽水', rarity: 1, color: '#c8b06a', desc: '一口透心凉，连果子都多顶一点。果实回复 +1', mods: { consumableHeal: 1 }, price: 15 },
      { id: 'lens', src: 'lens', name: '单片镜', rarity: 1, color: '#a8c0d8', desc: '远处瞄准，看得近些。射程 -5，远程伤害 +1', mods: { rangeFlat: -5, rangedDmg: 1 }, price: 20 },
      { id: 'lost_duck', src: 'lost_duck', name: '走失小鸭', rarity: 1, color: '#a8c0d8', desc: '带来好运，怕冷。运气 +8，元素伤害 -1', mods: { luck: 8, eleDmg: -1 }, price: 25 },
      { id: 'lumberjack_shirt', src: 'lumberjack_shirt', name: '伐木背心', rarity: 1, color: '#c8c8b0', desc: '顺手一劈，树苗一碰就倒。一触即倒 +1', mods: { oneShotTrees: 1 }, price: 15 },
      { id: 'mushroom', src: 'mushroom', name: '伞菇', rarity: 1, color: '#d8a24a', desc: '愈合快，运气背。生命恢复 +3，运气 -2', mods: { regen: 3, luck: -2 }, price: 25 },
      { id: 'mutation', src: 'mutation', name: '变异芽', rarity: 1, color: '#c8c8b0', desc: '元素和远程都长一点，推不动人。击退 -3，远程伤害 +1，元素伤害 +1', mods: { rangedDmg: 1, knockback: -3, eleDmg: 1 }, price: 25 },
      { id: 'peaceful_bee', src: 'peaceful_bee', name: '温顺土蜂', rarity: 1, color: '#d8a24a', desc: '会闪会收，力气小。闪避 +4%，采集 +4，近战伤害 -1，…', mods: { dodge: 4, meleeDmg: -1, rangedDmg: -1, harvest: 4 }, price: 18 },
      { id: 'pencil', src: 'pencil', name: '铅笔头', rarity: 1, color: '#c8b06a', desc: '画得架子稳，手慢眼钝。结构伤害 +1', mods: { engDmg: 1 }, price: 8 },
      { id: 'plant', src: 'plant', name: '盆栽', rarity: 1, color: '#c8c8b0', desc: '自愈飞快，吸不动。生命恢复 +3，吸血 -1', mods: { regen: 3, lifesteal: -1 }, price: 15 },
      { id: 'propeller_hat', src: 'propeller_hat', name: '竹蜻蜓帽', rarity: 1, color: '#c8c8b0', desc: '转出好运，力气飘。运气 +10，伤害 -2%', mods: { dmgPct: -2, luck: 10 }, price: 28 },
      { id: 'scar', src: 'scar', name: '旧疤', rarity: 1, color: '#c8b06a', desc: '学得快，看得近。经验 +20%，射程 -8', mods: { rangeFlat: -8, xpPct: 20 }, price: 25 },
      { id: 'scared_sausage', src: 'scared_sausage', name: '胆怯香肠', rarity: 1, color: '#a8c0d8', desc: '点着了就烧起来。燃烧几率 +25%，燃烧持续 +3，燃烧伤害 +1，…', mods: { burnChancePct: 25, burnDmg: 1, burnDur: 3, burnSpread: 1, burnScalePct: 100 }, price: 25 },
      { id: 'sharp_bullet', src: 'sharp_bullet', name: '尖头弹豆', rarity: 1, color: '#c8b06a', desc: '钻得深，钻不狠。穿透伤害 -20%，伤害 -5%，击退 -3，…', mods: { dmgPct: -5, knockback: -3, pierceBonus: 1, pierceDmgPct: -20 }, price: 25 },
      { id: 'snake', src: 'snake', name: '蛇形豆荚', rarity: 1, color: '#d8a24a', desc: '火苗会顺着荚爬到旁边。生命上限 -1，燃烧扩散 +1', mods: { maxHp: -1, burnSpread: 1 }, price: 25 },
      { id: 'terrified_onion', src: 'terrified_onion', name: '受惊洋葱', rarity: 1, color: '#d8a24a', desc: '辣得直窜，运气差。运气 -5，移速 +4%', mods: { speedPct: 4, luck: -5 }, price: 15 },
      { id: 'toxic_sludge', src: 'toxic_sludge', name: '毒泥浆', rarity: 1, color: '#d8a24a', desc: '元素更毒，身法变笨。闪避 -2%，元素伤害 +2', mods: { dodge: -2, eleDmg: 2 }, price: 20 },
      { id: 'tree', src: 'tree', name: '速生树苗', rarity: 1, color: '#a8c0d8', desc: '开波时地里冒出几棵。树苗 +1', mods: { trees: 1 }, price: 15 },
      { id: 'turret', src: 'turret', name: '哨戒炮座', rarity: 1, color: '#d8a24a', desc: '立在场上自己开火。哨戒炮 +1', mods: { structTurret: 1 }, price: 15 },
      { id: 'ugly_tooth', src: 'ugly_tooth', name: '歪牙', rarity: 1, color: '#d8a24a', desc: '咬住就拖慢它，最多拖到底。减速上限 +20，命中减速 +5，移速 -3%', mods: { speedPct: -3, slowOnHit: 5, slowOnHitMax: 20 }, price: 25 },
      { id: 'weird_food', src: 'weird_food', name: '怪味罐头', rarity: 1, color: '#d8a24a', desc: '闻着不对吃着上瘾，腿脚发软。闪避 -2%，果实回复 +2', mods: { dodge: -2, consumableHeal: 2 }, price: 20 },
      { id: 'weird_ghost', src: 'weird_ghost', name: '游魂灯笼', rarity: 1, color: '#c8c8b0', desc: '灯把命吊住，下一波却要从头捱。下波生命 -100%，生命上限 +3', mods: { maxHp: 3, hpStartNextWavePct: -100 }, price: 12 },
      /* ---------- rarity 2（源 tier 1）×55 ---------- */
      { id: 'acid', src: 'acid', name: '酸渍薯皮', rarity: 2, color: '#7ed08a', desc: '泡得发亮，硬得发涩。生命上限 +8，闪避 -2%，击退 -2', mods: { maxHp: 8, dodge: -2, knockback: -2 }, price: 65 },
      { id: 'alien_eyes', src: 'alien_eyes', name: '眼豆荚', rarity: 2, color: '#6ec8b0', desc: '荚里一排眼睛，替你盯着四周。环身眼豆 +6', mods: { eyes: 6 }, price: 50 },
      { id: 'bait', src: 'bait', name: '诱虫饵', rarity: 2, color: '#8fd66b', desc: '撒下去，下一波闻着味儿来的更多。伤害 +8%，下波额外敌人 +1', mods: { dmgPct: 8, extraEnemiesNextWave: 1 }, price: 25 },
      { id: 'banner', src: 'banner', name: '旗杆', rarity: 2, color: '#6ec8b0', desc: '站得高看得远，推不动人。射程 +20，攻速 +10%，击退 -5', mods: { rangeFlat: 20, atkSpd: 10, knockback: -5 }, price: 55 },
      { id: 'black_belt', src: 'black_belt', name: '黑腰带', rarity: 2, color: '#7ed08a', desc: '练出近战和见识，运气走光。经验 +25%，运气 -8，近战伤害 +3，…', mods: { meleeDmg: 3, luck: -8, knockback: 3, xpPct: 25 }, price: 50 },
      { id: 'blindfold', src: 'blindfold', name: '蒙眼布', rarity: 2, color: '#6ec8b0', desc: '凭感觉准，看不见远处。射程 -15，闪避 +5%，暴击率 +5%', mods: { dodge: 5, crit: 5, rangeFlat: -15 }, price: 45 },
      { id: 'blood_leech', src: 'blood_leech', name: '吸血蛭', rarity: 2, color: '#8fd66b', desc: '边打边回，收成被吸走。采集 -3，生命恢复 +2，吸血 +2', mods: { regen: 2, lifesteal: 2, harvest: -3 }, price: 45 },
      { id: 'campfire', src: 'campfire', name: '篝火堆', rarity: 2, color: '#7ed08a', desc: '暖和回血，抱着走不快。生命恢复 +2，移速 -2%，元素伤害 +2', mods: { regen: 2, speedPct: -2, eleDmg: 2, fogVisPct: 50 }, price: 40 },
      { id: 'celery_tea', src: 'celery_tea', name: '醒神芹菜茶', rarity: 2, color: '#9ad8a0', desc: '滚水一冲就清醒，脑子跑在手前面。每守住一波，杯底的碎叶替你攒下一分，随后的那一波也招来更结实的对手。…', mods: {}, trig: [{ fam: 'stats_end_of_wave', ch: 'xpPct', v: 5 }, { fam: 'stats_next_wave', ch: 'xpPct', v: 50 }, { fam: 'stats_next_wave', ch: 'enemyHpPct', v: 100 }], price: 35 },
      { id: 'clockwork_wasp', src: 'clockwork_wasp', name: '发条胡蜂', rarity: 2, color: '#9ad8a0', desc: '给架子上的家伙上紧发条。结构攻速 +10%，移速 +5%', mods: { speedPct: 5, structAtkSpdPct: 10 }, price: 45 },
      { id: 'cog', src: 'cog', name: '齿轮', rarity: 2, color: '#7ed08a', desc: '结构件转得欢，人没劲。伤害 -4%，结构伤害 +4，击退 +1', mods: { dmgPct: -4, knockback: 1, engDmg: 4 }, price: 35 },
      { id: 'compass', src: 'compass', name: '罗盘', rarity: 2, color: '#6ec8b0', desc: '跑得快搭得稳，瞄不准。移速 +5%，暴击率 -3%，结构伤害 +3', mods: { crit: -3, speedPct: 5, engDmg: 3 }, price: 40 },
/* 不上架（pool:false）: 触发家族 `dmg_when_death`（接线了, 但本作玩家死亡即终局 ⇒ 收益恒为 0）；而本作能算出来的部分里一条正收益都没有 ⇒ 不发值、标 pool:false 不上架。判定见 tools/parity-source.cjs 的 pool 断言与台账 §7.3。 */
            { id: 'cyberball', src: 'cyberball', name: '霓虹球', rarity: 2, color: '#6ec8b0', desc: '转起来运气爆棚。倒下的一瞬间，把最后一点运气甩向场上的敌人。…', mods: {}, trig: [{ fam: 'dmg_when_death', ch: 'luck', pct: 25, chance: 25 }], price: 30, pool: false },
      { id: 'cyclops_worm', src: 'cyclops_worm', name: '独眼虫', rarity: 2, color: '#7ed08a', desc: '又狠又近。射程 -12，伤害 +12%', mods: { rangeFlat: -12, dmgPct: 12 }, price: 45 },
      { id: 'dangerous_bunny', src: 'dangerous_bunny', name: '危险兔', rarity: 2, color: '#7ed08a', desc: '帮你免费换一次货。免费刷新 +1', mods: { freeRerolls: 1 }, price: 30 },
      { id: 'decomposing_flesh', src: 'decomposing_flesh', name: '腐叶泥', rarity: 2, color: '#7ed08a', desc: '吸一点命，人也烂一点。每当你变强一档，吸血更甚、血肉更薄。…', mods: {}, trig: [{ fam: 'stats_on_level_up', ch: 'lifesteal', v: 1 }, { fam: 'stats_on_level_up', ch: 'maxHp', v: -1 }], price: 30 },
      { id: 'energy_bracelet', src: 'energy_bracelet', name: '能量手环', rarity: 2, color: '#9ad8a0', desc: '电气十足，射术生疏。暴击率 +4%，远程伤害 -2，元素伤害 +2', mods: { crit: 4, rangedDmg: -2, eleDmg: 2 }, price: 55 },
      { id: 'eyes_surgery', src: 'eyes_surgery', name: '明目藕片', rarity: 2, color: '#6ec8b0', desc: '切薄了看火候更准，看远处差点。燃烧提速 +20%，射程 -10，元素伤害 +1', mods: { rangeFlat: -10, eleDmg: 1, burnCdPct: 20 }, price: 60 },
      { id: 'fruit_basket', src: 'fruit_basket', name: '果园提篮', rarity: 2, color: '#7ed08a', desc: '篮子里总有货，自己的伤口好得慢。生命恢复 -3，果实掉落 +1', mods: { regen: -3, fruitDrops: 1 }, price: 45 },
      { id: 'fuel_tank', src: 'fuel_tank', name: '燃料罐', rarity: 2, color: '#9ad8a0', desc: '元素旺盛，挥砍射术都松。元素伤害 +4，近战伤害 -1，远程伤害 -1', mods: { meleeDmg: -1, rangedDmg: -1, eleDmg: 4 }, price: 45 },
      { id: 'gambling_token', src: 'gambling_token', name: '赌运铜牌', rarity: 2, color: '#7ed08a', desc: '滑不留手，护甲打折。闪避 +8%，护甲 -1', mods: { armor: -1, dodge: 8 }, price: 50 },
      { id: 'garden', src: 'garden', name: '一畦菜圃', rarity: 2, color: '#7ed08a', desc: '隔一阵就送你一颗果子。菜圃 +1', mods: { structGarden: 1 }, price: 50 },
      { id: 'ice_cube', src: 'ice_cube', name: '冰晶块', rarity: 2, color: '#7ed08a', desc: '一冻一片。元素伤害命中后，冻住的敌人碎得更快。…', mods: {}, trig: [{ fam: 'enemy_percent_damage_taken', ch: 'eleDmg', pct: 10, dur: 3, maxStacks: 1, maxProcs: 1 }], price: 50 },
      { id: 'leather_vest', src: 'leather_vest', name: '皮马甲', rarity: 2, color: '#8fd66b', desc: '抗揍会躲，身板薄。闪避 +6%，生命上限 -3，护甲 +2', mods: { maxHp: -3, armor: 2, dodge: 6 }, price: 45 },
      { id: 'little_frog', src: 'little_frog', name: '小青蛙', rarity: 2, color: '#7ed08a', desc: '捡得远收得多，跳得笨。拾取 +20，采集 +10，闪避 -3%', mods: { dodge: -3, harvest: 10, pickup: 20 }, price: 45 },
      { id: 'little_muscley_dude', src: 'little_muscley_dude', name: '矮壮力士', rarity: 2, color: '#8fd66b', desc: '近战好血厚，手极短。射程 -15，生命上限 +5，近战伤害 +3', mods: { maxHp: 5, rangeFlat: -15, meleeDmg: 3 }, price: 50 },
      { id: 'lure', src: 'lure', name: '引路蜂蜡', rarity: 2, color: '#6ec8b0', desc: '跟着蜡味来的，还有额外的收货。生命恢复 +2，下波额外收货 +2', mods: { regen: 2, extraLootNextWave: 2 }, price: 34 },
      { id: 'mastery', src: 'mastery', name: '精通心得', rarity: 2, color: '#9ad8a0', desc: '近战专精，远程生疏。近战伤害 +6，远程伤害 -3', mods: { meleeDmg: 6, rangedDmg: -3 }, price: 55 },
      { id: 'medal', src: 'medal', name: '奖章', rarity: 2, color: '#7ed08a', desc: '样样都长，就是瞄不准。暴击率 -4%，生命上限 +3，移速 +3%，…', mods: { maxHp: 3, armor: 1, crit: -4, speedPct: 3, dmgPct: 3 }, price: 55 },
      { id: 'metal_detector', src: 'metal_detector', name: '探铁钎', rarity: 2, color: '#6ec8b0', desc: '戳一下，土里的零碎就成双。运气 +6，伤害 -5%，双倍材料 +5%，…', mods: { dmgPct: -5, luck: 6, engDmg: 2, doubleGoldPct: 5 }, price: 40 },
      { id: 'metal_plate', src: 'metal_plate', name: '铁板', rarity: 2, color: '#6ec8b0', desc: '挡得住，打不狠。伤害 -3%，护甲 +2', mods: { armor: 2, dmgPct: -3 }, price: 40 },
      { id: 'missile', src: 'missile', name: '小导弹', rarity: 2, color: '#6ec8b0', desc: '炸得狠，装填慢。伤害 +10%，攻速 -4%', mods: { dmgPct: 10, atkSpd: -4 }, price: 45 },
      { id: 'padding', src: 'padding', name: '棉垫', rarity: 2, color: '#9ad8a0', desc: '垫出四点命。生命上限 +3，每80份材料 生命上限 +1', mods: { maxHp: 3 }, scale: [{ ch: 'maxHp', per: 1, nb: 80, drive: 'gold', permOnly: false }], price: 45 },
      { id: 'piggy_bank', src: 'piggy_bank', name: '存钱瓦罐', rarity: 2, color: '#9ad8a0', desc: '开波前把本钱再滚一圈。开波本钱 +20%', mods: { goldStartWavePct: 20 }, price: 40 },
      { id: 'pile_of_books', src: 'pile_of_books', name: '书山', rarity: 2, color: '#9ad8a0', desc: '架子搭得明白，炮也算得精。暴击率 +5%，结构伤害 +3，结构暴击 +1', mods: { crit: 5, engDmg: 3, structCrit: 1 }, price: 60 },
      { id: 'pocket_factory', src: 'pocket_factory', name: '口袋小厂', rarity: 2, color: '#9ad8a0', desc: '砍倒的树都能立起来当炮架。结构伤害 +2，伐木成炮 +1', mods: { engDmg: 2, treeTurrets: 1 }, price: 75 },
      { id: 'pumpkin', src: 'pumpkin', name: '空心南瓜', rarity: 2, color: '#6ec8b0', desc: '拖着一路穿过去，瓜肉薄一层。穿透伤害 +15%，伤害 -2%', mods: { dmgPct: -2, pierceDmgPct: 15 }, price: 40 },
      { id: 'recycling_machine', src: 'recycling_machine', name: '粉碎机', rarity: 2, color: '#6ec8b0', desc: '拆下来的料，能多收回一把。回收收益 +35%', mods: { recycleGainPct: 35 }, price: 35 },
      { id: 'reinforced_steel', src: 'reinforced_steel', name: '强化钢条', rarity: 2, color: '#9ad8a0', desc: '远程结构都硬，跑不快。移速 -3%，结构伤害 +3，远程伤害 +2', mods: { speedPct: -3, rangedDmg: 2, engDmg: 3 }, price: 50 },
      { id: 'riposte', src: 'riposte', name: '反击架势', rarity: 2, color: '#8fd66b', desc: '回手一挡，近战多一点。闪开的那一下，顺手回敬打你的人。近战伤害 +2，…', mods: { meleeDmg: 2 }, trig: [{ fam: 'dmg_on_dodge', ch: 'meleeDmg', pct: 300, chance: 100 }], price: 40 },
      { id: 'ritual', src: 'ritual', name: '祭礼', rarity: 2, color: '#9ad8a0', desc: '又狠又吸血，结构件不服。伤害 +6%，吸血 +2，结构伤害 -2', mods: { lifesteal: 2, dmgPct: 6, engDmg: -2 }, price: 60 },
      { id: 'scope', src: 'scope', name: '瞄具', rarity: 2, color: '#6ec8b0', desc: '看得远射得准，出手慢。射程 +25，攻速 -7%，远程伤害 +2', mods: { rangeFlat: 25, rangedDmg: 2, atkSpd: -7 }, price: 48 },
      { id: 'shady_potion', src: 'shady_potion', name: '来路不明药水', rarity: 2, color: '#7ed08a', desc: '运气极好，伤口难合。运气 +20，生命恢复 -2', mods: { regen: -2, luck: 20 }, price: 48 },
      { id: 'small_magazine', src: 'small_magazine', name: '小弹匣', rarity: 2, color: '#6ec8b0', desc: '连发更远，单发更软。攻速 +10%，伤害 -6%，远程伤害 +2', mods: { dmgPct: -6, rangedDmg: 2, atkSpd: 10 }, price: 60 },
      { id: 'snail', src: 'snail', name: '黏蜗牛', rarity: 2, color: '#9ad8a0', desc: '拖慢全场，也拖累自己。敌人移速 -8%，移速 -3%', mods: { speedPct: -3, enemySpdPct: -8 }, price: 40 },
      { id: 'snowball', src: 'snowball', name: '雪球', rarity: 2, color: '#6ec8b0', desc: '捏一把冷。身上但凡有东西抬高元素伤害，它都跟着再涨一点。…', mods: {}, trig: [{ fam: 'gain_stat_for_equipped_item_with_stat', ch: 'eleDmg', per: 1, stat: 'eleDmg' }], price: 50 },
      { id: 'spicy_sauce', src: 'spicy_sauce', name: '辣酱瓶', rarity: 2, color: '#8fd66b', desc: '吃下去身子更壮，果子也带了火气。消耗品爆炸几率 +50%，生命上限 +3', mods: { maxHp: 3, explodeOnConsumablePct: 50 }, price: 40 },
      { id: 'sunglasses', src: 'sunglasses', name: '墨镜', rarity: 2, color: '#6ec8b0', desc: '看得准，护甲薄。暴击率 +10%，护甲 -1', mods: { armor: -1, crit: 10 }, price: 50 },
      { id: 'tentacle', src: 'tentacle', name: '触须标本', rarity: 2, color: '#6ec8b0', desc: '专挑要害，挑中了就回一口。暴击回血 +20%，暴击率 +3%', mods: { crit: 3, healOnCritPct: 20 }, price: 35 },
      { id: 'turret_flame', src: 'turret_flame', name: '喷火哨座', rarity: 2, color: '#6ec8b0', desc: '喷出来的火会粘住人。喷火哨座 +1', mods: { structTurretFlame: 1 }, price: 40 },
      { id: 'turret_healing', src: 'turret_healing', name: '医疗哨座', rarity: 2, color: '#9ad8a0', desc: '不伤人，只往你身上打药。医疗哨座 +1', mods: { structTurretHealing: 1 }, price: 40 },
      { id: 'tyler', src: 'tyler', name: '散射哨座', rarity: 2, color: '#8fd66b', desc: '一次撒出一把弹。散射哨座 +1', mods: { structTyler: 1 }, price: 62 },
      { id: 'wheelbarrow', src: 'wheelbarrow', name: '独轮车', rarity: 2, color: '#6ec8b0', desc: '一车收成，铁皮薄。采集 +16，护甲 -1', mods: { armor: -1, harvest: 16 }, price: 40 },
      { id: 'whetstone', src: 'whetstone', name: '磨刀石', rarity: 2, color: '#7ed08a', desc: '磨出血性，推不开人。吸血 +4，击退 -3', mods: { lifesteal: 4, knockback: -3 }, price: 40 },
      { id: 'white_flag', src: 'white_flag', name: '白旗', rarity: 2, color: '#8fd66b', desc: '举起来，场上的东西就懒得再往上凑。采集 +5，敌人数量 -5%', mods: { harvest: 5, enemyCountPct: -5 }, price: 40 },
      /* ---------- rarity 3（源 tier 2）×55 ---------- */
      { id: 'adrenaline', src: 'adrenaline', name: '跳跳椒', rarity: 3, color: '#7ea8d8', desc: '辣到手抖，躲得比谁都快。闪开的那一下，凭这口气缓一缓。闪避 +5%，…', mods: { dodge: 5 }, trig: [{ fam: 'heal_on_dodge', v: 5, chance: 50 }], price: 60 },
      { id: 'alien_baby', src: 'alien_baby', name: '外星豆苗', rarity: 3, color: '#9ac0e8', desc: '异星落下来的苗，把对手也养壮。生命上限 +15，敌人生命 +10%', mods: { maxHp: 15, enemyHpPct: 10 }, price: 80 },
      { id: 'alien_magic', src: 'alien_magic', name: '异种符咒', rarity: 3, color: '#8fa8e8', desc: '血厚回血快，运气败光。生命上限 +8，运气 -8，生命恢复 +3', mods: { maxHp: 8, regen: 3, luck: -8 }, price: 85 },
      { id: 'alloy', src: 'alloy', name: '合金豆', rarity: 3, color: '#8fa8e8', desc: '样样都沾，身法变笨。闪避 -6%，暴击率 +5%，近战伤害 +3，…', mods: { dodge: -6, crit: 5, meleeDmg: 3, rangedDmg: 3, eleDmg: 3, engDmg: 3 }, price: 80 },
/* 不上架（pool:false）: （无拦路者 —— 数据异常）；而本作能算出来的部分里一条正收益都没有 ⇒ 不发值、标 pool:false 不上架。判定见 tools/parity-source.cjs 的 pool 断言与台账 §7.3。 */
            { id: 'baby_with_a_beard', src: 'baby_with_a_beard', name: '胡子苗', rarity: 3, color: '#a8a0e8', desc: '倒下的那一刻把胡子甩出去，可惜人已经没了。射程 -50，倒下吐弹 +1，…', mods: { rangeFlat: -50, projOnDeath: 1 }, price: 100, pool: false },
      { id: 'ball_and_chain', src: 'ball_and_chain', name: '锁链冬瓜', rarity: 3, color: '#8fa8e8', desc: '拽着铁球躲不快，出手却压得实。伤害 +15%，击退 +5，护甲 +3，…', mods: { armor: 3, speedPct: -3, dmgPct: 15, knockback: 5, minWeaponCd: 0.75 }, price: 75 },
      { id: 'bandana', src: 'bandana', name: '头巾', rarity: 3, color: '#8fa8e8', desc: '多穿一个，力气大减。伤害 -10%，穿透 +1', mods: { dmgPct: -10, pierceBonus: 1 }, price: 75 },
      { id: 'barricade', src: 'barricade', name: '拒马', rarity: 3, color: '#8fa8e8', desc: '推得开人，走得慢。移速 -5%，击退 +3，站定不动时 护甲 +8', mods: { speedPct: -5, knockback: 3 }, cond: [{ ch: 'armor', v: 8, kind: 'notMoving' }], price: 75 },
      { id: 'bean_teacher', src: 'bean_teacher', name: '豆先生', rarity: 3, color: '#7ea8d8', desc: '学得飞快，吸不动。经验 +50%，吸血 -2', mods: { lifesteal: -2, xpPct: 50 }, price: 70 },
      { id: 'blood_donation', src: 'blood_donation', name: '献血袋', rarity: 3, color: '#7ea8d8', desc: '先放一点血，换一仓的收成。采集 +40，每秒失血 +1', mods: { harvest: 40, hpLossPerSec: 1 }, price: 50 },
      { id: 'bowler_hat', src: 'bowler_hat', name: '礼帽', rarity: 3, color: '#8fa8e8', desc: '走运有收成，手慢眼钝。采集 +18，运气 +15，攻速 -5%，…', mods: { crit: -3, atkSpd: -5, luck: 15, harvest: 18 }, price: 75 },
      { id: 'candle', src: 'candle', name: '守夜蜡烛', rarity: 3, color: '#8fa8e8', desc: '火头很小，招来的东西也少。敌人数量 -10%，伤害 -5%，元素伤害 +4，…', mods: { regen: 1, dmgPct: -5, eleDmg: 4, enemyCountPct: -10, fogVisPct: 25 }, price: 65 },
      { id: 'candy_bag', src: 'candy_bag', name: '糖纸袋', rarity: 3, color: '#a8a0e8', desc: '开波随手掏一颗，甜头随机落在某样长处上。下波精英几率 +10%，开波随机长处 +8', mods: { extraEliteChancePct: 10, randomPrimaryOnWave: 8 }, price: 70 },
      { id: 'chameleon', src: 'chameleon', name: '变色龙', rarity: 3, color: '#9ac0e8', desc: '滑了一点，打得轻。伤害 -4%，闪避 +3%，站定不动时 闪避 +20%', mods: { dodge: 3, dmgPct: -4 }, cond: [{ ch: 'dodge', v: 20, kind: 'notMoving' }], price: 70 },
      { id: 'clover', src: 'clover', name: '四叶草', rarity: 3, color: '#8fa8e8', desc: '运气与身法俱佳，吸不动。运气 +20，闪避 +6%，吸血 -2', mods: { lifesteal: -2, dodge: 6, luck: 20 }, price: 65 },
      { id: 'coil', src: 'coil', name: '线圈', rarity: 3, color: '#7ea8d8', desc: '一推老远，顺手加一点。击退 +5，每点击退 伤害 +1%', mods: { knockback: 5 }, scale: [{ ch: 'dmgPct', per: 1, nb: 1, drive: 'stat:knockback', permOnly: false }], price: 70 },
      { id: 'community_support', src: 'community_support', name: '邻里帮工', rarity: 3, color: '#7ea8d8', desc: '快一点点，护甲差。护甲 -2，每只场上怪 攻速 +1%', mods: { armor: -2 }, scale: [{ ch: 'atkSpd', per: 1, nb: 1, drive: 'livingEnemy', permOnly: false }], price: 75 },
      { id: 'crown', src: 'crown', name: '王冠', rarity: 3, color: '#8fa8e8', desc: '收获一茬比一茬多。收获成长 +8%', mods: { harvestingGrowth: 8 }, price: 70 },
      { id: 'fairy', src: 'fairy', name: '小仙灵', rarity: 3, color: '#7ea8d8', desc: '缠着你就回不动血。每件普通道具 生命恢复 +1，每件传说道具 生命恢复 -3', mods: {}, scale: [{ ch: 'regen', per: 1, nb: 1, drive: 'commonItem', permOnly: true }, { ch: 'regen', per: -3, nb: 1, drive: 'legendaryItem', permOnly: false }], price: 85 },
      { id: 'fin', src: 'fin', name: '背鳍', rarity: 3, color: '#7ea8d8', desc: '快且吸血，运气掉光。移速 +10%，运气 -8，吸血 +3', mods: { lifesteal: 3, speedPct: 10, luck: -8 }, price: 65 },
      { id: 'fried_rice', src: 'fried_rice', name: '隔夜炒饭', rarity: 3, color: '#a8a0e8', desc: '热一热，慢慢回。每只燃烧怪 生命恢复 +1', mods: {}, scale: [{ ch: 'regen', per: 1, nb: 1, drive: 'burningEnemy', permOnly: false }], price: 60 },
      { id: 'frozen_heart', src: 'frozen_heart', name: '冻心菜', rarity: 3, color: '#8fa8e8', desc: '心口凉一寸，元素劲道足。燃烧提速 -100%，元素伤害 +8，暴击率 +5%，…', mods: { eleDmg: 8, crit: 5, burnCdPct: -100 }, price: 90 },
      { id: 'ghost_outfit', src: 'ghost_outfit', name: '幽灵罩衫', rarity: 3, color: '#7ea8d8', desc: '闪避上限抬高，代价是慢而脆。闪避上限 +70，闪避 +10%，移速 -5%，…', mods: { armor: -3, dodge: 10, speedPct: -5, dodgeCap: 70 }, price: 80 },
      { id: 'glass_cannon', src: 'glass_cannon', name: '瓷炮筒', rarity: 3, color: '#9ac0e8', desc: '极狠极脆。伤害 +25%，护甲 -3', mods: { armor: -3, dmgPct: 25 }, price: 75 },
      { id: 'handcuffs', src: 'handcuffs', name: '铐手锁链', rarity: 3, color: '#9ac0e8', desc: '近战远程元素齐涨，代价是生命上限从此封顶。近战伤害 +8，远程伤害 +8，元素伤害 +8，最大生命值锁定为当前值…', mods: { meleeDmg: 8, rangedDmg: 8, eleDmg: 8, hpCapCurrent: 1 }, price: 80 },
      { id: 'honey', src: 'honey', name: '稠蜜罐', rarity: 3, color: '#8fa8e8', desc: '又黏又甜，脚步腻住了。爆炸伤害 +10%，爆炸范围 +5%，闪避 -3%，…', mods: { dodge: -3, speedPct: -3, rangedDmg: 3, explodeDmgPct: 10, explodeSizePct: 5 }, price: 70 },
      { id: 'hunting_trophy', src: 'hunting_trophy', name: '猎获标本', rarity: 3, color: '#a8a0e8', desc: '专挑要害下手的记号。暴击杀敌掉料 +33%', mods: { goldOnCritPct: 33 }, price: 55 },
      { id: 'improved_tools', src: 'improved_tools', name: '顺手家什', rarity: 3, color: '#9ac0e8', desc: '出手快了一截。攻速 +10%，…', mods: { atkSpd: 10 }, price: 70 },
      { id: 'lucky_charm', src: 'lucky_charm', name: '吉祥结', rarity: 3, color: '#a8a0e8', desc: '运气爆棚，打人发软。运气 +30，近战伤害 -2，远程伤害 -1', mods: { meleeDmg: -2, rangedDmg: -1, luck: 30 }, price: 75 },
      { id: 'mouse', src: 'mouse', name: '田鼠', rarity: 3, color: '#8fa8e8', desc: '顺手牵一把，顺带把远处的东西引来。敌人数量 +10%，吸血 +5，采集 -5', mods: { lifesteal: 5, harvest: -5, enemyCountPct: 10 }, price: 55 },
      { id: 'nail', src: 'nail', name: '铁钉', rarity: 3, color: '#9ac0e8', desc: '结构件稳一点，射术生疏。结构伤害 +5，远程伤害 -2，…', mods: { engDmg: 5, rangedDmg: -2 }, price: 65 },
      { id: 'peacock', src: 'peacock', name: '孔雀翎羽', rarity: 3, color: '#9ac0e8', desc: '翎子一展手气旺，对面也跟着凶。每守住一波，翎子上的一根眼斑换成经验，随后的那一波却招来更狠的对手。经验 +25%，…', mods: { xpPct: 25 }, trig: [{ fam: 'stats_next_wave', ch: 'xpPct', v: 100 }, { fam: 'stats_next_wave', ch: 'enemyDmgPct', v: 50 }], price: 50 },
      { id: 'plastic_explosive', src: 'plastic_explosive', name: '塑胶炸药包', rarity: 3, color: '#a8a0e8', desc: '不伤人，专炸开一大圈。爆炸范围 +25%', mods: { explodeSizePct: 25 }, price: 60 },
      { id: 'poisonous_tonic', src: 'poisonous_tonic', name: '毒补汤', rarity: 3, color: '#8fa8e8', desc: '快准远，伤口难合。射程 +15，攻速 +10%，暴击率 +5%，…', mods: { regen: -2, crit: 5, rangeFlat: 15, atkSpd: 10 }, price: 80 },
      { id: 'power_generator', src: 'power_generator', name: '发电机', rarity: 3, color: '#8fa8e8', desc: '拖着它，力气变小。伤害 -5%，每点移速 伤害 +1%', mods: { dmgPct: -5 }, scale: [{ ch: 'dmgPct', per: 1, nb: 1, drive: 'stat:speedPct', permOnly: true }], price: 65 },
      { id: 'rip_and_tear', src: 'rip_and_tear', name: '撕扯藤', rarity: 3, color: '#a8a0e8', desc: '打死的家伙偶尔会炸开。尸爆几率 +20%，暴击率 -5%', mods: { crit: -5, explodeOnDeathPct: 20 }, price: 65 },
      { id: 'sad_tomato', src: 'sad_tomato', name: '苦脸番茄', rarity: 3, color: '#7ea8d8', desc: '开波总要先蔫上一阵，蔫完又能缓过来。开波生命 -50%，生命恢复 +8', mods: { regen: 8, hpStartWavePct: -50 }, price: 50 },
      { id: 'shackles', src: 'shackles', name: '铁箍脚环', rarity: 3, color: '#9ac0e8', desc: '回血快射得远，腿却拖不动了。射程 +80，生命恢复 +8，结构伤害 +8，移速锁定为当前值…', mods: { regen: 8, rangeFlat: 80, engDmg: 8, speedCapCurrent: 1 }, price: 80 },
      { id: 'shmoop', src: 'shmoop', name: '软塌塌', rarity: 3, color: '#9ac0e8', desc: '养得壮回得快，打人没劲。生命上限 +6，生命恢复 +2，近战伤害 -2，…', mods: { maxHp: 6, regen: 2, meleeDmg: -2, rangedDmg: -1 }, price: 60 },
      { id: 'silver_bullet', src: 'silver_bullet', name: '银弹', rarity: 3, color: '#9ac0e8', desc: '专治大块头。对精英伤害 +25%', mods: { dmgVsBossPct: 25 }, price: 70 },
      { id: 'statue', src: 'statue', name: '石像', rarity: 3, color: '#9ac0e8', desc: '挪不动窝。移速 -10%，站定不动时 攻速 +40%', mods: { speedPct: -10 }, cond: [{ ch: 'atkSpd', v: 40, kind: 'notMoving' }], price: 60 },
      { id: 'stone_skin', src: 'stone_skin', name: '石皮', rarity: 3, color: '#7ea8d8', desc: '硬一点点，出手变钝。攻速 -6%，每点护甲 生命上限 +1', mods: { atkSpd: -6 }, scale: [{ ch: 'maxHp', per: 1, nb: 1, drive: 'stat:armor', permOnly: true }], price: 85 },
      { id: 'strange_book', src: 'strange_book', name: '怪书', rarity: 3, color: '#9ac0e8', desc: '结构件涨，肉身退。近战伤害 -1，远程伤害 -1，每点元素伤害 结构伤害 +1', mods: { meleeDmg: -1, rangedDmg: -1 }, scale: [{ ch: 'engDmg', per: 1, nb: 1, drive: 'stat:eleDmg', permOnly: true }], price: 70 },
      { id: 'tardigrade', src: 'tardigrade', name: '缓步虫干', rarity: 3, color: '#7ea8d8', desc: '每波头几下挨不死。受击豁免 +1', mods: { hitProtection: 1 }, price: 50 },
      { id: 'toolbox', src: 'toolbox', name: '工具箱', rarity: 3, color: '#8fa8e8', desc: '结构件强，手慢。攻速 -8%，结构伤害 +6', mods: { atkSpd: -8, engDmg: 6 }, price: 55 },
      { id: 'tractor', src: 'tractor', name: '铁牛', rarity: 3, color: '#8fa8e8', desc: '一趟顶十趟，打不疼。采集 +40，伤害 -8%', mods: { dmgPct: -8, harvest: 40 }, price: 70 },
      { id: 'triangle_of_power', src: 'triangle_of_power', name: '三角土阵', rarity: 3, color: '#9ac0e8', desc: '又狠又硬。挨一下，刀刃就钝一分。伤害 +20%，护甲 +1，…', mods: { armor: 1, dmgPct: 20 }, trig: [{ fam: 'temp_stats_on_hit', ch: 'dmgPct', v: -2 }], price: 65 },
      { id: 'turret_laser', src: 'turret_laser', name: '激光哨座', rarity: 3, color: '#a8a0e8', desc: '一发穿透一排。激光哨座 +1', mods: { structTurretLaser: 1 }, price: 65 },
      { id: 'vigilante_ring', src: 'vigilante_ring', name: '义警戒指', rarity: 3, color: '#a8a0e8', desc: '稳稳加三点伤害。每守完一波，这笔账就更硬气一点。…', mods: {}, trig: [{ fam: 'stats_end_of_wave', ch: 'dmgPct', v: 3 }], price: 92 },
      { id: 'wandering_bot', src: 'wandering_bot', name: '游走铁虫', rarity: 3, color: '#7ea8d8', desc: '绕着圈转，蹭到就减速。游走铁虫 +1', mods: { structBot: 1 }, price: 60 },
      { id: 'warrior_helmet', src: 'warrior_helmet', name: '铆钉铁盔', rarity: 3, color: '#a8a0e8', desc: '扛得住血也厚，走得沉。生命上限 +5，移速 -5%，护甲 +3', mods: { maxHp: 5, armor: 3, speedPct: -5 }, price: 80 },
      { id: 'wheat', src: 'wheat', name: '金麦束', rarity: 3, color: '#8fa8e8', desc: '近战远程收成都有，怕冷。采集 +10，近战伤害 +4，远程伤害 +2，…', mods: { meleeDmg: 4, rangedDmg: 2, harvest: 10, eleDmg: -2 }, price: 85 },
      { id: 'will_o_the_wisp', src: 'will_o_the_wisp', name: '鬼火', rarity: 3, color: '#a8a0e8', desc: '手慢了半拍。烧着的对手倒下时，这簇火苗就旺一分。攻速 -7%，…', mods: { atkSpd: -7 }, trig: [{ fam: 'gain_stat_for_killed_enemies_while_burning', ch: 'eleDmg', v: 30, maxProcs: 4 }], price: 80 },
      { id: 'wings', src: 'wings', name: '风羽披风', rarity: 3, color: '#a8a0e8', desc: '跑得快射得远，怕冷。射程 +30，移速 +10%，元素伤害 -2', mods: { rangeFlat: 30, speedPct: 10, eleDmg: -2 }, price: 85 },
      { id: 'wisdom', src: 'wisdom', name: '智囊书', rarity: 3, color: '#7ea8d8', desc: '想得多了，下手更轻。伤害 -15%，每隔5秒 伤害 +5%', mods: { dmgPct: -15 }, cond: [{ ch: 'dmgPct', v: 5, kind: 'interval', every: 5 }], price: 85 },
      /* ---------- rarity 4（源 tier 3）×34 ---------- */
/* 不上架（pool:false）: `upgrade_random_weapon`（需要与商店交互（随机升级一件武器）, 本作未实现）；而本作能算出来的部分里一条正收益都没有 ⇒ 不发值、标 pool:false 不上架。判定见 tools/parity-source.cjs 的 pool 断言与台账 §7.3。 */
            { id: 'anvil', src: 'anvil', name: '铁砧', rarity: 4, color: '#e0533f', desc: '扛在肩上，硬两点。…', mods: {}, price: 120, pool: false },
      { id: 'big_arms', src: 'big_arms', name: '铁臂藤', rarity: 4, color: '#e0533f', desc: '力气大推得远，手慢脚沉。近战伤害 +12，远程伤害 +6，移速 -3%，…', mods: { speedPct: -3, meleeDmg: 12, rangedDmg: 6, atkSpd: -3, knockback: 3 }, price: 105 },
      { id: 'bloody_hand', src: 'bloody_hand', name: '血手', rarity: 4, color: '#d8c05a', desc: '一直淌着，淌得越久下手越狠。吸血 +10，每秒失血 +1，每点吸血 伤害 +2%', mods: { lifesteal: 10, hpLossPerSec: 1 }, scale: [{ ch: 'dmgPct', per: 2, nb: 1, drive: 'stat:lifesteal', permOnly: false }], price: 110 },
      { id: 'cape', src: 'cape', name: '夜行披巾', rarity: 4, color: '#d8c05a', desc: '又飘又吸血，打人没劲。闪避 +20%，吸血 +5，近战伤害 -2，…', mods: { lifesteal: 5, dodge: 20, meleeDmg: -2, rangedDmg: -2, eleDmg: -2 }, price: 110 },
      { id: 'diploma', src: 'diploma', name: '文凭', rarity: 4, color: '#e0533f', desc: '见识结构双涨，身子薄。经验 +50%，结构伤害 +10，生命上限 -3', mods: { maxHp: -3, engDmg: 10, xpPct: 50 }, price: 90 },
      { id: 'estys_couch', src: 'estys_couch', name: '懒人躺椅', rarity: 4, color: '#d8c05a', desc: '血厚回血快，挪不动窝。移速 -20%，生命上限 +5，每点移速 生命恢复 -2', mods: { maxHp: 5, speedPct: -20 }, scale: [{ ch: 'regen', per: -2, nb: 1, drive: 'stat:speedPct', permOnly: true }], price: 100 },
      { id: 'exoskeleton', src: 'exoskeleton', name: '外骨壳', rarity: 4, color: '#d8c05a', desc: '硬准快，但回血吸血全废。暴击率 +5%，移速 +5%，结构伤害 +5，…', mods: { regen: -2, lifesteal: -2, armor: 3, crit: 5, speedPct: 5, engDmg: 5 }, price: 90 },
      { id: 'explosive_shells', src: 'explosive_shells', name: '爆壳瓜子', rarity: 4, color: '#d8c05a', desc: '壳一炸一大片，瓜瓤就轻了。爆炸伤害 +60%，伤害 -15%，爆炸范围 +15%', mods: { dmgPct: -15, explodeDmgPct: 60, explodeSizePct: 15 }, price: 100 },
/* 不上架（pool:false）: `consumable_stats_while_max`（本作没有消耗品）；而本作能算出来的部分里一条正收益都没有 ⇒ 不发值、标 pool:false 不上架。判定见 tools/parity-source.cjs 的 pool 断言与台账 §7.3。 */
            { id: 'extra_stomach', src: 'extra_stomach', name: '额外胃袋', rarity: 4, color: '#c96bd8', desc: '多吃一口，多扛一点。…', mods: {}, price: 100, pool: false },
      { id: 'focus', src: 'focus', name: '屏息口诀', rarity: 4, color: '#c96bd8', desc: '心一定，下手极狠。伤害 +30%，…', mods: { dmgPct: 30 }, price: 110 },
      { id: 'giant_belt', src: 'giant_belt', name: '巨人腰带', rarity: 4, color: '#d8c05a', desc: '一系上，暴击砸得更狠。暴击伤害 +10%', mods: { giantCritPct: 10 }, price: 110 },
      { id: 'gnome', src: 'gnome', name: '矮壮地精', rarity: 4, color: '#c96bd8', desc: '近战元素强，手短眼短。射程 -20，拾取 -20，近战伤害 +10，…', mods: { rangeFlat: -20, meleeDmg: 10, pickup: -20, eleDmg: 10 }, price: 100 },
      { id: 'greek_fire', src: 'greek_fire', name: '火油藤', rarity: 4, color: '#e08a3a', desc: '烧起来的量按对手的血算。燃烧按血比 +10%', mods: { burnHpPct: 10, fogVisPct: 75 }, price: 100 },
      { id: 'grinds_magical_leaf', src: 'grinds_magical_leaf', name: '磨碎的灵叶', rarity: 4, color: '#e08a3a', desc: '血厚回血又吸血。每熬过一波，根须就扎得更深。…', mods: {}, trig: [{ fam: 'stats_end_of_wave', ch: 'maxHp', v: 3 }, { fam: 'stats_end_of_wave', ch: 'regen', v: 1 }, { fam: 'stats_end_of_wave', ch: 'lifesteal', v: 1 }], price: 110 },
      { id: 'heavy_bullets', src: 'heavy_bullets', name: '重头弹', rarity: 4, color: '#d8c05a', desc: '又重又狠又远，慢且糙。射程 +10，伤害 +10%，暴击率 -5%，…', mods: { crit: -5, rangeFlat: 10, dmgPct: 10, rangedDmg: 5, atkSpd: -5 }, price: 100 },
/* 不上架（pool:false）: ``（本作未实现该机制）；而本作能算出来的部分里一条正收益都没有 ⇒ 不发值、标 pool:false 不上架。判定见 tools/parity-source.cjs 的 pool 断言与台账 §7.3。 */
            { id: 'broken_hourglass', src: 'broken_hourglass', name: '碎沙漏', rarity: 4, color: '#e0533f', desc: '漏完了，什么也没留下。下波生命 -100%，…', mods: { hpStartNextWavePct: -100 }, price: 1, pool: false },
      { id: 'hourglass', src: 'hourglass', name: '倒转沙漏', rarity: 4, color: '#e0533f', desc: '沙子倒着走，这一波算没来过。下波生命 -100%，时光倒流 +1', mods: { hpStartNextWavePct: -100, hourglassFlag: 1 }, price: 100 },
      { id: 'jetpack', src: 'jetpack', name: '喷气背囊', rarity: 4, color: '#e0533f', desc: '飞一样快，皮薄甲软。移速 +15%，闪避 +10%，生命上限 -5，…', mods: { maxHp: -5, armor: -1, dodge: 10, speedPct: 15 }, price: 100 },
      { id: 'lucky_coin', src: 'lucky_coin', name: '古旧铜钱', rarity: 4, color: '#e0533f', desc: '一点运气，换掉护甲。护甲 -2，每点暴击率 运气 +2', mods: { armor: -2 }, scale: [{ ch: 'luck', per: 2, nb: 1, drive: 'stat:crit', permOnly: false }], price: 105 },
      { id: 'mammoth', src: 'mammoth', name: '长毛兽皮', rarity: 4, color: '#d8c05a', desc: '力大血厚推得远，又慢又软。近战伤害 +20，伤害 -8%，生命恢复 +5，…', mods: { regen: 5, speedPct: -3, dmgPct: -8, meleeDmg: 20, knockback: 5 }, price: 110 },
      { id: 'medikit', src: 'medikit', name: '随军药囊', rarity: 4, color: '#e08a3a', desc: '回血极快，运气归零。生命恢复 +10，运气 -10，每隔5秒 生命恢复 +2', mods: { regen: 10, luck: -10 }, cond: [{ ch: 'regen', v: 2, kind: 'interval', every: 5 }], price: 95 },
      { id: 'night_goggles', src: 'night_goggles', name: '夜枭目镜', rarity: 4, color: '#d8c05a', desc: '夜里极准极远，人却虚。射程 +50，暴击率 +15%，生命上限 -3，…', mods: { maxHp: -3, armor: -1, crit: 15, rangeFlat: 50 }, price: 95 },
      { id: 'octopus', src: 'octopus', name: '八腕怪', rarity: 4, color: '#d8c05a', desc: '血厚回血吸血，瞄不准。生命上限 +12，暴击率 -8%，生命恢复 +5，…', mods: { maxHp: 12, regen: 5, lifesteal: 3, crit: -8 }, price: 105 },
      { id: 'panda', src: 'panda', name: '黑白团子', rarity: 4, color: '#c96bd8', desc: '又壮又走运，打人不疼。运气 +25，生命上限 +12，伤害 -5%', mods: { maxHp: 12, dmgPct: -5, luck: 25 }, price: 100 },
      { id: 'potato', src: 'potato', name: '什锦菜', rarity: 4, color: '#d8c05a', desc: '什么都来一点，什么都不精。伤害 +5%，攻速 +5%，运气 +5，…', mods: { maxHp: 3, regen: 2, lifesteal: 1, armor: 1, dodge: 3, speedPct: 3, dmgPct: 5, atkSpd: 5, luck: 5 }, price: 95 },
      { id: 'potion', src: 'potion', name: '红药水', rarity: 4, color: '#d8c05a', desc: '血见底时，回得更凶。低血回复 +100%，生命恢复 +3', mods: { regen: 3, regenLowHpPct: 100 }, price: 90 },
      { id: 'retromations_hoodie', src: 'retromations_hoodie', name: '旧连帽衫', rarity: 4, color: '#e0533f', desc: '手速略快，射程几乎没了。射程 -80，每点闪避 攻速 +2%', mods: { rangeFlat: -80 }, scale: [{ ch: 'atkSpd', per: 2, nb: 1, drive: 'stat:dodge', permOnly: false }], price: 110 },
      { id: 'ricochet', src: 'ricochet', name: '弹射弹', rarity: 4, color: '#e08a3a', desc: '会拐弯，打得软。伤害 -25%，弹射 +1', mods: { dmgPct: -25, bounce: 1 }, price: 110 },
      { id: 'robot_arm', src: 'robot_arm', name: '机械臂', rarity: 4, color: '#d8c05a', desc: '近战结构双涨，人薄一点。每守完一波，这只铁手更沉也更耗身。…', mods: {}, trig: [{ fam: 'stats_end_of_wave', ch: 'meleeDmg', v: 3 }, { fam: 'stats_end_of_wave', ch: 'engDmg', v: 3 }, { fam: 'stats_end_of_wave', ch: 'maxHp', v: -1 }], price: 100 },
      { id: 'sifds_relic', src: 'sifds_relic', name: '来路不明遗物', rarity: 4, color: '#e08a3a', desc: '东西不用捡，自己贴上来。材料吸附 +100%，护甲 +3', mods: { armor: 3, goldAttractPct: 100 }, price: 100 },
      { id: 'spider', src: 'spider', name: '结网蛛', rarity: 4, color: '#e08a3a', desc: '下手毒，身法差偷收成。伤害 +12%，采集 -5，闪避 -3%，…', mods: { dmgPct: 12, dodge: -3, harvest: -5 }, price: 110 },
      { id: 'torture', src: 'torture', name: '苦修藤', rarity: 4, color: '#e08a3a', desc: '绞着自己长，伤口不再结痂。生命上限 +15，苦修回复 +5', mods: { maxHp: 15, torture: 5 }, price: 100 },
      { id: 'turret_rocket', src: 'turret_rocket', name: '火箭哨座', rarity: 4, color: '#e08a3a', desc: '打出去会炸开一片。火箭哨座 +1', mods: { structTurretRocket: 1 }, price: 80 },
      { id: 'wolf_helmet', src: 'wolf_helmet', name: '狼头帽', rarity: 4, color: '#c96bd8', desc: '戴上走运又带火气，结构件不服。运气 +20，元素伤害 +10，结构伤害 -5', mods: { luck: 20, eleDmg: 10, engDmg: -5 }, price: 90 },
    ]
  };
  D.byId = function (id) {
    var l = D.list, i;
    for (i = 0; i < l.length; i++) if (l[i].id === id) return l[i];
    return null;
  };
  /* 稀有度池(商店抽取用) —— `pool: false` = 不上架（源里零永久词条、本作未实现其触发机制的那些件,
   * 见 list 内 B 组注释）。商店 rollShop / 幸运掉落都只经这里取货 ⇒ 标了就真的卖不出去。 */
  D.poolByRarity = function (r) {
    var out = [], i;
    for (i = 0; i < D.list.length; i++) if (D.list[i].rarity === r && D.list[i].pool !== false) out.push(D.list[i].id);
    return out;
  };
})(typeof GameGlobal !== 'undefined' ? GameGlobal : (typeof window !== 'undefined' ? window : globalThis));
