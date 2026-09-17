// app.js —— 小程序入口，负责云开发环境初始化与全局数据维护
// 环境 ID 统一维护在 utils/constant.js，切换环境时只需改那一处
const { ENV_ID } = require('./utils/constant')

App({
  // 全局数据：登录后由 pages/index 写入，供双端页面通过 getApp() 读取
  globalData: {
    openid: '',      // 当前用户 openid
    role: '',        // 身份：'buyer' | 'seller'
    userInfo: null   // users 集合中的完整用户记录
  },

  onLaunch() {
    if (!wx.cloud) {
      console.error('[FreshBuy] 请使用 2.2.3 或以上的基础库以使用云开发能力')
      return
    }

    wx.cloud.init({
      env: ENV_ID,
      traceUser: true // 将用户访问记录到用户管理面板
    })
  }
})
