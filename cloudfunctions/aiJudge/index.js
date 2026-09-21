// cloudfunctions/aiJudge —— 生鲜损坏责任判定
//
// ============================ 一期：mock 实现 ============================
// 一期用规则 mock，但**入参三项与出参结构严格按真 AI 的形态固定**，
// 二期接入真模型时只替换本文件内部实现，applyReturn 与双端页面一行都不用改。
//
// 判定依据（CLAUDE.md「aiJudge 判定依据」，一期二期都不变）：
//   1. shipPhotos         商家发货时拍的 3 张照片（由 applyReturn 从订单读出后传入，不由前端传入）
//   2. returnPhotos       买家上传的退货照片
//   3. hoursSinceReceive  从「买家确认收货」到「发起售后」的时间差（小时，由 applyReturn 计算）
//
// 之所以必须同时看两组照片：只看买家一张退货照片，无法区分「商家发出时就坏了」
// 与「买家收货后放坏了」。shipPhotos 是这个判定唯一站得住脚的依据。
//
// ============================ mock 规则 ============================
// 已拍板：必须**确定性、可复现、禁止随机数**。否则同一订单反复提交会得到不同结论，
// 既无法调试也无法答辩。
//
//   退货照片 ≥ 2 张  且  时间差 ≤ 48 小时  ->  判定为商家责任
//   其余情况                              ->  判定非商家责任
//
// 两条分支都必须能被测到，否则 applyReturn 里「liable=false 自动回退已完成」的
// 防卡死逻辑等于没验证过。
//
// ============================ 二期技术路线（调研结论，暂不实施）============================
// 优先验证微信云开发内置 AI（cloud.ai()，混元 Hy3，有免费额度），但官方文档只明确了
// 文本生成与文生图，**是否支持图片输入未获确认**，须先写测试云函数验证。
// 若不支持图片输入，退回阿里云通义千问 VL（百炼平台，支持多图输入，有 OpenAI 兼容接口）。
// ⚠️ SDK 版本隔离：内置 AI 要求 wx-server-sdk 3.0.5-beta.1+，现有云函数均为 ~2.6.3，
//    只在需要时升级本函数，**不得升级其他云函数**（2.x→3.x 有 BigInt 序列化 breaking change）。
// ⚠️ 密钥管理：API Key 一律放**云函数环境变量**，严禁写进代码或提交到 Git 仓库。

const LIABLE_MIN_PHOTOS = 2 // 判定商家责任所需的最少退货照片数
const LIABLE_MAX_HOURS = 48 // 判定商家责任的时间差上限（小时）

exports.main = async (event) => {
  const shipPhotos = Array.isArray(event.shipPhotos) ? event.shipPhotos.filter(Boolean) : []
  const returnPhotos = Array.isArray(event.returnPhotos) ? event.returnPhotos.filter(Boolean) : []

  // hoursSinceReceive 缺失或非法时按 0 处理（视为刚收货），保证规则仍可复现
  const rawHours = Number(event.hoursSinceReceive)
  const hoursSinceReceive = Number.isFinite(rawHours) && rawHours >= 0 ? rawHours : 0

  // ---- 规则命中判定 ----
  const photoHit = returnPhotos.length >= LIABLE_MIN_PHOTOS
  const timeHit = hoursSinceReceive <= LIABLE_MAX_HOURS
  const liable = photoHit && timeHit

  const hoursText = hoursSinceReceive.toFixed(1)

  let reason
  if (liable) {
    reason = `退货照片 ${returnPhotos.length} 张（≥${LIABLE_MIN_PHOTOS} 张），且距确认收货仅 ${hoursText} 小时（≤${LIABLE_MAX_HOURS} 小时），符合商家责任判定规则`
  } else if (!photoHit && !timeHit) {
    reason = `退货照片仅 ${returnPhotos.length} 张（需≥${LIABLE_MIN_PHOTOS} 张），且距确认收货已 ${hoursText} 小时（超过 ${LIABLE_MAX_HOURS} 小时），不符合商家责任判定规则`
  } else if (!photoHit) {
    reason = `退货照片仅 ${returnPhotos.length} 张，未达到 ${LIABLE_MIN_PHOTOS} 张的举证要求，不符合商家责任判定规则`
  } else {
    reason = `距确认收货已 ${hoursText} 小时，超过 ${LIABLE_MAX_HOURS} 小时，损坏更可能发生在买家收货之后，不符合商家责任判定规则`
  }

  return {
    liable,
    reason,
    confidence: liable ? 0.8 : 0.6,
    // raw 存放模型原始返回。一期 mock 时填规则命中说明，供商家端只读展示与答辩追溯。
    raw: {
      engine: 'mock-v1',
      rules: {
        LIABLE_MIN_PHOTOS,
        LIABLE_MAX_HOURS
      },
      hit: {
        photoHit,
        timeHit
      },
      input: {
        shipPhotoCount: shipPhotos.length,
        returnPhotoCount: returnPhotos.length,
        hoursSinceReceive: Number(hoursText)
      }
    }
  }
}
