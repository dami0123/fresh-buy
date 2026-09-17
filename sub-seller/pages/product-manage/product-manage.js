// sub-seller/pages/product-manage/product-manage.js —— 商品上下架与库存
// 列表按 CLAUDE.md「商家端特别约定」使用 skip / limit 分页，避免一次性拉取全量数据。
// 上下架与库存修改属于写操作，必须走云函数二次校验（当前留 TODO，未接入前不执行写入）。
const { formatPrice } = require('../../../utils/format')

const db = wx.cloud.database()
const PAGE_SIZE = 10

Page({
  data: {
    products: [],
    page: 1,
    hasMore: true,
    loading: false,
    refreshing: false,
    error: ''
  },

  onLoad() {
    this.loadProducts(true)
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
          // TODO: products 集合的上下架字段名尚未在 CLAUDE.md 中约定，
          // 此处暂按 status === 1 表示上架，确定字段后统一调整。
          onSale: Number(item.status) === 1
        }))

        this.setData({
          products: reset ? list : this.data.products.concat(list),
          page,
          // 返回条数不足一页即认为没有更多数据
          hasMore: list.length === PAGE_SIZE,
          loading: false
        })
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
   * 上架 / 下架
   * TODO: 按 CLAUDE.md 约定，写操作必须经云函数。需补充 updateProduct 云函数并在其中
   * 二次校验调用者身份是否为 seller，示例：
   *   wx.cloud.callFunction({ name: 'updateProduct', data: { productId, status, stock } })
   */
  onToggleSale(e) {
    const { id } = e.currentTarget.dataset
    console.warn('[FreshBuy] 上下架待接入 updateProduct 云函数，productId =', id)
    wx.showToast({ title: '待接入 updateProduct 云函数', icon: 'none' })
  },

  /** 修改库存（同上，需云函数二次校验，防止越权篡改） */
  onEditStock(e) {
    const { id } = e.currentTarget.dataset
    console.warn('[FreshBuy] 修改库存待接入 updateProduct 云函数，productId =', id)
    wx.showToast({ title: '待接入 updateProduct 云函数', icon: 'none' })
  },

  /** 新增商品（空壳阶段仅提示） */
  onCreate() {
    wx.showToast({ title: '待接入新增商品页', icon: 'none' })
  }
})
