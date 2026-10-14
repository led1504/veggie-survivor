/* PS.EnemyData v3.0 —— 敌人 32 只（源 extract-enemies.json 全量 1:1）
 * 由 tools/port-source.cjs 生成 —— 请勿手改数值；改源数据/映射表后重跑生成器。
 * 口径: qa/v3-port-spec.md §3.2 · 台账(AI 归类规则/进池波次设计/事实核对): qa/source-port-entities.md
 * 1:1 字段: hp/hpW/dmg/dmgW/spd/knockRes/value（原样） + src(源 key, 逐行可追溯)。
 *   源 attackCd 32/32 = 30 帧 ⇒ 接触伤害冷却 = 30/60 = 0.5s（B.contactHitCd, 全局常量, 不逐只存字段）。
 *   源 armor 32/32 = 0 ⇒ 不设 armor 字段（引擎无敌人护甲通道, 值与源一致）。
 *   spdPix 是历史派生字段（= spd / 250）: 引擎已直读 spd（game.js），保留它只为旧探针/注释不失效。
 * 本作设计(源里读不出): name/desc(原创名/短句) · color/r(表现) · ai(行为归类) · weight/spawnWave(进池波次) · 精英/Boss 档位。
 * 兼容别名: bonehead/splitseed 以非枚举属性保留（旧 core/美术引用），Object.keys 计数不含它们。
 */
