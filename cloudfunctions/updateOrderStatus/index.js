// cloudfunctions/updateOrderStatus —— 更新订单状态
// 安全约定：订单状态流转属于敏感操作，必须在云函数端二次校验调用者身份，
// 不能仅凭前端传来的 role 判断（那可以被伪造）。
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const users = db.collection('users')
const orders = db.collection('orders')

// 允许流转到的目标状态（0 待支付由 createOrder 初始写入，不允许从外部直接改回）
const ALLOWED_STATUS = [1, 2]

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const { orderId, status } = event

  if (!orderId) {
    return { code: -1, msg: '缺少订单 ID' }
  }

  const targetStatus = Number(status)
  if (!ALLOWED_STATUS.includes(targetStatus)) {
    return { code: -1, msg: '目标状态不合法' }
  }

  try {
    // ---- 权限校验：以数据库中的 role 为准 ----
    const userRes = await users.where({ openid: OPENID }).limit(1).get()
    if (userRes.data.length === 0) {
      return { code: -2, msg: '用户不存在' }
    }

    const role = userRes.data[0].role
    if (role !== 'seller') {
      return { code: -2, msg: '无权限操作，仅商家可更新订单状态' }
    }

    // ---- 确认订单存在 ----
    const orderRes = await orders.doc(orderId).get().catch(() => null)
    if (!orderRes || !orderRes.data) {
      return { code: -1, msg: '订单不存在' }
    }

    // ---- 更新状态 ----
    const updateRes = await orders.doc(orderId).update({
      data: {
        status: targetStatus,
        updateTime: new Date(),
        operatorOpenid: OPENID // 记录操作人，便于追溯
      }
    })

    if (updateRes.stats.updated === 0) {
      return { code: -1, msg: '状态更新未生效' }
    }

    return {
      code: 0,
      msg: '操作成功',
      orderId,
      status: targetStatus
    }
  } catch (err) {
    console.error('[updateOrderStatus] 更新失败', err)
    return { code: -1, msg: '操作失败，请稍后重试' }
  }
}
