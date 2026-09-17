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

/**
 * 订单状态（orders.status）
 * 状态机见 CLAUDE.md「订单状态机」：本项目无支付环节，status = 0 已废弃，永不写入。
 */
const ORDER_STATUS = {
  PENDING_SHIP: 1,         // 待发货
  PENDING_CONFIRM_SHIP: 2, // 待确认发货（商家已上传 3 张发货照片）
  DELIVERING: 3,           // 配送中（买家已确认照片）
  FINISHED: 4,             // 已完成
  AFTER_SALE: 5,           // 售后中
  CLOSED: 6                // 已关闭（退款终态）
}

/** 订单状态中文文案 */
const ORDER_STATUS_TEXT = {
  1: '待发货',
  2: '待确认发货',
  3: '配送中',
  4: '已完成',
  5: '售后中',
  6: '已关闭'
}

/** 订单状态对应的标签色（供页面样式绑定） */
const ORDER_STATUS_THEME = {
  1: 'primary',
  2: 'warn',
  3: 'primary',
  4: 'done',
  5: 'danger',
  6: 'muted'
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
