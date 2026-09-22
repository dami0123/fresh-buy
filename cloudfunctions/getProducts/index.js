// cloudfunctions/getProducts —— 获取商品列表（仅上架商品）
// 分页由云函数内的 skip / limit 完成，避免前端一次性拉取全量数据。
// status 过滤：下架（status = 0）的商品对买家不可见。用 neq(0) 而非 eq(1)，
// 兼容历史数据缺失 status 字段的情况（与 createOrder「仅显式下架才拒绝」的口径一致）。
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command
const products = db.collection('products')

const MAX_PAGE_SIZE = 50 // 单次请求上限，防止被恶意拉取全表

exports.main = async (event) => {
  const { category = '' } = event

  // 参数兜底与边界限制
  const pageSize = Math.min(Math.max(Number(event.pageSize) || 10, 1), MAX_PAGE_SIZE)
  const page = Math.max(Number(event.page) || 1, 1)

  try {
    // category 为空表示查询全部分类；两种情况下都过滤下架商品
    const query = products.where(
      category ? { category, status: _.neq(0) } : { status: _.neq(0) }
    )

    const [listRes, countRes] = await Promise.all([
      query
        .orderBy('createTime', 'desc') // 依赖商品文档的 createTime 字段
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .get(),
      query.count()
    ])

    const total = countRes.total

    return {
      code: 0,
      list: listRes.data,
      total,
      page,
      pageSize,
      hasMore: page * pageSize < total
    }
  } catch (err) {
    console.error('[getProducts] 查询失败', err)
    return {
      code: -1,
      msg: '商品列表加载失败',
      list: [],
      total: 0,
      page,
      pageSize,
      hasMore: false
    }
  }
}
