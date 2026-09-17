// sub-buyer/pages/home/home.js —— 用户端首页：商品列表与分类
// 读操作走 getProducts 云函数（分页由云函数内的 skip/limit 完成）
const { formatPrice } = require('../../../utils/format')

const PAGE_SIZE = 10

Page({
  data: {
    categories: [],       // 分类列表（空壳阶段为静态占位）
    activeCategory: '',   // 当前选中分类，'' 表示全部
    products: [],         // 商品列表
    page: 1,
    hasMore: true,
    loading: false,
    refreshing: false,
    error: ''
  },

  onLoad() {
    this.loadCategories()
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

  /** 分类列表：空壳阶段使用静态占位，接入后改为读取 category 集合 */
  loadCategories() {
    this.setData({
      categories: [
        { id: '', name: '全部' },
        { id: 'vegetable', name: '蔬菜' },
        { id: 'fruit', name: '水果' },
        { id: 'meat', name: '肉禽蛋' },
        { id: 'seafood', name: '水产' }
      ]
    })
  },

  /** 切换分类 */
  onCategoryTap(e) {
    const id = e.currentTarget.dataset.id
    if (id === this.data.activeCategory) return
    this.setData({ activeCategory: id })
    this.loadProducts(true)
  },

  /**
   * 加载商品列表
   * @param {boolean} reset true 表示重置到第一页
   * @param {Function} done 加载结束回调
   */
  loadProducts(reset, done) {
    const page = reset ? 1 : this.data.page + 1
    this.setData({ loading: true, error: '' })

    wx.cloud.callFunction({
      name: 'getProducts',
      data: {
        category: this.data.activeCategory,
        page,
        pageSize: PAGE_SIZE
      },
      success: (res) => {
        const result = res.result || {}
        if (result.code !== 0) {
          this.setData({ loading: false, error: result.msg || '加载失败' })
          return
        }

        const list = (result.list || []).map((item) => ({
          ...item,
          priceText: formatPrice(item.price),
          cover: (item.images && item.images[0]) || ''
        }))

        this.setData({
          products: reset ? list : this.data.products.concat(list),
          page,
          hasMore: !!result.hasMore,
          loading: false
        })
      },
      fail: (err) => {
        console.error('[FreshBuy] 获取商品列表失败', err)
        this.setData({ loading: false, error: '网络异常，请稍后重试' })
      },
      complete: () => {
        if (typeof done === 'function') done()
      }
    })
  },

  /** 进入商品详情 */
  onProductTap(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: `/sub-buyer/pages/detail/detail?id=${id}` })
  },

  /** 进入购物车 */
  onCartTap() {
    wx.navigateTo({ url: '/sub-buyer/pages/cart/cart' })
  }
})
