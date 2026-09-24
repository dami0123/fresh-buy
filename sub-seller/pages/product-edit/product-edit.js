// sub-seller/pages/product-edit/product-edit.js —— 商品新增 / 编辑
//
// 一个页面两种模式，靠 URL 上有没有 id 区分：
//   /sub-seller/pages/product-edit/product-edit         新增 -> createProduct
//   /sub-seller/pages/product-edit/product-edit?id=xxx  编辑 -> updateProduct
//
// 写操作一律走云函数：云函数内会再校验一次 role === 'seller' 与金额、库存
// （CLAUDE.md「商家端特别约定」）。本页的前端校验只是为了尽早给出提示，不构成安全边界。
//
// 图片：选中的是本地临时路径，提交时才逐张 wx.cloud.uploadFile 传云存储，
// 数据库只存 fileID（CLAUDE.md「图片处理」）。编辑模式下已有的图片保持原值，
// 不重复上传 —— 但开发期 seedProducts 造的是网络占位图 URL，它同样按原值保留。
const { toDisplayUrls } = require('../../utils/display')
const { CATEGORIES } = require('../../utils/category')

const db = wx.cloud.database()

const NAME_MAX_LEN = 30
const MAX_IMAGES = 9
const MAX_PRICE = 999999
const MAX_STOCK = 999999

// 价格只接受非负数字、最多两位小数：正则里没有负号，负数在输入层就被挡掉
const PRICE_RE = /^\d+(\.\d{1,2})?$/

/** 从本地临时路径取扩展名，取不到时按 jpg 处理 */
function getExt(path) {
  const matched = String(path).match(/\.([a-zA-Z0-9]+)$/)
  return matched ? matched[1].toLowerCase() : 'jpg'
}

