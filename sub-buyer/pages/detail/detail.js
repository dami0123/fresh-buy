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
   * 写操作必须走云函数（CLAUDE.md「前端开发规范」）。
   * 云函数本身还有下架 / 售罄 / 超库存等分支，成功与否以 result.code 为准，
   * 不能只看调用有没有 fail —— 业务失败也是 success 回调。
   */
  addCart() {
    wx.cloud.callFunction({
      name: 'addToCart',
      data: {
        productId: this.data.product._id,
        count: this.data.count
      },
      success: (res) => {
        const result = res.result || {}
        if (result.code !== 0) {
          wx.showToast({ title: result.msg || '加入购物车失败', icon: 'none' })
          return
        }
        wx.showToast({ title: '加入购物车成功', icon: 'success' })
      },
      fail: (err) => {
        console.error('[FreshBuy] 加入购物车失败', err)
        wx.showToast({ title: '加入购物车失败', icon: 'none' })
      }
    })
  },

  /**
   * 立即购买 —— 跳转到确认下单页
   *                    ← 改动位置：原实现直接调 createOrder，现改为带商品信息跳转。
   *
   * 为什么不在这里直接调 createOrder：下单必须带收货地址快照，而地址表单在
   * order-confirm 页。本页没有地址数据，也不该承担地址校验 —— 把商品信息交给
   * order-confirm 后，由那一页统一收集地址、校验、并以快照形式传给 createOrder。
   * 这样「购物车结算」与「立即购买」共用同一条下单链路，地址逻辑只有一份。
   *
   * mode=buyNow 告知下单页这是单品直购：只下单这一件，不读购物车，
   * 也不把商品写进购物车（用户没主动加购，不该在他的购物车里留下条目）。
   */
  onBuyNow() {
    if (this.data.submitting) return

    const { product, count } = this.data
    if (!product) return

    // 借 submitting 兼作「跳转中」的防抖标记：连点两下会 push 出两个下单页，
    // 返回时看到重复页面。WXML 上它同时驱动按钮的 disabled。
    this.setData({ submitting: true })

    wx.navigateTo({
      url: '/sub-buyer/pages/order-confirm/order-confirm' +
        `?mode=buyNow&productId=${encodeURIComponent(this.data.productId)}` +
        `&count=${Math.max(1, Math.floor(Number(count) || 1))}`,
      fail: (err) => {
        console.error('[FreshBuy] 跳转确认下单页失败', err)
        wx.showToast({ title: '页面跳转失败，请稍后重试', icon: 'none' })
      },
      complete: () => {
        // 跳转结束后松开标记，用户从下单页返回时按钮恢复可用
        this.setData({ submitting: false })
      }
    })
  }
})
