/**
 * utils/category.js —— 商品分类常量（双端共享）
 *
 * key 与 CLAUDE.md「数据库规范 → categories」的 categories.key 约定、
 * 买家首页 sub-buyer/pages/home/home.js 的静态分类严格对齐：
 *   vegetable 蔬菜 / fruit 水果 / meat 肉禽蛋 / seafood 水产
 *
 * 注意：categories 集合目前为空，前端分类仍走静态列表（CLAUDE.md「categories 使用说明」）。
 * home.js 中的静态数组是同伴 A 的历史实现，属其目录边界，未做统一迁移；
 * 商家端（product-edit 分类选择、createProduct/updateProduct 白名单）使用本文件。
 */

/** 分类列表（「全部」是前端伪分类，不入库、也不放这里） */
const CATEGORIES = [
  { key: 'vegetable', name: '蔬菜' },
  { key: 'fruit', name: '水果' },
  { key: 'meat', name: '肉禽蛋' },
  { key: 'seafood', name: '水产' }
]

/** key -> 中文名映射，如 CATEGORY_NAME.fruit === '水果' */
const CATEGORY_NAME = CATEGORIES.reduce((map, item) => {
  map[item.key] = item.name
  return map
}, {})

/** 仅 key 数组，供云函数白名单校验 */
const CATEGORY_KEYS = CATEGORIES.map((item) => item.key)

module.exports = {
  CATEGORIES,
  CATEGORY_NAME,
  CATEGORY_KEYS
}
