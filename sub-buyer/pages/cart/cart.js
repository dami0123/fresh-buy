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

  /** 结算：把购物车条目提交给 createOrder 云函数（金额与库存由云函数二次校验） */
  onCheckout() {
    if (this.data.submitting) return
    if (!this.data.carts.length) {
      wx.showToast({ title: '购物车是空的', icon: 'none' })
      return
    }

    this.setData({ submitting: true })
    wx.showLoading({ title: '提交中…', mask: true })

    wx.cloud.callFunction({
      name: 'createOrder',
      data: {
        items: this.data.carts.map((item) => ({
          productId: item.productId,
          count: item.count
        }))
      },
      success: (res) => {
        const result = res.result || {}
        if (result.code !== 0) {
          wx.showToast({ title: result.msg || '下单失败', icon: 'none' })
          return
        }
        wx.showToast({ title: '下单成功', icon: 'success' })
        // TODO: 下单成功后应清空已下单的购物车条目（需 removeCart 云函数）
      },
      fail: (err) => {
        console.error('[FreshBuy] 结算失败', err)
        wx.showToast({ title: '网络异常，请稍后重试', icon: 'none' })
      },
      complete: () => {
        wx.hideLoading()
        this.setData({ submitting: false })
      }
    })
  },

  /** 去逛逛 */
  onGoHome() {
    wx.navigateBack({
      fail: () => wx.redirectTo({ url: '/sub-buyer/pages/home/home' })
    })
  }
})
