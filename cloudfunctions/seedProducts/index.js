// cloudfunctions/seedProducts —— 开发期测试数据：商品造数
// 依据 CLAUDE.md「开发期测试数据约定」：12 条商品覆盖 vegetable / fruit / meat / seafood 四个分类。
//
// ⚠️ 开发期专用，上线前删除本函数：
//   商品图使用网络占位 URL（picsum.photos）而非云存储 fileID，与「图片处理」规范冲突，
//   属已拍板的开发期临时妥协。上线前必须换成云存储 fileID，届时 <image> 取值方式同步调整。
//   开发者工具需勾选「不校验合法域名」才能显示占位图。
//
// 幂等：执行前按 name 查重，已存在的跳过，可反复执行而不产生脏数据。
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command
const products = db.collection('products')
const users = db.collection('users')

/**
 * 12 条商品，每分类 3 条。
 * category 取值与 home.js 的静态分类、categories.key 严格对齐。
 * 字段遵循 CLAUDE.md「数据库规范 → products」：name / price / stock / category / images / status / createTime。
 */
const SEED_PRODUCTS = [
  // ---- vegetable 蔬菜 ----
  {
    name: '有机西红柿',
    price: 5.8,
    stock: 120,
    category: 'vegetable',
    images: [
      'https://picsum.photos/seed/fb-tomato-1/600/600',
      'https://picsum.photos/seed/fb-tomato-2/600/600'
    ]
  },
  {
    name: '新鲜黄瓜',
    price: 3.5,
    stock: 200,
    category: 'vegetable',
    images: [
      'https://picsum.photos/seed/fb-cucumber-1/600/600',
      'https://picsum.photos/seed/fb-cucumber-2/600/600'
    ]
  },
  {
    name: '上海青',
    price: 4.2,
    stock: 150,
    category: 'vegetable',
    images: [
      'https://picsum.photos/seed/fb-greens-1/600/600',
      'https://picsum.photos/seed/fb-greens-2/600/600'
    ]
  },

  // ---- fruit 水果 ----
  {
    name: '红富士苹果',
    price: 12.8,
    stock: 80,
    category: 'fruit',
    images: [
      'https://picsum.photos/seed/fb-apple-1/600/600',
      'https://picsum.photos/seed/fb-apple-2/600/600'
    ]
  },
  {
    name: '海南香蕉',
    price: 8.9,
    stock: 100,
    category: 'fruit',
    images: [
      'https://picsum.photos/seed/fb-banana-1/600/600',
      'https://picsum.photos/seed/fb-banana-2/600/600'
    ]
  },
  {
    name: '阳光玫瑰葡萄',
    price: 25.6,
    stock: 60,
    category: 'fruit',
    images: [
      'https://picsum.photos/seed/fb-grape-1/600/600',
      'https://picsum.photos/seed/fb-grape-2/600/600'
    ]
  },

  // ---- meat 肉禽蛋 ----
  {
    name: '黑猪五花肉',
    price: 32.0,
    stock: 50,
    category: 'meat',
    images: [
      'https://picsum.photos/seed/fb-pork-1/600/600',
      'https://picsum.photos/seed/fb-pork-2/600/600'
    ]
  },
  {
    name: '精选牛腩块',
    price: 45.5,
    stock: 40,
    category: 'meat',
    images: [
      'https://picsum.photos/seed/fb-beef-1/600/600',
      'https://picsum.photos/seed/fb-beef-2/600/600'
    ]
  },
  {
    name: '农家土鸡蛋',
    price: 15.8,
    stock: 90,
    category: 'meat',
    images: [
      'https://picsum.photos/seed/fb-egg-1/600/600',
      'https://picsum.photos/seed/fb-egg-2/600/600'
    ]
  },

  // ---- seafood 水产 ----
  {
    name: '鲜活基围虾',
    price: 58.0,
    stock: 30,
    category: 'seafood',
    images: [
      'https://picsum.photos/seed/fb-shrimp-1/600/600',
      'https://picsum.photos/seed/fb-shrimp-2/600/600'
    ]
  },
  {
    name: '冰鲜三文鱼排',
    price: 68.5,
    stock: 25,
    category: 'seafood',
    images: [
      'https://picsum.photos/seed/fb-salmon-1/600/600',
      'https://picsum.photos/seed/fb-salmon-2/600/600'
    ]
  },
  {
    name: '大连生蚝',
    price: 39.9,
    stock: 35,
    category: 'seafood',
    images: [
      'https://picsum.photos/seed/fb-oyster-1/600/600',
      'https://picsum.photos/seed/fb-oyster-2/600/600'
    ]
  }
]

exports.main = async () => {
  const { OPENID } = cloud.getWXContext()

  try {
    // ---- 权限校验：写操作必须确认调用者为商家，role 以数据库为准，不信任前端传入 ----
    const userRes = await users.where({ openid: OPENID }).limit(1).get()
    if (userRes.data.length === 0) {
      return { code: -2, msg: '用户不存在，请先进入小程序完成一次登录' }
    }
    if (userRes.data[0].role !== 'seller') {
      return {
        code: -2,
        msg: '无权限：仅商家可造测试数据。请在云控制台把 users 中本账号的 role 改为 seller，清缓存后重试'
      }
    }

    // ---- 幂等：按 name 查出已存在的商品，只插入缺失的 ----
    const names = SEED_PRODUCTS.map((item) => item.name)
    const existingRes = await products
      .where({ name: _.in(names) })
      .field({ name: true })
      .get()
    const existingNames = new Set((existingRes.data || []).map((item) => item.name))

    const inserted = []
    const skipped = []

    for (let i = 0; i < SEED_PRODUCTS.length; i++) {
      const item = SEED_PRODUCTS[i]

      if (existingNames.has(item.name)) {
        skipped.push(item.name)
        continue
      }

      // createTime 依次递减，保证 getProducts 的 orderBy('createTime', 'desc') 排序稳定可预期
      const createTime = new Date(Date.now() - i * 60000)

      await products.add({
        data: {
          name: item.name,
          price: item.price,
          stock: item.stock,
          category: item.category,
          images: item.images,
          status: 1, // 1 上架 / 0 下架
          createTime,
          updateTime: createTime
        }
      })

      inserted.push(item.name)
    }

    return {
      code: 0,
      msg: `造数完成：新增 ${inserted.length} 条，跳过 ${skipped.length} 条（已存在）`,
      inserted,
      skipped
    }
  } catch (err) {
    console.error('[seedProducts] 造数失败', err)
    return {
      code: -1,
      msg: '造数失败，请确认 products 集合已创建且数据库权限配置正确'
    }
  }
}
