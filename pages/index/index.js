// pages/index/index.js —— 启动页 / 身份选择页
// 职责：调用 login 云函数拿到 openid 与 role 并写入 globalData（购物车等页面依赖），
//      登录成功后停留在本页，由用户手动选择进入用户端或商家端。
const { HOME_PATH, ROLE } = require('../../utils/constant')

/** 身份的中文展示文案（仅本页调试展示用，不参与路由） */
const ROLE_TEXT = {
  [ROLE.BUYER]: '买家',
  [ROLE.SELLER]: '商家'
}

const app = getApp()

Page({
  data: {
    loading: true,
    error: '',        // 云环境异常时的提示文案
    resolvedRole: '', // login 返回的身份原值
    roleText: ''      // 身份的中文文案，供页面展示
  },

  onLoad() {
    this.login()
  },

  /** 登录：写入 globalData 后停留在本页，不再自动跳转 */
  login() {
    this.setData({ loading: true, error: '' })

    wx.cloud.callFunction({
      name: 'login',
      success: (res) => {
        const result = res.result || {}
        if (!result.openid) {
          this.setData({ loading: false, error: '登录失败：云函数未返回 openid' })
          return
        }

        app.globalData.openid = result.openid
        app.globalData.role = result.role
        app.globalData.userInfo = result.userInfo || null

        this.setData({
          loading: false,
          resolvedRole: result.role,
          roleText: ROLE_TEXT[result.role] || result.role || '未知'
        })
      },
      fail: (err) => {
        console.error('[FreshBuy] 调用 login 云函数失败', err)
        this.setData({
          loading: false,
          error: '无法连接云环境，请检查 app.js 中的 env 配置与 login 云函数是否已部署'
        })
      }
    })
  },

  /** 跳转到对应身份的分包首页（分包页面非 tabBar，使用 redirectTo 避免堆栈堆积） */
  redirect(role) {
    const url = HOME_PATH[role] || HOME_PATH[ROLE.BUYER]
    wx.redirectTo({
      url,
      fail: (err) => {
        console.error('[FreshBuy] 分包跳转失败', err)
        this.setData({ error: '跳转失败，请确认分包页面已正确配置在 app.json 的 subPackages 中' })
      }
    })
  },

  /** 手动进入用户端 */
  onEnterBuyer() {
    app.globalData.role = ROLE.BUYER
    this.redirect(ROLE.BUYER)
  },

  /** 手动进入商家端 */
  onEnterSeller() {
    app.globalData.role = ROLE.SELLER
    this.redirect(ROLE.SELLER)
  }
})
