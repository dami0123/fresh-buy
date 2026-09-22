// sub-buyer/pages/order-list/order-list.js —— 我的订单
// 本页职责：按状态分 tab 拉取「自己」的订单，分页加载。
// 注意：tab 中不含「待支付」（本项目无支付环节，见 CLAUDE.md 订单状态机）。
//
// 为什么走 getMyOrders 云函数而不是前端直查 orders：orders 集合若配置为
// 「所有人可读」，任何买家都能读到全部订单。云函数内用 getWXContext() 拿到的
// 可信 OPENID 过滤，从根本上保证只返回本人的订单（见该函数头部注释）。
const { formatPrice, formatTime } = require('../../../utils/format')
const { toDate, toDisplayUrls } = require('../../utils/display')
const { ORDER_STATUS, ORDER_STATUS_TEXT, ORDER_STATUS_THEME } = require('../../../utils/constant')

const PAGE_SIZE = 10 // 与 getMyOrders 的默认值一致，上限为 20

/**
 * tab 的状态取值与文案。
 *
 * -1 表示「全部」：getMyOrders 对 -1/NaN 不加 status 条件。
 * 文案一律取自 constant.js 的 ORDER_STATUS_TEXT，不在这里重抄中文 ——
 * 否则改常量时容易只改一处，另一处悄悄失效（CLAUDE.md 对该坑有明确记录）。
 */
const TAB_STATUSES = [
  -1,
  ORDER_STATUS.PENDING_SHIP,          // 1 待发货
  ORDER_STATUS.PENDING_CONFIRM_SHIP,  // 2 待确认发货
  ORDER_STATUS.DELIVERING,            // 3 配送中
  ORDER_STATUS.FINISHED               // 4 已完成
]

const TABS = TAB_STATUSES.map((status) => ({
  status,
  label: status === -1 ? '全部' : (ORDER_STATUS_TEXT[status] || '未知'),
  // 空态文案跟着当前 tab 走，让用户一眼看出「是这个筛选下没有」而不是「没下过单」
  emptyText: status === -1 ? '还没有订单' : `暂无${ORDER_STATUS_TEXT[status] || '此类'}订单`
}))

/**
 * 把云端订单补上展示层字段。
 *
 * createTime 必须经 display.js 的 toDate 归一后再交给 formatTime：
 * 云函数返回值经 JSON 序列化后 Date 会变成 ISO 字符串，而 formatTime 内部
 * 会把 '-' 换成 '/' 再 new Date()，这个结果在 iOS 上解析不了、会静默返回空串。
 */
function decorateOrder(order) {
  const items = (order.items || []).map((goods) => ({
    ...goods,
    priceText: formatPrice(goods.price),
    subtotalText: formatPrice(Number(goods.price || 0) * Number(goods.count || 0))
  }))

  const totalCount = items.reduce((sum, goods) => sum + Number(goods.count || 0), 0)

  return {
    ...order,
    items,
    totalCount,
    totalText: formatPrice(order.totalPrice),
    statusText: ORDER_STATUS_TEXT[order.status] || '未知状态',
    statusTheme: ORDER_STATUS_THEME[order.status] || 'muted',
    createTimeText: formatTime(toDate(order.createTime))
  }
}

