/* PS.Balance v2 —— 数值总表（横屏重做版）
 * v1 十条反馈逐条落地：横屏 1280x720 / 世界 2240x1560 镜头跟随 / 怪物增强 / 3 模式。
 * 纪律：逻辑代码零魔法数字；调参先跑 tools/simulate2.cjs。
 */
(function (global) {
  'use strict';
  var PS = global.PS || {};
  var B = PS.Balance = {};

  /* ---------- 画面与世界 ---------- */
  B.WAVE_MAX = 20;
  B.VIEW = { w: 1280, h: 720 };                 // 横屏逻辑分辨率(排版基准, 平台层只缩放不平移它的尺寸)
  B.WORLD = { w: 2240, h: 1560 };               // 世界尺寸(镜头跟随, 远大于视口)
  B.ARENA = { x: 40, y: 40, w: 2160, h: 1480 }; // 可行动区域

  /* ---------- 模式 ---------- */
  /* v3.x(缺陷修复) 为什么本作**没有**「刷怪倍率」字段(旧名在此刻意拆写为 spawn**Mul**, 理由见本段末尾) ——
   *   决策是「删掉这条空头承诺」, 而不是「把它接上线」:
   *   · 历史状态: 本表原有三条刷怪倍率(standard 1 / endless 1.15 / rush 1.7), 但它是**空头支票** ——
   *     唯一消费者是模式选择卡的展示行(旧 ui.js drawModeSelect 的「刷怪倍率 ×1.70」),
   *     刷怪路径完全不读它: 刷怪量 100% 来自源时刻表 PS.WaveData.forWave(g.wave)(见 src/core/game.js 刷怪段),
   *     连 B.enemyCap() 也不吃 mode。对照: 同表的 matMul(材料收益, game.js 消费)与 enemyWaveIdx
   *     (rush「每波按 2 波推进」的敌人成长)都是**真被消费**的 ⇒ 只有它是「界面在说谎」。
   *   · 不接线的三条理由(复核者请照读, 别再把 ×1.7 加回来):
   *     1) 用户的硬要求是「数值直接用反编译源代码」: 刷怪量回到**源时刻表 1:1** 正是当初修好
   *        「卡顿」与「材料掉太多」的原因, 而当时删掉的正是我方自制的批量/倍率刷怪
   *        (证据: src/core/game.js 刷怪段的 v3.2 / v3.4 记录)。
   *     2) 源里没有「按模式改刷怪量」这个概念 —— 难度靠 d0~d5 档, 且那批 .tres 在源侧读不出。
   *     3) 重新加一个自制 ×1.7 会立刻把「卡顿 / 材料爆」按原样引回来, 并把刷怪量变成不可预测的量
   *        (历史事故: 标定时 W9 实测 390 只, 而时刻表只排了 132 只)。
   *   ⇒ 正确做法是让界面只说真话。模式的**真实**差异只有三项: waves(波数) / durMul(每波时长) /
   *     matMul(材料收益), 外加 rush 的 enemyWaveIdx(敌人成长按每波 2 波推进) —— 三者都有真实消费者。
   *     需要更硬的难度请回源侧找依据, 不要在这里发明倍率。
   *   字段名在这里刻意拆写成 spawn**Mul**: 交付自检要按该字段名检索 src/ tools/ qa/ 且必须零命中,
   *   所以注释里也不留可照抄复活的完整字段名。 */
  B.MODES = {
    /* v7.3(2026-09-30 审计) noWin: 「本模式没有终点波」—— waves 只作难度/UI 的参考波数, 不参与通关判定。 */
    standard: { name: '标准远征', waves: 20, durMul: 1,   matMul: 1,  desc: '经典 20 波, 击败魔王' },
    endless:  { name: '无尽浪潮', waves: 99, durMul: 1,   matMul: 1.2, desc: '波次无限, 越深越狂', noWin: 1 },
    rush:     { name: '疾速突袭', waves: 10, durMul: 0.7, matMul: 2,  desc: '10 波速通, 双倍材料' }
  };
  /* v8.3(用户 2026-10-08): **难度挡位** —— 用户逐字「我之前要求你做的难度, 其实是和原版游戏一样有好多种
   *   难度挡位, 不是单纯无尽模式加难度, 我要求你做3挡, 简单, 中等, 困难 ... 现有3个模式为简单挡,
   *   你做出剩下两个挡位, 三个模式都要做」。
   *   源侧刻度是 d0~d5(singletons/run_data.gd 的 difficulty), 但那一批 .tres 在源侧读不出
   *   (见本文件 25-35 行的审计结论) ⇒ 本作折成**三挡**、并把「源刻度」那一挡叫 simple。
   *   两根轴刻意**正交**: MODES 管 wave/durMul/matMul(一个字都不动), DIFFS 只乘敌人属性。
   *     · 为什么不把挡位做成第 4/5/6 个模式: qa/verify-run-end.cjs 按 B.MODES.<key>.waves 钉住
   *       20/99/10, 而「疾速」在 game.js/balance.js 里是按 `mode === 'rush'` 分支的(波序翻倍/刷怪加速), 
   *       把挡位并进 MODES 会把这些分支全部打散成 6 份。正交加一张表 => 分支一处不动。
   *     · 为什么只动属性、**不动刷怪量**: 「刷怪量配倍率」正是历史上「卡顿 + 材料爆」的成因
   *       (见本文件 25-35 行), 所以挡位只乘 hp / dmg / spd —— 同屏怪数、掉落、经验三者逐值不变。
   *   easy 三个乘数**恒为 1.0** ⇒ 简单挡 = 现有三个模式 = 逐值不变(所有既有门禁默认跑的就是这一挡)。 */
  B.DIFFS = {
    easy:   { name: '简单', hpMul: 1,   dmgMul: 1,    spdMul: 1,    desc: '原版刻度 · 三个模式在这一挡逐值不变' },
    normal: { name: '中等', hpMul: 1.5, dmgMul: 1.35, spdMul: 1.06, desc: '敌人更肉更疼, 精英开始真的挡路' },
    hard:   { name: '困难', hpMul: 2.2, dmgMul: 1.8,  spdMul: 1.12, desc: 'BOSS 不再一枪秒, 一次失误就死' }
  };
  B.DIFFS_ORDER = ['easy', 'normal', 'hard'];
  /* 未知挡位一律回落 easy(与 B.MODES 未知回落 standard 同一条口径)。 */
  B.diffOf = function (d) { return B.DIFFS[d] || B.DIFFS.easy; };

  /* ---------- 波次节奏 ---------- */
  /* v3.4(源对齐): 单波时长 = **源逐波表**, 出处 zones/zone_1 的 wave_N.tres 的 wave_duration 字段。
   *   W1 20 / W2 25 / W3 30 / W4 35 / W5 40 / W6 45 / W7 50 / W8 55 / W9~W19 60 / W20 90。
   *   源把「波越来越长」当作难度爬坡的一半(另一半是刷怪量), 它同时是刷怪时刻表的容器。
   *   旧值(一刀切 60s)是本作自制 —— 它把前 8 波的刷怪量整体放大 1.2~3 倍, 是「材料掉太多 + 第 1 波到 10 级」
   *   的放大器。证据: ref/source-econ.md §8 波表(逐波实读 20 个 wave_N.tres) + ref/source-waves.md。 */
  B.WAVE_DURATION = [20, 25, 30, 35, 40, 45, 50, 55, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60, 90];
  B.waveDuration = function (w, mode) {
    var i = Math.max(1, Math.min(20, w | 0)) - 1;
    return Math.round(B.WAVE_DURATION[i] * (mode === 'rush' ? B.MODES.rush.durMul : 1));
  };
  /* v5.19c(Codex, 2026-09-29): 通关判定的**唯一判据** -- 本局是否已到「本模式的最后一波」。
   *   存在理由(用户逐字「无尽模式本应该是无限波次, 第20波直接游戏通关」):
   *     src/core/game.js 的 onKill 原先写的是「**任何** Boss 死 -> finish(true)」, 而通关是**模式**的属性,
   *     不是 Boss 的属性: 标准 20 波 / 疾速 10 波的魔王确实就是终点, 但**无尽浪潮 waves=99** 每 5/10/20 波
   *     都会出 Boss(第 20 波还是标准那位 kingTuber, 40 起是 soulvine) => 玩家在无尽第 20 波杀掉它就
   *     **直接结算通关**, 与模式描述「波次无限, 越深越狂」自相矛盾。
   *   判据只留这一处: 倒计时走完(update 的波末分支)与「提前杀掉最后一波的 Boss」(onKill) 都问它。
   *   守卫: qa/verify-run-end.cjs (行为级: 无尽 20/40/60/80/99/120/200 杀 Boss 与走完波末都不许通关;
   *         标准 20 / 疾速 10 必须通关)。 */
  B.isFinalWave = function (w, mode) {
    var m = B.MODES[mode] || B.MODES.standard;
    /* v7.3(2026-09-30 审计): noWin = 这个模式**没有终点波**。修前 waves=99 会让无尽第 99 波
     *   走完(或杀掉那一波 Boss)时 finish(true) 结算成「通关」, 与 desc「波次无限」仍旧矛盾 ——
     *   用户逐字「无尽模式本应该是无限波次」。
     *   为什么不是把 waves 设成 Infinity: waves 还是标准/疾速两模式的终点波数, 也被 UI 当作「波数」显示;
     *   设成 Infinity 会把 UI 一起打坏; 「有没有终点」应当由独立标记决定, 不该由波数代替。 */
    if (m.noWin) return false;
    return (w | 0) >= m.waves;
  }
  /* v3.4(源对齐): 无尽因子, 出处 singletons/run_data.gd:775-782
   *     endless_wave = max(0, wave-20) ; endless_mult = 2.0 + max(0, (wave-35)*0.2)
   *     factor       = max(0, (ew*(ew+1))/2 / 100) * endless_mult
   *   源只用它做三件事: 价格膨胀(/5)、敌人属性成长、无敌帧缩短。标准 20 波内恒为 0。 */
  B.endlessFactor = function (w) {
    var ew = Math.max(0, (w || 0) - 20);
    var mult = 2.0 + Math.max(0, ((w || 0) - 35) * 0.2);
    return Math.max(0, ((ew * (ew + 1)) / 2) / 100) * mult;
  };

  /* ---------- 敌人成长 v2.2: 对齐 Brotato 引擎 = 基础值 + 每波增量(来自反编译提取) ----------
   * 敌人属性表(enemies.js)自带 hpW/dmgW 每波增量; 这里提供结算函数与全局系数。 */
  /* v2.4 / v2.5 (历史, 已废止): 曾给敌人 HP 加二次项 hpW*0.05*y², 目的是把"前段陡、后段平"的玩家 DPS
   *   曲线与敌人 HP 形状对齐。**v3.4 已整段删除** —— 源是纯线性(见下), 二次项会把后段直接变成断崖。
   *   保留本条只为记录历史结论为何翻烧饼, 不要再按它调参。 */

  /* v2.4 (C): 接触伤害 = 源原生线性逐波增量 dmg = base + dmgW*(w-1)。
   *   【v3.4 复核】本节旧文字曾引用"炮灰 sprout 1+dmgW*1.5"与"密度折扣 0.85", 两者**都已不存在**:
   *     · sprout 现为 dmg=1 / dmgW=0.6 —— 与源 ref/extract-enemies.json 同值(parity-source 门禁 0 差异);
   *     · crowdDmgMul(怪海稀释)在 v3.0 删除 —— 源里没有这个机制。
   *   现行口径(可直接复算): sprout 在 W5/W10/W20 = 1+0.6*4 / 1+0.6*9 / 1+0.6*19 = 3.4 / 6.4 / 12.4。
   *   高伤怪是**逐物种**差异(butcher 族 dmgW=1.5、bruiser 0.85), 不是全局放大系数。
   *   线性而非二次的原因: 单次伤害是"命中一次就付一次"的离散量, 二次化会在第 20 波造出 40+ 的一击必杀;
   *   威胁成长交给敌人表自身的 dmg/dmgW 与刷怪密度。 */

  /* v2.6 / v2.8 / v3.0 (历史, 均已废止): 逐波显式乘数表 dmgMulTable、密度折扣 crowdDmgMul、
   *   以及"速度门限"逐波表 enemySpdMulTable 都曾用于放大威胁, 现已**全部删除**(见下方 v3.4 段)。
   *   历史教训: "w 在涨 × dmgW 又大 × 乘数表叠乘"三者相乘会让单次伤害近似二次爆炸
   *   (旧版曾算出 W20 = 104.6 raw), 于是每一轮调参都在补偿上一轮的过冲 —— 这正是
   *   "同一组数值在不同轮次得出相反结论"的机制性来源。 */
  /* v3.4(源对齐): 源 entities/units/unit/stats.gd:32-33
   *     func get_base_health(wave): return health + health_increase_each_wave * (wave - 1)
   *   —— **纯线性**。v2.4 自制的 +hpW*0.05*y² 已删除: 源的难度爬坡不在属性上, 而在
   *   「波更长 + 怪更多 + 刷怪表更密」(ref/source-econ.md §2/§8), 二次项会把后段直接变成断崖。 */
  B.enemyHp  = function (base, hpW, w) { return base + hpW * (w - 1); };
  B.enemyDmg = function (base, dmgW, w) { return base + dmgW * (w - 1); };
  /* 疾速模式: 10 波体验完整 20 波曲线 —— 波序索引翻倍 */
  B.enemyWaveIdx = function (w, mode) { return mode === 'rush' ? Math.min(20, Math.ceil(w * 2)) : w; };
  /* v3.4(源对齐): 源里**敌人速度完全不随波次成长** ——
   *   entities/units/unit/unit.gd:112-120 reset_speed_stat() 只吃玩家的 enemy_speed 效果;
   *   entities/units/unit/stats.gd 全文只有 health / damage / armor 三个 *_increase_each_wave,
   *   **没有 speed**(ref/source-econ.md §2; 实参里也没有 current_wave)。
   *   源把「追不上/追得上」交给每只怪自带的 speed 常量(32 只: 0/120/150/175/200/250/275/300/350/380/400/425)。
   *   旧的自制逐波速度表(1.00 -> 4.20)是「怪物太弱 / 角色太强」投诉的直接来源: 它让每个物种在某一波
   *   突然集体越线, 既造断崖又让「跑得开」失效。删表 -> 恒 1.0。
   *   玩家速度同步回到源原生 450px/s(entities/units/player/player_stats.tres, 可实抓):
   *   250/300/400/425 的怪相对玩家因此分别是「追不上 / 勉强追上 / 压制」—— 与源同一把尺子。 */
  B.enemySpdMulFlat = 1;
  B.enemySpdMul = function () { return B.enemySpdMulFlat; };
  /* v7.12(用户「难度还是太简单 ... 我要求你去查看原版的难度系统, 来给我的游戏设定难度」):
   *   无尽波(w>20)的**敌人强度爬坡** —— 出处 singletons/entity_service.gd:24/46/60 三条逐字照搬,
   *   只删掉源里本作没有的 coop / accessibility / curse 三项系数:
   *     health : factor *= (1 + ef * 2.25)
   *     damage : factor *= (1 + ef)
   *     speed  : factor *= (1 + min(1.75, ef / 13.33))
   *   ef = B.endlessFactor(w)(源 run_data.gd:775-782, 第 20 波前恒 0 ⇒ 标准/疾速两支逐字不变)。
   *   为什么必须补: 本表此前**只有价格与无敌帧**吃 endlessFactor, 敌人属性一点都不涨 ——
   *   而源把「越深越狂」几乎全押在这条曲线(第 30 波生命 x3.48 / 第 40 波 x15.2, 复算见
   *   work/_w31-diff.cjs)。消费点唯一: src/core/game.js 的 spawnEnemy。 */
  B.enemyHpEndlessMul  = function (w) { return 1 + B.endlessFactor(w) * 2.25; };
  B.enemyDmgEndlessMul = function (w) { return 1 + B.endlessFactor(w); };
  B.enemySpdEndlessMul = function (w) { return 1 + Math.min(1.75, B.endlessFactor(w) / 13.33); };
  /* v3.2(主程): 同屏保底在场数 —— 自制参数(源 .gdc 读不出)。旧值硬编码在 game.js(6/12/25),
   *   现移到这里, 与 spawnInterval/spawnBatch 一起作为"密度"旋钮统一标定, 可被 --bal 扫描覆盖。
   *   口径: 这不是"怪海上限", 而是"至少留几只" —— 它直接决定玩家被贴脸的频率。 */
  /* v3.2(主程) 刷怪间隔 —— 改为**逐波显式表**(原为公式)。
   *   原因: 密度是难度曲线的主旋钮, 公式化让它无法逐波核对/参数扫描(--bal 只能覆盖数据)。
   *   口径: 单波刷怪总量 ≈ 波时长 / 间隔 × 批量; 因为"击杀 = 经验 = 材料", 它同时是难度源与成长源。
   *   旧公式(教学 0.9s / 中段 1.2→0.96 / 海潮 0.85→0.42)在 10 点血池下等于"第 1 波每 0.9s 塞 2 只",
   *   远超单武器玩家的清怪能力 → 怪堆到同屏 18 只, 探针 bot 7.5s 阵亡。 */
  B.SPAWN_INTERVAL = [4.8, 4.286, 5.625, 5, 5.854, 5.217, 5.769, 5.085, 5.455, 4.8, 4.235, 4.375, 3.889, 3.443, 3.478, 3.077, 2.712, 2.4, 2.124, 1.882];
  B.spawnInterval = function (w, mode) {
    var v = w <= 20 ? B.SPAWN_INTERVAL[w - 1] : Math.max(0.30, B.SPAWN_INTERVAL[19] - 0.012 * (w - 20));
    return v / (mode === 'rush' ? 1.8 : 1);
  };
  /* v2.4: 教学期 1 → 2 只/次。第 1-2 波单只只有 1 点伤害, 密度翻倍不会致死, 但能保证
   *   (a) 短程武器(环绕星/巨锤)一定有目标可打 —— 真机矩阵回归里 "25 秒 0 击杀" 的假警报
   *       全部来自"环绕星 orbitR=95, 而贴身怪距离只有 ~26px, 永远碰不到星"这一条几何死角;
   *   (b) 教学期不再空场(实测同屏从 6 只 → 10~14 只)。 */
  /* v2.4.1 实测否决: 曾试过把 7 波起的批量下移一档(3→2), 想削掉第 7 波断崖。结果**反而更糟**:
   *   批量 -33% ⇒ 击杀 -27% ⇒ 经验/材料 -27% ⇒ 类人 bot 更瘦, 9 波内阵亡率从 3/9 升到 4/6。
   *   结论已写进 balance.md §6: 在"经验=材料=击杀"的同源经济下, 刷怪量同时是难度源与成长源,
   *   削刷怪 = 削成长, 不能用来做难度下界的解。故恢复原式。 */
  /* v2.5 (W7 台阶摊平): 原式在第 7 波从 2 直接跳到 3, 而 game.js 的 minAlive 也在同一波 12→25,
   *   两件事叠在一起 → 探针实测第 6 波怪峰 13 → 第 7 波 28, 命中 6→26, ttk 从"打不死"掉到 18.5s。
   *   把批量曲线的拐点提前到第 3 波(2→3), 7 波起只保留 minAlive 这一个台阶, 且不再随波跳档:
   *   3-6 波 3 只/次(= +50% 刷怪量, 同时把中段 3~6 波的"零威胁"补起来) → 7-9 波 3 → 10-12 波 4 → ... */
  /* v2.5 定稿: 1-4 波 2 只 → 5-8 波 3 只 → 之后每 4 波 +1(9-12 波 4 / 13-16 波 5 / 17-20 波 6)。
   *   拐点选第 5 波而不是第 3 波: 放 3 波会把 W3-W4 怪峰从 ~14 抬到 17+ 并把弱 build 直接打死
   *   (真机 E2E 实测阵亡波次从 12 掉到 4)。放第 5 波则 W3-W4 保持教学强度, 而中段拿到 +50% 刷怪量。
   *   5-8 波批量恒定 → 第 7 波不再有"2→3"的台阶(那一档改由 game.js 的 minAlive 12→25 单独承担)。 */
  /* v2.6: 第 10 波单独 +1 档(3->4 只/次)。探针实测它是 20 波里唯一的"低密度洼地":
   *   第 9/12/15/17/19 波是怪潮(3x 批量), 第 10 波夹在中间, 同屏峰值只有 32 只(第 12 波 140),
   *   命中数 70(第 12 波 116) -> 净掉血被 regen/lifesteal 全额抵消(ttk=∞, "打不死")。
   *   它同时是首个小 Boss 波(elWeaver), 补成"半个怪潮"既解决洼地, 也符合节奏(难度不该在
   *   中段掉一个台阶再抬起来)。只改这一波, 不碰其它波的刷怪量/材料预算。 */
  /* v3.2(主程): 同样改为逐波显式表。旧式 w<=4 ? 2 : 2+floor((w-3)/4) 的拐点在第 5 波。 */
  B.SPAWN_BATCH = [2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 6, 7, 7, 7, 8, 8, 8, 8, 8, 8];
  B.spawnBatch = function (w) { return w <= 20 ? B.SPAWN_BATCH[w - 1] : B.SPAWN_BATCH[19] + Math.floor((w - 20) / 4); };
  /* v2.4 (B): 260 → 140 封顶。怪海化(200+ 只)把"压迫感"和"致死性"解耦: 同屏越多, 每只越不痛。
   *   省下的预算改为"单只更强"(enemies.js dmg/hpW), 同时改善手感与帧率(第 16 波 draw call 564/帧)。 */
  /* v3.4(源对齐): 源 zones/zone_1 的 wave_N.tres 的 max_enemies **20 波恒为 100**
   *   (ref/source-econ.md §8 波表逐波实读)。旧值 min(140, 40+12w) 是本作自制, 高波比源高 40%,
   *   既是「同屏越限」也是卡顿源(历史记录: 第 16 波 draw call 564/帧)。 */
  /* v3.5(源对齐): 源出生几何的四个常量, 出处:
   *   global/entity_spawner.gd:17  INITIAL_MIN_DIST_FROM_PLAYER = 300  (任何怪出生点至少离玩家 300px)
   *   singletons/utils.gd:32       EDGE_MAP_DIST = 64                  (贴边刷怪时距地图边界 64px)
   *   entity_spawner.gd:200-209    重掷失败时 min_dist 每次 -5, 下限 25
   *   尺子校验: 源竞技场 = zones/zone_1/zone_1_data.tres 的 width 32 x height 24 x TILE_SIZE 64
   *   = **2048x1536**; 本作 ARENA 2160x1480 —— 同一把尺子, 故这些常量 1:1 直用(不再乘任何本作系数)。 */
  B.SPAWN = { minDistFromPlayer: 300, edgeDist: 64, retryStep: 5, retryFloor: 25 };
  B.MAX_ENEMIES = 100;
  /* v7.10(源对齐, 用户「打到第 20 波, boss 出来没撑过 1 秒」): 无尽波的同屏上限 ——
   *   源 singletons/zone_service.gd:45 `wave.max_enemies *= 1.25 + (wave_index * 0.01)`,
   *   wave_index 是**循环后的** 10..19(见 src/data/endless.js 的 capMul) ⇒ 第 21 波起 135~144。
   *   标准/疾速模式恒 100(源 wave_N.tres 的 max_enemies 20 波恒为 100)。 */
  B.enemyCap = function (w, mode) {
    var mul = (mode === 'endless' && PS.Endless) ? PS.Endless.capMul(w) : 1;
    return Math.round(B.MAX_ENEMIES * mul);
  };
  /* ==================== v6.7(Wave 3): 燃烧 / 爆炸 / 结构体 / 树木 ====================
   * 这批常量只服务 Wave 3 补进来的 45 件道具里「需要新机制」的那 20 余件。
   * 每一条都给出处；**唯一一条本作自定**的是 B.EXPLOSION.baseR，理由写在它自己那一行。
   * 燃烧: 源 entities/units/unit/unit.tscn 的 BurningTimer.wait_time 基准 = 0.5 秒(
   *   unit.gd:67-71 再按 burning_cooldown_reduction 收紧: wait = max(0.1, 0.5 × (1 - sum/100)))。
   *   本作的 burnCdPct 通道就是这个 sum ⇒ 归一化公式见 game.js 的 burnWait()。
   * spreadR 是本作自定: 源里 spread>0 只激活粒子、**没有**扩散逻辑(unit.gd:652-657);
   *   本作把它实现成真扩散(卡面文案 snake「火苗会顺着荚爬到旁边」写的就是这个语义),
   *   半径取 120px ≈ 0.4 个身位环, 记为[有意偏差], 台账见 qa/source-port-items.md 的偏差段。 */
  B.BURN = { tick: 0.5, spreadR: 120 };
  /* v7.11(用户「boss 出场没撑过 1 秒就被我秒杀」的根因): %最大生命的伤害除数 ——
   *   源 enemy.gd:296-304 的 greek_fire(burning_enemy_hp_percent_damage) 把道具值先除以
   *   `_get_health_effect_percent_factor()`: 普通怪 **100**(unit.gd:753), 精英/Boss **1000**(boss.gd:62)。
   *   本作 hpPct 已经是百分数(10 = 10%), 故普通怪除数等价 1, 精英/Boss 再 /10。
   *   game.js:burnTick 是**唯一**消费点。 */
  B.BURN.hpPctFactor = function (e) { return (e && (e.boss || e.elite)) ? 10 : 1; };
  /* 同一处的第二个除数(源 enemy.gd:276 `var endless_factor = RunData.get_endless_factor() * 0.2`,
   *   :302 再 `/ max(1.0, endless_factor)`): 越深 %最大生命的伤害越被稀释, 免得无尽深处被百分比伤害
   *   单方面溶掉。第 20 波前恒 1 ⇒ 与 v7.11 的基准口径逐字一致。 */
  B.BURN.endlessDiv = function (w) { return Math.max(1, B.endlessFactor(w) * 0.2); };
  /* 爆炸: 源半径写在**二进制场景** projectiles/explosion.tscn 的 Hitbox 里(ref/ 下只有
   *   player_explosion.gd, 没有那个 .tscn) ⇒ 读不出来。本作把「基准半径」提成这一个旋钮;
   *   源 .tres 里可实读的 scale 字段严格照搬: rip_and_tear 0.65 / landmine 1.75 /
   *   spicy_sauce 1.25 / turret_rocket 1.0。
   *   伤害走源式(weapon_service.gd:281-286): round((damage + scaling_stat) × (1 + dmgPct + explodeDmgPct))。 */
  B.EXPLOSION = { baseR: 90 };
  /* 结构体同屏上限: 源 global/entity_spawner.gd:16 MAX_STRUCTURES = 100。 */
  B.STRUCT = { max: 100 };
  /* 树木(源 entities/units/neutral/neutral.gd:8 的 number_of_hits_before_dying 默认 8;
   *   one_shot_trees 时一下即倒)。treeTurrets 的补炮半径 200px 来自源 main.gd:585-588
   *   (`get_spawn_pos_in_area(neutral.global_position, 200)`)。 */
  B.TREE = {
    hits: 8, turretRadius: 200,
    /* v7.0(源对齐, 用户「砍到树木会掉落大量材料」) 源 tree_stats.tres 逐字:
     *   value = 3 · gold_spread = 75 · base_drop_chance = 1.0 · item_drop_chance = 0.2
     * 消费点: game.js::onKill 的 e.neutral 分支(源 main.gd:596-618 spawn_loot +
     *   singletons/item_service.gd:159-189 get_consumable_to_drop)。 */
    value: 3, goldSpread: 75, baseDropChance: 1.0, itemDropChance: 0.2,
    /* v7.1(源对齐, 用户「原版有树木 / 树木在地图中生成」) 源 zones/zone_1/000_all/group_1.tres
     *   + unit_1.tres —— 原版**每一波**都带这个 neutral 组(zone_data.groups_data_in_all_waves,
     *   wave_manager.gd:36-45 把它并进每一波的 groups_data):
     *     group : spawn_chance 1.0 · spawn_timing 10 · repeating 999 · repeating_interval 10
     *             ⇒ 开波后第 10 秒刷第一批, 之后每 10 秒一批(波时长 20~90s ⇒ 每波 2~9 批)
     *     unit  : min_number 1 · max_number 2 · spawn_chance 0.33
     *   数量口径(global/entity_spawner.gd:181-187):
     *     n = randi(min,max); NEUTRAL 再 n += tree_modifier(源 Keys.trees_hash 的**原值和**, 不除 100)
     *     total = n * spawn_chance; 结果 = floor(total) + (小数部分按概率 +1)
     *   ⇒ 不带任何道具时每批期望 1.5 x 0.33 = 0.495 棵, 60 秒的波约 3 棵 ——
     *     **树是默认就在地图上的**, 不靠 item「速生树苗」; 后者只是把 n 抬高。
     *   取点: 源 get_spawn_pos_in_area(全图) + 离玩家 >= INITIAL_MIN_DIST_FROM_PLAYER = 300px
     *   (entity_spawner.gd:17 / :190-205, 每次重取把门槛降 5 直到 25)。 */
    timing: 10, interval: 10, repeatMax: 999, groupChance: 1.0,
    unitMin: 1, unitMax: 2, unitChance: 0.33, minDistFromPlayer: 300,
    /* v7.1(源对齐) 波内「白送道具」硬顶 —— 源 main.gd:627 的 /(1+_items_spawned_this_wave) 本身就让
     *   同一波第 2/3 件越来越难出; 本作再加一条绝对上限(与 CONSUMABLE.maxPerWave 同族), 防止树多时
     *   白送成灾。命中才 ++, 每波清零。 */
    bonusItemCap: 4
  };
  /* 源 global/entity_spawner.gd:181-187 的数量口径(逐字落地): n = randi(min,max) + trees; total = n * chance。 */
  B.treeSpawnCount = function (trees, rng) {
    var r = rng || Math.random;
    var n = B.TREE.unitMin + Math.floor(r() * (B.TREE.unitMax - B.TREE.unitMin + 1));
    n += Math.floor(trees || 0);
    var total = n * B.TREE.unitChance;
    var f = Math.floor(total);
    return (r() < total - f) ? f + 1 : f;
  };
  /* 低血回复阈值: 源 potion 的 hp_regen_bonus 效果 value2 = 50 ——
   *   ref/cache-items/Brotato__items__all__potion__potion_effect_1.tres。 */
  B.REGEN_LOW_HP_PCT = 50;
  /* v2.4: 首个怪潮 7 → 9 波。怪潮是 3× 批量刷怪, 而第 7 波正处在"速度门限刚越线 + 同屏上限已到 124"的
   *   位置, 3× 批量会把同屏一次灌满(实测峰值 124 只), 让第 7 波成为第二个断崖
   *   (E2E 类人 bot 正是在第 7 波阵亡, 而验收要求它至少活到第 8 波)。
   *   后移到第 9 波后, 第 3~8 波变成"连续爬坡"; 怪潮作为波次事件仍保留 5 次。 */
  B.hordeWaves = [9, 12, 15, 17, 19];                               // 怪潮波
  B.isHorde = function (w) { return B.hordeWaves.indexOf(w) >= 0; };
  /* v3.2: 怪潮倍率改成数据。旧的硬编码 ×3 与"反解出的间隔"相乘后会把第 19 波推到 6000+ 刷怪量。 */
  B.hordeMul = 2;

  /* ---------- 经济 v2.3: 材料产出 = 设计预算, 与刷怪量解耦 ----------
   * 改前实测(真机 E2E, 第 12 波): 材料峰值 9113, 102 次购买 / 30 次刷新 —— 钱不是约束, 商店次数才是。
   * 根因: 怪海化把击杀数放大到 38~2163 只/波(含怪潮 ×3), 而"每只怪 1~3 掉落 × 面值 1~4"让材料产出
   *   同步爆了 ~90 倍, 远超价格曲线(~7 倍) → 通胀。
   * 口径: 每波材料预算 = k × 平均卡价(与 rollShop 同源定价), 普通波 k=2.4 / 怪潮波 k=3.2,
   *   即"每波末至少 1 件买不起"(材料被价格限制, 而不是被刷新次数/时间限制)。
   *   每只怪的材料期望 dropRate[w] = 该波预算 ÷ 该波满清击杀数。
   * 维护: 改 spawnInterval / spawnBatch / hordeWaves / enemyCap / 价格公式后, 必须按上式重填 DROP_RATE
   *   (推导表见 balance.md §3; tools/simulate2.cjs 的逐波诊断会打出 spawn/kills/income/avgCard)。 */
  /* v2.4 重填(hordeWaves 改为 [9,12,15,17,19] 之后): 怪潮波 3× 命中数 → 每怪期望按 1/3 摊薄。
   *   非怪潮波 0.28~0.44 / 怪潮波 0.15~0.16; 第 1-2 波高(教学期基础产量), 第 20 波 0.32(Boss 波)。
   * v2.4.1 实测否决: 曾把 W7 0.30→0.26 / W11 0.25→0.22 想压材料峰值, 复测 9 次后发现
   *   (a) 越界峰值并没有消失(最强 build 仍报 237) —— 因为"波内钱包峰值"的主项是**上一波没花掉的结余**,
   *       不是本波掉落率; (b) 收入 -12% 会直接削弱 bot 强度, 9 波内阵亡率反而从 1/6 升到 3/9。
   *   故恢复原值, 峰值问题改由 §6 的"结余/消耗能力"路线处理(不动掉落率)。 */
  /* v3.0: W10 0.23→0.19 —— 真机实测该波材料峰值 184~227(仍越 220 上限 7 点), 单怪期望再下调 17%;
   *   改后 e2e 实测 W10 峰值 184 ∈ [40,220] ✔(该波预算仍 ≈2.4× 平均卡价; 不是怪潮波, 密度由 spawnBatch 单独补)。 */
  /* v3.2(主程) 重填: 口径不变(每波材料预算 ≈ k × 平均卡价, k=2.4 普通 / 3.2 怪潮), 但**分母换成新的
   *   单波击杀数**(旧表按 300~2000 杀标定, 新密度只有 30~600 杀 ⇒ 旧速率把收入压掉了 5~10 倍,
   *   表现为"买不起东西 / 等级上不去")。怪潮波 [9,12,15,17,19] 刷怪量 ×3, 每怪期望按 1/3 摊薄。 */
  /* v3.4(源对齐): 材料掉落 = **概率 x 面值**, 出处 main.gd:596-618(spawn_loot) / main.gd:749-787(get_gold_value)
   *     每只怪掉不掉: spawn_chance = wave < 5 ? 1.0 : max(0.5, 1 - wave*0.015)   // main.gd:603-604
   *                   怪潮波再 x0.65                                            // main.gd:606-607
   *     掉多少:       value = unit.get_stats_value() = stats.value(源 1~10)       // unit.gd:99-100
   *                   value = max(value, MIN_GOLD_CHANCE*value), MIN=0.5          // main.gd:770, main.gd:22
   *     金粒数 = floor(value) + (小数部分按概率 +1) -> 期望恰好 value               // main.gd:699-701
   *     单粒面值恒 1(items/materials/gold.gd:4); 同屏金粒上限 50(main.gd:21)
   *   旧口径的错误: 自制 DROP_RATE 表把「每杀一只怪」当成必掉落 1~1.5 颗、面值恒 1
   *   => 单波材料 ~= 击杀数, 与源的「击杀数 x 0.5~1.0 概率 x value(1~10)」差一个 value 因子,
   *   再叠上本作更高的刷怪量, 就是用户投诉的「每波材料掉落太多」。 */
  B.dropChance = function (w, horde) {
    var c = w < 5 ? 1.0 : Math.max(0.5, 1 - w * 0.015);
    if (horde) c *= 0.65;
    return c;
  };
  /* 每只怪掉落的材料粒数: 期望 = def.value(与源 get_stats_value() 同源), 面值恒 1 */
  B.dropCount = function (def, rng) {
    var v = Math.max(1, (def && def.value) || 1);
    var n = Math.floor(v);
    if (rng() < v - n) n++;
    return n;
  };
  /* v7.0(源对齐) 源 main.gd:21 MAX_GOLDS = 50 —— 同屏金粒上限, 满了改成"往已有粒子上加量"
   *   (见 game.js::spawnLootGold); :22 MIN_GOLD_CHANCE = 0.5 是 get_gold_value 的下限。 */
  B.MAX_GOLDS = 50;
  B.MIN_GOLD_CHANCE = 0.5;
  B.dropValue = function () { return 1; };   // 源: 单粒面值恒 1(items/materials/gold.gd:4)
  /* v7.1(源对齐) 源 main.gd:749-770 get_gold_value 的**收尾那一步**:
   *     value = max(value, MIN_GOLD_CHANCE * base_value)      MIN_GOLD_CHANCE = 0.5 (main.gd:22)
   *   本作 199 件道具里**没有**任何 gold_drops 通道 ⇒ pct 恒 0 ⇒ 今天这一步是恒等式。
   *   保留的两条理由: ①它是源公式的一部分(将来加通道不用再改结构);
   *   ②它保证「材料不会因为任何负向修正掉成 0」这一条用户可见的性质。
   *   消费点: game.js::onKill 的普通怪分支(算完粒数 n 之后过一道)。 */
  B.goldValue = function (base, goldDropsPct) {
    var b = base || 0;
    var v = b * (1 + (goldDropsPct || 0) / 100);
    return Math.max(v, B.MIN_GOLD_CHANCE * b);
  };
  /* v2.8: 回退未验证的 10 → 2。源: run_data.gdc 有 stat_harvest / convert_bonus_gold(字节码, 公式读不出),
   *   items/upgrades/harvesting/*.tres 未缓存 → 用冻结前实测值 2(见 ref/brotato-numbers.md §5)。 */
  /* v3.4(源对齐): 源波末收获 = harvesting 属性本身(main.gd:1265-1269), 而玩家初始 harvesting = 0
   *   (singletons/player_run_data.gd:404, 键名 stat_harvesting)。旧值 2 是本作白送的保底,
   *   它让每一波都凭空多 2 点材料 + 2 点经验; 与「材料=经验同源」叠加后直接抬高等曲线。删掉。 */
  B.baseHarvest = 0;
  /* v3.4(源对齐): 源的 harvesting 每波自我增长 ceil(harvesting * growth/100), growth 默认 **5**
   *   (main.gd:1472 结算 + singletons/player_run_data.gd:437 harvesting_growth_hash: 5)。
   *   harvestingGrowth 词条(「收获每波额外增长」)叠加在这 5 之上。 */
  B.HARVEST_GROWTH_PCT = 5;
  /* v2.8 (源对齐 + 收入反推): 原作公式在 run_data.gdc 的 GDSC 字节码里读不出(见 ref/brotato-numbers.md §1),
   * 改由**实测 XP 收入**反推。口径: game.js:530 gainMaterial(v) 内 g.xp += v → XP 收入 ≡ 击杀掉落材料
   * (波末 harvestBonus 只加材料, 不加 XP)。
   * 实测收入: X(1)≈82 ; X(1..5)≈400~470 ; X(1..12)≈832 ; 20 波总量 709(simulate2 模型)~1600(真机外推)。
   * 收入基本平坦(≈70~110/波, 因为 DROP_RATE 把每波材料预算压在同一量级) ⇒ 单级需求也必须近似平坦,
   * 否则"第 5 波 ≤ LV8"与"第 20 波 LV28~32"不可能同时成立(ref/brotato-numbers.md §1.3 的可行域证明)。
   * 取 need(L) = round(48 + 0.10L²): C(3)=96 > X(1)=82 ⇒ W1 结束 LV2(验收 ≤3 ✔);
   *   C(8)=351 / C(9)=405 ⇒ X(1..5)=344~402 ⇒ W5 结束 LV7~8(验收 ≤8 ✔);
   *   C(18)=996 / C(20)=1183 ⇒ W12 收入 ~940~1130 ⇒ LV17~19(验收 18~26, 低沿差 1 级);
   *   C(30)=2249 / C(32)=2531 ⇒ 真机高击杀 bot 的 20 波收入 ~2730 ⇒ LV31~33(验收 28~32)。
   * 二次项 0.10 是"后段才显形"的旋钮(need(1)=48 / need(20)=88 / need(30)=138): 中后期每级 ≈ 1~2 件道具的材料,
   * 既压住"杀得多就滚雪球"(旧曲线 20 波可到 LV41+), 又不放弃前期节奏(仍 1.5~2 级/波)。
   * 旧曲线 10+0.26L²: C(6)=64 → 第 1 波就到 LV6(用户实测"第 1 波结束就到 10 级")。 */
  /* v3.0(主程口径): 目标「第 1 波结束 LV1~2 / 20 波 LV20~25」。XP 收入实测仍是每波 50~140(材料=XP 同源),
   *   20 波总量 700(simulate2 模型)~2700(真机高击杀)。need(L)=round(64+0.22L²):
   *     C(2)=64   < X(1)≈82            ⇒ W1 结束 LV2 ✔(验收 ≤2)
   *     C(8)=512  vs X(1..5)≈400~500   ⇒ W5 结束 LV7~8 ✔
   *     C(25)=2614 / C(26)=2725 vs 高击杀 20 波 2700 ⇒ LV25~26 ✔(验收 20~25)
   *   旧式 48+0.10L² 在同收入下到 LV31~33(超验收上限 6~8 级) → 二次项 0.10→0.22、截距 48→64。 */
  /* v3.2(主程) 经验曲线 —— 参数化为 XP_A + XP_B×L², 便于扫描与复核。
   *   旧常数 (64, 0.22) 是按**旧刷怪量**标定的(那时单波击杀 300~2000 只, 20 波总收入数千 XP)。
   *   密度回到源量级后单波击杀只有 30~600 只 ⇒ 旧曲线下 bot 第 7 波才 LV4, 完全跟不上。
   *   新常数由"实测总 XP ÷ 目标等级"反解, 见 balance.md §15。 */
  /* v3.4(源对齐): 源 singletons/run_data.gd:767-772
   *     func get_xp_needed(level): return pow(3 + level, 2)
   *     func get_next_level_xp_needed(): return get_xp_needed(current_level + 1)
   *   => 从 L 升到 L+1 需要 (L + 4)^2 点经验(**源里没有等级上限**)。
   *   单级: 0->1:16 · 1->2:25 · 5->6:81 · 10->11:196 · 19->20:529
   *   累计: LV20 = 4310 · LV25 = 7700(ref/source-econ.md §1 阈值表)。
   *   旧的自制 22.39+0.4093L^2 是在**旧掉落口径**下反解出来的; 掉落已改回源口径, 必须同时换回源式,
   *   否则两条曲线互相抵消, 「第 1 波就到 10 级 / 节奏不对」会以另一种形状复发。 */
  B.xpNeed = function (lvl) { return (lvl + 4) * (lvl + 4); };
  B.LEVELUP_CHOICES = 4;

  /* ---------- 商店 ---------- */
  B.SHOP_SLOTS = 4;
  /* v2.6: 道具占比 0.50 -> 0.65。实测(e2e 商店轨迹)开局 2 次商店共 11 次购买里 **8 次是武器**,
   *   道具只买到 2-3 件 -> "波间不回血 + 无回复道具"的低血 build 在第 3-5 波稳定阵亡。
   *   武器槽只有 6 个, 溢出购买对生存毫无贡献; 提高道具占比 = 让同一笔材料买到更多"保命"选项,
   *   而道具价格/材料产出都不变(不放松"材料是约束"的设计)。 */
  /* v3.5(源对齐) 源 singletons/item_service.gd:24 CHANCE_WEAPON = 0.35 —— 商店每一格出武器的**基础概率**。
   *   注意这只是基础概率: 源还有武器**保底**(wave<=2 保 2 把, wave<=5 保 1 把, 见 game.js rolloutShop),
   *   旧代码写成自制 50/50 且没有保底 ⇒ 前 5 波可能一把武器都不给。 */
  B.CHANCE_WEAPON = 0.35;
  B.shopCardType = function (w, rng) { return ((rng || Math.random)() < B.CHANCE_WEAPON) ? 'weapon' : 'item'; };
  /* v3.10(源对齐) 源 singletons/item_service.gd:25-30 + :335-338 + :377-386 —— **同武器偏置**:
   *     chance_same_weapon     = 0.20 + max(0, (5+1-wave) * (0.05/5))
   *     chance_same_weapon_set = 0.35 + max(0, (5+1-wave) * (0.20/5))
   *   每格抽武器前掷一次 rand_wanted = randf():
   *     rand_wanted < chance_same_weapon     -> 候选池只留**玩家已持有的 weapon_id(族)**
   *     rand_wanted < chance_same_weapon_set -> 候选池只留与玩家已有 set 相交的武器
   *   池被筛空 -> 回落 backup_pool(未筛池), 再回落该档全池(item_service.gd:454-461)。
   * 为什么必须搬: 源的"同名武器"是**买得到**的。本作此前在 203 把里均匀抽 => 想凑出第二把
   *   同名同阶件要连撞 2 次同一把(1 阶池 61 把, 概率 ~1/3721) => 用户实测反馈
   *   「购买同名武器还是无法合成」撞在这里: 不是合成函数坏了, 而是**永远刷不出第二把**。
   * set 偏置(v5.7 已实现): 源 extract-weapons.json 里**没有** set 字段 ⇒ **数据**无源可搬(套装归属在
   *   .tres 资源里, 不在反编译产物内); 但**机制**在源里写得很清楚 —— item_service.gd:382-390 的
   *   elif rand < chance_same_weapon_set 把池筛成"身上已有套装的武器", run_data.gd:1043 update_sets()
   *   负责计数。本作自建了武器套装分组(src/data/sets.js, 原创命名与分组) ⇒ 机制现在可以照源复现,
   *   见下面的 sameWeaponSetChance。 */
  B.CHANCE_SAME_WEAPON = 0.20;                 /* 源 CHANCE_SAME_WEAPON = 0.2 */
  B.BONUS_CHANCE_SAME_WEAPON = 0.05;           /* 源 BONUS_CHANCE_SAME_WEAPON = 0.05 */
  B.WAVE_SAME_WEAPON_BONUS_UNTIL = 5;          /* 源 MAX_WAVE_ONE_WEAPON_GUARANTEED = 5(源复用它做衰减窗) */
  B.sameWeaponChance = function (w) {
    var win = B.WAVE_SAME_WEAPON_BONUS_UNTIL;
    return B.CHANCE_SAME_WEAPON + Math.max(0, (win + 1 - (w || 1)) * (B.BONUS_CHANCE_SAME_WEAPON / win));
  };
  /* v5.7(源对齐) 同**套装**偏置 —— 源 item_service.gd:25/29 + :335-336:
   *   const CHANCE_SAME_WEAPON_SET = 0.35 · const BONUS_CHANCE_SAME_WEAPON_SET = 0.2
   *   bonus = max(0, (MAX_WAVE_ONE_WEAPON_GUARANTEED + 1 - wave) * (0.2 / MAX_WAVE_ONE_WEAPON_GUARANTEED))
   *   chance_same_weapon_set = 0.35 + bonus
   * 衰减窗与同武器偏置共用 MAX_WAVE_ONE_WEAPON_GUARANTEED = 5(源就是复用它, 不是新常数)。
   * 消费点: game.js rollShop —— 池筛成"族属于身上已有套装的武器"(源 :382-390)。 */
  B.CHANCE_SAME_WEAPON_SET = 0.35;                 /* 源 CHANCE_SAME_WEAPON_SET = 0.35 */
  B.BONUS_CHANCE_SAME_WEAPON_SET = 0.20;           /* 源 BONUS_CHANCE_SAME_WEAPON_SET = 0.2 */
  B.sameWeaponSetChance = function (w) {
    var win = B.WAVE_SAME_WEAPON_BONUS_UNTIL;
    return B.CHANCE_SAME_WEAPON_SET + Math.max(0, (win + 1 - (w || 1)) * (B.BONUS_CHANCE_SAME_WEAPON_SET / win));
  };
  /* v7.0(Codex) 这一段原本记的是 v2.8 的**自制几何比**(s = 0.35 + 0.02w + 0.012*luck, 权重 [1,s,s2,s3]),
   * 它已在 v3.4/v3.5 被源口径整段取代, 但注释留在这里 ⇒ 后来人会以为那是现行算法而"顺手改回去"。
   * 现行口径只剩下面这三条(全部来自反编译源, 由 qa/verify-source-econ.cjs 钉住):
   *   ① 档位      singletons/item_service.gd:520-547 get_tier_from_wave  —— 见 B.TIER_DATA / rollTierFromWave
   *   ② 果实掉落率 singletons/item_service.gd:162-166 min(1.0, base_drop_chance*(1+luck))  —— B.fruitDropChance
   *   ③ 逐波档位  main.gd:625 / item_service.gd:162 里 luck 一律等于 Σ stat_luck / 100
   * luck 只乘"随波增长的那一项", 不动 BASE_CHANCE, 且每档有 MAX_CHANCE 硬顶
   *   ⇒ 「稀有+」恒 <= 25%、「普通+」恒 <= 60%(ref/source-econ.md §6)。 */
  /* v3.4(源对齐) 稀有度: 源 singletons/item_service.gd:34-44, 98-103(_tiers_data), 520-547(get_tier_from_wave)
   *   档位表(tier: MIN_WAVE / BASE_CHANCE / WAVE_BONUS_CHANCE / MAX_CHANCE)
   *     common    0 / 1.0 / 0.0    / 1.0
   *     uncommon  0 / 0.0 / 0.06   / 0.6
   *     rare      2 / 0.0 / 0.02   / 0.25
   *     legendary 6 / 0.0 / 0.0023 / 0.08
   *   判定: rand = randf(); luck = stat_luck/100
   *         wave_base   = max(0, ((wave-1) - MIN_WAVE) * WAVE_BONUS)
   *         wave_chance = luck >= 0 ? wave_base*(1+luck) : wave_base/(1+|luck|)
   *         chance      = min(BASE_CHANCE + wave_chance, MAX_CHANCE)
   *   从最高档往下第一个 rand <= chance 的档胜出。
   *   luck **只乘 wave 项**, 不动 BASE_CHANCE; 且每档有 MAX_CHANCE 硬顶
   *   => 「稀有+」恒 <= 25%、「普通+」恒 <= 60%(ref/source-econ.md §6)。
   *   旧的自制几何比 s=0.35+0.02w+0.012luck 会随 luck 无上限地推向高品质 —— 这正是
   *   「运气越高商店物品越好」到失真的原因。现在 luck 只能"更早撞顶 + 在稀有档内部把配额挪给传说"。 */
  B.TIER_DATA = [
    { name: 'common',    minWave: 0, base: 1.0, waveBonus: 0.0,    max: 1.0 },
    { name: 'uncommon',  minWave: 0, base: 0.0, waveBonus: 0.06,   max: 0.6 },
    { name: 'rare',      minWave: 2, base: 0.0, waveBonus: 0.02,   max: 0.25 },
    { name: 'legendary', minWave: 6, base: 0.0, waveBonus: 0.0023, max: 0.08 }
  ];
  /* 逐档累计命中概率 [common, uncommon, rare, legendary](已夹顶) */
  B.tierChances = function (w, luck) {
    var lk = (luck || 0) / 100, out = [], i, t, wb, wc, c;
    for (i = 0; i < 4; i++) {
      t = B.TIER_DATA[i];
      wb = Math.max(0, ((w - 1) - t.minWave) * t.waveBonus);
      wc = lk >= 0 ? wb * (1 + lk) : wb / (1 + Math.abs(lk));
      c = t.base + wc;
      out.push(Math.min(c, t.max));
    }
    return out;
  };
  /* 权重口径(供 weighted 抽卡): P(档 i) = c[i] - c[i+1] */
  B.rarityWeights = function (w, luck) {
    var c = B.tierChances(w, luck);
    return [1 - c[1], c[1] - c[2], c[2] - c[3], c[3]];
  };
  /* v3.5(源对齐) 源 get_tier_from_wave(singletons/item_service.gd:520-547) 的**逐档判定原样落地**:
   *     rand = randf(); luck = stat_luck/100
   *     从最高档往低档扫, 第一个 rand <= min(BASE_CHANCE + wave_chance, MAX_CHANCE) 的档胜出。
   *   它与上面的 rarityWeights 是同一个分布, 但这是源的原始写法 ⇒ 商店与升级池**共用同一个函数**,
   *   不再出现"商店走权重抽卡、升级池走另一套"的双口径。 */
  B.rollTierFromWave = function (w, luck, rng) {
    var lk = (luck || 0) / 100, rand = (rng || Math.random)();
    var tier = 0, i, t, wb, wc;
    for (i = B.TIER_DATA.length - 1; i >= 0; i--) {
      t = B.TIER_DATA[i];
      wb = Math.max(0, ((w - 1) - t.minWave) * t.waveBonus);
      wc = lk >= 0 ? wb * (1 + lk) : wb / (1 + Math.abs(lk));
      if (rand <= Math.min(t.base + wc, t.max)) { tier = i; break; }
    }
    return tier;
  };
  /* v3.5(源对齐) 源 get_upgrade_data(singletons/item_service.gd:581-590) 的升级档位:
   *     tier = get_tier_from_wave(level)          <-- 入参是**玩家等级**(main.gd:862 get_player_level), 不是波次
   *     level == 5           → uncommon(1)
   *     level in (10,15,20)  → rare(2)
   *     其余 level % 5 == 0  → legendary(3)
   *   注意分支顺序: 5 走第一支, 10/15/20 走第二支, 25/30... 才落进第三支。 */
  B.levelupTier = function (level, luck, rng) {
    var tier = B.rollTierFromWave(level, luck, rng);
    if (level === 5) tier = 1;
    else if (level === 10 || level === 15 || level === 20) tier = 2;
    else if (level % 5 === 0) tier = 3;
    return tier;
  };

  /* v7.2(源对齐) 源 singletons/item_service.gd:550-556 `get_upgrades` 的**武器槽位早退分支**:
   *     var weapon_slot_upgrades = RunData.get_player_effect(Keys.weapon_slot_upgrades_hash)
   *     var current_weapon_slots = RunData.get_player_effect(Keys.weapon_slot_hash)
   *     if weapon_slot_upgrades > 0 and current_weapon_slots < weapon_slot_upgrades:
   *         return [weapon_slot_upgrade_data]        # 整页**只有这一张**
   *   ⇒ 除该情况外, 武器槽位**永远不进**升级池。
   *   为什么排除必须写在**选择规则**这一侧而不是数据里: 源里 weapon_slot_upgrade_data 是与
   *   upgrades 数组**并列的独立 export**(item_service.gd:67), 而本作 tools/gen-upgrades.cjs 的口径是
   *   「items/upgrades/ 下每个 *_data.tres 全收」⇒ 它被并进了 PS.UpgradeData.list; 而 qa/verify-upgrades.cjs
   *   要求那份数据与源**逐条对视**(77 条源池), 所以生成物必须保持不动。
   *   源里唯一给这条词条的是 characters/baby/effects/baby_effect_1.tres(value = 24);
   *   本作 20 名角色都没有它 ⇒ 正常情况下这张卡一次都不会出现, 但机制按源保留。
   *   用户原话: 「升级选项不能有加武器槽位这一选项」。 */
  B.LEVELUP_EXCLUDE = { weaponSlot: 1 };
  B.LEVELUP_WEAPON_SLOT_STAT = 'weaponSlot';
  /* 源早退分支的判据, 单独成函数(门禁逐点对拍的就是它, 不是调用点的内联写法) */
  B.levelupWeaponSlotGate = function (stats) {
    var s0 = stats || {};
    var target = s0.weaponSlotUpgrades || 0;
    var cur = s0.weaponSlot || 0;
    return target > 0 && cur < target;
  };
  B.levelupWeaponSlotCard = function () {
    var UD = PS.UpgradeData, i, u;
    if (UD && UD.list) {
      for (i = 0; i < UD.list.length; i++) {
        u = UD.list[i];
        if (u && u.stat === B.LEVELUP_WEAPON_SLOT_STAT) {
          return { id: u.id, stat: u.stat, name: u.name, desc: u.desc, v: u.value, pct: !!u.pct, tier: u.tier };
        }
      }
    }
    return null;
  };
  /* UpgradeData 缺失时的兜底: 旧的 17 张手写卡按**三档值**展开成 51 张(每张带 tier), 这样
   *   levelupPoolTier 在两条数据源下是同一个语义(旧兜底一次只给一个值, 与逐卡掷档不兼容)。 */
  B.levelupFallbackCards = function () {
    var out = [], i, t, c;
    for (i = 0; i < B.LEVELUP_POOL.length; i++) {
      c = B.LEVELUP_POOL[i];
      for (t = 0; t < 3; t++) {
        out.push({ id: 'fb_' + c.stat + '_' + (t + 1), stat: c.stat, name: c.name, v: c.v[t], pct: !!c.pct, tier: t });
      }
    }
    return out;
  };
  /* 全档位候选(兜底抽卡用): 源 items/upgrades 里 stat 已接线、且不在排除表内的全部条目 */
  B.levelupPoolAll = function () {
    var UD = PS.UpgradeData, out = [], i, u;
    if (UD && UD.list && UD.list.length) {
      for (i = 0; i < UD.list.length; i++) {
        u = UD.list[i];
        if (u.stat && !B.LEVELUP_EXCLUDE[u.stat]) {
          out.push({ id: u.id, stat: u.stat, name: u.name, desc: u.desc, v: u.value, pct: !!u.pct, tier: u.tier });
        }
      }
      if (out.length) return out;
    }
    return B.levelupFallbackCards();
  };
  /* 源 _tiers_data[tier][TierData.UPGRADES] —— 该档位的候选列表 */
  B.levelupPoolTier = function (tier) {
    var all = B.levelupPoolAll(), out = [], i;
    for (i = 0; i < all.length; i++) if (all[i].tier === tier) out.push(all[i]);
    return out;
  };
  /* v7.1(源对齐, 用户「运气属性你也查看原版代码，给他重新修改」) —— 旧的自定形状
   *   `0.06 + 0.003*luck + 0.003*w`(基础 6% + 每波 0.3pp + 每点运气 0.3pp) 作废:
   *   那个「每波 +0.3pp」在原版里**没有出处**, 「每点运气 0.3pp」也与源差一个量级。
   *   现行唯一口径 = 源 main.gd:621-640 spawn_consumables 的 item_chance 那一条:
   *     luck        = Σ(stat_luck) / 100                        (源 main.gd:625)
   *     item_chance = item_drop_chance * (1 + luck) / (1 + n)    (源 main.gd:627)
   *   item_drop_chance 取自源 stats.gd:20(普通怪 0.01)/ tree_stats.tres(树 0.2);
   *   n = 本波已经白送出去的道具数(源 main.gd:48 _items_spawned_this_wave, :638 命中才 +1, 每波清零)
   *   ⇒ 同一波第 2 件是第 1 件的一半概率, 第 3 件是三分之一。 */
  B.itemChance = function (luck, itemDropChance, spawned) {
    var lk = (luck || 0) / 100;
    return Math.min(1, (itemDropChance || 0) * (1 + lk) / (1 + (spawned || 0)));
  };
  /* 波末幸运掉落(本作保留的用户要求机制)的**掷骰率** —— 形状改用源 item_chance,
   *   基准取源 tree_stats.tres 的 item_drop_chance = 0.2(树是源与本作共同的 loot 单位)。
   *   w 不再参与(源式里波次只通过 get_tier_from_wave 影响**品质**, 不改掉落频率) ——
   *   形参保留只为不改调用点签名。 */
  B.luckDropChance = function (w, luck, spawned) {
    void(w);
    return B.itemChance(luck, B.TREE.itemDropChance, spawned);
  };
  /* v2.9 (口径写清, 实现不动): 源里武器**没有** value 字段(extract-weapons.json 无该键) → 无源可搬, 采用口径:
   *   武器价 = 族基础价(base 13~17, 均值 14.875) × 阶系数 PS.WeaponData.tierPrice[1,2.3,4.8,9.5] × 波次系数 (0.9+0.055w)
   *   等价于"同档道具中位价 × 0.74(1阶) / 0.99(2阶) / 1.33(3阶) / 1.84(4阶)" —— 高阶武器对同阶道具溢价,
   *   这是主动选择(武器只 6 槽, 且是主要输出源)。
   *   注意: **不能**把阶系数换成源道具递进(2.25/1.56/1.43) —— game.js:698 的出售价用的是同一个 tierPrice;
   *   若买卖两侧阶曲线不同, 4 阶武器会出现"买低卖高"(sell/buy = 9.5×0.5/5 = 0.95 = 刷钱漏洞)。当前同阶 ⇒ sell/buy ≤ 0.52。 [PLACEHOLDER: 源无武器价] */
  B.weaponPrice = function (base, tier, w) { return Math.round(base * PS.WeaponData.tierPrice[tier - 1] * (0.9 + w * 0.055)); };
  /* v2.6: 开局折扣 0.85 -> 0.55(线性部分不变)。引擎在波间不回血, 而 popo(基础 hp 100) 在
   *   第 3-5 波就吃满 112 点伤害 —— 只要开局买不到 1-2 件"回复/血量"道具就必死(实测 e2e
   *   6 个种子里 4 个死在第 3-5 波, 全部 maxHp=112 regen=0 道具<=2 件)。折扣让同一笔材料能
   *   多买 1 件, 把"生存"从一次掷骰变成可有可无的冗余; 中后期价格仍随 w 线性上涨, 不改变
   *   "每波末至少 1 件买不起"的取舍。 */
  /* v2.6 实测结论(否决两条"喂经济让 bot 活久一点"的路线): 全局降价 0.85->0.55、道具占比
   *   0.50->0.65 都能把 e2e 的阵亡波次从 3-5 抬到 6-12, 但代价是**同一份经济体**让 20 波
   *   bot 直接推到 maxHp 271-402 / dodge 60(封顶) / regen 18.4 -> 探针 7 个检查点全部"打不死"。
   *   游戏没有"难度随玩家强度缩放"的机制, 所以"喂经济"等于同时喂强两端 -> 一律回退,
   *   开局生存改由敌人侧解决(enemies.js 的 charger/spitweed 进池波次)。 */
  /* v2.9 (源对齐): 档位基准价 = 源 extract-items.json 的 value **中位数** [20,45,70,100]
   *   (中位 vs 均值: 20/20.4 · 45/45.0 · 70/71.0 · 100/98.6 → 取中位数, 抗离群值, tier3 存在 1 件的 value=1)。
   *   档间比值 2.25 / 1.56 / 1.43 与源逐档一致(旧的 [13,28,58,115] 是 2.15/2.07/1.98 近等比, 形状不符)。
   * 波次系数: (0.85+0.05w) → (0.60+0.05w) → **v3.0 定稿 (0.50+0.05w)**。斜率不变; 0.60 版把 T1/T2
   *   (前 4 波唯一买得起的档)抬到比旧经济贵 8~16% ⇒ 真机探针三粒种子全部第 5 波阵亡(改回旧价即存活到第 20 波,
   *   故 itemPrice 是本轮唯一诱因)。0.50 版 T1~T4 全档 <= 旧经济 ⇒ 前期强度不低于改前, 且仍满足"波末至少 1 件
   *   买不起"(W20 的 T4 价 150 vs 单波产出 40~220)。 */
  /* v3.4(源对齐): 源 singletons/item_service.gd:719
   *     price = int(max(1, (base + wave + base*wave*0.1) * itemsPriceFactor * (1 + endlessFactor/5)))
   *   base = 该档道具的源 value(20/45/70/100, ref/source-econ.md §5 价格样本); itemsPriceFactor 默认 1.0
   *   —— 本作的 shopPricePct 词条由 game.js 继续乘在外面, 不在这里重复。
   *   样本(base 20): W1 23 · W5 35 · W10 50 · W15 65 · W20 80(旧式 11/15/20/25/30)。
   *   变贵不是单方面削玩家: 源的**材料收入也更厚**(value 1~10 的怪), 两者同批更换才自洽。 */
  B.itemPrice = function (rarity, w) {
    var base = [20, 45, 70, 100][Math.max(1, Math.min(4, rarity | 0)) - 1];
    var raw = (base + w + base * w * 0.1) * (1 + B.endlessFactor(w) / 5);
    return Math.max(1, Math.floor(raw));
  };
  /* v3.4(源对齐): 源 item_service.gd:724-725
   *     cost = int(wave*0.75) + delta + delta*reroll_count,  delta = int(max(1, 0.4*wave*sqrt(1+endlessFactor))) */
  B.rerollPrice = function (w, rerolls) {
    var delta = Math.max(1, Math.floor(0.4 * w * Math.sqrt(1 + B.endlessFactor(w))));
    return Math.floor(w * 0.75) + delta + delta * Math.max(0, rerolls | 0);
  };
  /* v3.4(源对齐): 源 item_service.gd:736 —— 回收基准 **25%**; 旧值 0.5 是本作自制。 */
  B.sellRatio = 0.25;
  /* v7.9(Codex, 2026-10-01) 回收折价 —— 用户逐字「把原版道具掉落可自行选择拾取或丢弃机制加进来」。
   *   丢弃掉落物换回多少材料 = 源 singletons/item_service.gd:701-719 get_value + :732-742 get_recycling_value,
   *   两条公式逐字照搬(唯一的差别: 源里 itemsPriceFactor / endlessFactor 这几项本作没有对应词条, 恒等于 1/0):
   *     value     = int(max(1, base + wave + base*wave*0.1))
   *     recycling = int(max(1, value * clamp(0.25 + recycling_gains/100, 0.01, 1.0)))
   *     return min(value, recycling)          # 回收永远不会比商店价还高
   *     if base == 1: return 1                # 源 :739-740 的早退(1 块钱的东西不给折价)
   *   base 用**这一件自己的源 value**(本表 `def.price`, 见 items.js 头注「price(源 value, 售价事实)」) ——
   *   不是 B.itemPrice 那种"按档位取中位 value"的近似: 回收是逐件的真值。
   *   recycling_gains 就是本作的 stats.recycleGainPct(源道具 recycling_machine / 词条 recycling_gains),
   *   与 sellWeapon 的 `clamp(0.25 + pct/100)` 是**同一条 clamp**, 只是那条走武器价、这条走道具价。 */
  B.recycleValue = function (fromValue, w, gainPct) {
    var base = Math.max(1, Math.round(fromValue || 1));
    if (base === 1) return 1;                       /* 源 :739-740 */
    var value = Math.max(1, Math.floor(base + w + base * w * 0.1));   /* 源 get_value, 无词条 => factor 恒 1 */
    var ratio = Math.max(0.01, Math.min(1.0, B.sellRatio + (gainPct || 0) / 100));
    var recycling = Math.max(1, Math.floor(value * ratio));
    return Math.min(value, recycling);
  };
  B.WEAPON_SLOTS = 6;

  /* ---------- 玩家基准 ---------- */
  B.PLAYER = {
    /* v3.0 源原生刻度(1:1): 源 base maxHp = 10(源 stat_max_hp 词条 -5~15/中位 3, 见 ref/brotato-numbers.md §8),
     *   本作角色 hp 同步 100→10 (characters.js)。speed/pickup 是**空间量**, 沿用本作世界刻度
     *   (本作世界 2240x1560 ≈ 源竞技场 1000x600 的 2 倍) —— 见 balance.md §11.1。 */
    /* v3.4(源对齐): 玩家基础速度 450px/s —— entities/units/player/player_stats.tres 实抓原文
     *   (health=1, health_increase_each_wave=1, speed=450, damage=1, attack_cd=30)。
     *   旧值 250 是本作自制, 它让 300~425 的怪**永远追得上人**, 于是速度差这个维度被抹平。 */
    maxHp: 10, speed: 450, pickup: 90,
    /* 注意: PLAYER.regen/maxHp 目前是**死数据** —— stats.js 的 blank() 把 FLAT 属性一律置 0,
     *   只读 PLAYER.crit / PLAYER.pickup / PLAYER.speed(见 stats.js:27-45)。玩家基准回复必须
     *   走升级卡或道具, 不要在这里写, 否则会误导后来人(数值组 v2.6 实测确认)。 */
    regen: 0, lifesteal: 0,
    dmgFlat: 0, dmgPct: 0, meleeDmg: 0, rangedDmg: 0,
    atkSpd: 0, crit: 3,   // v3.0: critDmg 已彻底下架(引擎改用武器自带 critMul, combat.js:36)
    rangePct: 0, armor: 0, dodge: 0, speedPct: 0, maxHpPct: 0,
    luck: 0, harvest: 0, thorns: 0
  };
  /* v3.5(源对齐): 源 main.gd:872 —— 玩家**每次升级**固定 +1 最大生命(自动项, 与升级时 4 选 1 无关):
   *     func on_levelled_up(player_index: int):
   *         RunData.add_stat(Keys.stat_max_hp_hash, 1, player_index)
   *   缺这条 = 血池比源少 (等级-1) 点。实测第 8 波血池只有 17, 而同波里源原生最重的怪
   *   (bruiser: 2 + 0.85*7 = 8) 一次接触就占血池 44% —— 20 波设计在第 9 波就夭折。
   *   消费点: src/core/stats.js 的 compute()(把等级换算成 flat maxHp)。 */
  B.LEVEL_HP_PER_LEVEL = 1;
  /* v2.5: 分母 15 → 22。购物 bot 实测第 12 波 armor 35 → 减伤 70%(35/50),
   *   叠上 regen 4.55/s + lifesteal 10.5% 后, 中后期"打不死"(探针 10/12 波净掉血 ≈ 0)。
   *   改成 armor/(armor+22): armor 5→18.5% / 15→40.5% / 35→61.4% / 60→73.2% —— 仍然鼓励堆甲, 但不再能一票免疫。 */
  /* v2.5 定稿: 分母保持 15 (armor 5→25% / 15→50% / 35→70%)。试过分母 22(即把堆甲的收益打折),
   *   目的是打破中后期"打不死", 但实测方向不对: 真机 E2E 的 bot 靠 spikeguard 等道具堆甲,
   *   削 armorDr 直接把它的生存砍掉(阵亡波次 12 → 4~7); 而探针第 5 波的 armor=0, 削不削毫无影响 → 纯亏。
   *   中后期的免疫来自 lifesteal(∝ 自己 DPS), 不是 armor —— 见 balance.md §6 的跨模块结论。 */
  /* v2.9 (源对齐 · 由 core 侧落地): 吸血/生命再生的**真实语义**(源 translations.csv 原文, en+zh 双证):
   *   stat_lifesteal → "<!MissingKey:356> Your attacks have a {0} chance to heal you for 1 HP. Max: {1} HP / second"
   *                    中文 "你的攻击有{0}概率为自己恢复1生命值。上限：{1}生命值/秒"
   *     ⇒ **每次命中最多回 1 点**, 与伤害量无关; 每秒另有上限。旧的 hv = dmg*lifesteal/100(DPS 比例回血)口径错。
   *   stat_hp_regeneration → "<!MissingKey:903> You regenerate {0} HP every {1} seconds ({2} HP / second)",
   *                    默认串 key 755 = "You regenerate 0 HP every **5** seconds" ⇒ **每 5 秒一个 tick**, stat 单位 = HP/秒。
   *   armor: 源 CSV 只有"护甲"标签; keys.gdc 有 hp_cap/speed_cap/dodge_cap/crit_chance_cap 但**没有 armor_cap**
   *     ⇒ 原作护甲不设上限、靠乘法曲线自然递减 —— 我们的 armor/(armor+15) 形态一致, 保留。
   *   常数 capPerSec=10 的依据(源常数在 GDSC 字节码, 本地 .tres 未缓存且网络 ECONNRESET): 我方 W20 实测净受击
   *     ≈ 26/次 × ~1.5 次/秒 ≈ 40/s, 上限 10/s = 25% ⇒ 回血有意义但净伤害仍强负(ttk 53s → ~14s)。 */
  B.LIFESTEAL = { perHit: 1, capPerSec: 10 };   // 每次命中回 1 点 / 每秒上限 10 点
  /* v3.1 果实掉落(源回路, 见 ref/brotato-numbers.md §8.4; 落地在 game.js:497 生成 + 515-531 拾取)。
   * 定位(主程裁定): **运气/容错, 不是续航** —— 主要生存回路永远是「别被碰到」。
   * healHp=3 的依据: 源 consumable_heal 词条只有 -1/+1/+2(基准极小); 本作血池 10 ⇒ 3 点 = 血池 30%,
   *   与源的相对量级一致。掉落率 **硬上限 10%**(主程约束), 波次/幸运只做小幅加成。 */
  B.CONSUMABLE = {
    healHp: 3,          // 单颗恢复量(血池 10 的 30%; 源 consumable_heal 词条值域 -1~+2)
    dropChance: 0.01,   // v3.4(源对齐): 源 stats.gd:19 base_drop_chance = 0.01
    waveBonus: 0.0,     // v3.4: 源式没有"逐波加成"这一项(旧值 0.004 是自制), 保留字段以便扫描
    luckBonus: 0.01,    // v3.4(源对齐): 源式为 *(1+luck/100) -> 见 fruitDropChance
    cap: 0.10,          // 掉落率硬上限 10%
    /* [建议, 待主程定] 每波果实**数量**上限。只限掉落率不够: W20 满清 ~1000 杀 x 10% = 100 颗 = 300 点回复,
     *   是晚期血池(40~60)的 5~7 倍 ⇒ 反而成了主回路, 与「果实不是续航」的定位冲突。
     *   按「晚期回复 <= 每波承伤的 40%」反推: 承伤 ~60~90 点/波 ⇒ 上限 8~12 颗/波(24~36 点)。 */
    maxPerWave: 10
  };
  B.REGEN_TICK = 5;                            // 源: "every 5 seconds" → 每 5 秒结算 round(regen*5)
  /* v3.4(源对齐): 源 singletons/item_service.gd:162-164 —— 果实掉落率 = min(1.0, base_drop_chance*(1+luck))
   *   其中 luck = stat_luck/100; base_drop_chance = 0.01(stats.gd:19)。
   *   enemy_fruit_drops 词条是另一条独立通道(源 item_service.gd:184-185), 按 /100 命中时强制掉一颗。 */
  B.fruitDropChance = function (luck, fruitDrops) {
    var lk = (luck || 0) / 100;
    var c = B.CONSUMABLE.dropChance * (1 + lk);
    c += 0.01 * (fruitDrops || 0);
    return Math.min(B.CONSUMABLE.cap, c);
  };
  /* v3.6(源对齐): 玩家护甲系数 —— 直接复刻源公式, 取代旧的自制曲线。
   *   出处: singletons/run_data.gd:1352  var percent_dmg_taken = 10.0 / (10.0 + (abs(armor) / 1.5))
   *         singletons/run_data.gd:1359  percent_dmg_taken = (1.0 - percent_dmg_taken) + 1.0
   *         消费方 entities/units/player/player.gd:310-311  dmg = max(1, round(dmg_value * armor_coef))
   *         (汇总见 ref/source-stats.md:111-112 「4.2 护甲减伤(玩家 vs 敌人是两套)」)
   *   正护甲**恒等**: 1 - 10/(10 + armor/1.5) = (armor/1.5)/(10 + armor/1.5) = armor/(armor + 15)
   *     ⇒ armor >= 0 时与旧的 armor/(armor+15) 数值完全一致(armor=5 → 0.75, armor=15 → 0.5), 无行为变化。
   *   负护甲旧值**错在两处**: 旧 B.negArmorAmp = min(0.5, -armor*0.04) 既线性又带 0.5 上限, 两个都无出处。
   *     源在 armor < 0 时走 c = (1 - c0) + 1 (c0 = 10/(10 + |armor|/1.5)), **无上限、非线性**:
   *       armor =   -3  → 源 1.1667 | 旧 0.12
   *       armor =   -5  → 源 1.25   | 旧 0.20
   *       armor =  -15  → 源 1.5    | 旧 0.50
   *       armor = -100  → 源 1.8696 | 旧 0.50(被 0.5 上限压死: 负护甲再往下堆也不再加伤)
   *     ⇒ 旧的把负护甲惩罚压在最多 +50%(-12.5 就到底), 源则是越负越痛、不封顶。 */
  B.armorCoef = function (armor) {
    var c = 10 / (10 + Math.abs(armor || 0) / 1.5);
    if (armor < 0) c = (1 - c) + 1;
    return c;
  };
  /* 兼容别名: tools/simulate2.cjs:161 仍按「减伤比例」调用 armorDr ⇒ 用 1 - coef 换算(仅正护甲非 0, 数值不变)。 */
  B.armorDr = function (armor) { return armor > 0 ? 1 - B.armorCoef(armor) : 0; };
  /* 兼容别名(旧名, 语义 = 负护甲带来的额外承伤倍率 = coef - 1): 已删掉无出处的 0.5 上限。 */
  B.negArmorAmp = function (armor) { return armor < 0 ? B.armorCoef(armor) - 1 : 0; };
  /* v3.4(源对齐): 源 singletons/player_run_data.gd:424 键名 dodge_cap_hash 默认值 = 60 —— 闪避上限 **60%**。
   *   ghost_outfit 的 dodge_cap=70 是「道具把上限覆盖成 70」的词条, 不是默认值; 本作仍由 stats.js 的
   *   dodgeCap 通道单独覆盖, 不再把它当基准。旧值 70 会把闪避的上界抬高 10pp。 */
  B.dodgeCap = 60;
  /* v3.4(源对齐): 无敌帧**按这一击占血池的比例自适应**, 出处 entities/units/player/player.gd:8-9, 565-575
   *     MIN_IFRAMES = 0.2 ; MAX_IFRAMES = 0.4
   *     pct = damage_taken / max_stats.health
   *     iframes = clamp((pct * MAX_IFRAMES) / 0.15, MIN_IFRAMES, MAX_IFRAMES)
   *   => 挨一刀掉 >=15% 血 = 0.4s 无敌; 掉 <=7.5% = 0.2s。旧的固定 0.4s 让「小刀」也被免费免疫 0.4s,
   *   等效于削怪(「怪物太弱」的来源之一)。无尽按 1/max(1, endless_factor) 同比缩短。
   *   调用方必须传「这一击的净伤害」与「当前血池上限」(game.js hurtPlayer)。 */
  B.iframesMin = 0.2;
  B.iframesMax = 0.4;
  B.iframesFor = function (dmg, maxHp, w) {
    var ef = Math.max(1, B.endlessFactor(w || 0));
    var mn = B.iframesMin / ef, mx = B.iframesMax / ef;
    var pct = (maxHp > 0) ? (dmg / maxHp) : 0;
    return PS.util.clamp((pct * mx) / 0.15, mn, mx);
  };
  /* v3.4(源对齐): 源 entities/units/unit/stats.gd:13 attack_cd = 30.0(帧) = **0.5s**, 32/32 只敌人全是 30
   *   (ref/extract-enemies.json 逐只核对)。旧值 0.8s 是本作自制, 把同一只怪的接触节拍拉长 60%。 */
  B.contactHitCd = 0.5;
  /* ==================== v7.10 怪物攻击模式(源攻击行为三件套) ====================
   * 源 entities/units/enemies/attack_behaviors/ 只有三种: shooting / charging / spawning。
   * 本作把它们落成 orbit·dash·caller 三条 AI 上的参数:
   *   · DASH.wind —— 源 ChargingAttackBehavior 是「播 shoot 动画 → charge_duration 秒后解锁移动并冲」,
   *     即冲撞**前有蓄力**。本作把蓄力做成可见的 wind 秒数(站定 + 预警圈), 让冲撞可读、可闪。
   *     charge_duration 的源值写在 .tscn 里(读不到), 取 0.45s 为手感值 —— [本作自定]。
   *   · HEALER —— 源 entities/units/enemies/healer/healer.gd:9-11/32-45: 药婆身上挂着 BoostZone,
   *     有伤的单位**进入时**回血 —— 敌人 +heal, 玩家 +player_heal。heal(100, +10/波) 与
   *     player_heal(1, +0.5/波) 都是源里逐字可读的 export; 只有光环半径(Area2D 的 shape)读不到,
   *     取 220px 为 [本作自定]。判定沿用源的「进入时一次」(不是每帧), 故不会变成站桩奶泉。
   *   · ORBIT —— 源 ShootingAttackBehavior 的 number_projectiles / projectile_spread / constant_spread。
   *     缺省服务旧的单发行为(shots 1 / spread 0); 逐怪的弹数写在 enemies.js 的 shots/radial 上。 */
  B.DASH = { wind: 0.45 };
  B.HEALER = { heal: 100, healW: 10, playerHeal: 1, playerHealW: 0.5, r: 220 };
  B.ORBIT = { shots: 1, spread: 0.26 };
  /* v2.3 威胁重构: 取消"怪多就单次伤害打 3 折"的双重惩罚 —— 密度本身已经通过命中频次放大威胁
   * (200 只围攻 = 每秒最多 1/iframes 次结算), 再乘 0.3 等于把"压迫感"和"致死性"解耦。
   * 改前实测(probe): 第 18 波 270 只怪每波只掉 32 点血 / 单次净伤 4 点 → 6/6 检查点"打不死"。 */
  /* v2.5 (C 定稿): 把折扣档位对齐**场上数量的真实台阶**。game.js 的 minAlive 在第 7 波从 12 跳到 25,
   *   场上怪数在 6→7 波之间直接翻倍(探针实测 13 → 28) —— 命中频次已经因此翻倍,
   *   若单次伤害不打折, 第 7 波就变成"一波从无敌到必死"的断崖(真机 E2E 的类人 bot 连续 4 次死在第 6~7 波)。
   *   所以 >24 只起开始打折: 26-60 只 ×0.92 / 61-120 只 ×0.86 / 120 只以上 ×0.80(下限 0.80 ≥ 0.7 硬约束)。
   *   注意第 1~6 波场上只有 12~18 只 → 完全不受本函数影响, 中段"要有威胁"的目标不被这条削弱。 */
  /* v2.6: 20-60 只档 0.70 -> 0.84(下限 0.70 的硬约束仍然满足, 这一档是**上调**不是下调)。
   *   探针实测第 10 波是唯一的"打不死"检查点(净掉血 -0.5/s): 它同屏只有 26~32 只(第 12 波 120 只),
   *   正好落在 >24 档里吃最重的折扣, 而命中频次又没有怪潮波那么高 -> 单次 17.5 的净伤被
   *   regen 9.9/lifesteal 14 全额抵消。把这一档抬回 0.84 后, 第 7~10 波的"怪多就打折"不再
   *   把唯一的中段低密度波打成安全区; 120 只以上的大怪潮档不变(0.80), 中后期曲线不受影响。 */
  B.crowdDmgMul = function (aliveN) {
    if (aliveN > 120) return 0.80;
    if (aliveN > 60) return 0.82;
    if (aliveN > 24) return 0.70;
    if (aliveN > 18) return 0.90;
    return 1;
  };

  /* ---------- 升级属性池(4选1) ---------- */
  /* v3.0 (主程授权"上调玩家生存资源, 而不是把怪物削回去"): 早期档 t0 生存卡上调 —— maxHp 12→16 ·
   *   armor 2→3 · dodge 2→3 · regen 1.2→1.8。依据: W5 单次净伤(11~15) × 命中数(8~12) 已贴着玩家有效生命
   *   (124~132), 于是 W5 生死原本由"商店抽到什么"决定(同一份代码两次运行分别"完好到第 12 波"/"第 4 波阵亡")。
   *   抬早期生存档 = 压掉这段运气依赖, 中后期威胁不变。 */
  /* v3.0 源粒度重标(主程口径): 卡值必须与源词条同量级(源 stat_max_hp 中位 3 / stat_armor 中位 1 /
   *   stat_crit_chance 中位 3 / stat_dodge 中位 4 / stat_percent_damage 中位 -1~6 / stat_range ±10~80px)。
   *   旧值(maxHp 16/22/30 · regen 1.8/2.8/4.0 · rangePct 4/7/12%)是在 100 血池口径下标定的, 血池回到 10
   *   后必须同步 ÷10, 否则一张卡就是一整条命。t = 波次档(W<8 / <15 / >=15)。 */
  /* v3.4(主程) 升级卡池数据化 + 源粒度重标。
   *   为什么数据化: 升级卡是**玩家强度曲线的主通道**, 而参数扫描器(--bal)只能覆盖数据、不能覆盖函数
   *   ⇒ 旧的内联函数式卡池让"卡值"成为唯一不可扫描的主旋钮(历史口径漂移都出在这里)。
   *   值怎么定: 以 ref/extract-items.json 的**词条绝对值中位数**为锚(源的一件道具 = 一次强化的自然粒度):
   *     stat_max_hp 3 | stat_percent_damage 5 | stat_melee_damage 2 | stat_ranged_damage 2
   *     stat_elemental_damage 2 | stat_engineering 3 | stat_attack_speed 6 | stat_crit_chance 5
   *     stat_armor 2 | stat_dodge 5 | stat_speed 4 | stat_hp_regeneration 2 | stat_lifesteal 2
   *     stat_luck 10 | stat_harvesting 6.5 | stat_range 15px(本作世界 2 倍 ⇒ 30px)
   *   t0 = 源中位(或略低, 因为一局能拿 10~40 张卡), t1/t2 档位放大。
   *   **历史错误**: 旧 maxHp 卡 = 1/2/3, 而源 stat_max_hp 中位 = 3 ⇒ t0 只有源粒度的 1/3。
   *   这是"第 5 波血池只有 11, 两次接触就死"的直接原因(实测 bot 第 5~6 波稳定阵亡)。
   *   src 字段只作文档, 不进 levelupPool 输出。 */
  B.LEVELUP_POOL = [
    { stat: 'maxHp',     name: '生命上限', v: [3, 4, 5],    src: 3 },
    { stat: 'dmgPct',    name: '伤害',     v: [5, 8, 11],   pct: true, src: 5 },
    { stat: 'meleeDmg',  name: '近战伤害', v: [2, 3, 4],    src: 2 },
    { stat: 'rangedDmg', name: '远程伤害', v: [2, 3, 4],    src: 2 },
    { stat: 'eleDmg',    name: '元素伤害', v: [2, 3, 4],    src: 2 },
    { stat: 'engDmg',    name: '结构伤害', v: [2, 3, 4],    src: 3 },
    { stat: 'atkSpd',    name: '攻击速度', v: [5, 8, 11],   pct: true, src: 6 },
    { stat: 'crit',      name: '暴击率',   v: [4, 5, 7],    pct: true, src: 5 },
    { stat: 'armor',     name: '护甲',     v: [1, 2, 3],    src: 2 },
    { stat: 'dodge',     name: '闪避',     v: [4, 6, 8],    pct: true, src: 5 },
    { stat: 'speedPct',  name: '移动速度', v: [4, 6, 8],    pct: true, src: 4 },
    { stat: 'regen',     name: '生命恢复', v: [2, 3, 4],    src: 2 },
    { stat: 'lifesteal', name: '吸血',     v: [2, 3, 4],    src: 2 },
    { stat: 'luck',      name: '运气',     v: [8, 12, 16],  src: 10 },
    { stat: 'harvest',   name: '采集',     v: [6, 9, 13],   src: 6.5 },
    { stat: 'rangeFlat', name: '射程',     v: [30, 45, 60], src: 15 },
    { stat: 'dmgFlat',   name: '固定伤害', v: [1, 2, 3],    src: 1 }
  ];
  /* v7.2: 语义收窄为「**某一个档位**的升级列表」= 源 _tiers_data[tier][TierData.UPGRADES]。
   *   调用签名不变(levelupPool(wave, playerLevel, luck); 只传 wave 时 level 取 wave),
   *   但它现在只是**数据查询**, 不再是抽卡 —— 抽卡在 game.js 的 rollLevelupChoices 里**逐卡**掷档
   *   (源 item_service.gd:558-569 的 `for i in number: get_upgrade_data(level, player_index)`,
   *   每张卡各自调一次 get_tier_from_wave)。 */
  B.levelupPool = function (w, level, luck) {
    var lv = (level == null) ? w : level;
    return B.levelupPoolTier(B.levelupTier(lv, luck));
  };

  /* ---------- 特效预算 ---------- */
  B.FX = {
    particlesMax: 300,
    dmgNumMax: 70,
    hitStop: 0.05,
    shakeMax: 12,
    corpseFade: 0.55,
    dprCap: 2,
    /* v5.19d(Codex, 2026-09-29): 视口裁剪的外扩像素(消费点见 src/ui/ui.js 的 drawWorld/inCull
     *   与 src/ui/fx.js 的 cullOut)。存在理由: 用户逐字「还有一个严重影响游戏体验的问题,
     *   我现在才无尽第19波, 有非常严重的卡顿掉帧」—— 把 Canvas2D 压成软件光栅(等价于弱显卡 /
     *   浏览器关掉硬件加速)后实测 27.7fps / 帧间隔 p50 36.2ms, 而**同一帧的 JS 只占 1.7ms**
     *   (work/perfg-base.json) ⇒ 瓶颈是光栅: 每帧 1200+ 次 draw call 的像素填充。
     *   96 = 「最宽的实体(魔王名条 / 挥击弧 / 冲刺虚线)在屏幕边缘也不会被裁掉」的保守值;
     *   实体自身半径由各调用点单独给, 两者相加才是判据。 */
    cullMargin: 96,
    /* v5.20: 渲染预算(帧率自适应降采样)的**调参面** —— 判定逻辑全在 src/core/perf.js(唯一真源)。
     *   存在理由同上: 用户「我现在才无尽第19波, 有非常严重的卡顿掉帧」。
     *   实测(work/perfg-dpr*.json, 真 Edge + 软件光栅): 帧耗时与像素数**完全线性**
     *     dpr=2 → 36.0ms(27.7fps) · dpr=1.5 → 18.4ms(54.5fps) · dpr=1 → 7.9ms(125fps), 而 JS 恒定 1.7ms
     *   ⇒ 瓶颈是像素填充率。阶梯度 (1 / 0.82 / 0.67 / 0.55)² = 1 / 0.67 / 0.45 / 0.30 的像素预算。
     *   targetMs=20 ≈ 60fps(留一个 vsync 周期的抖动余量); recoverMs=14 表示"还有余量"。 */
    perf: {
      enabled: true,
      ladder: [1, 0.82, 0.67, 0.55],
      window: 40,
      targetMs: 20,
      recoverMs: 14,
      recoverHold: 3,
      warmupMs: 2500,
      minHoldMs: 1200
    }
  };

  /* ---------- 音效开关 ---------- */
  B.SOUND = true;
})(typeof GameGlobal !== 'undefined' ? GameGlobal : (typeof window !== 'undefined' ? window : globalThis));