Page({
  data: {
    mode: 'create', // create / edit
    productId: '',
    loading: false,
    submitting: false,
    error: '',

    // ---- 表单字段 ----
    name: '',
    price: '',
    stock: '',
    status: 1, // 1 上架 / 0 下架

    // 分类用下标取值，避免 dataset 把数字转成字符串（订单 tab 踩过这个坑）
    categoryNames: CATEGORIES.map((item) => item.name),
    categoryIndex: 0,
    category: '',
    categoryText: '请选择分类',

    // 图片项：{ id, raw, src, isNew }
    //   raw   提交入库的值：本地路径（isNew）或已有 fileID / URL
    //   src   <image> 显示用的地址：本地路径或临时链接
    images: [],

    maxImages: MAX_IMAGES,
    nameMaxLen: NAME_MAX_LEN
  },

  onLoad(options) {
    const productId = (options && options.id) || ''

    this.setData({
      productId,
      mode: productId ? 'edit' : 'create'
    })

    wx.setNavigationBarTitle({ title: productId ? '编辑商品' : '新增商品' })

    if (productId) {
      this.loadProduct(productId)
    }
  },

  /** 编辑模式：读取商品回填表单（读操作，按约定可直接前端直查） */
  loadProduct(productId) {
    this.setData({ loading: true, error: '' })

    db.collection('products')
      .doc(productId)
      .get()
      .then((res) => {
        const product = res.data || {}

        const images = (product.images || []).map((src, index) => ({
          id: `old-${index}`,
          raw: src,
          src,
          isNew: false
        }))

        const categoryIndex = CATEGORIES.map((item) => item.key).indexOf(product.category)
        const hasCategory = categoryIndex >= 0

        this.setData({
          name: product.name || '',
          // 价格 / 库存转成字符串回填，数字直接塞进 input 的 value 也能显示，但字符串更稳
          price: product.price === undefined || product.price === null ? '' : String(product.price),
          stock: product.stock === undefined || product.stock === null ? '' : String(product.stock),
          category: hasCategory ? product.category : '',
          categoryIndex: hasCategory ? categoryIndex : 0,
          categoryText: hasCategory ? CATEGORIES[categoryIndex].name : '请选择分类',
          status: Number(product.status) === 0 ? 0 : 1,
          images,
          loading: false
        })

        // 已有图片可能是 cloud:// fileID，换成临时链接才能显示
        this.fillImageUrls()
      })
      .catch((err) => {
        console.error('[FreshBuy] 读取商品失败', err)
        this.setData({ loading: false, error: '商品加载失败，请返回重试' })
      })
  },

  /** 把已有图片的 cloud:// fileID 换成临时链接（网络占位图原样返回） */
  fillImageUrls() {
    const raws = this.data.images.filter((item) => !item.isNew).map((item) => item.raw).filter(Boolean)
    if (!raws.length) return

    toDisplayUrls(raws).then((urls) => {
      const urlMap = {}
      raws.forEach((raw, index) => {
        urlMap[raw] = urls[index] || raw
      })

      this.setData({
        images: this.data.images.map((item) => {
          if (item.isNew || !urlMap[item.raw]) return item
          return { ...item, src: urlMap[item.raw] }
        })
      })
    })
  },

  // ---- 表单输入 ----

  onNameInput(e) {
    this.setData({ name: e.detail.value })
  },

  onPriceInput(e) {
    this.setData({ price: e.detail.value })
  },

  onStockInput(e) {
    this.setData({ stock: e.detail.value })
  },

  onCategoryChange(e) {
    const index = Number(e.detail.value)
    const category = CATEGORIES[index]
    if (!category) return

    this.setData({
      categoryIndex: index,
      category: category.key,
      categoryText: category.name
    })
  },

  onStatusChange(e) {
    this.setData({ status: e.detail.value ? 1 : 0 })
  },

  // ---- 图片 ----

  /**
   * 选取商品图片。
   * 开发期允许相册，因为开发者工具模拟器调不起相机；上线前若要强制拍照，
   * 把 sourceType 改成 ['camera']（CLAUDE.md「发货照片约定」对图片的一贯口径）。
   */
  onChooseImage() {
    const remain = MAX_IMAGES - this.data.images.length
    if (remain <= 0) {
      wx.showToast({ title: `最多上传 ${MAX_IMAGES} 张`, icon: 'none' })
      return
    }

    wx.chooseMedia({
      count: remain,
      mediaType: ['image'],
      sourceType: ['camera', 'album'],
      sizeType: ['compressed'],
      success: (res) => {
        const picked = (res.tempFiles || [])
          .map((file) => file.tempFilePath)
          .filter(Boolean)
        if (!picked.length) return

        const added = picked.map((path, index) => ({
          id: `new-${Date.now()}-${index}`,
          raw: path,
          src: path,
          isNew: true
        }))

        this.setData({ images: this.data.images.concat(added).slice(0, MAX_IMAGES) })
      },
      fail: (err) => {
        // 用户主动取消不算错误，不打扰
        if (err && err.errMsg && err.errMsg.indexOf('cancel') !== -1) return
        console.error('[FreshBuy] 选取商品图片失败', err)
        wx.showToast({ title: '选取图片失败', icon: 'none' })
      }
    })
  },

  onPreviewImage(e) {
    const index = Number(e.currentTarget.dataset.index)
    const urls = this.data.images.map((item) => item.src).filter(Boolean)
    if (!urls.length || index < 0 || index >= urls.length) return

    wx.previewImage({ current: urls[index], urls })
  },

  /** 删除图片。用 catchtap 绑定，避免冒泡到预览那层 */
  onRemoveImage(e) {
    const index = Number(e.currentTarget.dataset.index)
    const images = this.data.images.slice()
    if (index < 0 || index >= images.length) return

    images.splice(index, 1)
    this.setData({ images })
  },

  // ---- 提交 ----

  /**
   * 表单校验，通过时返回可提交的字段对象，否则弹提示并返回 null。
   * 口径与 createProduct / updateProduct 云函数保持一致：前端拦一遍是为了体验，
   * 云函数那层才是真正的边界。
   */
  validateForm() {
    const name = String(this.data.name || '').trim()
    if (!name) {
      wx.showToast({ title: '请填写商品名称', icon: 'none' })
      return null
    }
    if (name.length > NAME_MAX_LEN) {
      wx.showToast({ title: `商品名称最多 ${NAME_MAX_LEN} 字`, icon: 'none' })
      return null
    }

    const priceRaw = String(this.data.price === undefined || this.data.price === null ? '' : this.data.price).trim()
    if (!priceRaw) {
      wx.showToast({ title: '请填写商品价格', icon: 'none' })
      return null
    }
    if (!PRICE_RE.test(priceRaw)) {
      // 负号、非数字、超过两位小数都在这里被拦下
      wx.showToast({ title: '价格只能是非负数字，最多两位小数', icon: 'none' })
      return null
    }
    const price = Number(priceRaw)
    if (price <= 0) {
      wx.showToast({ title: '价格必须大于 0', icon: 'none' })
      return null
    }
    if (price > MAX_PRICE) {
      wx.showToast({ title: `价格不能超过 ${MAX_PRICE}`, icon: 'none' })
      return null
    }

    const stockRaw = String(this.data.stock === undefined || this.data.stock === null ? '' : this.data.stock).trim()
    if (!stockRaw) {
      wx.showToast({ title: '请填写库存数量', icon: 'none' })
      return null
    }
    if (!/^\d+$/.test(stockRaw)) {
      wx.showToast({ title: '库存只能是非负整数', icon: 'none' })
      return null
    }
    const stock = Number(stockRaw)
    if (stock > MAX_STOCK) {
      wx.showToast({ title: `库存不能超过 ${MAX_STOCK}`, icon: 'none' })
      return null
    }

    if (!this.data.category) {
      wx.showToast({ title: '请选择商品分类', icon: 'none' })
      return null
    }

    if (!this.data.images.length) {
      wx.showToast({ title: '请至少上传 1 张商品图片', icon: 'none' })
      return null
    }

    return {
      name,
      price,
      stock,
      category: this.data.category,
      status: Number(this.data.status) === 0 ? 0 : 1
    }
  },

  /**
   * 上传本次新增的本地图片，返回可直接入库的 images 数组。
   * 已有图片（编辑模式带过来的 fileID / 开发期占位图 URL）原样保留，不重复上传。
   * Promise.all 保持入参顺序，因此数组第一项仍是封面。
   */
  uploadImages() {
    const tasks = this.data.images.map((item) => {
      if (!item.isNew) return Promise.resolve(item.raw)

      // cloudPath 必须唯一，否则同名后传的会覆盖前一张。
      // Date.now() 在同一毫秒内会重复，故补一个随机数。
      const cloudPath = `products/${Date.now()}-${Math.floor(Math.random() * 1000000)}.${getExt(item.raw)}`

      return wx.cloud.uploadFile({ cloudPath, filePath: item.raw }).then((res) => {
        if (!res || !res.fileID) throw new Error('图片上传失败，请重试')
        return res.fileID
      })
    })

    return Promise.all(tasks)
  },

  onSubmit() {
    if (this.data.submitting) return

    const form = this.validateForm()
    if (!form) return

    const isEdit = !!this.data.productId

    this.setData({ submitting: true })
    wx.showLoading({ title: '保存中…', mask: true })

    this.uploadImages()
      .then((fileIDs) => {
        const payload = {
          name: form.name,
          price: form.price,
          stock: form.stock,
          category: form.category,
          images: fileIDs,
          status: form.status
        }
        if (isEdit) payload.productId = this.data.productId

        return wx.cloud.callFunction({
          name: isEdit ? 'updateProduct' : 'createProduct',
          data: payload
        })
      })
      .then((res) => {
        // 先关 loading 再弹 toast：顺序反了会被 hideLoading 一起收走
        wx.hideLoading()
        this.setData({ submitting: false })

        const result = (res && res.result) || {}
        if (result.code !== 0) {
          wx.showToast({ title: result.msg || '保存失败', icon: 'none' })
          return
        }

        wx.showToast({ title: result.msg || '保存成功', icon: 'success' })
        // 返回商品管理页，那边 onShow 会自动重拉列表
        setTimeout(() => wx.navigateBack(), 800)
      })
      .catch((err) => {
        wx.hideLoading()
        this.setData({ submitting: false })
        console.error('[FreshBuy] 保存商品失败', err)
        wx.showToast({
          title: (err && err.message) || '保存失败，请稍后重试',
          icon: 'none'
        })
      })
  }
})
