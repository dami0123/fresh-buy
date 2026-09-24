// sub-seller/pages/order-manage/order-manage.js —— 订单发货处理 + 订单详情弹层
//
// 为什么走 getSellerOrders 云函数而不是前端直查 orders：orders 集合若配置为「所有人可读」，
// 任何买家都能读到全部订单（CLAUDE.md「越权校验约定」记录的缺陷）。云函数内校验 role === 'seller'，
// 且已内置售后过滤（filter: 'aftersale'），正好对上本页新增的售后 tab。
//
// 发货动作本身不在这里执行：本页只负责跳转到 ship 发货拍照页并带上订单 id，
// 拍照上传后由 shipOrder 云函数把状态 1 -> 2（CLAUDE.md「订单状态机」）。
const { formatPrice, formatTime } = require('../../../utils/format')
const { toDate, toDisplayUrls, formatAddress } = require('../../utils/display')
const { ORDER_STATUS, ORDER_STATUS_TEXT, ORDER_STATUS_THEME } = require('../../../utils/constant')

const PAGE_SIZE = 10
const SHIP_PATH = '/sub-seller/pages/ship/ship'

/**
 * tab 定义。
 *
 * 用字符串 key 标识 tab，而不是把 status 数字直接塞进 dataset：
 * WXML 的 dataset 取值是字符串（"1"），拿 "1" 去 where({ status: "1" }) 查不到数据、
 * 与数字比较也会因类型不同恒为 false —— 这正是改造前 tab 筛选失效的原因。
 *
 * 售后 tab 不用 status 过滤，改传 filter: 'aftersale'（getSellerOrders 按
 * return.applyAt 是否存在筛选），因此它的 status 固定 -1。
 */
const TABS = [
  { key: 'all', name: '全部', status: -1, filter: '' },
  { key: 's1', name: ORDER_STATUS_TEXT[ORDER_STATUS.PENDING_SHIP], status: ORDER_STATUS.PENDING_SHIP, filter: '' },
  { key: 's2', name: ORDER_STATUS_TEXT[ORDER_STATUS.PENDING_CONFIRM_SHIP], status: ORDER_STATUS.PENDING_CONFIRM_SHIP, filter: '' },
  { key: 's3', name: ORDER_STATUS_TEXT[ORDER_STATUS.DELIVERING], status: ORDER_STATUS.DELIVERING, filter: '' },
  { key: 's4', name: ORDER_STATUS_TEXT[ORDER_STATUS.FINISHED], status: ORDER_STATUS.FINISHED, filter: '' },
  { key: 'aftersale', name: '售后', status: -1, filter: 'aftersale' }
]

/**
 * 售后信息摘要（只读）。
 * 责任判定由系统自动完成且为终局结论，商家端只查看，不提供任何改判入口
 * （CLAUDE.md「售后判定约定」）。
 */
function aftersaleSummary(order) {
  const ret = order.return
  if (!ret || !ret.applyAt) return null

  let liableText = '判定中'
  let liableTheme = 'pending'
  if (ret.liable === true) {
    liableText = '商家责任'
    liableTheme = 'yes'
  } else if (ret.liable === false) {
    liableText = '不成立'
    liableTheme = 'no'
  }

  let resolutionText = '待处理'
  if (ret.resolution === 'refund') {
    resolutionText = '已退款，订单关闭'
  } else if (ret.resolution === 'rejected') {
    resolutionText = '售后未通过'
  } else if (ret.resolution === 'reship') {
    resolutionText = '已重发货'
  } else if (ret.liable === true) {
    resolutionText = '待买家选择退款或重发货'
  }

  return {
    liableText,
    liableTheme,
    resolutionText,
    reason: ret.reason || '',
    reshipCount: Number(order.reshipCount) || 0,
    applyTimeText: formatTime(toDate(ret.applyAt))
  }
}

/**
 * 补展示层字段。
 *
 * createTime / updateTime 必须经 display.js 的 toDate 归一后再交给 formatTime：
 * 云函数返回值经 JSON 序列化后 Date 会变成 ISO 字符串，而 formatTime 内部会把
 * '-' 换成 '/' 再 new Date()，这个结果在 iOS 上解析不了、会静默返回空串。
 */
function decorateOrder(order) {
  const items = order.items || []
  const status = Number(order.status)
  const shipRejectReason = order.shipRejectReason || ''

  // 状态 2 只有在买家驳回（shipRejectReason 非空）时才对商家开放重拍，
  // shipOrder 云函数接受 1 和 2 两种状态，重拍会覆盖上一轮照片
  const canRebook = status === ORDER_STATUS.PENDING_CONFIRM_SHIP && !!shipRejectReason

  return {
    ...order,
    items,
    count: items.reduce((sum, goods) => sum + Number(goods.count || 0), 0),
    totalPriceText: formatPrice(order.totalPrice),
    createTimeText: formatTime(toDate(order.createTime)),
    updateTimeText: formatTime(toDate(order.updateTime)),
    statusText: ORDER_STATUS_TEXT[status] || '未知',
    statusTheme: ORDER_STATUS_THEME[status] || 'muted',
    canShip: status === ORDER_STATUS.PENDING_SHIP || canRebook,
    shipBtnText: canRebook ? '重新拍照' : '发货',
    shipRejectReason,
    aftersale: aftersaleSummary(order)
  }
}

