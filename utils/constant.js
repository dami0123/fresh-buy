/**
 * 全局常量：双端共享的字面量定义，避免各处硬编码
 * 集合字段约定见 CLAUDE.md「数据库规范」
 */

/**
 * 云开发环境 ID（环境名 cloud1）
 * 切换环境（如日后做开发/正式环境分离）时只需改这一处。
 * 查看路径：云开发控制台 -> 设置 -> 权限设置 -> 环境 ID
 * 说明：env ID 是环境标识而非密钥，访问权限由 AppID 与成员权限决定，可安全提交到仓库。
 */
const ENV_ID = 'cloud1-d5gynlrhm38118b88'

/** 用户身份（users.role） */
const ROLE = {
  BUYER: 'buyer',
  SELLER: 'seller'
}

/** 订单状态（orders.status） */
const ORDER_STATUS = {
  PENDING_PAY: 0,   // 待支付
  PENDING_SHIP: 1,  // 待发货
  FINISHED: 2       // 已完成
}

/** 订单状态中文文案 */
const ORDER_STATUS_TEXT = {
  0: '待支付',
  1: '待发货',
  2: '已完成'
}

/** 订单状态对应的标签色（供页面样式绑定） */
const ORDER_STATUS_THEME = {
  0: 'warn',
  1: 'primary',
  2: 'done'
}

/** 双端首页路径，供身份路由跳转使用 */
const HOME_PATH = {
  buyer: '/sub-buyer/pages/home/home',
  seller: '/sub-seller/pages/dashboard/dashboard'
}

module.exports = {
  ENV_ID,
  ROLE,
  ORDER_STATUS,
  ORDER_STATUS_TEXT,
  ORDER_STATUS_THEME,
  HOME_PATH
}
