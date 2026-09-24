// cloudfunctions/confirmShipment —— 买家确认 / 驳回商家上传的发货照片
//
// 状态机（CLAUDE.md「订单状态机」）：
//   确认通过：2 待确认发货 -> 3 配送中
//   驳回    ：停留在 2，写入 shipRejectReason，等商家重新拍照（商家端可见原因）
//
// 越权校验：必须以 getWXContext() 的 OPENID 与订单 userId 比对，不信任前端传入的身份。
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const orders = db.collection('orders')

const REASON_MAX_LEN = 100

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const { orderId, pass } = event
  const reason = String(event.reason || '').trim()

  // ---- 参数校验 ----
  if (!orderId) {
    return { code: -1, msg: '缺少订单 ID' }
  }
  // 注意：pass 必须显式传布尔值，不能用真值判断，否则不传时会被当成「确认通过」
  if (typeof pass !== 'boolean') {
    return { code: -1, msg: '缺少确认结果' }
  }
  if (!pass && !reason) {
    return { code: -1, msg: '驳回时请填写原因，便于商家重新拍照' }
  }
  if (reason.length > REASON_MAX_LEN) {
    return { code: -1, msg: `驳回原因最多 ${REASON_MAX_LEN} 字` }
  }

  try {
    const orderRes = await orders.doc(orderId).get().catch(() => null)
    if (!orderRes || !orderRes.data) {
      return { code: -1, msg: '订单不存在' }
    }

    const order = orderRes.data

    // ---- 越权校验 ----
    if (order.userId !== OPENID) {
      return { code: -2, msg: '无权操作该订单' }
    }

    // ---- 状态校验：只有「待确认发货」才能确认/驳回照片 ----
    if (Number(order.status) !== 2) {
      return { code: -1, msg: '当前订单状态不可确认发货照片' }
    }

    // 驳回时状态不变（仍为 2），商家重拍后本条记录会被覆盖
    const targetStatus = pass ? 3 : 2

    await orders.doc(orderId).update({
      data: {
        status: targetStatus,
        // 通过则清掉历史驳回原因；驳回则记录本次原因
        shipRejectReason: pass ? '' : reason,
        updateTime: new Date()
      }
    })

    return {
      code: 0,
      msg: pass ? '已确认发货照片' : '已驳回，等待商家重新拍照',
      status: targetStatus
    }
  } catch (err) {
    console.error('[confirmShipment] 操作失败', err)
    return { code: -1, msg: '操作失败，请稍后重试' }
  }
}
