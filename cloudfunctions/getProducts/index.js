// cloudfunctions/getProducts —— 获取商品列表
// 分页由云函数内的 skip / limit 完成，避免前端一次性拉取全量数据。
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const products = db.collection('products')

const MAX_PAGE_SIZE = 50 // 单次请求上限，防止被恶意拉取全表

exports.main = async (event) => {
  const { category = '' } = event

  // 参数兜底与边界限制
  const pageSize = Math.min(Math.max(Number(event.pageSize) || 10, 1), MAX_PAGE_SIZE)
  const page = Math.max(Number(event.page) || 1, 1)

  try {
    // category 为空表示查询全部（不做 where 过滤）
    const query = category ? products.where({ category }) : products

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