(function (global) {
  'use strict';
  var PS = global.PS || {};
  /* 精英/Boss 出场表（本作设计; 规格书 §3.5 第 10 波精英 / 第 20 波 Boss）—— 必须在此声明, 否则 eliteAt 抛 ReferenceError */
  var ELITE_BY_WAVE = {"10":"elBrute","15":"elReaper","20":"kingTuber"};
  var ELITE_CYCLE = ["elBrute","elWeaver","elReaper","scythemantis","earthmother","asceticradish","ironrhizo"];
  PS.EnemyData = {
    list: {
      /* ---------- 进池怪（按源数值 1:1） ---------- */
      sprout: { src: 'baby_alien', name: '嫩芽', desc: '米粒大的小苗，成群往上挤。', hp: 3, hpW: 2, dmg: 1, dmgW: 0.6, spd: 250, spdPix: 1, r: 12, color: '#7a9a4a', weight: 10, spawnWave: 1, ai: 'chase', knockRes: 0, value: 1 },
      thug: { src: 'bruiser', name: '壮墩', desc: '又宽又厚，胸前一道竖裂。', hp: 20, hpW: 11, dmg: 2, dmgW: 0.85, spd: 300, spdPix: 1.2, r: 17, color: '#a06a4a', weight: 4, spawnWave: 7, ai: 'chase', knockRes: 0.9, value: 3 },
      soilheap: { src: 'buffer', name: '土墩', desc: '一坨会走的肉墩，挪得慢撞得沉。', hp: 20, hpW: 3, dmg: 1, dmgW: 0.6, spd: 150, spdPix: 0.6, r: 18, color: '#8a7a5a', weight: 8, spawnWave: 3, ai: 'chase', knockRes: 0.95, value: 2 },
      /* ---------- 精英档（本作设计: 波次事件） ---------- */
      elBrute: { src: 'butcher', name: '剁螳', desc: '两条前肢是两把菜刀。', hp: 1, hpW: 750, dmg: 1, dmgW: 1.5, spd: 200, spdPix: 0.8, r: 26, color: '#c05a3a', weight: 0, spawnWave: 10, ai: 'dash', knockRes: 1, value: 10, elite: 1, dropBonus: 6, dashCd: 3 },
      charger: { src: 'charger', name: '冲角', desc: '断了一只角，低头就冲。', hp: 4, hpW: 2.5, dmg: 1, dmgW: 0.85, spd: 400, spdPix: 1.6, r: 15, color: '#d86a4a', weight: 8, spawnWave: 3, ai: 'dash', knockRes: 0.8, value: 1, dashCd: 5 },
      buzzling: { src: 'chaser', name: '刺虫', desc: '细长的一条，尾巴带刺。', hp: 1, hpW: 1, dmg: 1, dmgW: 0.6, spd: 380, spdPix: 1.52, r: 9, color: '#d8c05a', weight: 10, spawnWave: 1, ai: 'chase', knockRes: 0, value: 1 },
      /* ---------- Boss 档（本作设计: 波次事件） ---------- */
      kingTuber: { src: 'colossus', name: '薯王', desc: '地里最大的一块，受伤反而更疯。', hp: 1, hpW: 750, dmg: 1, dmgW: 1.5, spd: 300, spdPix: 1.2, r: 42, color: '#8a2a4a', weight: 0, spawnWave: 20, ai: 'boss', knockRes: 1, value: 10, boss: 1, dropBonus: 30, phase2: 0.5 },
      rotstump: { src: 'corrupted_tree', name: '空桩', desc: '心子是空的，绕着圈吐木屑。', hp: 15, hpW: 13, dmg: 1, dmgW: 1.1, spd: 0, spdPix: 0, r: 20, color: '#7a6a4a', weight: 3, spawnWave: 8, ai: 'orbit', knockRes: 0.95, value: 1, orbitR: 260, shootCd: 3.4, projSpd: 200, shots: 4, radial: 1 },
      elReaper: { src: 'croc', name: '鳄瓜', desc: '皮像鳄鱼，冲起来收不住。', hp: 1, hpW: 750, dmg: 1, dmgW: 1.5, spd: 350, spdPix: 1.4, r: 27, color: '#4a8a5a', weight: 0, spawnWave: 15, ai: 'dash', knockRes: 1, value: 10, elite: 1, dropBonus: 6, dashCd: 2.6 },
      mobrage: { src: 'evil_mob', name: '菜帮', desc: '一整帮叶子挤成一团，横着推。', hp: 5, hpW: 30, dmg: 1, dmgW: 0.85, spd: 350, spdPix: 1.4, r: 14, color: '#c05a5a', weight: 3, spawnWave: 11, ai: 'chase', knockRes: 0, value: 8 },
      finling: { src: 'fin_alien', name: '鳍鱼', desc: '背鳍一竖，贴着地面滑。', hp: 12, hpW: 2, dmg: 1, dmgW: 1, spd: 400, spdPix: 1.6, r: 13, color: '#5ac0d0', weight: 9, spawnWave: 2, ai: 'dash', knockRes: 0, value: 1, dashCd: 4.5 },
      fly: { src: 'fly', name: '腐蝇', desc: '两只大眼占了整个头。', hp: 15, hpW: 4, dmg: 1, dmgW: 0.85, spd: 350, spdPix: 1.4, r: 12, color: '#9aa86a', weight: 7, spawnWave: 4, ai: 'chase', knockRes: 0, value: 1 },
      elWeaver: { src: 'gargoyle', name: '石瓜', desc: '蹲在石壳里，一圈一圈扔籽。', hp: 1, hpW: 750, dmg: 1, dmgW: 1.5, spd: 350, spdPix: 1.4, r: 25, color: '#7a8a9a', weight: 0, spawnWave: 12, ai: 'orbit', knockRes: 1, value: 10, elite: 1, dropBonus: 6, orbitR: 300, shootCd: 2.4, projSpd: 260, shots: 6, radial: 1 },
      herbwife: { src: 'healer', name: '药婆', desc: '走一路撒一路，顺手给同伴敷伤。', hp: 10, hpW: 8, dmg: 1, dmgW: 0.85, spd: 400, spdPix: 1.6, r: 14, color: '#7ed08a', weight: 5, spawnWave: 6, ai: 'healer', knockRes: 0, value: 2 },
      rockling: { src: 'helmet_alien', name: '岩壳', desc: '背着一块石头，硬得很。', hp: 8, hpW: 4, dmg: 1, dmgW: 1, spd: 250, spdPix: 1, r: 15, color: '#6a7a8a', weight: 7, spawnWave: 4, ai: 'chase', knockRes: 0.5, value: 1 },
      hornpumpkin: { src: 'horned_bruiser', name: '角瓜', desc: '棱上一对歪角，推土机似地碾。', hp: 30, hpW: 22, dmg: 1, dmgW: 1.15, spd: 300, spdPix: 1.2, r: 20, color: '#c07a3a', weight: 3, spawnWave: 9, ai: 'chase', knockRes: 0.9, value: 3 },
      hornpod: { src: 'horned_charger', name: '尖荚', desc: '荚尖带锥，撞上就扎。', hp: 12, hpW: 5, dmg: 1, dmgW: 1.1, spd: 425, spdPix: 1.7, r: 15, color: '#d84a3a', weight: 6, spawnWave: 5, ai: 'dash', knockRes: 0.8, value: 1, dashCd: 3.6 },
      elderBlight: { src: 'invoker', name: '枯老', desc: '干瘪发黑，脸是一个空洞。', hp: 15000, hpW: 750, dmg: 1, dmgW: 1.5, spd: 200, spdPix: 0.8, r: 44, color: '#2a5a3a', weight: 0, spawnWave: 30, ai: 'boss', knockRes: 1, value: 10, boss: 1, dropBonus: 40, phase2: 0.5, endlessOnly: 1 },
      hopper: { src: 'junkie', name: '跳菇', desc: '歪戴一顶菇盖，一蹦一蹦。', hp: 5, hpW: 5, dmg: 1, dmgW: 1, spd: 350, spdPix: 1.4, r: 11, color: '#e0a05a', weight: 6, spawnWave: 5, ai: 'chase', knockRes: 0.5, value: 1, hop: 1 },
      lamprey: { src: 'lamprey', name: '沟鳗', desc: '从水沟里爬上来，吸住不撒口。', hp: 30, hpW: 15, dmg: 1, dmgW: 0.75, spd: 350, spdPix: 1.4, r: 16, color: '#4a7a8a', weight: 3, spawnWave: 8, ai: 'chase', knockRes: 0.95, value: 1 },
      crothief: { src: 'looter', name: '偷鸦', desc: '贴地跑，叼了熟菜就走。', hp: 5, hpW: 30, dmg: 1, dmgW: 0.85, spd: 350, spdPix: 1.4, r: 13, color: '#5a5a6a', weight: 3, spawnWave: 11, ai: 'chase', knockRes: 0, value: 8 },
      scythemantis: { src: 'mantis', name: '镰螳', desc: '两把镰刀举过头顶。', hp: 1, hpW: 750, dmg: 1, dmgW: 1.5, spd: 250, spdPix: 1, r: 24, color: '#7ac05a', weight: 0, spawnWave: 16, ai: 'chase', knockRes: 1, value: 10, elite: 1, dropBonus: 6 },
      earthmother: { src: 'mom', name: '薯婆', desc: '佝偻着背，土块结了一身。', hp: 1, hpW: 750, dmg: 1, dmgW: 1.5, spd: 250, spdPix: 1, r: 30, color: '#8a6a8a', weight: 0, spawnWave: 18, ai: 'orbit', knockRes: 1, value: 10, elite: 1, dropBonus: 9, orbitR: 280, shootCd: 2.2, projSpd: 250, shots: 3, spread: 0.34 },
      asceticradish: { src: 'monk', name: '苦萝', desc: '瘦得只剩一根主根，撞过来不减速。', hp: 1, hpW: 700, dmg: 1, dmgW: 1.5, spd: 350, spdPix: 1.4, r: 26, color: '#c8b06a', weight: 0, spawnWave: 19, ai: 'dash', knockRes: 1, value: 10, elite: 1, dropBonus: 9, dashCd: 2.2 },
      soulvine: { src: 'predator', name: '魂藤', desc: '中间一只巨眼，缠住人就往土里拖。', hp: 15000, hpW: 750, dmg: 1, dmgW: 1.5, spd: 300, spdPix: 1.2, r: 48, color: '#3a2a5a', weight: 0, spawnWave: 40, ai: 'boss', knockRes: 1, value: 10, boss: 1, dropBonus: 50, phase2: 0.5 },
      rootthrall: { src: 'pursuer', name: '缠根', desc: '底下一把根，慢慢缠上来。', hp: 10, hpW: 24, dmg: 1, dmgW: 1.2, spd: 150, spdPix: 0.6, r: 16, color: '#6a8a4a', weight: 3, spawnWave: 10, ai: 'chase', knockRes: 0, value: 3 },
      ironrhizo: { src: 'rhino', name: '铁薯', desc: '铆钉铁甲，低头直冲不拐弯。', hp: 1, hpW: 750, dmg: 1, dmgW: 1.5, spd: 250, spdPix: 1, r: 29, color: '#9a7a5a', weight: 0, spawnWave: 24, ai: 'dash', knockRes: 1, value: 10, elite: 2, dropBonus: 9, dashCd: 2 },
      slasher: { src: 'slasher', name: '镰手', desc: '挥着一只镰臂，走直线。', hp: 50, hpW: 25, dmg: 1, dmgW: 1.15, spd: 275, spdPix: 1.1, r: 19, color: '#8a4a5a', weight: 3, spawnWave: 10, ai: 'dash', knockRes: 0.9, value: 5, dashCd: 2.8 },
      splitpod: { src: 'slasher_egg', name: '裂荚', desc: '晒干的荚，一破就撒出一把籽。', hp: 5, hpW: 3, dmg: 1, dmgW: 0.25, spd: 0, spdPix: 0, r: 12, color: '#c8e08a', weight: 4, spawnWave: 7, ai: 'splitter', knockRes: 1, value: 1, splitInto: 'splitseed', splitN: 2 },
      cackler: { src: 'spawner', name: '笑枭', desc: '夜里咯咯叫，一叫就来一串。', hp: 10, hpW: 1, dmg: 1, dmgW: 0.85, spd: 120, spdPix: 0.48, r: 15, color: '#8a6aa8', weight: 5, spawnWave: 6, ai: 'caller', knockRes: 0.7, value: 1, callCd: 3.2, callKey: 'buzzling', callN: 2 },
      spitweed: { src: 'spitter', name: '喷藤', desc: '立着一根藤，顶端会喷籽。', hp: 8, hpW: 1, dmg: 1, dmgW: 0.6, spd: 200, spdPix: 0.8, r: 13, color: '#8fae5a', weight: 9, spawnWave: 2, ai: 'orbit', knockRes: 0.95, value: 1, orbitR: 320, shootCd: 2.6, projSpd: 240, shots: 3, spread: 0.3 },
      tentacle: { src: 'tentacle', name: '沼手', desc: '从土里直起身，一碰就黏。', hp: 100, hpW: 20, dmg: 1, dmgW: 1, spd: 175, spdPix: 0.7, r: 24, color: '#5a6a4a', weight: 3, spawnWave: 9, ai: 'chase', knockRes: 0.7, value: 4 },
    },

    /* 波次刷怪池 */
    pick: function (w, rng) {
      var items = [], k, e;
      for (k in this.list) {
        e = this.list[k];
        if (e.weight > 0 && e.spawnWave <= w) items.push({ w: e.weight, v: k });
      }
      return PS.util.weighted(items, rng);
    },
    /* 精英/Boss 出场（本作设计: 第 10/15 波精英, 第 20 波 Boss） */
    eliteAt: function (w, mode) {
      if (mode === 'rush') return w === 10 ? 'kingTuber' : null;
      if (ELITE_BY_WAVE[w]) return ELITE_BY_WAVE[w];
      if (mode === 'endless') {
        if (w % 20 === 0) return 'soulvine';
        if (w % 10 === 0) return w >= 30 ? 'elderBlight' : 'kingTuber';
        if (w % 5 === 0) return ELITE_CYCLE[((((w / 5) | 0) - 1) % ELITE_CYCLE.length + ELITE_CYCLE.length) % ELITE_CYCLE.length];
        return null;
      }
      return null;
    }
  };
  /* ---- 旧 key 兼容别名（非枚举）---- */
  (function () {
    var L2 = PS.EnemyData.list;
    Object.defineProperty(L2, 'bonehead', { value: L2['tentacle'], enumerable: false });
    Object.defineProperty(L2, 'splitseed', { value: L2['buzzling'], enumerable: false });
  })();
})(typeof GameGlobal !== 'undefined' ? GameGlobal : (typeof window !== 'undefined' ? window : globalThis));
