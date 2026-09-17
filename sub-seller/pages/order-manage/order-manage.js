// sub-seller/pages/order-manage/order-manage.js —— 订单发货处理
// 列表按 CLAUDE.md 约定使用 skip / limit 分页；
// 发货属于状态变更，统一调用 updateOrderStatus 云函数（其中会校验调用者是否为 seller）。
const { formatTime, formatPrice } = require('../../../utils/format')
const { ORDER_STATUS, ORDER_STATUS_TEXT, ORDER_STATUS_THEME } = require('../../../utils/constant')

const db = wx.cloud.database()
const PAGE_SIZE = 10

Page({
  data: {
    // 用 -1 表示「全部」：WXML 的 dataset 会把 null 转成空字符串，
    // 直接用 null 会退化成 where({ status: '' }) 而查不到数据
    tabs: [
      { status: -1, name: '全部' },
      { status: ORDER_STATUS.PENDING_SHIP, name: '待发货' },
      { status: ORDER_STATUS.PENDING_CONFIRM_SHIP, name: '待确认发货' },
      { status: ORDER_STATUS.DELIVERING, name: '配送中' },
      { status: ORDER_STATUS.FINISHED, name: '已完成' }
    ],
    activeStatus: -1, // -1 表示不过滤状态
    orders: [],
    page: 1,
    hasMore: true,
    loading: false,
    refreshing: false,
    shipping: false,
    error: ''
  },

  onLoad() {
    this.loadOrders(true)
  },

  onPullDownRefresh() {
    this.setData({ refreshing: true })
    this.loadOrders(true, () => {
      this.setData({ refreshing: false })
      wx.stopPullDownRefresh()
    })
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loading) {
      this.loadOrders(false)
    }
  },

  /** 切换状态筛选 */
  onTabTap(e) {
    const status = e.currentTarget.dataset.status
    if (status === this.data.activeStatus) return
    this.setData({ activeStatus: status })
    this.loadOrders(true)
  },

  /**
   * 分页加载订单
   * @param {boolean} reset true 表示重置到第一页
   */
  loadOrders(reset, done) {
    const page = reset ? 1 : this.data.page + 1
    const status = this.data.activeStatus
    this.setData({ loading: true, error: '' })

    // activeStatus 为 -1 时表示「全部」，不加 where 条件
    const query = status === -1
      ? db.collection('orders')
      : db.collection('orders').where({ status })

    query
      .orderBy('createTime', 'desc')
      .skip((page - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .get()
      .then((res) => {
        const list = (res.data || []).map((order) => ({
          ...order,
          totalPriceText: formatPrice(order.totalPrice),
          createTimeText: formatTime(order.createTime),
          statusText: ORDER_STATUS_TEXT[order.status] || '未知',
          statusTheme: ORDER_STATUS_THEME[order.status] || 'done',
          count: (order.items || []).reduce((sum, i) => sum + Number(i.count || 0), 0),
          canShip: order.status === ORDER_STATUS.PENDING_SHIP
        }))

        this.setData({
          orders: reset ? list : this.data.orders.concat(list),
          page,
          hasMore: list.length === PAGE_SIZE,
          loading: false
        })
      })
      .catch((err) => {
        console.error('[FreshBuy] 读取订单列表失败', err)
        this.setData({ loading: false, error: '加载失败，请检查数据库权限设置' })
      })
      .then(() => {
        if (typeof done === 'function') done()
      })
  },

  /** 发货：调用云函数把订单状态推进到「已完成」 */
  onShip(e) {
    if (this.data.shipping) return

    const { id } = e.currentTarget.dataset
    const order = this.data.orders.find((item) => item._id === id)
    if (!order || !order.canShip) return

    wx.showModal({
      title: '确认发货',
      content: `订单 ${order.orderNo}`,
      success: (res) => {
        if (!res.confirm) return
        this.submitShip(id)
      }
    })
  },

  /** 执行状态变更 */
  submitShip(orderId) {
    this.setData({ shipping: true })
    wx.showLoading({ title: '处理中…', mask: true })

    wx.cloud.callFunction({
      name: 'updateOrderStatus',
      data: {
        orderId,
        status: ORDER_STATUS.FINISHED
      },
      success: (res) => {
        const result = res.result || {}
        if (result.code !== 0) {
          wx.showToast({ title: result.msg || '操作失败', icon: 'none' })
          return
        }
        wx.showToast({ title: '发货成功', icon: 'success' })
        this.loadOrders(true)
      },
      fail: (err) => {
        console.error('[FreshBuy] 更新订单状态失败', err)
        wx.showToast({ title: '网络异常，请稍后重试', icon: 'none' })
      },
      complete: () => {
        wx.hideLoading()
        this.setData({ shipping: false })
      }
    })
  }
})
