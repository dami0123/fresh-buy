// sub-seller/pages/ship/ship.js —— 发货拍照
//
// 入口：order-manage 的「发货 / 重新拍照」按钮 -> ship?id=<orderId>
//
// 流程：拍/选 3 张照片 -> 逐张 wx.cloud.uploadFile 传云存储 -> 调 shipOrder
//   状态 1 待发货    -> 2 待确认发货（首次发货）
//   状态 2 待确认发货 -> 2（买家驳回后重新拍照，覆盖上一轮照片）
// 状态由云函数推进（CLAUDE.md「订单状态机」），前端不碰 status。
//
// 订单信息通过 getSellerOrders 的单条模式拉取（云函数内校验 role === 'seller'）。
const { formatPrice, formatTime } = require('../../../utils/format')
const { toDate, toDisplayUrls, formatAddress } = require('../../utils/display')
const { ORDER_STATUS, ORDER_STATUS_TEXT } = require('../../../utils/constant')

const SHIP_PHOTO_COUNT = 3

/** 从本地临时路径取扩展名，取不到时按 jpg 处理 */
function getExt(path) {
  const matched = String(path).match(/\.([a-zA-Z0-9]+)$/)
  return matched ? matched[1].toLowerCase() : 'jpg'
}

function decorateOrder(order) {
  const items = order.items || []
  const status = Number(order.status)

  return {
    ...order,
    items,
    statusText: ORDER_STATUS_TEXT[status] || '未知',
    count: items.reduce((sum, goods) => sum + Number(goods.count || 0), 0),
    totalPriceText: formatPrice(order.totalPrice),
    createTimeText: formatTime(toDate(order.createTime)),
    addressText: formatAddress(order.address),
    receiverName: (order.address && order.address.name) || '',
    receiverPhone: (order.address && order.address.phone) || '',
    shipRejectReason: order.shipRejectReason || '',
    shipPhotos: order.shipPhotos || []
  }
}

