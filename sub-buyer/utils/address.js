/**
 * sub-buyer/utils/address.js —— 收货地址文本解析
 *
 * 位置说明：与 display.js 同理，放在 sub-buyer/ 内部而非根目录 utils/，
 * 因为根目录的 utils/format.js 与 utils/constant.js 属项目禁止区。
 *
 * 用途：下单页「粘贴地址」——用户在微信里复制来的一整段收货信息，
 * 往往是「姓名 + 电话 + 省市区 + 详细地址」糊在一起，手抄一遍很费劲。
 * 这里把它拆成 address 结构里的各个字段，填进表单后仍可逐项修改。
 *
 * ⚠️ 这是**启发式**解析，不保证 100% 准确（地址写法千奇百怪）。
 * 它只是替用户省打字，不替代 order-confirm 的 validateAddress() 与
 * createOrder 云函数端的二次校验。解析不出的字段一律返回空串，
 * 由调用方决定「只覆盖解析出内容的字段」，避免把用户已填好的部分清空。
 */

// 汉字区间。地址里的中文只有汉字，不含标点，用它拼各种正则片段
const SEG = '[\\u4e00-\\u9fa5]'

// 手机号：可选 +86 前缀，随后 1[3-9] 开头的 11 位
const MOBILE_RE = /(?:\+?86[-\s]?)?1[3-9]\d{9}/
// 座机：区号 0xx(x) + 7~8 位，连字符可有可无
const TEL_RE = /0\d{2,3}-?\d{7,8}/

// 直辖市：picker mode="region" 与文本中都会出现「省=市」同名的情况
const MUNICIPALITY_RE = /^(北京|上海|天津|重庆)市/

/**
 * 强标签：本身几乎不可能出现在地址正文里，即使不带冒号也直接剥掉。
 * 按长度降序排列，保证「手机号码」先于「手机」被匹配，不会留下残尾。
 */
const STRONG_LABELS = [
  '收货人', '收件人', '联系人', '姓名', '名字',
  '手机号码', '手机号', '联系电话', '联系方式', '电话', '手机'
].sort((a, b) => b.length - a.length)

/**
 * 弱标签：本身可能就是地址正文的一部分（如「地址不详」「电话局宿舍」），
 * 只在带冒号时剥离，避免误伤。
 */
const WEAK_LABELS = ['收货地址', '详细地址', '地址'].sort((a, b) => b.length - a.length)

/** 全角转半角 + 统一分隔符 + 压缩空白 */
function normalize(text) {
  let s = String(text == null ? '' : text)

  // 全角字符（！-～）整体平移 0xFEE0 到半角，顺带解决全角数字与全角冒号
  s = s.replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
  s = s.replace(/　/g, ' ') // 全角空格

  // 各种逗号、分号、顿号、竖线统一成空格，避免它们粘进字段内容
  s = s.replace(/[,;、|]/g, ' ')
  s = s.replace(/[\r\n\t]+/g, ' ')

  return s.replace(/\s+/g, ' ').trim()
}

/** 剥离「收货人：」「电话：」这类标签词，只留其后的内容 */
function stripLabels(text) {
  let s = text

  STRONG_LABELS.forEach((label) => {
    s = s.split(label).join(' ')
  })

  WEAK_LABELS.forEach((label) => {
    s = s.split(label + ':').join(' ')
  })

  return s.replace(/\s+/g, ' ').trim()
}

/**
 * 找出文本中连续的「省市区」块。
 *
 * 为什么要整块找：地址里省市区一定是连续的一段，拿到它的起止位置后，
 * 前面的就是姓名（若正好是 2~4 个汉字）、后面的就是详细地址 —— 比逐个
 * 字段去猜要稳得多。
 *
 * @return {{index:number, 0:string}|null} 匹配结果；找不到返回 null
 */
function matchRegionBlock(s) {
  // 一级：省（或直辖市）→ 市? → 区?
  const provinceFirst = new RegExp(
    '(' +
      '(?:' + SEG + '{2,9}?(?:省|自治区|特别行政区)|(?:北京|上海|天津|重庆)市)' +
      '\\s*' +
      '(?:' + SEG + '{2,9}?(?:市|自治州|地区|盟))?' +
      '\\s*' +
      '(?:' + SEG + '{2,9}?(?:区|县|旗))?' +
      ')'
  )
  const m1 = s.match(provinceFirst)
  if (m1 && m1[1]) return m1

  // 二级：用户没写省，如「深圳市南山区……」。要求市与区同时出现，
  // 否则单一个「区」字太容易误判
  const cityFirst = new RegExp(
    '(' + SEG + '{2,9}?(?:市|自治州|地区|盟)' +
      '\\s*' +
      SEG + '{2,9}?(?:区|县|旗)' +
      ')'
  )
  const m2 = s.match(cityFirst)
  if (m2 && m2[1]) return m2

  return null
}

