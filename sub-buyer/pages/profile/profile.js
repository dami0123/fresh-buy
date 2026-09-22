// sub-buyer/pages/profile/profile.js —— 个人中心
// 【基础骨架】本次只搭页面结构，内部业务逻辑不实现。
//
// 预留的待实现项（见 CLAUDE.md「商家身份授予约定」：不做「申请成为商家」入口）：
//   头像 / 昵称展示与修改、默认收货地址的编辑与同步回 users.address、
//   订单状态快捷入口（待发货 / 待确认发货 / 配送中 / 已完成 的数量角标）
const { ROLE } = require('../../../utils/constant')

/** 身份的中文文案 */
const ROLE_TEXT = {
  [ROLE.BUYER]: '买家',
  [ROLE.SELLER]: '商家'
}

Page({
  data: {
    // 只读展示：完整用户记录由 pages/index 登录后写入 globalData
    roleText: '',
    displayName: '',
    phone: ''
  },

  onShow() {
    // 展示层仅做只读回填，不涉及任何写操作与云函数调用
    const app = getApp()
    const userInfo = app.globalData.userInfo || {}

    this.setData({
      roleText: ROLE_TEXT[app.globalData.role] || '',
      displayName: (userInfo.address && userInfo.address.name) || userInfo.nickname || '微信用户',
      phone: userInfo.phone || (userInfo.address && userInfo.address.phone) || ''
    })
  },

  /** TODO: 待实现 —— 跳转「我的收货地址」编辑页 */
  onAddressTap() {
    wx.showToast({ title: '待实现', icon: 'none' })
  },

  /** TODO: 待实现 —— 按状态跳转订单列表对应 tab */
  onOrderEntryTap() {
    wx.showToast({ title: '待实现', icon: 'none' })
  }
})
