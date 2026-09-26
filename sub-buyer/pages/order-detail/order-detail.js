// sub-buyer/pages/order-detail/order-detail.js —— 订单详情
// 本页职责：
//   status=2 展示发货照片（本次 + 各历史轮次）+ 确认发货 / 驳回重拍（调 confirmShipment）
//   status=3 展示确认收货按钮（调 confirmReceipt）
//   status=3/4 提供发起售后入口（跳 return-apply，由那一页上传照片后调 applyReturn）
//   status=5 且系统判定为商家责任：展示判责结论，并提供「申请退款 / 补发商品」
//             两个按钮（调 resolveReturn）—— 售后到此收尾
//   status=5 但无商家责任结论（异常数据，正常流程不会出现）：降级为跳 return-apply 的兜底入口
//
// 为什么用 getMyOrders 的单条模式而不是前端直查：orders 集合的读权限不应放开，
// 且该函数内部会用 getWXContext() 的可信 OPENID 校验归属，越权会返回 code -2。
const { formatPrice, formatTime } = require('../../../utils/format')
const { toDate, toDisplayUrls } = require('../../utils/display')
const { formatRegion } = require('../../utils/address')
const { ROLE, ORDER_STATUS, ORDER_STATUS_TEXT, ORDER_STATUS_THEME } = require('../../../utils/constant')
const { guardPage } = require('../../../utils/auth')

// 与 confirmShipment 云函数内的 REASON_MAX_LEN 保持一致
const REASON_MAX_LEN = 100

/** 拼接收货地址展示文案：省市区 + 详细地址（直辖市由 formatRegion 去重） */
function formatAddressText(address) {
  if (!address || typeof address !== 'object') return ''

  const region = formatRegion(address.province, address.city, address.district)
  return region + String(address.detail || '')
}

/**
 * 整理归档的历史发货轮次（orders.shipPhotoHistory），转成可直接渲染的结构。
 *
 * 该字段由 shipOrder 维护：每覆盖一轮 shipPhotos 前，把被覆盖的那一轮整体追加进数组，
 * 所以「数组下标 + 1」就是商家心里的第几轮。这里先按原始下标编号、再滤掉没图的空项，
 * 保证轮次编号不会因为中间某轮缺图而整体前移（编号错了比少一张图更难排查）。
 *
 * 返回**由新到旧**：页面最关心最新一轮，历史轮次排在它后面。
 *
 * 与商家端 ship 页的 loadHistory 是同源逻辑（那边还要自己算轮次上限），
 * 但跨分包不能 require，且买家端这里只需要一个纯展示结构，故各留一份。
 *
 * @param {Array} raw orders.shipPhotoHistory 原始值，可能缺失或不是数组
 * @return {Array<{round: number, archivedAtText: string, photos: string[]}>}
 */
function buildShipHistory(raw) {
  return (Array.isArray(raw) ? raw : [])
    .map((item, index) => ({
      round: index + 1,
      archivedAtText: formatTime(toDate(item && item.archivedAt)),
      photos: ((item && item.photos) || []).filter(Boolean)
    }))
    .filter((round) => round.photos.length > 0)
    .reverse()
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

  // 系统判责结论：只有严格 true 才算「商家责任」。false 与缺失都不给收尾入口
  // —— 不能让买家靠提交把责任刷出来（CLAUDE.md「AI 调用失败的处理」同一原则）。
  const liable = afterSale.liable === true
  // resolution 已写过说明这一单收尾过了，不能再给出按钮（resolveReturn 内会再拦一道）
  const resolved = Boolean(afterSale.resolution)

  // 归档轮次数按**原始数组长度**算，而不是按 buildShipHistory 过滤后的长度 ——
  // 轮次编号以库里的数组下标为准，过滤只影响「画不画」，不该改变「第几轮」。
  const shipHistoryCount = Array.isArray(order.shipPhotoHistory) ? order.shipPhotoHistory.length : 0
  const currentShipCount = (order.shipPhotos || []).filter(Boolean).length

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

    // ---- 商家发货照片（补发单会有多轮）----
    // 商家发货照片分两处存，缺一不可：
    //   shipPhotos       —— 最近一轮。shipOrder 每次提交都用新照片整体覆盖它
    //   shipPhotoHistory —— 更早的每一轮。shipOrder 在覆盖前把旧的一轮归档进去
    // 原来只读 shipPhotos，补发单就只看得见「一轮」；补发后的新一轮会覆盖旧值，
    // 若页面又是从页面栈里恢复的旧实例，看到的就还是上一轮 —— 表现即「只能看到最早一次」。
    shipPhotos: order.shipPhotos || [],
    shipHistory: buildShipHistory(order.shipPhotoHistory),
    // 发过几轮 = 归档轮次数 + 本次这一轮（shipPhotos 有图才算这一轮存在）
    shipRoundTotal: shipHistoryCount + (currentShipCount > 0 ? 1 : 0),
    shipCurrentRound: shipHistoryCount + 1,
    // 只有发过两轮以上才打轮次标签：单轮是绝大多数情况，加了纯属噪音
    shipMultiRound: shipHistoryCount > 0,

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
    isAfterSale: status === ORDER_STATUS.AFTER_SALE,

    // ---- 售后收尾：申请退款 / 补发商品 ----
    // 三个条件与 resolveReturn 的校验一一对应：状态=5、liable===true、resolution 未写过。
    // 前端只按此渲染按钮，真正的准入一律以云函数为准（归属、状态、重复提交都在那边校验）。
    canResolveReturn: status === ORDER_STATUS.AFTER_SALE && liable && !resolved,
    // 判定为商家责任时把结论与理由展示出来，买家才知道底部那两个按钮因何出现。
    // reason 与 rejectReason 是同一个库字段，只是两个分支的展示位置不同。
    showJudgeCard: status === ORDER_STATUS.AFTER_SALE && liable,
    liableReason: String(afterSale.reason || '')
  }
}

