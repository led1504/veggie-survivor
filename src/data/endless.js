/* PS.Endless —— 无尽波(w>20)的难度爬坡
 * 唯一出处: 源 Brotato 反编译 singletons/zone_service.gd:30-95 的
 *   get_wave_data() / get_additional_groups(), 以及 main.gd:482-488 的末波补组。
 *
 * 源在 index > waves_data.size()(=20) 时这么做:
 *   1. wave_index = (index - 1) % 20; 若 < 10 再 +10  ⇒ **复用 wave_11..wave_20 的 10 波循环**
 *   2. wave.max_enemies *= 1.25 + (wave_index * 0.01)  ⇒ 1.35 ~ 1.44 倍同屏上限
 *   3. wave.wave_duration = 60
 *   4. nb = int((index / 10.0) * 2) 个额外组; 组 spawn_timing 在波内均布(:76), 
 *      repeating_interval = rand 6~8 秒(:83)
 *   5. get_additional_groups(..., bonus_enemies_per_group = nb / 5.0):
 *      每组成员 min_number = 1 + bonus, max_number = 2 + bonus(:88-89)
 *   6. 兵种从 zone_1_data.tres:66 的 endless_enemy_scenes 白名单里随机取(:87)
 *
 * 本实现的两处有意偏差(都记在这里):
 *   · 源的"随机取组/取兵种/取间隔"改成由 (w, i) 现算的定值 —— 不消耗游戏随机流,
 *     于是固定种子下无尽波逐字可复现(与本仓库其它探针同一口径)。
 *   · 波时长沿用本作 B.waveDuration 的 90 秒(源是无尽固定 60) —— 本作的逐波排班表是
 *     按源 wave_N.tres 的 wave_duration 铺的, 改时长会把事件表整体挤出波外。
 * 事件对象形状与 waves.js 的 list 完全一致: { t, edge, area, edgeDist, units: [[key,min,max]] }。
 */
(function (global) {
  'use strict';
  var PS = global.PS || {};
  var E = PS.Endless = {};

  /* 源 zones/zone_1/zone_1_data.tres:66 endless_enemy_scenes -> 本作敌人 key(顺序照源) */
  E.POOL = ['tentacle', 'lamprey', 'splitpod', 'fly', 'hornpumpkin', 'hornpod', 'rootthrall', 'soilheap', 'cackler'];

  /* 源 zone_service.gd:45 的同屏上限倍率 */
  E.capMul = function (w) {
    if (!(w > 20)) return 1;
    var c = (w - 1) % 20; if (c < 10) c += 10;
    return 1.25 + c * 0.01;
  };

  /* 源 get_additional_groups() 的事件展开 */
  E.extraEvents = function (w, dur) {
    var nb = Math.floor((w / 10) * 2);
    if (nb <= 0) return [];
    var bonus = Math.floor(nb / 5);
    var evs = [], i, t;
    for (i = 0; i < nb; i++) {
      var key = E.POOL[(w * 7 + i * 3) % E.POOL.length];
      var t0 = Math.max(1, Math.round(i * ((dur - 10) / nb) + 1));
      var step = 6 + ((w * 31 + i * 17) % 3);
      for (t = t0; t < dur; t += step) {
        evs.push({ t: t, edge: ((w + i) % 2 === 0), area: (i % 2 === 0 ? -1 : 250), edgeDist: 0,
          units: [[key, 1 + bonus, 2 + bonus]] });
      }
    }
    return evs;
  };

  /* 逐波缓存: game.js 每帧都要问一次, 且同一波内的排班必须稳定 */
  E._cache = {};
  E.forWave = function (baseSched, w) {
    var B = PS.Balance;
    var dur = (B && B.waveDuration) ? B.waveDuration(w, 'endless') : 90;
    var ck = w + ':' + dur;
    if (!E._cache[ck]) {
      var events = baseSched.events.concat(E.extraEvents(w, dur));
      events.sort(function (a, b) { return a.t - b.t; });
      E._cache[ck] = { wave: w, duration: dur, maxEnemies: baseSched.maxEnemies, events: events };
    }
    return E._cache[ck];
  };
})(typeof GameGlobal !== 'undefined' ? GameGlobal : (typeof window !== 'undefined' ? window : globalThis));