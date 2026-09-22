// sub-buyer/components/bottom-nav/bottom-nav.js —— 买家端自定义底部导航
//
// 为什么是自定义组件而不是 app.json 里的 tabBar：
//   微信平台规定 tabBar 页面必须位于【主包】，而买家端 4 个页面都在 sub-buyer 分包里，
//   写进 tabBar 编译期直接报错。且 tabBar 只能配在 app.json（CLAUDE.md 划定的禁止区，
//   只有项目负责人能改）。自定义组件两处都绕开，同时天然只作用于引用了它的买家页面，
//   商家端 sub-seller 完全不受影响。
//
// 用法：在页面 wxml 的最末尾加一行，current 传本页的 key
//   <bottom-nav current="cart" />
// 并在页面 json 的 usingComponents 里注册。
const ITEMS = [
  { key: 'home', text: '首页', icon: '🏠', url: '/sub-buyer/pages/home/home' },
  { key: 'cart', text: '购物车', icon: '🛒', url: '/sub-buyer/pages/cart/cart' },
  { key: 'order', text: '我的订单', icon: '📋', url: '/sub-buyer/pages/order-list/order-list' },
  { key: 'profile', text: '个人中心', icon: '👤', url: '/sub-buyer/pages/profile/profile' }
]

Component({
  properties: {
    // 当前页面的 key，与上面 ITEMS 的 key 对应，用于高亮
    current: {
      type: String,
      value: ''
    }
  },

  data: {
    items: ITEMS
  },

  methods: {
    onTap(e) {
      const key = e.currentTarget.dataset.key
      if (key === this.data.current) return

      const target = ITEMS.find((item) => item.key === key)
      if (!target) return

      // 用 redirectTo 而不是 navigateTo：底部导航是【同级切换】，
      // 不该把页面压进页面栈。否则「首页 → 购物车 → 订单 → 个人中心」
      // 连点几次后，返回键要按四下方能退出小程序。
      // redirectTo 是替换当前页，页面栈始终只有一层，行为与真 tabBar 一致。
      wx.redirectTo({
        url: target.url,
        fail: (err) => {
          console.error('[FreshBuy] 底部导航跳转失败', target.url, err)
          wx.showToast({ title: '页面跳转失败，请稍后重试', icon: 'none' })
        }
      })
    }
  }
})
