# FreshBuy 生鲜电商小程序

基于微信云开发的生鲜电商小程序，采用**双端分包架构**（用户端 + 商家端），共享同一套云开发环境。

完整的架构说明与编码规范见 [CLAUDE.md](./CLAUDE.md)。

## 目录结构

```
├── app.js / app.json / app.wxss   # 入口：云环境初始化、分包配置、全局样式
├── pages/index/                   # 【主包】启动页 / 身份选择页
├── sub-buyer/                     # 【分包A】用户端
│   └── pages/{home,detail,cart}
├── sub-seller/                    # 【分包B】商家端
│   └── pages/{dashboard,product-manage,order-manage}
├── utils/                         # 双端共享工具函数
│   ├── format.js                  # 时间格式化、金额计算
│   └── constant.js                # 身份 / 订单状态 / 路由常量
└── cloudfunctions/                # 云函数
    ├── login/                     # 登录鉴权
    ├── getProducts/               # 商品列表（分页）
    ├── createOrder/               # 创建订单（服务端计价）
    └── updateOrderStatus/         # 更新订单状态（商家权限校验）
```

## 起步步骤

1. **配置云环境 ID**
   打开 `app.js`，把 `env: 'YOUR-ENV-ID'` 替换为你的云开发环境 ID
   （微信开发者工具 → 云开发 → 设置 → 环境 ID）。

2. **创建数据库集合**
   在云开发控制台创建以下集合：`users`、`products`、`orders`、`cart`。

3. **部署云函数**
   在开发者工具中右键 `cloudfunctions` 下的每个函数 → **上传并部署：云端安装依赖**。

4. **设置商家账号**
   首次进入小程序会自动在 `users` 集合创建一条 `role: 'buyer'` 的记录。
   若要体验商家端，在云开发控制台把该记录的 `role` 手动改为 `'seller'`。

5. **编译运行**
   主包 `index` 页会根据 `login` 云函数返回的 `role` 自动跳转到对应分包首页。
   调试期间也可在首页手动选择进入用户端 / 商家端。

## 待补充的云函数

以下功能在骨架中已预留页面与调用位置，但按项目规范（写操作必须经云函数）尚未实现，需要补齐后才能使用：

| 待补云函数 | 用途 | 调用位置 |
| --- | --- | --- |
| `addToCart` | 加入购物车 | `sub-buyer/pages/detail/detail.js` |
| `updateCartCount` | 修改购物车数量 | `sub-buyer/pages/cart/cart.js` |
| `removeCart` | 删除购物车条目 | `sub-buyer/pages/cart/cart.js` |
| `updateProduct` | 商品上下架 / 改库存 | `sub-seller/pages/product-manage/product-manage.js` |

> 以上函数的实现必须遵循 CLAUDE.md 的安全约定：写操作在云函数端完成，
> 并对调用者的 `role` 做二次校验，不信任前端传入的身份与金额。
