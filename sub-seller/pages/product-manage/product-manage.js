// sub-seller/pages/product-manage/product-manage.js —— 商品上下架与库存
// 列表按 CLAUDE.md「商家端特别约定」使用 skip / limit 分页，避免一次性拉取全量数据。
// 上下架与库存修改属于写操作，统一调 updateProduct 云函数（云函数内二次校验 role === 'seller'）。
const { formatPrice } = require('../../../utils/format')
const { toDisplayUrls } = require('../../utils/display')

const db = wx.cloud.database()
const PAGE_SIZE = 10

// 库存上限：与云函数端的校验口径对齐，防手滑输入天文数字
const MAX_STOCK = 999999

const PRODUCT_EDIT_PATH = '/sub-seller/pages/product-edit/product-edit'

// 云函数名与提示文案集中一处，避免三个操作各写一遍参数
const CLOUD_FN_UPDATE = 'updateProduct'

Page({
  data: {
    products: [],
    page: 1,
    hasMore: true,
    loading: false,
    refreshing: false,
    saving: false, // 上下架 / 改库存进行中，防止连点重复提交
    error: ''
  },

  onLoad() {
    this.loadProducts(true)
  },

  onShow() {
    // 从 product-edit 返回时列表可能已变（新增 / 改价 / 改图 / 改状态），需要重拉。
    // 首次进入 onLoad 已发过请求，用 hasLoadedOnce 跳过，避免同一次进入打两次接口。
    if (this.hasLoadedOnce) {
      this.loadProducts(true)
    }
  },

  onPullDownRefresh() {
    this.setData({ refreshing: true })
    this.loadProducts(true, () => {
      this.setData({ refreshing: false })
      wx.stopPullDownRefresh()
    })
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loading) {
      this.loadProducts(false)
    }
  },

  /** 分页加载商品；reset 为 true 时回到第一页 */
  loadProducts(reset, done) {
    const page = reset ? 1 : this.data.page + 1
    this.setData({ loading: true, error: '' })

    db.collection('products')
      .orderBy('createTime', 'desc')
      .skip((page - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .get()
      .then((res) => {
        const list = (res.data || []).map((item) => ({
          ...item,
          priceText: formatPrice(item.price),
          // 列表里只取首图作为封面，避免 WXML 中直接下标访问 undefined
          cover: (item.images && item.images[0]) || '',
          // products.status：1 上架 / 0 下架（CLAUDE.md「数据库规范 → products」）
          onSale: Number(item.status) === 1
        }))

        this.setData({
          products: reset ? list : this.data.products.concat(list),
          page,
          // 返回条数不足一页即认为没有更多数据
          hasMore: list.length === PAGE_SIZE,
          loading: false
        })

        this.hasLoadedOnce = true

        // 封面可能是云存储 fileID（product-edit 上传的）或网络占位图（seedProducts 造的），
        // 前者必须换临时链接才能显示，转换不阻塞列表出现
        this.fillCoverUrls()
      })
      .catch((err) => {
        console.error('[FreshBuy] 读取商品列表失败', err)
        this.setData({ loading: false, error: '加载失败，请检查数据库权限设置' })
      })
      .then(() => {
        if (typeof done === 'function') done()
      })
  },

  /**
   * 把封面里的 cloud:// fileID 换成 <image> 能用的临时链接。
   * 网络占位图由 toDisplayUrls 原样返回，不浪费接口调用。
   */
  fillCoverUrls() {
    const covers = this.data.products.map((item) => item.cover).filter(Boolean)
    if (!covers.length) return

    toDisplayUrls(covers).then((urls) => {
      const urlMap = {}
      covers.forEach((cover, index) => {
        urlMap[cover] = urls[index] || cover
      })

      // 按解析完成时的最新 this.data.products 重算，避免分页期间丢数据
      this.setData({
        products: this.data.products.map((item) => ({
          ...item,
          cover: urlMap[item.cover] || item.cover
        }))
      })
    })
  },

  /** 新增商品 / 编辑商品：统一跳转商品编辑页，带 id 即编辑模式 */
  goEdit(productId) {
    const url = productId ? `${PRODUCT_EDIT_PATH}?id=${productId}` : PRODUCT_EDIT_PATH
    wx.navigateTo({
      url,
      fail: (err) => {
        console.error('[FreshBuy] 打开商品编辑页失败', err)
        wx.showToast({ title: '页面打开失败', icon: 'none' })
      }
    })
  },

  /** 新增商品：不带 id，编辑页据此走 createProduct */
  onCreate() {
    this.goEdit('')
  },

  /** 编辑商品：携带商品 id，编辑页据此走 updateProduct */
  onEdit(e) {
    const { id } = e.currentTarget.dataset
    if (!id) return
    this.goEdit(id)
  },

  /** 上架 / 下架：状态写操作，走 updateProduct 云函数 */
  onToggleSale(e) {
    if (this.data.saving) return

    const { id } = e.currentTarget.dataset
    const product = this.data.products.find((item) => item._id === id)
    if (!product) return

    const nextStatus = product.onSale ? 0 : 1
    const actionText = product.onSale ? '下架' : '上架'

    wx.showModal({
      title: `确认${actionText}`,
      content: `商品「${product.name}」将被${actionText}`,
      success: (res) => {
        if (!res.confirm) return
        this.submitUpdate({ productId: id, status: nextStatus }, `${actionText}成功`)
      }
    })
  },

  /** 修改库存：showModal 的 editable 输入框取值，本地校验后走云函数 */
  onEditStock(e) {
    if (this.data.saving) return

    const { id } = e.currentTarget.dataset
    const product = this.data.products.find((item) => item._id === id)
    if (!product) return

    wx.showModal({
      title: '修改库存',
      editable: true,
      placeholderText: `请输入新的库存数量（当前 ${product.stock}）`,
      content: String(product.stock),
      success: (res) => {
        if (!res.confirm) return

        const raw = String(res.content === undefined || res.content === null ? '' : res.content).trim()

        // ---- 前端校验：口径与 updateProduct 云函数一致 ----
        // 库存是件数，只接受非负整数；/^\d+$/ 天然挡住负号、小数与空串
        if (!raw) {
          wx.showToast({ title: '请输入库存数量', icon: 'none' })
          return
        }
        if (!/^\d+$/.test(raw)) {
          wx.showToast({ title: '库存只能是非负整数', icon: 'none' })
          return
        }

        const stock = Number(raw)
        if (stock > MAX_STOCK) {
          wx.showToast({ title: `库存不能超过 ${MAX_STOCK}`, icon: 'none' })
          return
        }
        if (stock === Number(product.stock)) {
          wx.showToast({ title: '库存未发生变化', icon: 'none' })
          return
        }

        this.submitUpdate({ productId: id, stock }, '库存已更新')
      }
    })
  },

  /** 调 updateProduct 云函数（上下架 / 改库存共用入口，避免两处各写一遍） */
  submitUpdate(payload, successText) {
    this.setData({ saving: true })
    wx.showLoading({ title: '处理中…', mask: true })

    wx.cloud.callFunction({
      name: CLOUD_FN_UPDATE,
      data: payload,
      success: (res) => {
        // 先关掉 loading 再弹 toast：顺序反了会被 hideLoading 一起收走
        wx.hideLoading()

        const result = res.result || {}
        if (result.code !== 0) {
          // 云函数已二次校验，这里如实展示它的拒绝理由（含无权限场景）
          wx.showToast({ title: result.msg || '操作失败', icon: 'none' })
          return
        }

        wx.showToast({ title: successText || '操作成功', icon: 'success' })
        this.loadProducts(true)
      },
      fail: (err) => {
        wx.hideLoading()
        console.error('[FreshBuy] 更新商品失败', err)
        wx.showToast({ title: '网络异常，请稍后重试', icon: 'none' })
      },
      complete: () => {
        this.setData({ saving: false })
      }
    })
  }
})
