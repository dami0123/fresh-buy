// sub-seller/pages/dashboard/dashboard.js —— 数据概览
// 概览数据均为读操作，按 CLAUDE.md 约定可直接使用云数据库的 count 统计，无需云函数。
const { ORDER_STATUS } = require('../../../utils/constant')

const db = wx.cloud.database()

Page({
  data: {
    stats: {
      productTotal: 0,      // 商品总数
      orderTotal: 0,        // 订单总数
      pendingShipTotal: 0,  // 待发货订单数
      finishedTotal: 0      // 已完成订单数
    },
    loading: true,
    error: ''
  },

  onShow() {
    this.loadStats()
  },

  onPullDownRefresh() {
    this.loadStats(() => wx.stopPullDownRefresh())
  },

  /** 并发统计各维度数据 */
  loadStats(done) {
    this.setData({ loading: true, error: '' })

    Promise.all([
      db.collection('products').count(),
      db.collection('orders').count(),
      db.collection('orders').where({ status: ORDER_STATUS.PENDING_SHIP }).count(),
      db.collection('orders').where({ status: ORDER_STATUS.FINISHED }).count()
    ])
      .then(([productRes, orderRes, pendingRes, finishedRes]) => {
        this.setData({
          stats: {
            productTotal: productRes.total,
            orderTotal: orderRes.total,
            pendingShipTotal: pendingRes.total,
            finishedTotal: finishedRes.total
          },
          loading: false
        })
      })
      .catch((err) => {
        console.error('[FreshBuy] 读取概览数据失败', err)
        this.setData({ loading: false, error: '数据加载失败，请检查数据库权限设置' })
      })
      .then(() => {
        if (typeof done === 'function') done()
      })
  },

  /** 快捷入口跳转 */
  onNavTap(e) {
    const { url } = e.currentTarget.dataset
    wx.navigateTo({ url })
  },

  /** 退出到身份选择页 */
  onLogout() {
    const app = getApp()
    app.globalData.role = ''
    app.globalData.userInfo = null
    wx.reLaunch({ url: '/pages/index/index' })
  }
})
