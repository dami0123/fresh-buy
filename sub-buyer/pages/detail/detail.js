// sub-buyer/pages/detail/detail.js —— 商品详情
// 读取单个商品属于读操作，按 CLAUDE.md 约定可直接使用云数据库；
// 一切写操作（加购、下单）必须经由云函数。
const { formatPrice, calcTotal } = require('../../../utils/format')

const db = wx.cloud.database()

Page({
  data: {
    productId: '',
    product: null,
    count: 1,
    totalText: '0.00',
    loading: true,
    error: '',
    submitting: false
  },

  onLoad(options) {
    const productId = options && options.id
    if (!productId) {
      this.setData({ loading: false, error: '缺少商品参数' })
      return
    }
    this.setData({ productId })
    this.loadProduct(productId)
  },

  /** 读取商品详情 */
  loadProduct(productId) {
    db.collection('products')
      .doc(productId)
      .get()
      .then((res) => {
        const product = res.data
        product.priceText = formatPrice(product.price)
        this.setData({ product, loading: false })
        this.refreshTotal()
      })
      .catch((err) => {
        console.error('[FreshBuy] 读取商品详情失败', err)
        this.setData({ loading: false, error: '商品不存在或已被下架' })
      })
  },

  /** 数量 -1 */
  onMinus() {
    if (this.data.count <= 1) return
    this.setData({ count: this.data.count - 1 })
    this.refreshTotal()
  },

  /** 数量 +1，不超过库存 */
  onPlus() {
    const { product, count } = this.data
    const stock = product ? Number(product.stock) : 0
    if (count >= stock) {
      wx.showToast({ title: '已达库存上限', icon: 'none' })
      return
    }
    this.setData({ count: count + 1 })
    this.refreshTotal()
  },

  /** 重算合计金额 */
  refreshTotal() {
    const { product, count } = this.data
    if (!product) return
    const total = calcTotal([{ price: product.price, count }])
    this.setData({ totalText: formatPrice(total) })
  },

  /**
   * 加入购物车
   * TODO: 按 CLAUDE.md「所有写操作必须通过云函数」的约定，购物车需要补充云函数
   * （建议命名 addToCart / updateCartCount / removeCart），部署后再在此处调用：
   *   wx.cloud.callFunction({ name: 'addToCart', data: { productId, count } })
   */
  onAddToCart() {
    wx.showToast({
      title: '待接入 addToCart 云函数',
      icon: 'none'
    })
  },

  /** 立即购买 —— 调用 createOrder 云函数下单（金额由服务端重新计算） */
  onBuyNow() {
    if (this.data.submitting) return

    const { product, count } = this.data
    if (!product) return

    this.setData({ submitting: true })
    wx.showLoading({ title: '提交中…', mask: true })

    wx.cloud.callFunction({
      name: 'createOrder',
      data: {
        items: [{ productId: this.data.productId, count }]
      },
      success: (res) => {
        const result = res.result || {}
        if (result.code !== 0) {
          wx.showToast({ title: result.msg || '下单失败', icon: 'none' })
          return
        }
        wx.showToast({ title: '下单成功', icon: 'success' })
        // 空壳阶段不接入支付，仅提示订单号；后续可跳转订单详情页
        console.log('[FreshBuy] 订单已创建', result.orderNo)
      },
      fail: (err) => {
        console.error('[FreshBuy] 创建订单失败', err)
        wx.showToast({ title: '网络异常，请稍后重试', icon: 'none' })
      },
      complete: () => {
        wx.hideLoading()
        this.setData({ submitting: false })
      }
    })
  }
})
