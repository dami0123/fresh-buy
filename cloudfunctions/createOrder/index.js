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

/**
 * 收货地址必填字段（见 CLAUDE.md「收货地址约定」）。
 * postalCode 不在其中：wx.chooseAddress 本就可能返回空串，缺失不算错。
 */
const ADDRESS_REQUIRED = ['name', 'phone', 'province', 'city', 'district', 'detail']

/** 字段中文名，用于拼出「请补全××」这种能直接照着改的提示 */
const ADDRESS_LABEL = {
  name: '收货人',
  phone: '手机号',
  province: '省份',
  city: '城市',
  district: '区县',
  detail: '详细地址'
}

/**
 * 把前端传来的地址规整成订单快照。
 *
 * 为什么要白名单式重建而不是直接存 event.address：前端可被绕过，
 * 传入的对象可能夹带 _id、_openid 等字段。逐字段取值能保证订单里
 * 只有约定的 7 个字段，且类型统一为字符串。
 *
 * @return {{ok: boolean, msg: string, address: Object|null}}
 */
function normalizeAddress(input) {
  if (!input || typeof input !== 'object') {
    return { ok: false, msg: '缺少收货地址', address: null }
  }

  const address = {}
  ADDRESS_REQUIRED.forEach((key) => {
    address[key] = String(input[key] == null ? '' : input[key]).trim()
  })
  address.postalCode = String(input.postalCode == null ? '' : input.postalCode).trim()

  const missing = ADDRESS_REQUIRED.find((key) => !address[key])
  if (missing) {
    return { ok: false, msg: `收货地址不完整，请补全${ADDRESS_LABEL[missing]}`, address: null }
  }

  return { ok: true, msg: '', address }
}

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
  const { items = [], address: rawAddress } = event || {}

  // ---- 参数校验 ----
  if (!Array.isArray(items) || items.length === 0) {
    return { code: -1, msg: '订单商品不能为空' }
  }
  if (items.length > MAX_ITEM_KINDS) {
    return { code: -1, msg: `单笔订单最多支持 ${MAX_ITEM_KINDS} 种商品` }
  }

  // 地址与商品同属下单的必要信息，必须一起校验。
  // 前端下单页也校验一次，但那只为尽早给用户提示 —— 前端可被绕过，以这里的校验为准。
  const addressCheck = normalizeAddress(rawAddress)
  if (!addressCheck.ok) {
    return { code: -1, msg: addressCheck.msg }
  }
  const address = addressCheck.address

  try {
    // ---- 拉取涉及的商品，以数据库中的数据为准 ----
    const ids = items.map((item) => item.productId).filter(Boolean)
    if (ids.length !== items.length) {
      return { code: -1, msg: '订单商品参数不完整' }
    }
    // 同一商品在本单里出现多次，会被拆成多条 orderItems 且各自判库存，
    // 合计数量可能超过实际库存。购物车已按 productId 合并，正常不会出现，直接拦下。
    if (new Set(ids).size !== ids.length) {
      return { code: -1, msg: '订单中存在重复商品，请返回购物车重新提交' }
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

      // 三项服务端校验：下架 / 价格合法性 / 库存。
      // 必须在 count 校验之后 —— 下面用到了 count，而它是本块内的 const。
      if (Number(product.status) === 0) {
        return { code: -1, msg: `【${product.name}】已下架` }
      }

      const price = Number(product.price)
      if (!Number.isFinite(price) || price < 0) {
        return { code: -1, msg: `【${product.name}】价格异常` }
      }

      // 缺 stock 字段时按 0 处理：原写法 Number(undefined) < count 恒为 false，
      // 会让没有库存字段的商品蒙混过关（NaN 与任何数比较都是 false）。
      const stock = Number(product.stock) || 0
      if (stock < count) {
        return { code: -1, msg: `【${product.name}】库存不足，仅剩 ${stock} 件` }
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
      // 地址快照：这里存的是下单时复制过来的内容副本，不是 users.address 的引用。
      // 否则用户事后修改收货地址，历史订单的地址会跟着变（CLAUDE.md「地址快照原则」）。
      address,
      createTime: now,
      updateTime: now
    }

    const addRes = await orders.add({ data: order })

    // TODO【第二梯队 · 本次迭代不实现】：库存扣减与订单写入应放入事务，保证并发下不超卖。
    //
    // 现存风险（两处，都属于并发问题，功能测试单人操作测不出来）：
    //   1) 超卖：上面的库存校验只是「读校验」，与这里的订单写入是两步独立操作，
    //      中间没有事务保护。两个用户同时下单同一件 stock=1 的商品时，双方都能读到
    //      库存充足并通过校验，随后各自写入订单 —— 库存被超卖。
    //      按 CLAUDE.md「库存扣减约定」，正确做法是 db.startTransaction() 内完成
    //      「扣减 + 写单」，扣减用 _.inc(-count) 原子写（禁止先读后写回），
    //      事务内重新校验库存，任一步失败整体回滚。
    //   2) 重复商品拦截的边界：上面的 new Set(ids) 查重只能拦住「同一个订单内重复提交
    //      同一商品」，拦不住「两个并发请求各下一单同一商品」—— 后者是跨请求的并发，
    //      需靠上面的事务 + 原子扣减解决，查重逻辑本身无法覆盖。
    //
    // 空壳阶段暂不扣减，接入商品发布流程后随事务一起补全。

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
