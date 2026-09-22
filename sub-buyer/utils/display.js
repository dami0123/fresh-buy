/**
 * sub-buyer/utils/display.js —— 买家端展示层小工具
 *
 * 位置说明：放在 sub-buyer/ 内部而非根目录 utils/，因为根目录的 utils/format.js
 * 与 utils/constant.js 属项目禁止区（只有负责人能改），本文件不触碰它们，只做补充。
 */

/**
 * 把云函数返回的时间统一转成 Date，再交给 utils/format.js 的 formatTime 格式化。
 *
 * 为什么需要它：云函数返回值经 JSON 序列化后，Date 会变成 ISO 字符串
 * （如 '2026-09-19T06:30:00.000Z'）。而 formatTime 内部会把 '-' 替换成 '/' 再交给
 * new Date()，这个结果在 iOS（JavaScriptCore）与 V8 下都无法解析，会静默返回空串。
 * 时间戳数字同样不被 formatTime 支持。这里先归一化，规避该问题。
 *
 * @param {Date|string|number} value
 * @return {Date|null} 无法解析时返回 null（formatTime 收到 null 会返回空串）
 */
function toDate(value) {
  if (!value) return null
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value
  if (typeof value === 'number') return new Date(value)

  const str = String(value)

  // ISO 8601 各端均可直接解析，优先走这条路
  let date = new Date(str)
  if (!isNaN(date.getTime())) return date

  // 兜底：'2026-09-19 06:30:00' 这类 iOS 不认的格式，换成 '/' 分隔再试
  date = new Date(str.replace(/-/g, '/'))
  return isNaN(date.getTime()) ? null : date
}

/**
 * 把照片列表转成 <image> 能直接用的地址。
 *
 * 正式规范（CLAUDE.md「图片处理」）要求数据库只存云存储 fileID，展示时换临时链接；
 * 但开发期 devAdvanceOrder / seedProducts 造的是 picsum 网络占位图。这里做个兼容：
 *   cloud:// 前缀 -> 调 getTempFileURL 换临时链接
 *   其余（http/https）-> 原样返回，不浪费一次接口调用
 *
 * @param {Array<string>} fileList
 * @return {Promise<Array<string>>} 与入参等长；转换失败时保留原值，不阻断页面展示
 */
function toDisplayUrls(fileList) {
  const list = (fileList || []).filter(Boolean)
  if (list.length === 0) return Promise.resolve([])

  const result = list.slice()
  const cloudIndexes = []
  const cloudIds = []

  list.forEach((item, index) => {
    if (typeof item === 'string' && item.indexOf('cloud://') === 0) {
      cloudIndexes.push(index)
      cloudIds.push(item)
    }
  })

  if (cloudIds.length === 0) return Promise.resolve(result)

  return new Promise((resolve) => {
    wx.cloud.getTempFileURL({
      fileList: cloudIds,
      success: (res) => {
        const fileList2 = res.fileList || []
        cloudIndexes.forEach((targetIndex, i) => {
          const file = fileList2[i]
          if (file && file.tempFileURL) {
            result[targetIndex] = file.tempFileURL
          }
        })
        resolve(result)
      },
      fail: (err) => {
        console.error('[FreshBuy] 获取图片临时链接失败，保留原始 fileID', err)
        resolve(result)
      }
    })
  })
}

module.exports = {
  toDate,
  toDisplayUrls
}
