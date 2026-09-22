// sub-buyer/pages/order-confirm/order-confirm.js —— 确认下单
// 本页职责：收货地址表单（微信地址预填 + 粘贴解析 + 逐项手改）+ 商品清单 + 提交。
// 提交调 createOrder 云函数，入参 { items, address }；address 必须按下单时的快照写入
// （CLAUDE.md「地址快照原则」），不得只传 users 的引用或 _id，
// 否则用户事后修改收货地址，历史订单的地址会跟着变。
const { formatPrice, calcTotal } = require('../../../utils/format')
const { parseAddressText, formatRegion } = require('../../utils/address')

const db = wx.cloud.database()

/**
 * 地址结构固定六字段（见 CLAUDE.md「收货地址约定」）。
 * postalCode 允许为空串，不参与必填校验 —— wx.chooseAddress 本就可能返回空串。
 */
const EMPTY_ADDRESS = {
  name: '',
  phone: '',
  province: '',
  city: '',
  district: '',
  detail: '',
  postalCode: ''
}

/** 必填项：顺序与表单从上到下一致，便于把提示落到第一个缺失的字段上 */
const ADDRESS_FIELDS = [
  { key: 'name', label: '收货人' },
  { key: 'phone', label: '手机号' },
  { key: 'province', label: '省份' },
  { key: 'city', label: '城市' },
  { key: 'district', label: '区县' },
  { key: 'detail', label: '详细地址' }
]

/** 地址不完整时的统一提示文案 */
const ADDRESS_INCOMPLETE_MSG = '请填写完整的收货地址（收货人、手机号、省市区与详细地址）'

