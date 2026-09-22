// sub-buyer/pages/order-detail/order-detail.js —— 订单详情
// 本页职责：
//   status=2 展示发货照片 + 确认发货 / 驳回重拍（调 confirmShipment）
//   status=3 展示确认收货按钮（调 confirmReceipt）
//   status=3/4 提供发起售后入口（跳 return-apply，由那一页上传照片后调 applyReturn）
//   status=5 提供处理售后入口（跳 return-apply，由那一页选择退款或重发、调 resolveReturn）
//
// 为什么用 getMyOrders 的单条模式而不是前端直查：orders 集合的读权限不应放开，
// 且该函数内部会用 getWXContext() 的可信 OPENID 校验归属，越权会返回 code -2。
const { formatPrice, formatTime } = require('../../../utils/format')
const { toDate, toDisplayUrls } = require('../../utils/display')
const { formatRegion } = require('../../utils/address')
const { ORDER_STATUS, ORDER_STATUS_TEXT, ORDER_STATUS_THEME } = require('../../../utils/constant')

// 与 confirmShipment 云函数内的 REASON_MAX_LEN 保持一致
const REASON_MAX_LEN = 100

/** 拼接收货地址展示文案：省市区 + 详细地址（直辖市由 formatRegion 去重） */
function formatAddressText(address) {
  if (!address || typeof address !== 'object') return ''

  const region = formatRegion(address.province, address.city, address.district)
  return region + String(address.detail || '')
}

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
  const status = Number(order.status)

  const afterSale = order.return || {}
  const rejected = afterSale.resolution === 'rejected'

  return {
    ...order,
    items,
    totalCount,
    totalText: formatPrice(order.totalPrice),
    statusText: ORDER_STATUS_TEXT[status] || '未知状态',
    statusTheme: ORDER_STATUS_THEME[status] || 'muted',
    createTimeText: formatTime(toDate(order.createTime)),

    // ---- 收货地址（快照，见 CLAUDE.md「地址快照原则」）----
    addressName: String((order.address && order.address.name) || ''),
    addressPhone: String((order.address && order.address.phone) || ''),
    addressText: formatAddressText(order.address),

    // ---- 照片 ----
    shipPhotos: order.shipPhotos || [],
    returnPhotos: afterSale.photos || [],

    // ---- 售后未通过横幅 ----
    // liable=false 时订单已自动回退到 4「已完成」。必须让买家看到结论与理由，
    // 否则订单会卡在售后中无人能处理（CLAUDE.md「售后判定约定」）。
    showRejectBanner: rejected,
    rejectReason: String(afterSale.reason || ''),

    // ---- 按状态决定展示哪些按钮（放在这里算好，WXML 里不做逻辑）----
    canConfirmShip: status === ORDER_STATUS.PENDING_CONFIRM_SHIP,
    canConfirmReceipt: status === ORDER_STATUS.DELIVERING,
    // 判定为终局结论后不再提供入口：applyReturn 内部也会拒绝，前端不该给出可点的按钮
    canApplyReturn: (status === ORDER_STATUS.DELIVERING || status === ORDER_STATUS.FINISHED) && !rejected,
    isAfterSale: status === ORDER_STATUS.AFTER_SALE
  }
}