// 身份守卫：seller 账号进入本页会被弹窗提示并跳转到商家订单管理页
Page(guardPage(ROLE.BUYER, {
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

  /**
   * 回到本页时重拉一次订单。
   *
   * 为什么必须重拉：本页会长时间留在页面栈里（点照片预览、去 return-apply 申请售后、
   * 选完补发再回来）。补发单的发货照片是商家在**另一台设备**上后传的，
   * 本页 data 里那份是进页面时的快照，不重拉就永远是上一轮 —— 这正是
   * 「商家第二次发货后买家看不到新照片」的直接原因。订单状态同理（售后中 -> 待发货等）。
   *
   * 首次进入时 onShow 紧跟在 onLoad 之后触发，两者会撞成两次请求，
   * 因此用 hasLoadedOnce 跳过首次（order-manage / order-list 用的是同一套写法）。
   * 正在提交时跳过：那次请求会把 submitting 期间刚 setData 的东西冲掉。
   */
  onShow() {
    if (!this.hasLoadedOnce) {
      this.hasLoadedOnce = true
      return
    }
    if (this.data.submitting || !this.data.orderId) return
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
   * 把发货照片（本次 + 各历史轮次）与退货照片统一转成 <image> 能用的地址。
   * 正式规范下数据库只存云存储 fileID，展示时要换临时链接；
   * 开发期造的数据可能是网络占位图，由 toDisplayUrls 一并处理。
   *
   * 三处照片放进同一次 getTempFileURL 并发换完再 setData（urlMap 按原始值索引，
   * 三处共用），而不是每处各换一次 —— 补发单可能有十几张图，分几次换会闪好几次。
   */
  fillPhotoUrls() {
    const order = this.data.order
    if (!order) return

    const historyPhotos = []
    order.shipHistory.forEach((round) => {
      historyPhotos.push.apply(historyPhotos, round.photos)
    })

    const srcs = order.shipPhotos.concat(order.returnPhotos, historyPhotos).filter(Boolean)
    if (!srcs.length) return

    toDisplayUrls(srcs).then((urls) => {
      const urlMap = {}
      srcs.forEach((src, index) => {
        urlMap[src] = urls[index] || src
      })

      const mapAll = (list) => list.map((src) => urlMap[src] || src)

      this.setData({
        'order.shipPhotos': mapAll(order.shipPhotos),
        'order.returnPhotos': mapAll(order.returnPhotos),
        'order.shipHistory': order.shipHistory.map((round) => ({
          ...round,
          photos: mapAll(round.photos)
        }))
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
   * 照片的拍摄与上传都在 return-apply 页完成（见 CLAUDE.md「售后判定约定」）。
   * 判责完成后若判定为商家责任，订单回到本页停在「售后中」，
   * 由这里底部的「申请退款 / 补发商品」做最后的收尾。
   */
  onApplyReturn() {
    wx.navigateTo({ url: `/sub-buyer/pages/return-apply/return-apply?id=${this.data.orderId}` })
  },

  /**
   * 售后中的兜底入口（跳 return-apply，那边的 canResolve 分支会给出退款 / 补发按钮）。
   *
   * 正常流程用不到：liable===true 时本页直接展示两个收尾按钮（见 canResolveReturn），
   * 只有 status=5 却没拿到商家责任结论这种异常数据才落到这里。
   * 保留它是因为「订单卡在售后中」比「多一个入口」糟得多。
   */
  onHandleReturn() {
    wx.navigateTo({ url: `/sub-buyer/pages/return-apply/return-apply?id=${this.data.orderId}` })
  },

  // ==================== 售后收尾：退款 / 补发商品 ====================

  /** 申请退款：resolveReturn 把订单 5 售后中 -> 6 已关闭（终态，写 return.refundAt） */
  onRefund() {
    this.confirmResolve('refund', '申请退款', '退款后订单将关闭，无法再申请售后。确认继续？')
  },

  /** 补发商品：resolveReturn 把订单 5 售后中 -> 1 待发货（累加 reshipCount，商家重新发货） */
  onReship() {
    this.confirmResolve('reship', '补发商品', '商家将重新发货，订单回到「待发货」。确认继续？')
  },

  /**
   * 售后收尾统一入口：两个分支只差 resolution 取值，其余（防抖、确认框、调用、刷新）
   * 完全一致，合并成一个方法，避免两处逻辑改一处漏一处。
   *
   * 为什么先弹确认框：两个分支都不可逆 —— 退款直接关单，补发要让商家重拍一轮发货照片。
   * 本页其它不可逆操作（确认发货 / 确认收货 / 驳回重拍）也都是先弹确认框，保持一致。
   *
   * @param {string} resolution 'refund' 退款 / 'reship' 补发商品
   */
  confirmResolve(resolution, title, content) {
    if (!this.guard()) return

    wx.showModal({
      title,
      content,
      success: (res) => {
        if (!res.confirm) return
        // icon 传 'none'：resolveReturn 返回的结论较长（如「已通知商家补发，订单重新进入待发货」），
        // 带 success 图标时标题会被截到 7 个字以内，看不清到底办成了哪一件
        this.callAction(
          'resolveReturn',
          { orderId: this.data.orderId, resolution },
          { icon: 'none' }
        )
      }
    })
  },

  /** 点击照片放大预览 */
  onPreview(e) {
    const src = e.currentTarget.dataset.src
    if (!src) return

    const order = this.data.order
    if (!order) return

    // 发货照片（本次 + 各历史轮次）与退货照片一起传入，便于左右滑动对比
    // —— 判责看的就是「发货时什么样」与「退货时什么样」的对照，
    // 补发单还要能滑到更早几轮，才看得出问题是不是重复出现。
    let urls = order.shipPhotos.slice()
    order.shipHistory.forEach((round) => {
      urls = urls.concat(round.photos)
    })
    urls = urls.concat(order.returnPhotos).filter(Boolean)
    if (!urls.length) return

    wx.previewImage({ current: src, urls })
  },

  /**
   * 调云函数推进订单状态，成功后重新拉取订单。
   * 重新拉取而不是就地改 status：状态与按钮的联动关系只在 decorateOrder 里维护一份，
   * 就地改容易漏掉 receiveAt、return 子对象等由云函数写入的字段。
   *
   * @param {string} name 云函数名
   * @param {object} data 入参
   * @param {object} [options] 可选项
   * @param {string} [options.icon] 成功提示的图标，默认 'success'。
   *   带 success 图标的 toast 标题会被小程序截到 7 个字以内，云函数返回的结论稍长
   *   （如 resolveReturn 的「已通知商家补发，订单重新进入待发货」）就会看不全，
   *   这类调用传 'none'，让文案完整显示。
   */
  callAction(name, data, options) {
    const icon = (options && options.icon) || 'success'

    this.setData({ submitting: true })
    wx.showLoading({ title: '处理中…', mask: true })

    // 收尾统一走这里：必须**先关 loading 再弹提示** —— showLoading 与 showToast
    // 用的是同一个浮层，反过来（把 hideLoading 放在 complete 里）会把刚弹出的提示
    // 一起收走，用户看不到任何结果。return-apply 页记录的是同一条规矩。
    const finish = () => {
      wx.hideLoading()
      this.setData({ submitting: false })
    }

    wx.cloud.callFunction({
      name,
      data,
      success: (res) => {
        finish()

        const result = res.result || {}
        if (result.code !== 0) {
          // 失败原因原样透出：越权、状态不符、重复提交等都靠云函数返回的 msg 区分
          wx.showToast({ title: result.msg || '操作失败', icon: 'none' })
          return
        }

        wx.showToast({ title: result.msg || '操作成功', icon })
        this.loadOrder()
      },
      fail: (err) => {
        finish()
        console.error(`[FreshBuy] 调用 ${name} 失败`, err)
        wx.showToast({ title: '网络异常，请稍后重试', icon: 'none' })
      }
    })
  }
}))
