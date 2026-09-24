// cloudfunctions/getSellerOrders —— 商家端订单查询（列表 / 单条 / 售后过滤）
//
// 存在意义（CLAUDE.md「越权校验约定」）：替代商家端前端直查全量订单的写法——
// 订单集合为「仅创建者可读写」时买家直查会越权，放开权限则任何买家都能读到
// 所有订单，属安全缺陷。本函数在云函数内校验调用者 role === 'seller'。
//
// 三种模式：
//   1. orderId 传入 -> 返回单条订单 { order }（ship 发货页加载订单用）
//   2. filter = 'aftersale' -> 返回存在 return.applyAt 的订单，含已终结的售后
//      （rejected / refund / reship），对应商家端流程图「查看退款结果」；
//      按 updateTime 倒序（最近处理的排前面）
//   3. 其余 -> 按 status 过滤（status > 0 才过滤，0 或不传 = 全部）分页列表，
//      返回 { list, total, hasMore }，total 供 dashboard 统计复用
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command
const users = db.collection('users')
const orders = db.collection('orders')

const MAX_PAGE_SIZE = 50 // 单次请求上限，防止被恶意拉取全表

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()

  try {
    // ---- 权限校验：以数据库中的 role 为准 ----
    const userRes = await users.where({ openid: OPENID }).limit(1).get()
    const role = userRes.data[0] && userRes.data[0].role
    if (role !== 'seller') {
      return { code: -2, msg: '无权限操作，仅商家可查看订单' }
    }

    // ---- 单条模式 ----
    const orderId = String(event.orderId || '')
    if (orderId) {
      const orderRes = await orders.doc(orderId).get().catch(() => null)
      if (!orderRes || !orderRes.data) {
        return { code: -1, msg: '订单不存在' }
      }
      return { code: 0, order: orderRes.data }
    }

    // ---- 列表模式 ----
    const pageSize = Math.min(Math.max(Number(event.pageSize) || 10, 1), MAX_PAGE_SIZE)
    const page = Math.max(Number(event.page) || 1, 1)
    const status = Number(event.status)

    let query = orders
    let orderField = 'createTime'

    if (event.filter === 'aftersale') {
      // 售后相关：return.applyAt 字段存在的订单（进行中 + 已终结）
      query = orders.where({ 'return.applyAt': _.exists(true) })
      orderField = 'updateTime'
    } else if (Number.isInteger(status) && status > 0) {
      query = orders.where({ status })
    }

    const [listRes, countRes] = await Promise.all([
      query
        .orderBy(orderField, 'desc')
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .get(),
      query.count()
    ])

    return {
      code: 0,
      list: listRes.data,
      total: countRes.total,
      page,
      pageSize,
      hasMore: page * pageSize < countRes.total
    }
  } catch (err) {
    console.error('[getSellerOrders] 查询失败', err)
    return { code: -1, msg: '订单加载失败', list: [], total: 0, hasMore: false }
  }
}
