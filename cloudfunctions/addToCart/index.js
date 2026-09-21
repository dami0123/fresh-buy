// cloudfunctions/addToCart —— 加入购物车
// 安全约定（CLAUDE.md「前端开发规范」）：写操作一律在云函数内完成，禁止前端直接调用数据库写方法。
// cart 集合建档时必须显式写入 _openid：云函数写入的数据不会自动带 _openid，
// 而「仅创建者可读写」权限规则依赖它做比对，缺了会导致前端读不到自己的购物车。
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const CART_COLLECTION = 'cart'

const db = cloud.database()
const products = db.collection('products')
const carts = db.collection(CART_COLLECTION)

const MAX_COUNT = 99 // 单次加购上限，防止误操作与恶意刷量

// 云数据库不支持「写入时自动建表」，集合不存在时写入会直接抛错。
// 开发期很容易踩这个坑（报错信息也不够直白），这里主动兜底建一次。
// 容器复用期间只尝试一次，避免每次加购都浪费一次接口调用。
let cartCollectionEnsured = false

async function ensureCartCollection() {
  if (cartCollectionEnsured) return
  try {
    await db.createCollection(CART_COLLECTION)
    console.log(`[addToCart] ${CART_COLLECTION} 集合不存在，已自动创建`)
  } catch (err) {
    // 集合已存在时会抛错，属正常情况，忽略即可；
    // 若当前环境不支持该接口，也交给后续写入去暴露真实错误
  }
  cartCollectionEnsured = true
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const { productId } = event
  const count = Math.floor(Number(event.count))

  // ---- 参数校验 ----
  if (!productId) {
    return { code: -1, msg: '缺少商品参数' }
  }
  if (!Number.isFinite(count) || count <= 0) {
    return { code: -1, msg: '购买数量不合法' }
  }
  if (count > MAX_COUNT) {
    return { code: -1, msg: `单次最多加入 ${MAX_COUNT} 件` }
  }

  try {
    // 先确保集合存在，否则后面的写入会以「集合不存在」失败
    await ensureCartCollection()

    // ---- 以数据库中的商品为准，不信任前端传入的任何价格字段 ----
    const productRes = await products.doc(productId).get().catch(() => null)
    if (!productRes || !productRes.data) {
      return { code: -1, msg: '商品不存在或已被下架' }
    }

    const product = productRes.data

    // 仅在商品被显式下架时拒绝：部分历史数据可能没有 status 字段，不应因此误伤
    if (Number(product.status) === 0) {
      return { code: -1, msg: '商品已下架' }
    }

    const stock = Number(product.stock) || 0
    if (stock <= 0) {
      return { code: -1, msg: `「${product.name}」已售罄` }
    }

    // ---- 同一商品已在购物车中则累加数量，避免出现重复条目 ----
    const existRes = await carts.where({ userId: OPENID, productId }).limit(1).get()
    const exist = existRes.data[0]
    const currentCount = exist ? Number(exist.count) || 0 : 0
    const nextCount = currentCount + count

    if (nextCount > stock) {
      return { code: -1, msg: `「${product.name}」库存不足，仅剩 ${stock} 件` }
    }

    const now = new Date()

    // 商品快照：仅供购物车列表展示。下单金额一律由 createOrder 依据数据库现价重新计算，
    // 因此这里的 price 即便过期也不会影响成交价。
    const snapshot = {
      name: product.name,
      price: Number(product.price),
      image: (product.images && product.images[0]) || ''
    }

    if (exist) {
      await carts.doc(exist._id).update({
        data: { ...snapshot, count: nextCount, updateTime: now }
      })
      return { code: 0, msg: '已加入购物车', cartId: exist._id, count: nextCount }
    }

    const addRes = await carts.add({
      data: {
        userId: OPENID,
        _openid: OPENID, // 显式写入，供「仅创建者可读写」权限规则比对
        productId,
        ...snapshot,
        count,
        createTime: now,
        updateTime: now
      }
    })

    return { code: 0, msg: '已加入购物车', cartId: addRes._id, count }
  } catch (err) {
    console.error('[addToCart] 加入购物车失败', err)
    return { code: -1, msg: '加入购物车失败，请确认 cart 集合已创建且权限配置正确' }
  }
}
