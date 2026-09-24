// cloudfunctions/updateProduct —— 商家更新商品（上下架 / 库存 / 名称 / 价格 / 分类 / 图片）
//
// 安全约定（CLAUDE.md「商家端特别约定」）：
//   - 受保护字段（createTime / _id / _openid / updateTime）传入即拒绝，见 PROTECTED_FIELDS
//   - 字段白名单：白名单外的字段一律忽略，防止越权注入
//   - 金额、库存云函数端二次校验，不信任前端传入（价格负数与非正数分开拦）
//   - 调用者身份查 users 集合确认 role === 'seller'
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const users = db.collection('users')
const products = db.collection('products')

// 分类白名单：与 categories.key / home.js 静态分类 / utils/category.js 严格对齐
const CATEGORY_KEYS = ['vegetable', 'fruit', 'meat', 'seafood']
const NAME_MAX_LEN = 30
const MAX_PRICE = 999999 // 金额上限，防异常值

/**
 * 受保护字段：传入即拒绝（而不是静默忽略）。
 *
 * - createTime 由 createProduct 写定，同时是 getProducts 列表排序的依据
 *   （cloudfunctions/getProducts 按 createTime desc 排序）。若允许前端改，
 *   商品可以靠改时间把自己顶到首页，也可能因改成字符串导致排序整体错乱。
 * - _id / _openid 是云开发的系统字段，updateTime 由本函数统一维护。
 *
 * 为什么是「拒绝」而不是像其他字段那样过滤掉：白名单静默忽略会让调用方
 * 以为改动生效了，排查时只能靠猜。这里直接报错，问题第一时间暴露。
 */
const PROTECTED_FIELDS = ['createTime', '_id', '_openid', 'updateTime']

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const { productId } = event

  if (!productId) {
    return { code: -1, msg: '缺少商品 ID' }
  }

  // ---- 受保护字段拦截 ----
  const hitProtected = PROTECTED_FIELDS.filter((key) =>
    Object.prototype.hasOwnProperty.call(event, key)
  )
  if (hitProtected.length) {
    return { code: -1, msg: `不允许修改字段：${hitProtected.join('、')}` }
  }

  // ---- 字段白名单：逐项校验，白名单外的字段一律忽略 ----
  const data = {}
  const has = (key) => Object.prototype.hasOwnProperty.call(event, key)

  if (has('name')) {
    const name = String(event.name || '').trim()
    if (!name) return { code: -1, msg: '商品名称不能为空' }
    if (name.length > NAME_MAX_LEN) return { code: -1, msg: `商品名称最多 ${NAME_MAX_LEN} 字` }
    data.name = name
  }
  if (has('price')) {
    const price = Number(event.price)
    // 负数与非数字分开拦：文案不同，前端排查时一眼能看出是传错了还是传漏了
    if (!Number.isFinite(price) || price < 0) {
      return { code: -1, msg: '商品价格不能为负数' }
    }
    if (price === 0 || price > MAX_PRICE) {
      return { code: -1, msg: `商品价格需大于 0 且不超过 ${MAX_PRICE}` }
    }
    data.price = Number(price.toFixed(2))
  }
  if (has('stock')) {
    // Math.floor(Number(...)) 对非数字得 NaN，会被下面的 isFinite 拦下
    const stock = Math.floor(Number(event.stock))
    if (!Number.isFinite(stock) || stock < 0) return { code: -1, msg: '库存不能为负数' }
    data.stock = stock
  }
  if (has('category')) {
    const category = String(event.category || '')
    if (!CATEGORY_KEYS.includes(category)) return { code: -1, msg: '商品分类不合法' }
    data.category = category
  }
  if (has('images')) {
    const images = Array.isArray(event.images)
      ? event.images.filter((item) => typeof item === 'string' && item)
      : []
    if (images.length === 0) return { code: -1, msg: '请至少保留 1 张商品图片' }
    data.images = images
  }
  if (has('status')) {
    data.status = Number(event.status) === 0 ? 0 : 1
  }

  if (Object.keys(data).length === 0) {
    return { code: -1, msg: '没有需要更新的字段' }
  }

  try {
    // ---- 权限校验：以数据库中的 role 为准 ----
    const userRes = await users.where({ openid: OPENID }).limit(1).get()
    const role = userRes.data[0] && userRes.data[0].role
    if (role !== 'seller') {
      return { code: -2, msg: '无权限操作，仅商家可修改商品' }
    }

    // ---- 确认商品存在 ----
    const productRes = await products.doc(productId).get().catch(() => null)
    if (!productRes || !productRes.data) {
      return { code: -1, msg: '商品不存在' }
    }

    await products.doc(productId).update({
      data: { ...data, updateTime: new Date() }
    })

    return { code: 0, msg: '商品已更新' }
  } catch (err) {
    console.error('[updateProduct] 更新商品失败', err)
    return { code: -1, msg: '更新失败，请稍后重试' }
  }
}