/**
 * 详情弹层的展示数据：在列表用的 decorateOrder 之上再补三样列表不展示的东西
 * —— 收货地址、商品单价与小计、两组照片的原始地址。
 *
 * 地址不额外存一份而是每次从 order.address 快照读（CLAUDE.md「地址快照原则」），
 * 保证详情与列表口径一致。
 */
function decorateDetail(order) {
  const base = decorateOrder(order)
  const address = order.address || {}
  const ret = order.return || {}

  return {
    ...base,
    items: base.items.map((goods) => {
      const price = Number(goods.price) || 0
      const count = Number(goods.count) || 0
      return {
        ...goods,
        priceText: formatPrice(price),
        subtotalText: formatPrice(price * count)
      }
    }),
    receiverName: String(address.name || ''),
    receiverPhone: String(address.phone || ''),
    addressText: formatAddress(address),
    // 原始值（可能是 cloud:// fileID，也可能是开发期的网络占位图），
    // 渲染后再由 fillDetailPhotos 换成 <image> 能用的地址
    shipPhotos: order.shipPhotos || [],
    returnPhotos: ret.photos || []
  }
}

Page({
  data: {
    tabs: TABS,
    activeKey: TABS[0].key, // 当前 tab 的字符串标识
    activeStatus: -1,       // 传给 getSellerOrders 的状态过滤，-1 表示不过滤
    orderFilter: '',        // 'aftersale' 表示按售后过滤，空串表示不按售后过滤
    orders: [],
    page: 1,
    hasMore: true,
    loading: false,
    refreshing: false,
    error: '',

    // ---- 订单详情弹层 ----
    detailVisible: false,
    detailLoading: false,
    detailError: '',
    detail: null
  },

  onLoad() {
    this.loadOrders(true)
  },

  onShow() {
    // 从 ship 发货页返回时订单状态可能已变（1 -> 2），需要重拉。
    // 首次进入 onLoad 已发过请求，用 hasLoadedOnce 跳过，避免同一次进入打两次接口。
    if (this.hasLoadedOnce) {
      // 弹层里的数据同样可能已过期（比如刚发完货回来），一并关掉，避免看着旧状态
      this.closeDetail()
      this.loadOrders(true)
    }
  },

  onPullDownRefresh() {
    this.setData({ refreshing: true })
    this.loadOrders(true, () => {
      this.setData({ refreshing: false })
      wx.stopPullDownRefresh()
    })
  },

  onReachBottom() {
    this.loadOrders(false)
  },

  /** 切换状态筛选 */
  onTabTap(e) {
    const key = e.currentTarget.dataset.key
    if (!key || key === this.data.activeKey) return

    const tab = TABS.filter((item) => item.key === key)[0]
    if (!tab) return

    // 切 tab 必须同时重置分页与 hasMore，否则会带着上一个 tab 的页码去查，
    // 出现「第一页有数据、往上滑却没反应」这类难查的问题
    this.setData({
      activeKey: key,
      activeStatus: tab.status,
      orderFilter: tab.filter,
      orders: [],
      page: 1,
      hasMore: true,
      error: ''
    })

    this.loadOrders(true)
  },

  /**
   * 分页加载订单（走 getSellerOrders 云函数）
   * @param {boolean} reset true 表示重置到第一页
   * @param {Function} done 加载结束回调（供下拉刷新停止动画）
   */
  loadOrders(reset, done) {
    const finish = () => {
      if (typeof done === 'function') done()
    }

    // 上拉触发时若已到底或正在加载，直接结束，避免重复请求同一页
    if (!reset && (this.data.loading || !this.data.hasMore)) {
      finish()
      return
    }

    const page = reset ? 1 : this.data.page + 1
    this.setData({ loading: true, error: '' })

    wx.cloud.callFunction({
      name: 'getSellerOrders',
      data: {
        status: this.data.activeStatus,
        filter: this.data.orderFilter,
        page,
        pageSize: PAGE_SIZE
      },
      success: (res) => {
        const result = res.result || {}

        if (result.code !== 0) {
          this.setData({ loading: false, error: result.msg || '加载失败' })
          finish()
          return
        }

        const incoming = (result.list || []).map(decorateOrder)

        this.setData({
          orders: reset ? incoming : this.data.orders.concat(incoming),
          page,
          hasMore: !!result.hasMore,
          loading: false
        })

        this.hasLoadedOnce = true
        finish()
      },
      fail: (err) => {
        console.error('[FreshBuy] 获取订单列表失败', err)
        this.setData({ loading: false, error: '网络异常，请稍后重试' })
        finish()
      }
    })
  },

  /** 发货 / 重新拍照：跳转发货拍照页并带上订单 id，由 ship 页调 shipOrder */
  onShip(e) {
    const { id } = e.currentTarget.dataset
    if (!id) return

    wx.navigateTo({
      url: `${SHIP_PATH}?id=${id}`,
      fail: (err) => {
        console.error('[FreshBuy] 打开发货页失败', err)
        wx.showToast({ title: '页面打开失败', icon: 'none' })
      }
    })
  },

  // ---------------- 订单详情弹层 ----------------

  /**
   * 点击订单卡片 -> 打开详情弹层。
   *
   * 卡片数据是列表接口返回的，字段不全（没有地址、没有单条订单的完整 return），
   * 所以这里按 id 再取一次单条：getSellerOrders 传 orderId 走单条模式，
   * 云函数内已校验 role === 'seller'，不需要前端再做权限判断。
   */
  onCardTap(e) {
    const { id } = e.currentTarget.dataset
    if (!id) return

    // 每次打开自增一次令牌，用于丢弃「上一次打开」遗留的在途响应
    this.detailToken = (this.detailToken || 0) + 1
    const token = this.detailToken

    this.setData({
      detailVisible: true,
      detailLoading: true,
      detailError: '',
      detail: null
    })

    this.loadDetail(id, token)
  },

  /**
   * 拉取单条订单详情
   * @param {string} orderId
   * @param {number} token 打开时的令牌；响应回来时若已不等于当前值（弹层被关掉、
   *                       或用户快速点了另一张卡片），直接丢弃，避免把旧数据写进新弹层
   */
  loadDetail(orderId, token) {
    wx.cloud.callFunction({
      name: 'getSellerOrders',
      data: { orderId },
      success: (res) => {
        if (token !== this.detailToken) return

        const result = res.result || {}
        if (result.code !== 0 || !result.order) {
          this.setData({ detailLoading: false, detailError: result.msg || '订单加载失败' })
          return
        }

        this.setData({ detail: decorateDetail(result.order), detailLoading: false })
        this.fillDetailPhotos(token)
      },
      fail: (err) => {
        if (token !== this.detailToken) return

        console.error('[FreshBuy] 获取订单详情失败', err)
        this.setData({ detailLoading: false, detailError: '网络异常，请稍后重试' })
      }
    })
  },

  /**
   * 把详情里的发货照片 / 退货照片换成 <image> 能直接用的地址。
   * 与 ship.js 的 fillLastShipPhotos 同一套路：cloud:// 换临时链接，
   * 开发期的网络占位图原样返回（见 sub-seller/utils/display.js）。
   */
  fillDetailPhotos(token) {
    const detail = this.data.detail
    if (!detail) return

    const srcs = detail.shipPhotos.concat(detail.returnPhotos).filter(Boolean)
    if (!srcs.length) return

    toDisplayUrls(srcs).then((urls) => {
      if (token !== this.detailToken) return

      const current = this.data.detail
      if (!current) return

      const urlMap = {}
      srcs.forEach((src, index) => {
        urlMap[src] = urls[index] || src
      })

      const mapAll = (list) => list.map((src) => urlMap[src] || src)

      this.setData({
        'detail.shipPhotos': mapAll(current.shipPhotos),
        'detail.returnPhotos': mapAll(current.returnPhotos)
      })
    })
  },

  /** 点击详情里的照片放大；发货照片与退货照片合并传入，便于左右滑动对比 */
  onPreviewPhoto(e) {
    const src = e.currentTarget.dataset.src
    const detail = this.data.detail
    if (!src || !detail) return

    const urls = detail.shipPhotos.concat(detail.returnPhotos).filter(Boolean)
    if (!urls.length) return

    wx.previewImage({ current: src, urls })
  },

  /** 关闭详情弹层（点遮罩、点 × 都走这里） */
  onCloseDetail() {
    this.closeDetail()
  },

  /**
   * 关闭弹层。
   * 令牌自增，让还在路上的详情请求 / 图片地址转换结果全部作废，
   * 否则关闭后回来的响应会把 detail 又填上、弹层下次打开时闪一下旧数据。
   */
  closeDetail() {
    this.detailToken = (this.detailToken || 0) + 1
    if (!this.data.detailVisible && !this.data.detail) return

    this.setData({
      detailVisible: false,
      detailLoading: false,
      detailError: '',
      detail: null
    })
  },

  /**
   * 空处理器：只用于 catchtap / catchtouchmove 拦截冒泡。
   * catchtouchmove 拦的是页面本身的滚动与下拉刷新穿透 —— 弹层内的 scroll-view
   * 自己管自己的触摸，不受影响。
   */
  noop() {}
})