Page({
  data: {
    orderId: '',
    order: null,
    loading: true,
    error: '',
    submitting: false
  },

  onLoad(options) {
    const orderId = options && options.id
    if (!orderId) {
      this.setData({ loading: false, error: '缺少订单参数' })
      return
    }

    this.setData({ orderId })
    this.loadOrder()
  },

  onPullDownRefresh() {
    this.loadOrder(() => wx.stopPullDownRefresh())
  },

  /** 拉取单条订单（getMyOrders 传 orderId 时走单条模式，并校验归属） */
  loadOrder(done) {
    const finish = () => {
      if (typeof done === 'function') done()
    }

    this.setData({ loading: true, error: '' })

    wx.cloud.callFunction({
      name: 'getMyOrders',
      data: { orderId: this.data.orderId },
      success: (res) => {
        const result = res.result || {}

        if (result.code !== 0 || !result.order) {
          this.setData({ loading: false, order: null, error: result.msg || '订单不存在' })
          finish()
          return
        }

        this.setData({ order: decorateOrder(result.order), loading: false })
        finish()

        // 照片地址归一放在渲染之后异步做，不阻塞页面出现
        this.fillPhotoUrls()
      },
      fail: (err) => {
        console.error('[FreshBuy] 获取订单详情失败', err)
        this.setData({ loading: false, order: null, error: '网络异常，请稍后重试' })
        finish()
      }
    })
  },

  /**
   * 把发货照片与退货照片统一转成 <image> 能用的地址。
   * 正式规范下数据库只存云存储 fileID，展示时要换临时链接；
   * 开发期造的数据可能是网络占位图，由 toDisplayUrls 一并处理。
   */
  fillPhotoUrls() {
    const order = this.data.order
    if (!order) return

    const srcs = order.shipPhotos.concat(order.returnPhotos).filter(Boolean)
    if (!srcs.length) return

    toDisplayUrls(srcs).then((urls) => {
      const urlMap = {}
      srcs.forEach((src, index) => {
        urlMap[src] = urls[index] || src
      })

      const mapAll = (list) => list.map((src) => urlMap[src] || src)

      this.setData({
        'order.shipPhotos': mapAll(this.data.order.shipPhotos),
        'order.returnPhotos': mapAll(this.data.order.returnPhotos)
      })
    })
  },

  /** 操作前的统一防抖：提交中或订单未加载完直接忽略 */
  guard() {
    if (this.data.submitting) return false
    if (!this.data.order) return false
    return true
  },

  /** 确认发货照片（2 待确认发货 -> 3 配送中） */
  onConfirmShip() {
    if (!this.guard()) return

    wx.showModal({
      title: '确认发货',
      content: '确认商家上传的发货照片无误？确认后订单进入「配送中」。',
      success: (res) => {
        if (!res.confirm) return
        // pass 必须是布尔值：confirmShipment 用 typeof 判断，不传会被当成未提供
        this.callAction('confirmShipment', { orderId: this.data.orderId, pass: true })
      }
    })
  },

  /**
   * 驳回发货照片（停留在 2，商家重新拍照）
   * 用 showModal 的 editable 输入原因，省掉一整套自定义弹层；
   * 需要基础库 2.17.1+（开发者工具默认远高于此）。
   */
  onRejectShip() {
    if (!this.guard()) return

    wx.showModal({
      title: '驳回发货照片',
      editable: true,
      placeholderText: '请说明问题，如：照片模糊 / 货物与订单不符',
      success: (res) => {
        if (!res.confirm) return

        const reason = String(res.content || '').trim()
        if (!reason) {
          wx.showToast({ title: '请填写驳回原因', icon: 'none' })
          return
        }
        if (reason.length > REASON_MAX_LEN) {
          wx.showToast({ title: `原因最多 ${REASON_MAX_LEN} 字`, icon: 'none' })
          return
        }

        this.callAction('confirmShipment', {
          orderId: this.data.orderId,
          pass: false,
          reason
        })
      }
    })
  },

  /** 确认收货（3 配送中 -> 4 已完成，云函数内会写入 receiveAt） */
  onConfirmReceipt() {
    if (!this.guard()) return

    wx.showModal({
      title: '确认收货',
      content: '确认已收到货物？确认后订单完成，之后仍可发起售后。',
      success: (res) => {
        if (!res.confirm) return
        this.callAction('confirmReceipt', { orderId: this.data.orderId })
      }
    })
  },

  /**
   * 申请退货 —— 跳转到退货申请页。
   *
   * 不在这里直接调 applyReturn：该函数要求至少 1 张退货照片，
   * 照片的拍摄与上传，以及 liable=true 时的「退款 / 重发」选择都在
   * return-apply 页完成（见 CLAUDE.md「售后判定约定」与分工文档）。
   */
  onApplyReturn() {
    wx.navigateTo({ url: `/sub-buyer/pages/return-apply/return-apply?id=${this.data.orderId}` })
  },

  /** 售后中：去处理（选退款或重发货，调 resolveReturn，由退货申请页执行） */
  onHandleReturn() {
    wx.navigateTo({ url: `/sub-buyer/pages/return-apply/return-apply?id=${this.data.orderId}` })
  },

  /** 点击照片放大预览 */
  onPreview(e) {
    const src = e.currentTarget.dataset.src
    if (!src) return

    const order = this.data.order
    if (!order) return

    // 发货照片与退货照片一起传入，便于左右滑动对比两组照片
    const urls = order.shipPhotos.concat(order.returnPhotos).filter(Boolean)
    if (!urls.length) return

    wx.previewImage({ current: src, urls })
  },

  /**
   * 调云函数推进订单状态，成功后重新拉取订单。
   * 重新拉取而不是就地改 status：状态与按钮的联动关系只在 decorateOrder 里维护一份，
   * 就地改容易漏掉 receiveAt、return 子对象等由云函数写入的字段。
   */
  callAction(name, data) {
    this.setData({ submitting: true })
    wx.showLoading({ title: '处理中…', mask: true })

    wx.cloud.callFunction({
      name,
      data,
      success: (res) => {
        const result = res.result || {}
        if (result.code !== 0) {
          wx.showToast({ title: result.msg || '操作失败', icon: 'none' })
          return
        }

        wx.showToast({ title: result.msg || '操作成功', icon: 'success' })
        this.loadOrder()
      },
      fail: (err) => {
        console.error(`[FreshBuy] 调用 ${name} 失败`, err)
        wx.showToast({ title: '网络异常，请稍后重试', icon: 'none' })
      },
      complete: () => {
        wx.hideLoading()
        this.setData({ submitting: false })
      }
    })
  }
})
