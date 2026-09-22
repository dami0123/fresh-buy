// sub-buyer/pages/cart/cart.js —— 购物车
// 说明：CLAUDE.md 云函数清单中尚未包含购物车相关函数，因此当前仅实现「读取」与结算入口。
// 增删改（加购 / 改数量 / 删除）必须在补充云函数后接入，禁止在前端直接调用数据库写方法。
const { formatPrice, calcTotal } = require('../../../utils/format')

const db = wx.cloud.database()

Page({
  data: {
    carts: [],       // 购物车条目（含商品快照信息）
    totalCount: 0,
    totalText: '0.00',
    loading: true,
    error: '',
    submitting: false
  },

  onShow() {
    this.loadCart()
  },

  onPullDownRefresh() {
    this.loadCart(() => wx.stopPullDownRefresh())
  },

  /** 读取当前用户的购物车（读操作，允许直接查库；按 userId 过滤保证只取自己的数据） */
  loadCart(done) {
    const app = getApp()
    const openid = app.globalData.openid

    if (!openid) {
      this.setData({ loading: false, error: '未获取到登录信息，请返回首页重新登录' })
      if (typeof done === 'function') done()
      return
    }

    this.setData({ loading: true, error: '' })

    db.collection('cart')
      .where({ userId: openid })
      .get()
      .then((res) => {
        const carts = (res.data || []).map((item) => ({
          ...item,
          priceText: formatPrice(item.price),
          subtotalText: formatPrice(Number(item.price || 0) * Number(item.count || 0))
        }))

        const total = calcTotal(carts.map((i) => ({ price: i.price, count: i.count })))
        const totalCount = carts.reduce((sum, i) => sum + Number(i.count || 0), 0)

        this.setData({
          carts,
          totalCount,
          totalText: formatPrice(total),
          loading: false
        })
      })
      .catch((err) => {
        console.error('[FreshBuy] 读取购物车失败', err)
        this.setData({ loading: false, error: '加载失败，请稍后重试' })
      })
      .then(() => {
        if (typeof done === 'function') done()
      })
  },

  /**
   * 删除条目
   * TODO: 按 CLAUDE.md「所有写操作必须通过云函数」的约定，需先补充 removeCart 云函数，示例：
   *   wx.cloud.callFunction({ name: 'removeCart', data: { cartId } })
   */
  onRemove(e) {
    wx.showToast({ title: '待接入 removeCart 云函数', icon: 'none' })
  },

  /**
   * 结算：跳转到确认下单页。
   *
   * 为什么不在这里直接调 createOrder：下单必须先有收货地址快照，
   * 而地址表单在 order-confirm 页。购物车既没有地址数据，也不该替下单页
   * 承担地址校验（校验的唯一归属地是 order-confirm 的 validateAddress），
   * 因此这里只负责把用户送到下单页，由那一页收集地址后调 createOrder。
   */
  onCheckout() {
    if (this.data.submitting) return
    if (!this.data.carts.length) {
      wx.showToast({ title: '购物车是空的', icon: 'none' })
      return
    }

    wx.navigateTo({ url: '/sub-buyer/pages/order-confirm/order-confirm' })
  },

  /** 去逛逛 */
  onGoHome() {
    wx.navigateBack({
      fail: () => wx.redirectTo({ url: '/sub-buyer/pages/home/home' })
    })
  }
})
