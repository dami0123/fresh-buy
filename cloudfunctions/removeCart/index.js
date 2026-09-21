// cloudfunctions/removeCart —— 删除购物车条目（单条或批量）
// 批量模式供下单成功后清空已下单的条目使用。
// 删除条件同时限定 _id 与 userId，避免越权删除他人购物车。
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command
const carts = db.collection('cart')

const MAX_BATCH = 20 // 与 createOrder 的单笔订单商品种类上限保持一致

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()

  // 兼容两种入参：单条 cartId、批量 cartIds
  const ids = []
  if (event.cartId) ids.push(event.cartId)
  if (Array.isArray(event.cartIds)) ids.push(...event.cartIds)

  const uniqIds = [...new Set(ids.filter(Boolean))]

  if (uniqIds.length === 0) {
    return { code: -1, msg: '缺少购物车条目参数' }
  }
  if (uniqIds.length > MAX_BATCH) {
    return { code: -1, msg: `单次最多删除 ${MAX_BATCH} 条` }
  }

  try {
    // where 里带上 userId，等同于「只允许删自己的条目」——
    // 即便前端传了别人的 cartId，也匹配不到记录，不会误删
    const res = await carts.where({ _id: _.in(uniqIds), userId: OPENID }).remove()

    const removed = (res.stats && res.stats.removed) || 0

    return {
      code: 0,
      msg: removed > 0 ? '已删除' : '条目不存在或无权删除',
      removed
    }
  } catch (err) {
    console.error('[removeCart] 删除失败', err)
    return { code: -1, msg: '删除失败，请稍后重试' }
  }
}
