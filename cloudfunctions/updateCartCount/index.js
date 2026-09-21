// cloudfunctions/updateCartCount —— 修改购物车条目数量
// 写操作必须在云函数内完成，并在云函数端校验条目归属（userId 以数据库为准，不信任前端）。
// 数量上限以商品当前库存为准，避免购物车里出现超过库存的数量。
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const products = db.collection('products')
const carts = db.collection('cart')

const MAX_COUNT = 99

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const { cartId } = event
  const count = Math.floor(Number(event.count))

  if (!cartId) {
    return { code: -1, msg: '缺少购物车条目参数' }
  }
  if (!Number.isFinite(count) || count <= 0) {
    return { code: -1, msg: '数量不合法' }
  }
  if (count > MAX_COUNT) {
    return { code: -1, msg: `单件商品最多 ${MAX_COUNT} 件` }
  }

  try {
    const cartRes = await carts.doc(cartId).get().catch(() => null)
    if (!cartRes || !cartRes.data) {
      return { code: -1, msg: '购物车条目不存在' }
    }

    const cart = cartRes.data

    // ---- 越权校验：只能操作自己的条目 ----
    if (cart.userId !== OPENID) {
      return { code: -2, msg: '无权操作该条目' }
    }

    // ---- 以商品当前库存作为数量上限 ----
    const productRes = await products.doc(cart.productId).get().catch(() => null)
    if (!productRes || !productRes.data) {
      return { code: -1, msg: '商品已不存在，请删除该条目' }
    }

    const product = productRes.data
    const stock = Number(product.stock) || 0

    if (count > stock) {
      return { code: -1, msg: `「${product.name}」库存不足，仅剩 ${stock} 件` }
    }

    await carts.doc(cartId).update({
      data: { count, updateTime: new Date() }
    })

    return { code: 0, msg: '已更新', cartId, count }
  } catch (err) {
    console.error('[updateCartCount] 更新数量失败', err)
    return { code: -1, msg: '更新失败，请稍后重试' }
  }
}
