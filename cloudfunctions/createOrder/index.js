// cloudfunctions/createOrder —— 创建订单
// 安全约定（CLAUDE.md「商家端特别约定」）：前端只传 productId 与数量，
// 商品单价与订单总价一律在服务端依据数据库现价重新计算，杜绝前端篡改金额。
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command
const products = db.collection('products')
const orders = db.collection('orders')

const MAX_ITEM_KINDS = 20 // 单笔订单最多包含的商品种类（受 where _id in 查询上限约束）

/** 生成订单号：年月日时分秒 + 4 位随机数 */
function generateOrderNo() {
  const now = new Date()
  const pad = (n) => (n < 10 ? '0' + n : '' + n)
  const stamp = [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds())
  ].join('')
  const rand = Math.floor(Math.random() * 10000)
  return stamp + String(rand).padStart(4, '0')
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const { items = [] } = event

  // ---- 参数校验 ----
  if (!Array.isArray(items) || items.length === 0) {
    return { code: -1, msg: '订单商品不能为空' }
  }
  if (items.length > MAX_ITEM_KINDS) {
    return { code: -1, msg: `单笔订单最多支持 ${MAX_ITEM_KINDS} 种商品` }
  }

  try {
    // ---- 拉取涉及的商品，以数据库中的数据为准 ----
    const ids = items.map((item) => item.productId).filter(Boolean)
    if (ids.length !== items.length) {
      return { code: -1, msg: '订单商品参数不完整' }
    }

    const productRes = await products.where({ _id: _.in(ids) }).get()
    const productMap = {}
    productRes.data.forEach((product) => {
      productMap[product._id] = product
    })

    // ---- 逐项校验并重新计价 ----
    const orderItems = []
    let totalPrice = 0

    for (const item of items) {
      const product = productMap[item.productId]
      if (!product) {
        return { code: -1, msg: '订单中包含不存在的商品' }
      }

      const count = Math.floor(Number(item.count))
      if (!Number.isFinite(count) || count <= 0) {
        return { code: -1, msg: `「${product.name}」的购买数量不合法` }
      }

      if (Number(product.stock) < count) {
        return { code: -1, msg: `「${product.name}」库存不足，仅剩 ${product.stock} 件` }
      }

      // 金额一律取服务端的 product.price，忽略前端传入的任何价格字段
      totalPrice += Number(product.price) * count

      orderItems.push({
        productId: product._id,
        name: product.name,
        price: Number(product.price),
        count,
        image: (product.images && product.images[0]) || ''
      })
    }

    // 避免浮点误差，保留两位小数
    totalPrice = Number(totalPrice.toFixed(2))

    // ---- 写入订单 ----
    const now = new Date()
    const order = {
      orderNo: generateOrderNo(),
      userId: OPENID,
      items: orderItems,
      totalPrice,
      status: 1, // 1:待发货 2:待确认发货 3:配送中 4:已完成 5:售后中 6:已关闭
      createTime: now,
      updateTime: now
    }

    const addRes = await orders.add({ data: order })

    // TODO: 库存扣减与订单写入应放入事务（db.startTransaction），保证并发下不超卖。
    // 空壳阶段暂不扣减，接入商品发布流程后补全。

    return {
      code: 0,
      msg: '下单成功',
      orderId: addRes._id,
      orderNo: order.orderNo,
      totalPrice
    }
  } catch (err) {
    console.error('[createOrder] 创建订单失败', err)
    return { code: -1, msg: '下单失败，请稍后重试' }
  }
}
