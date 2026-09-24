// cloudfunctions/resolveReturn —— 买家选择售后处理方式（退款 / 重发货）
//
// 前置条件：aiJudge 已判定 liable = true，订单停在 5 售后中。
// 判责是自动且终局的，**选择权在买家**：
//   refund -> 5 -> 6（已关闭），写 return.refundAt，订单终结
//   reship -> 5 -> 1（待发货），reshipCount 累加，订单重新走商家拍照环
//
// ⚠️ 重发不再二次扣库存：首次下单时已在事务内扣减过，重发只是重新发货。
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command
const orders = db.collection('orders')

const STATUS_PENDING_SHIP = 1
const STATUS_AFTER_SALE = 5
const STATUS_CLOSED = 6

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const { orderId } = event
  const resolution = String(event.resolution || '')

  if (!orderId) {
    return { code: -1, msg: '缺少订单 ID' }
  }
  if (resolution !== 'refund' && resolution !== 'reship') {
    return { code: -1, msg: '请选择退款或重发货' }
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

    // ---- 状态与判责校验 ----
    if (Number(order.status) !== STATUS_AFTER_SALE) {
      return { code: -1, msg: '当前订单不在售后中' }
    }
    if (!order.return || order.return.liable !== true) {
      return { code: -1, msg: '该订单未判定为商家责任，无法执行' }
    }

    const now = new Date()
    const prevReturn = order.return || {}

    if (resolution === 'refund') {
      await orders.doc(orderId).update({
        data: {
          status: STATUS_CLOSED,
          return: { ...prevReturn, resolution: 'refund', refundAt: now },
          updateTime: now
        }
      })
      return { code: 0, msg: '已退款，订单关闭', status: STATUS_CLOSED }
    }

    // ---- 重发货：回到待发货，商家重新拍照 ----
    await orders.doc(orderId).update({
      data: {
        status: STATUS_PENDING_SHIP,
        return: { ...prevReturn, resolution: 'reship' },
        reshipCount: _.inc(1), // 原子累加，字段不存在时自动创建
        // 清掉上一轮的驳回原因，避免残留误导商家
        shipRejectReason: '',
        updateTime: now
      }
    })

    return { code: 0, msg: '已通知商家重发货', status: STATUS_PENDING_SHIP }
  } catch (err) {
    console.error('[resolveReturn] 处理失败', err)
    return { code: -1, msg: '操作失败，请稍后重试' }
  }
}