/** 把「广东省深圳市南山区」这样的整块拆成三个字段 */
function splitRegion(block) {
  const out = { province: '', city: '', district: '' }
  let rest = block.trim()

  const muniM = rest.match(MUNICIPALITY_RE)
  if (muniM) {
    // 直辖市：省与市同名。与 picker mode="region" 的返回值保持一致
    // （它同样返回 ['北京市','北京市','朝阳区']），展示层再用 formatRegion 去重
    out.province = muniM[0]
    out.city = muniM[0]
    rest = rest.slice(muniM[0].length).trim()
  } else {
    const provM = rest.match(new RegExp('^' + SEG + '{2,9}?(?:省|自治区|特别行政区)'))
    if (provM) {
      out.province = provM[0]
      rest = rest.slice(provM[0].length).trim()
    }
  }

  const cityM = rest.match(new RegExp('^' + SEG + '{2,9}?(?:市|自治州|地区|盟)'))
  if (cityM) {
    out.city = cityM[0]
    rest = rest.slice(cityM[0].length).trim()
  }

  const distM = rest.match(new RegExp('^' + SEG + '{2,9}?(?:区|县|旗)'))
  if (distM) {
    out.district = distM[0]
  }

  return out
}

/** 去掉首尾残留的分隔符与标点 */
function trimPunct(s) {
  return String(s || '')
    .replace(/^[\s:：,，.。;；、|\-—_/\\]+/, '')
    .replace(/[\s:：,，.。;；、|\-—_/\\]+$/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * 把一整段地址文本拆成地址字段。
 *
 * @param {string} text 通常是剪贴板里复制来的一整段
 * @return {{name:string, phone:string, province:string, city:string, district:string, detail:string}}
 *         解析不出的字段为空串（绝不返回 null，调用方可直接取用）
 */
function parseAddressText(text) {
  const result = {
    name: '',
    phone: '',
    province: '',
    city: '',
    district: '',
    detail: ''
  }

  let s = normalize(text)
  if (!s) return result

  s = stripLabels(s)

  // ---- 手机号：优先手机，其次座机 ----
  const phoneM = s.match(MOBILE_RE) || s.match(TEL_RE)
  if (phoneM) {
    result.phone = phoneM[0].replace(/[\s-]/g, '')
    // 摘掉后补一个空格，避免前后文字被粘连成新词
    s = (s.slice(0, phoneM.index) + ' ' + s.slice(phoneM.index + phoneM[0].length))
      .replace(/\s+/g, ' ')
      .trim()
  }

  // ---- 省市区整块定位 ----
  const regionM = matchRegionBlock(s)
  let head = s
  let tail = ''

  if (regionM) {
    head = s.slice(0, regionM.index)
    tail = s.slice(regionM.index + regionM[0].length)

    const region = splitRegion(regionM[0])
    result.province = region.province
    result.city = region.city
    result.district = region.district
  }

  // ---- 姓名：省市区之前剩下的部分若正好是 2~4 个汉字，那就是姓名 ----
  const headClean = head.replace(/[\s:：,，.。;；、|\-—_/\\]+/g, '')

  if (/^[一-龥]{2,4}$/.test(headClean)) {
    result.name = headClean
  } else if (headClean) {
    // 不是姓名就不能丢，退回详细地址
    tail = headClean + ' ' + tail
  }

  result.detail = trimPunct(tail)

  // ---- 姓名也可能写在地址之后（如「…科技园路1号 张三 138…」），从尾部再找一次 ----
  if (!result.name) {
    const parts = result.detail.split(' ').filter(Boolean)
    const lastPart = parts[parts.length - 1]
    // 要求至少两个片段：只有一个片段时，整段就是详细地址，不能整个当成姓名
    if (parts.length > 1 && /^[一-龥]{2,4}$/.test(lastPart)) {
      result.name = lastPart
      result.detail = parts.slice(0, -1).join(' ')
    }
  }

  return result
}

/**
 * 拼接省市区用于展示。
 *
 * 必要性：直辖市在数据里省与市同名（'北京市' + '北京市' + '朝阳区'），
 * 直接连起来会显示成「北京市北京市朝阳区」。这里把与省同名的市去掉。
 *
 * @param {string} province
 * @param {string} city
 * @param {string} district
 * @return {string} 如「广东省深圳市南山区」「北京市朝阳区」
 */
function formatRegion(province, city, district) {
  const p = String(province || '').trim()
  const c = String(city || '').trim()
  const d = String(district || '').trim()

  const parts = [p]
  if (c && c !== p) parts.push(c)
  if (d) parts.push(d)

  return parts.filter(Boolean).join('')
}

module.exports = {
  parseAddressText,
  formatRegion
}