Page({
  data: {
    address: { ...EMPTY_ADDRESS },
    region: [],        // picker mode="region" 的绑定值 [省, 市, 区]
    regionText: '',    // 省市区的展示文案（直辖市去重，见 address.js 的 formatRegion）
    errorField: '',    // 校验未通过的字段，用于把对应行标红
    carts: [],         // 待下单的购物车条目
    totalCount: 0,
    totalText: '0.00',
    loading: true,
    error: '',
    submitting: false
  },

  /**
   * 本页有两个入口，共用同一套地址表单、校验与提交流程：
   *   购物车结算 —— 无参数，商品清单读自 cart 集合
   *   立即购买   —— mode=buyNow + productId/count，只下单这一件
   */
  onLoad(options) {
    this.prefillAddress()

    const opts = options || {}
    if (opts.mode === 'buyNow' && opts.productId) {
      this.loadBuyNowItem(opts.productId, opts.count)
    } else {
      this.loadCart()
    }
  },

  /**
   * 立即购买入口：按商品 id 取当前价与图片，拼成一条商品清单。
   *
   * 为什么不落进购物车再读：这条路径完全不写 cart 集合 —— 用户只是点了一下
   * 「立即购买」，不该在购物车里留下一条他没主动加过的条目（购物车的删除入口
   * 目前仍是 TODO 桩，留下了用户自己也清不掉）。
   *
   * 金额仍由 createOrder 依据数据库现价重算，这里取价只用于展示。
   *
   * @param {string} productId 商品 _id
   * @param {string|number} count 来自 URL query，必然是字符串，需转数字
   */
  loadBuyNowItem(productId, count) {
    const num = Math.max(1, Math.floor(Number(count) || 1))

    this.setData({ loading: true, error: '' })

    db.collection('products')
      .doc(productId)
      .get()
      .then((res) => {
        const product = res.data

        const carts = [{
          // 不来自购物车，因此没有 cartId。留空串而不是删掉该字段：
          // 提交成功后 clearOrderedCart 会用 filter(Boolean) 过滤掉它，
          // 于是单品直购不会去调 removeCart，也就不会误删任何购物车条目。
          _id: '',
          productId: product._id,
          name: product.name,
          price: Number(product.price),
          image: (product.images && product.images[0]) || '',
          count: num,
          priceText: formatPrice(product.price),
          subtotalText: formatPrice(Number(product.price || 0) * num)
        }]

        const total = calcTotal(carts.map((i) => ({ price: i.price, count: i.count })))

        this.setData({
          carts,
          totalCount: num,
          totalText: formatPrice(total),
          loading: false
        })
      })
      .catch((err) => {
        console.error('[FreshBuy] 读取商品失败', err)
        this.setData({ loading: false, error: '商品不存在或已被下架' })
      })
  },

  /**
   * 预填收货地址：优先取 globalData.userInfo.address。
   *
   * 为什么要有 login 这条回退分支：globalData 是内存对象，冷启动时
   * （编译时指定本页为启动页、或被杀后台后从分享卡进入）pages/index 的登录
   * 还没跑过，userInfo 为 null。此时补调一次 login 把完整用户记录取回来并
   * 写回 globalData，保证 userInfo 里始终是含 address 的完整文档。
   *
   * login 云函数查的是 users 集合的整条文档（无 .field() 投影），
   * address 就在返回的 userInfo 里，无需额外查询。
   */
  prefillAddress() {
    const app = getApp()
    const userInfo = app.globalData.userInfo

    if (userInfo && userInfo.address) {
      this.applyAddress(userInfo.address)
      return
    }

    wx.cloud.callFunction({
      name: 'login',
      success: (res) => {
        const result = res.result || {}
        if (result.userInfo) {
          // 关键：把完整用户记录（含 address）写回 globalData，
          // 后续其它买家页面读 globalData.userInfo.address 即可拿到地址
          app.globalData.userInfo = result.userInfo
          if (result.userInfo.address) this.applyAddress(result.userInfo.address)
        }
      },
      fail: (err) => {
        // 预填失败不阻断下单：用户仍可手填或粘贴地址
        console.error('[FreshBuy] 预填收货地址失败，降级为手动填写', err)
      }
    })
  },

  /** 把一份地址应用到表单：字段缺失一律按空串处理，不因缺字段报错 */
  applyAddress(address) {
    const next = { ...EMPTY_ADDRESS }
    Object.keys(EMPTY_ADDRESS).forEach((key) => {
      next[key] = address[key] == null ? '' : String(address[key])
    })

    const filled = next.province && next.city && next.district

    this.setData({
      address: next,
      // picker mode="region" 需要完整的三段值，缺一段就退回未选择，避免控件显示错乱
      region: filled ? [next.province, next.city, next.district] : [],
      regionText: formatRegion(next.province, next.city, next.district),
      errorField: ''
    })
  },

  /** 省市区选择：picker mode="region" 返回 [省, 市, 区] */
  onRegionChange(e) {
    const value = e.detail.value || []
    const province = value[0] || ''
    const city = value[1] || ''
    const district = value[2] || ''

    this.setData({
      region: value,
      regionText: formatRegion(province, city, district),
      'address.province': province,
      'address.city': city,
      'address.district': district,
      errorField: ''
    })
  },

  /** 输入框通用处理：靠 data-field 指明写回 address 的哪个字段 */
  onInput(e) {
    const field = e.currentTarget.dataset.field
    if (!field) return

    const patch = { [`address.${field}`]: e.detail.value }
    // 用户开始修正出错的那一项时，顺手撤掉标红
    if (this.data.errorField === field) patch.errorField = ''

    this.setData(patch)
  },

  /**
   * 微信地址簿预填。
   * 用户拒绝授权时降级为手动填写，不得阻断下单流程（CLAUDE.md「收货地址约定」）。
   *
   * ⚠️ 注意：`wx.chooseAddress` 属需在 app.json 的 requiredPrivateInfos 中声明的接口，
   * 该文件是项目禁止区（只有负责人能改）。若未声明，此接口会直接走 fail 分支，
   * 页面会提示「请手动填写」——粘贴地址与手工录入仍然可用，不影响下单。
   */
  onChooseWxAddress() {
    wx.chooseAddress({
      success: (res) => {
        this.applyAddress({
          name: res.userName || '',
          phone: res.telNumber || '',
          province: res.provinceName || '',
          city: res.cityName || '',
          district: res.countyName || '',
          detail: res.detailInfo || '',
          postalCode: res.postalCode || ''
        })
      },
      fail: (err) => {
        // 用户主动取消/拒绝授权也会走 fail，这种情况静默处理，不弹提示打扰
        const msg = String((err && err.errMsg) || '')
        if (/cancel|deny|auth/i.test(msg)) return

        console.error('[FreshBuy] 调起微信地址簿失败', err)
        wx.showToast({ title: '未能获取微信地址，请手动填写', icon: 'none' })
      }
    })
  },

  /**
   * 粘贴地址：把从微信里复制来的一整段文本拆成各字段。
   * 解析是启发式的（见 address.js），因此只覆盖解析出内容的字段，
   * 不把用户已经填好的部分清空；解析结果一律提示用户核对。
   */
  onPasteAddress() {
    wx.getClipboardData({
      success: (res) => {
        const text = String(res.data || '').trim()
        if (!text) {
          wx.showToast({ title: '剪贴板是空的', icon: 'none' })
          return
        }

        const parsed = parseAddressText(text)
        const next = { ...this.data.address }

        Object.keys(parsed).forEach((key) => {
          if (parsed[key]) next[key] = parsed[key]
        })

        this.applyAddress(next)
        wx.showToast({ title: '已尝试识别，请核对', icon: 'none' })
      },
      fail: (err) => {
        console.error('[FreshBuy] 读取剪贴板失败', err)
        wx.showToast({ title: '读取剪贴板失败', icon: 'none' })
      }
    })
  },

  /** 读取待下单的购物车条目（读操作可直接查库；按 userId 过滤保证只取自己的数据） */
  loadCart(done) {
    const openid = getApp().globalData.openid

    if (!openid) {
      this.setData({ loading: false, error: '未获取到登录信息，请返回首页重新登录' })
      if (typeof done === 'function') done()
      return
    }

    this.setData({ loading: true, error: '' })

    db.collection('cart')
      .where({ userId: openid })
      .get()
      .then((res) => {
        const carts = (res.data || []).map((item) => ({
          ...item,
          priceText: formatPrice(item.price),
          subtotalText: formatPrice(Number(item.price || 0) * Number(item.count || 0))
        }))

        const total = calcTotal(carts.map((i) => ({ price: i.price, count: i.count })))
        const totalCount = carts.reduce((sum, i) => sum + Number(i.count || 0), 0)

        this.setData({
          carts,
          totalCount,
          totalText: formatPrice(total),
          loading: false
        })
      })
      .catch((err) => {
        console.error('[FreshBuy] 读取待下单商品失败', err)
        this.setData({ loading: false, error: '加载失败，请稍后重试' })
      })
      .then(() => {
        if (typeof done === 'function') done()
      })
  },

  /**
   * 收货地址校验：六个必填项必须都是非空字符串（trim 后），缺任意一项即拦截。
   *
   * 注意：这里只是「尽早给出提示」的前端校验。真正的安全校验以云函数为准，
   * 前端拦截不能替代服务端校验。
   *
   * @return {{ok: boolean, field: string, label: string}}
   */
  validateAddress() {
    const address = this.data.address || {}

    for (let i = 0; i < ADDRESS_FIELDS.length; i += 1) {
      const { key, label } = ADDRESS_FIELDS[i]
      const raw = address[key]
      const value = String(raw == null ? '' : raw).trim()

      if (!value) {
        return { ok: false, field: key, label }
      }
    }

    return { ok: true, field: '', label: '' }
  },

  /** 提交订单 */
  onSubmit() {
    if (this.data.submitting) return

    if (!this.data.carts.length) {
      wx.showToast({ title: '没有待下单的商品', icon: 'none' })
      return
    }

    // ---- 地址校验 ----
    const check = this.validateAddress()
    if (!check.ok) {
      console.warn('[FreshBuy] 收货地址不完整，缺少字段:', check.label)
      this.setData({ errorField: check.field })
      // 提示文案较长，toast 会截断，这里用 showModal 保证完整可读
      wx.showModal({
        title: '收货地址不完整',
        content: ADDRESS_INCOMPLETE_MSG,
        showCancel: false,
        confirmText: '去填写'
      })
      return
    }

    this.setData({ errorField: '' })

    // ---- 地址快照：把表单内容整体复制成一份纯对象，不引用 users.address ----
    const address = { ...this.data.address }
    ADDRESS_FIELDS.forEach(({ key }) => {
      address[key] = String(address[key] == null ? '' : address[key]).trim()
    })
    address.postalCode = String(address.postalCode || '').trim()

    this.setData({ submitting: true })
    wx.showLoading({ title: '提交中…', mask: true })

    wx.cloud.callFunction({
      name: 'createOrder',
      data: {
        // 只传 productId 与数量，单价与总价由云函数依据数据库现价重算
        items: this.data.carts.map((item) => ({
          productId: item.productId,
          count: item.count
        })),
        address
      },
      success: (res) => {
        const result = res.result || {}
        if (result.code !== 0) {
          wx.showToast({ title: result.msg || '下单失败', icon: 'none' })
          return
        }

        // 下单成功后清空已下单的条目（removeCart 的批量模式正是为此设计）
        this.clearOrderedCart(this.data.carts.map((item) => item._id).filter(Boolean))

        wx.showToast({ title: '下单成功', icon: 'success' })

        //            ← 改动位置：原为 navigateBack（回来源页），现统一跳「我的订单」。
        // 两个入口（购物车结算 / 立即购买）落点一致，不再一个回购物车、一个回详情页。
        //
        // 用 redirectTo 而不是 navigateTo：redirectTo 是「替换当前页」，会把本页
        // 从页面栈里摘掉。若用 navigateTo，栈里会留下这个已经提交过的下单页，
        // 用户从订单列表返回时看到它还停在原样（商品清单仍在），再点一次
        // 「提交订单」就会重复下单。navigateBack 则只能回来源页，两个入口落点
        // 不一致，正是这次要统一掉的问题。
        setTimeout(() => {
          wx.redirectTo({
            url: '/sub-buyer/pages/order-list/order-list',
            fail: (err) => {
              // 跳转失败也必须让用户知道订单已经建好了，否则他会以为没下成功而重复提交
              console.error('[FreshBuy] 跳转我的订单失败', err)
              wx.showToast({ title: '订单已提交，请在「我的订单」中查看', icon: 'none' })
            }
          })
        }, 800)
      },
      fail: (err) => {
        console.error('[FreshBuy] 创建订单失败', err)
        wx.showToast({ title: '网络异常，请稍后重试', icon: 'none' })
      },
      complete: () => {
        wx.hideLoading()
        this.setData({ submitting: false })
      }
    })
  },

  /**
   * 清空已下单的购物车条目。
   * 失败只记日志、不向用户报错：订单已经创建成功，清购物车是收尾动作，
   * 弹一个「清理失败」反而会让用户以为下单没成功。
   */
  clearOrderedCart(cartIds) {
    if (!cartIds.length) return

    wx.cloud.callFunction({
      name: 'removeCart',
      data: { cartIds },
      success: (res) => {
        const result = res.result || {}
        if (result.code !== 0) {
          console.warn('[FreshBuy] 清空购物车失败', result.msg)
        }
      },
      fail: (err) => {
        console.error('[FreshBuy] 清空购物车失败', err)
      }
    })
  }
})