Page({
  data: {
    orderId: '',
    order: null,
    // 上一轮的发货照片（临时链接），仅在买家驳回后重拍时展示
    lastShipPhotos: [],

    photos: [], // 本次选中的本地临时路径，提交时才上传
    photoCount: SHIP_PHOTO_COUNT,

    canShip: false, // 状态是否允许上传发货照片（1 待发货 / 2 待确认发货）
    loading: true,
    submitting: false,
    error: ''
  },

  onLoad(options) {
    const orderId = (options && options.id) || ''
    this.setData({ orderId })

    if (!orderId) {
      this.setData({ loading: false, error: '缺少订单 ID，请从订单管理页进入' })
      return
    }

    this.loadOrder()
  },

  /** 读取订单详情 */
  loadOrder() {
    this.setData({ loading: true, error: '' })

    wx.cloud.callFunction({
      name: 'getSellerOrders',
      data: { orderId: this.data.orderId },
      success: (res) => {
        const result = res.result || {}

        if (result.code !== 0 || !result.order) {
          this.setData({ loading: false, error: result.msg || '订单加载失败' })
          return
        }

        const order = decorateOrder(result.order)
        const status = Number(order.status)

        // shipOrder 云函数接受 1 和 2 两种状态；但前端要再收紧一档：
        // 状态 2 未带驳回原因时订单正在等买家确认，此时不该让商家重拍覆盖照片
        // （驳回后状态仍为 2 并写入 shipRejectReason，见 confirmShipment）。
        // 与 order-manage 的 canShip 判断保持一致，避免从两个入口进来口径不同。
        const canReshoot =
          status === ORDER_STATUS.PENDING_CONFIRM_SHIP && !!order.shipRejectReason
        const canShip = status === ORDER_STATUS.PENDING_SHIP || canReshoot

        this.setData({
          order,
          canShip,
          loading: false,
          error: canShip ? '' : `当前订单状态为「${order.statusText}」，不可上传发货照片`
        })

        this.fillLastShipPhotos()
      },
      fail: (err) => {
        console.error('[FreshBuy] 读取订单失败', err)
        this.setData({ loading: false, error: '网络异常，请稍后重试' })
      }
    })
  },

  /** 上一轮发货照片可能是 cloud:// fileID，换成临时链接才能显示 */
  fillLastShipPhotos() {
    const fileIDs = this.data.order ? this.data.order.shipPhotos : []
    if (!fileIDs.length) return

    toDisplayUrls(fileIDs).then((urls) => {
      this.setData({ lastShipPhotos: urls })
    })
  },

  /**
   * 选取发货照片。
   *
   * TODO(上线前必改)：CLAUDE.md「发货照片约定」要求上线必须用 sourceType: ['camera']
   * 强制拍照；开发期保留 'album' 是因为微信开发者工具模拟器调不起相机，
   * 否则本页写完立刻无法自测。**上线前把下面这行改回 ['camera']。**
   */
  onChoosePhoto() {
    const remain = SHIP_PHOTO_COUNT - this.data.photos.length
    if (remain <= 0) {
      wx.showToast({ title: `已选满 ${SHIP_PHOTO_COUNT} 张`, icon: 'none' })
      return
    }

    wx.chooseMedia({
      count: remain,
      mediaType: ['image'],
      sourceType: ['camera', 'album'], // TODO(上线前必改): 改回 ['camera']
      sizeType: ['compressed'],
      success: (res) => {
        const picked = (res.tempFiles || [])
          .map((file) => file.tempFilePath)
          .filter(Boolean)
        if (!picked.length) return

        this.setData({
          photos: this.data.photos.concat(picked).slice(0, SHIP_PHOTO_COUNT)
        })
      },
      fail: (err) => {
        // 用户主动取消不算错误，不打扰
        if (err && err.errMsg && err.errMsg.indexOf('cancel') !== -1) return
        console.error('[FreshBuy] 选取发货照片失败', err)
        wx.showToast({ title: '选取照片失败', icon: 'none' })
      }
    })
  },

  onPreview(e) {
    const index = Number(e.currentTarget.dataset.index)
    const photos = this.data.photos
    if (index < 0 || index >= photos.length) return

    wx.previewImage({ current: photos[index], urls: photos })
  },

  onRemovePhoto(e) {
    const index = Number(e.currentTarget.dataset.index)
    const photos = this.data.photos.slice()
    if (index < 0 || index >= photos.length) return

    photos.splice(index, 1)
    this.setData({ photos })
  },

  /** 上传本次选中的照片，返回 fileID 数组（Promise.all 保持选取顺序） */
  uploadPhotos() {
    const orderId = this.data.orderId

    const tasks = this.data.photos.map((path, index) => {
      // cloudPath 必须唯一，否则同名后传的会覆盖前一张
      const cloudPath = `ship/${orderId}/${Date.now()}-${index}.${getExt(path)}`

      return wx.cloud.uploadFile({ cloudPath, filePath: path }).then((res) => {
        if (!res || !res.fileID) throw new Error('照片上传失败，请重试')
        return res.fileID
      })
    })

    return Promise.all(tasks)
  },

  onSubmit() {
    if (this.data.submitting) return

    if (!this.data.canShip) {
      wx.showToast({ title: '当前订单状态不可发货', icon: 'none' })
      return
    }

    // 前端先拦一道，云函数端同样强校验「恰好 3 张」
    if (this.data.photos.length !== SHIP_PHOTO_COUNT) {
      wx.showToast({ title: `请拍摄 ${SHIP_PHOTO_COUNT} 张发货照片`, icon: 'none' })
      return
    }

    this.setData({ submitting: true })
    wx.showLoading({ title: '上传中…', mask: true })

    this.uploadPhotos()
      .then((fileIDs) =>
        wx.cloud.callFunction({
          name: 'shipOrder',
          data: { orderId: this.data.orderId, photos: fileIDs }
        })
      )
      .then((res) => {
        // 先关 loading 再弹 toast：顺序反了会被 hideLoading 一起收走
        wx.hideLoading()
        this.setData({ submitting: false })

        const result = (res && res.result) || {}
        if (result.code !== 0) {
          wx.showToast({ title: result.msg || '提交失败', icon: 'none' })
          return
        }

        wx.showToast({ title: '已提交，待买家确认', icon: 'none' })
        // 返回订单管理页，那边 onShow 会自动重拉列表
        setTimeout(() => wx.navigateBack(), 1200)
      })
      .catch((err) => {
        wx.hideLoading()
        this.setData({ submitting: false })
        console.error('[FreshBuy] 提交发货照片失败', err)
        wx.showToast({
          title: (err && err.message) || '提交失败，请稍后重试',
          icon: 'none'
        })
      })
  }
})
