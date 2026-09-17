/**
 * 公共工具函数：时间格式化与金额计算
 * 位置约定见 CLAUDE.md「逻辑复用」，双端均可 require 引入。
 * 注意按调用页面所在层级调整相对深度：
 *   分包页面（sub-buyer/pages/home/home.js 等）：
 *     const { formatTime, formatPrice } = require('../../../utils/format')
 *   主包页面（pages/index/index.js）：
 *     const { formatTime, formatPrice } = require('../../utils/format')
 */

/** 补零：9 -> '09' */
function pad(n) {
  return n < 10 ? '0' + n : '' + n
}

/**
 * 时间格式化
 * @param {Date|string|number} input 时间对象 / 时间戳 / 可被 Date 解析的字符串
 * @param {boolean} withTime 是否附带 时:分:秒
 * @param {string} sep 日期分隔符
 * @return {string} 如 '2026-09-16 08:30:00'，输入非法时返回空串
 */
function formatTime(input, withTime = true, sep = '-') {
  if (!input) return ''
  // 兼容 iOS：'2026-09-16 08:30:00' 这类格式需转成 '2026/09/16 08:30:00'
  const date = input instanceof Date ? input : new Date(String(input).replace(/-/g, '/'))
  if (isNaN(date.getTime())) return ''

  const ymd = [date.getFullYear(), pad(date.getMonth() + 1), pad(date.getDate())].join(sep)
  if (!withTime) return ymd

  return ymd + ' ' + [pad(date.getHours()), pad(date.getMinutes()), pad(date.getSeconds())].join(':')
}

/** 金额展示：保留两位小数，如 9.5 -> '9.50' */
function formatPrice(value) {
  const num = Number(value)
  if (isNaN(num)) return '0.00'
  return num.toFixed(2)
}

/** 元 -> 分。避免浮点误差，用于需要以分为单位存储/比较的场景 */
function yuanToFen(yuan) {
  const num = Number(yuan)
  return isNaN(num) ? 0 : Math.round(num * 100)
}

/** 分 -> 元（字符串，保留两位小数） */
function fenToYuan(fen) {
  return formatPrice(Number(fen || 0) / 100)
}

/**
 * 按商品单价与数量累加总价
 * @param {Array} items [{ price, count }]
 * @return {number} 总价（元）
 */
function calcTotal(items) {
  if (!Array.isArray(items)) return 0
  const total = items.reduce((sum, item) => {
    return sum + Number(item.price || 0) * Number(item.count || 0)
  }, 0)
  return Number(total.toFixed(2))
}

module.exports = {
  formatTime,
  formatPrice,
  yuanToFen,
  fenToYuan,
  calcTotal
}