Page({
  data: {
    tabs: TABS,
    activeStatus: -1,        // 当前 tab 的状态值，-1 表示全部
    emptyText: TABS[0].emptyText,
    orders: [],
    page: 1,
    hasMore: true,
    loading: true,           // 首屏 / 切 tab 时的整页加载
    loadingMore: false,      // 上拉加载下一页
    error: ''
  },

  onLoad() {
    this.loadOrders(true)
  },

  onShow() {
    // 从订单详情页返回时状态可能已变（确认发货、确认收货、发起售后都会改 status），
    // 需要重新拉取。首次进入时 onLoad 已经发过请求，靠 hasLoadedOnce 跳过，
    // 避免同一次进入打两次接口。
    if (this.hasLoadedOnce) {
      this.loadOrders(true)
    }
  },

  onPullDownRefresh() {
    this.loadOrders(true, () => wx.stopPullDownRefresh())
  },

  onReachBottom() {
    this.loadOrders(false)
  },

  /** 切换状态 tab */
  onTabTap(e) {
    const status = Number(e.currentTarget.dataset.status)
    if (status === this.data.activeStatus) return

    const tab = TABS.filter((t) => t.status === status)[0]

    // 切 tab 必须同时重置分页与 hasMore，否则会带着上一个 tab 的页码去查，
    // 出现「第一页就有数据、往上滑却没反应」这类难查的问题
    this.setData({
      activeStatus: status,
      emptyText: tab ? tab.emptyText : '还没有订单',
      orders: [],
      page: 1,
      hasMore: true,
      error: ''
    })

    this.loadOrders(true)
  },

  /**
   * 加载订单列表
   * @param {boolean} reset true 表示重置到第一页
   * @param {Function} done 加载结束回调（供下拉刷新停止动画）
   */
  loadOrders(reset, done) {
    const finish = () => {
      if (typeof done === 'function') done()
    }

    // 上拉触发时若已到底或正在加载，直接结束，避免重复请求同一页
    if (!reset && (this.data.loadingMore || !this.data.hasMore)) {
      finish()
      return
    }

    const page = reset ? 1 : this.data.page + 1

    this.setData(reset ? { loading: true, error: '' } : { loadingMore: true })

    wx.cloud.callFunction({
      name: 'getMyOrders',
      data: {
        // 传 -1 表示全部：getMyOrders 对 -1/NaN/未传不加状态条件
        status: this.data.activeStatus,
        page,
        pageSize: PAGE_SIZE
      },
      success: (res) => {
        const result = res.result || {}

        if (result.code !== 0) {
          this.setData({
            loading: false,
            loadingMore: false,
            error: result.msg || '加载失败'
          })
          finish()
          return
        }

        const incoming = (result.list || []).map(decorateOrder)

        this.setData({
          orders: reset ? incoming : this.data.orders.concat(incoming),
          page,
          hasMore: !!result.hasMore,
          loading: false,
          loadingMore: false
        })

        // 标记已加载过，onShow 据此决定是否需要刷新（见 onShow 注释）
        this.hasLoadedOnce = true
        finish()

        // 图片地址归一放在渲染之后异步做，不阻塞列表出现
        this.fillImageUrls()
      },
      fail: (err) => {
        console.error('[FreshBuy] 获取订单列表失败', err)
        this.setData({ loading: false, loadingMore: false, error: '网络异常，请稍后重试' })
        finish()
      }
    })
  },

  /**
   * 把已加载订单里的商品图统一转成 <image> 能用的地址。
   *
   * 订单里的图可能是 cloud:// fileID（正式规范）或网络占位图（开发期造的数据），
   * display.js 的 toDisplayUrls 对两者都处理：前者换临时链接，后者原样返回。
   * 转换失败时它内部已兜底保留原值 —— 图挂掉但列表仍可浏览，不影响下单信息。
   */
  fillImageUrls() {
    const srcs = []

    this.data.orders.forEach((order) => {
      order.items.forEach((goods) => {
        // 只收非空值：toDisplayUrls 会先 filter(Boolean)，
        // 传进空串会让返回数组与入参下标错位
        if (goods.image) srcs.push(goods.image)
      })
    })

    if (!srcs.length) return

    toDisplayUrls(srcs).then((urls) => {
      const urlMap = {}
      srcs.forEach((src, index) => {
        urlMap[src] = urls[index] || src
      })

      // 按解析完成时的最新 this.data.orders 重算，避免分页期间丢数据
      this.setData({
        orders: this.data.orders.map((order) => ({
          ...order,
          items: order.items.map((goods) => ({
            ...goods,
            image: urlMap[goods.image] || goods.image
          }))
        }))
      })
    })
  },

  /** 查看订单详情 */
  onDetail(e) {
    const orderId = e.currentTarget.dataset.id
    if (!orderId) return

    wx.navigateTo({ url: `/sub-buyer/pages/order-detail/order-detail?id=${orderId}` })
  },

  /** 空态里的「去逛逛」 */
  onGoHome() {
    wx.navigateBack({
      fail: () => wx.redirectTo({ url: '/sub-buyer/pages/home/home' })
    })
  }
})
