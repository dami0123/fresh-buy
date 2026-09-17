# FreshBuy - 微信小程序生鲜电商（双端分包版）

## 项目简介
一个基于微信云开发的生鲜电商小程序，采用**双端分包架构**。包含**用户端**和**商家端**两个独立模块，共享同一套云开发环境。适合多人协作开发，支持商品浏览、购物车、下单及商家后台管理。

## 技术栈
- 微信小程序原生语法 (WXML, WXSS, JavaScript)
- 微信云开发 (CloudBase)：云数据库、云函数、云存储
- 数据存储：云数据库 (NoSQL, JSON文档型)

## 项目结构
采用主包+分包模式，物理隔离不同角色的代码：

- `app.js / app.json`：小程序入口，初始化云环境，配置分包路径
- `pages/index/`：【主包】启动页与身份选择页
- `sub-buyer/`：【分包A】**用户端**代码目录（同伴A负责）
    - `pages/home/`：商品列表与分类
    - `pages/detail/`：商品详情
    - `pages/cart/`：购物车管理
- `sub-seller/`：【分包B】**商家端**代码目录（同伴B负责）
    - `pages/dashboard/`：数据概览
    - `pages/product-manage/`：商品上下架与库存
    - `pages/order-manage/`：订单发货处理
- `cloudfunctions/`：云函数目录（双端共享逻辑）
    - `login/`：登录鉴权
    - `getProducts/`：获取商品列表
    - `createOrder/`：创建订单
    - `updateOrderStatus/`：更新订单状态

## 架构约定
- **分包隔离**：用户端页面放在 `sub-buyer`，商家端页面放在 `sub-seller`，互不干扰，支持并行开发。
- **身份路由**：主包 `index` 页根据 `users` 集合中的 `role` 字段（buyer/seller）自动跳转对应分包首页。
- **数据共享**：双端操作同一套云数据库集合，通过字段权限控制数据安全。
- **逻辑复用**：公共工具函数（如格式化时间、金额计算）放在 `utils/` 目录供双端引用。

## 常用命令/操作
- **部署云函数**：在开发者工具中右键 `cloudfunctions` 目录下的具体函数 -> "上传并部署：云端安装依赖"
- **预览真机**：点击开发者工具顶部 "预览" -> 手机扫码（需添加为体验成员）
- **清除缓存**：开发阶段修改云数据库权限后，需在真机调试中清除缓存生效

## FreshBuy 编码规范

### 数据库规范 (云数据库)

5 个集合就像 FreshBuy 小程序的 5 个「仓库」，各自存放不同种类的数据，分工非常明确。它们组合起来完成一个完整的购物流程：用户（users）通过分类货架（categories）快速找到想买的类别，从商品仓库（products）中挑选商品，放进购物车（cart），结算后生成订单记录（orders）。

- **users（用户档案）**：存放所有使用小程序的人的档案。关键字段：`_id`, `openid`, `role` ('buyer'/'seller'), `phone`, `avatar`, `address` (Object, 最近一次使用的收货地址，供下单页预填)；规划扩展字段（当前代码尚未实现，勿在逻辑中假设其存在）：`nickname` 微信昵称, `balance` 账户余额。首次登录由 login 云函数自动建档，默认角色为 buyer。
- **地址快照原则**：下单时必须把地址内容复制进 `orders.address`，**不得**在订单里只存 users 的引用或 `_id`。否则用户事后修改收货地址，历史订单的地址会跟着变。
- **categories（分类货架）**：存放商品的分类信息，比如「新鲜水果」「肉禽蛋品」「粮油调味」。有了它，用户就能在首页快速找到想要购买的类别。关键字段：`key` (与 `products.category` 对应的英文标识), `name` (中文名), `sort` (Number, 升序排列), `icon` (可选, 云存储 fileID), `enabled` (Boolean, 是否启用)。
- **products（商品仓库）**：存放所有售卖的生鲜信息，比如西红柿、牛肉卷的名称、价格、图片和库存。关键字段：`name`, `price` (Number), `stock` (Number), `category` (对应 `categories.key`), `images` (Array), `status` (1 上架 / 0 下架), `createTime`。
- **cart（购物车）**：存放用户还没下单、准备购买的商品信息，比如加了 1 斤排骨和 2 个苹果。关键字段：`userId`, `_openid` (云函数建档时必须显式写入，供「仅创建者可读写」权限比对), `productId`, `count`。
- **orders（订单记录）**：存放用户的历史订单和当前订单，记录他买了什么、花了多少钱、订单现在是什么状态。关键字段：`orderNo`, `userId` (openid), `items` (Array), `totalPrice`, `status` (1:待发货, 2:待确认发货, 3:配送中, 4:已完成, 5:售后中, 6:已关闭；**无支付环节，0 已废弃**), `address` (Object, 下单时的收货地址快照), `shipPhotos` (Array, 商家发货照片 fileID, 固定 3 张), `shipRejectReason` (String, 买家驳回原因), `return` (Object, 售后子对象: photos[] / aiResult{} / liable / resolution / refundAt), `reshipCount` (Number, 重发次数), `createTime`, `updateTime`。

#### categories 使用说明
- **关联方式**：`categories.key` 是业务主键，`products.category` 存的就是这个值（如 `vegetable`）。不使用自动生成的 `_id` 做关联，因为 `_id` 不可读且无法在代码里硬编码。
- **「全部」不入库**：分类栏首位的「全部」是前端 UI 的伪分类（`key` 为空串），由页面代码自行拼接，数据库中不存这条记录。
- **当前状态**：`sub-buyer/pages/home/home.js` 的 `loadCategories()` 仍使用写死的静态数组，尚未接入本集合。集合已建但为空，接入前不影响任何现有功能。
- **接入方式**：新增 `getCategories` 云函数（读操作也可前端直查），按 `enabled: true` 过滤、`sort` 升序返回，前端在结果首位拼上「全部」。改造后新增/调整分类只需在控制台改数据，无需发版。

### 前端开发规范
- **样式隔离**：分包内的页面样式尽量写在页面级 `.wxss` 中，避免污染全局。
- **API调用**：所有涉及写操作（增删改）必须通过**云函数**调用，禁止在前端直接调用数据库 `add/update` 方法（防止越权）。
- **图片处理**：商品图片统一上传至云存储，数据库仅保存 `fileID`。

### 商家端特别约定
- **敏感操作**：涉及金额修改、库存扣减的操作，必须在云函数端进行二次校验。
- **列表分页**：商家端商品/订单列表必须使用云数据库的 `skip` 和 `limit` 实现分页加载，避免一次性拉取全量数据。

### 订单状态机（已拍板，双端必须一致）

主流程：**确认下单 → 等待商家上传发货图 → 买家确认照片 → 确认收货 → 完成**

**本项目无支付环节**：下单成功后订单直接进入「待发货」，不存在「待支付」状态，也不需要 `mockPay` 云函数。

| status | 含义 | 由哪个云函数推进 | 归属 |
|--------|------|------------------|------|
| 1 | 待发货 | `createOrder` 下单时直接写入；或售后判定「重发货」时回退 | A / B |
| 2 | 待确认发货 | `shipOrder` 商家上传 3 张照片 | B |
| 3 | 配送中 | `confirmShipment` 买家确认照片（驳回则停留在 2，商家重拍） | A |
| 4 | 已完成 | `confirmReceipt` 买家确认收货；或售后不成立时自动回退 | A |
| 5 | 售后中 | `applyReturn` 且系统判定为商家责任 | A |
| 6 | 已关闭 | `resolveReturn` 执行退款后终态 | A |

- **status = 0 已废弃，永不写入**。现有代码中 `createOrder` 写的 `status: 0` 必须改为 `1`，`order-manage.js` 的「待支付」tab 必须删除（详见「支付环节移除的改造点」）。
- **禁止前端直接改 status**：所有状态变更必须经云函数，云函数内校验调用者身份与当前状态是否允许流转。
- `updateOrderStatus` 在新状态机下由上表函数取代，标记 deprecated，不再新增调用。
  - ⚠️ **该函数当前已失效**：状态机重新编号后 `ORDER_STATUS.FINISHED` 由 2 变为 4，但其内部白名单仍是 `ALLOWED_STATUS = [1, 2]`，导致商家端「发货」按钮点击后返回「目标状态不合法」。**这是已知问题，属预期行为，不要排查。**
  - 处理方式：由同伴 B 在实现 `shipOrder`（拍照发货）时，把 `order-manage.js` 中调用 `updateOrderStatus` 的 `submitShip` 整体替换掉，替换后按钮恢复。不要为了让旧按钮可用而去修改 `ALLOWED_STATUS`。

### 支付环节移除的改造点（三处必须同时改，缺一不可）
1. `cloudfunctions/createOrder/index.js`：`status: 0` → `status: 1`，并更新同行注释。
2. `utils/constant.js`：删除 `ORDER_STATUS.PENDING_PAY`，以及 `ORDER_STATUS_TEXT`、`ORDER_STATUS_THEME` 中 key 为 `0` 的两条。
3. `sub-seller/pages/order-manage/order-manage.js`：删除 tabs 数组里的「待支付」项。

> ⚠️ 第 2、3 条有强依赖：若只删常量不删 tab，`ORDER_STATUS.PENDING_PAY` 会变成 `undefined`，订单列表的「待支付」筛选项会失效且难排查。改完必须重新部署 `createOrder` 云函数。

### 售后判定约定（已拍板：系统自动终局判定）
- 责任判定**由系统自动完成**。商家端流程图中「查看 AI 判定结果 → 是否商家责任」表示商家只是**查看**系统给出的结论，**不提供人工判定按钮**，商家不能改判。
- `applyReturn` 内同步调用 `aiJudge` 得出结论，写入 `return.aiResult`（原始输出，**永不覆盖**）与 `return.liable`。
- `liable = true`：订单停留在 5，由**买家**选择「退款」或「重发货」，调 `resolveReturn` 执行。
- `liable = false`：售后不成立，订单**自动回退到 4（已完成）**，写入 `return.resolution = 'rejected'` 与理由。买家端必须展示「售后未通过」提示——否则订单会卡在售后中无人能处理。
- 重发货：5→1，`reshipCount` 累加，订单重新走商家拍照环。
- 退款：5→6，写入 `return.refundAt`，订单终结。

#### aiJudge 判定依据（已拍板：两组照片 + 时间差）
`aiJudge` 的输入固定为以下三项，**一期二期都不变**：
1. `shipPhotos`：商家发货时拍的 3 张照片（来自订单，云函数内自行读取，不由前端传入）
2. `return.photos`：买家上传的退货照片
3. `hoursSinceReceive`：从「买家确认收货」到「发起售后」的时间差（小时），由云函数依据 `receiveAt` 计算，**不由前端传入**

判定逻辑：对比发货照片与退货照片，判断损坏在发货时是否已存在；时间差作为辅助参考（间隔越长，越可能是买家侧存放导致）。

> 之所以必须对比两组照片：单看买家一张退货照片，无法区分「商家发出时就坏了」与「买家收货后放坏了」。`shipPhotos` 是这个判定唯一站得住脚的依据，也是发货拍照环存在的核心价值。

#### 一期 mock 与二期真 AI 的边界（已拍板）
- **一期做 mock**，但**接口必须按真 AI 的形态设计**：入参三项固定、出参结构固定，二期只替换 `aiJudge` 内部实现，`applyReturn` 与双端页面**一行都不用改**。
- `aiJudge` 出参统一为：`{ liable: Boolean, reason: String, confidence: Number, raw: Object }`。`raw` 存放模型原始返回，一期 mock 时填规则命中说明。
- mock 规则必须**确定性、可复现**（同样输入必得同样结论），**禁止用随机数**——否则同一订单反复提交会得到不同结果，无法调试也无法答辩。
- mock 规则建议（可调整，但须写死在代码里而非硬编码结论）：退货照片 ≥2 张且 `hoursSinceReceive ≤ 48` 判 `liable=true`；其余判 `false`。**必须让两条分支都能被测到**，否则 `liable=false → 自动回退已完成` 这条防卡死逻辑等于没验证过。

#### 二期接入真 AI 的技术路线（调研结论，暂不实施）
- **优先验证微信云开发内置 AI**（`cloud.ai()`）：有「微信 AI 小程序成长计划」赠送 10 亿 Token 免费额度、混元 Hy3 模型。⚠️ 但官方文档只明确了文本生成与文生图，**是否支持图片输入（视觉理解）未获确认**，须先写测试云函数验证。
- 若内置 AI 不支持图片输入，**退回阿里云通义千问 VL**（百炼平台，文档明确支持单图/多图输入，有 OpenAI 兼容接口）。需注册阿里云 + 实名认证 + 创建 `DASHSCOPE_API_KEY`。
- **SDK 版本隔离（重要）**：内置 AI 要求 `wx-server-sdk` 3.0.5-beta.1+，而现有 4 个云函数均为 `~2.6.3`，2.x→3.x 有 breaking change（BigInt 序列化行为改变）。**只在 `aiJudge` 这个新函数里用新版 SDK，不得升级现有云函数**，避免连带影响已跑通的 login。
- **密钥管理**：API Key 一律放**云函数环境变量**，**严禁写进代码或提交到 Git 仓库**。
- **有利条件**：AI 调用在云函数内发起，**不受小程序 request 合法域名白名单限制**，无需去公众平台配域名。

#### AI 调用失败的处理（已拍板：提示重试，不自动判责）
- 超时、限流、返回格式错误等失败情况，`applyReturn` 返回 `{ code: -1, msg: '鉴别服务暂不可用，请稍后重试' }`，**订单状态保持不变**（仍为 3 或 4），不写入 `return` 子对象。
- **禁止**失败时降级为「商家责任」——否则服务报错会被利用，买家反复提交即可刷出退款。
- **禁止**失败时转人工判定——与「系统自动终局判定」的拍板结论冲突，且商家端页面已按只读设计。
- 需限制同一订单的售后提交重试次数（建议 5 次/天），防止刷接口。

### 收货地址约定（已拍板：微信地址预填 + 可手动修改）
- 录入方式：默认调 `wx.chooseAddress` 拉取微信地址簿预填，**允许用户手动修改任意字段**。用户拒绝授权时降级为全手动填写，不得阻断下单流程。
- `orders.address` 字段结构固定为：
  ```
  { name, phone, province, city, district, detail, postalCode }
  ```
  其中 `detail` 为街道门牌等详细地址。商家端展示时拼接为 `province + city + district + detail`。
- **必须是快照**：下单时把地址内容完整复制进 `orders.address`，不得只存 users 的引用或 `_id`（见「数据库规范 → 地址快照原则」）。
- `wx.chooseAddress` 返回的 `postalCode` 可能为空串，写入时按空串处理即可，不要因缺失而报错。

### 发货照片约定（已拍板：开发期允许相册）
- **上线要求**：`ship` 页必须用 `wx.chooseMedia` 且 `sourceType: ['camera']`，强制拍照，`count: 3`，不足 3 张禁用提交按钮。
- **开发期降级**：微信开发者工具模拟器**调不起相机**，照此实现会导致同伴 B 写完立刻无法自测。因此开发期用 `sourceType: ['camera', 'album']`，并在代码中加显式 TODO 标记。
- ⚠️ **上线前必须改回 `['camera']`**，这是已知技术债，负责人在验收时检查此项。
- 退货照片（`return-apply` 页）同理：开发期允许相册，上线前评估是否需要强制相机。
- 照片统一 `wx.cloud.uploadFile` 传云存储，数据库只存 `fileID`（符合「图片处理」规范）。展示时用 `wx.cloud.getTempFileURL` 换临时链接。

### 开发期测试数据约定（已拍板：云函数造数据 + 网络占位图）
- 新增 `seedProducts` 云函数，插入 12 条商品，覆盖 `vegetable` / `fruit` / `meat` / `seafood` 四个分类（与 `home.js` 静态分类及 `categories.key` 对齐）。
- 字段严格遵循「数据库规范 → products」，含 `status: 1`、`createTime`（`getProducts` 依赖此字段排序）。
- **图片用网络占位图 URL**（如 `https://picsum.photos/...`），`images` 数组存 URL 而非 fileID。开发者工具需勾选「不校验合法域名」才能显示。
- ⚠️ 这与「图片处理」规范（只存 fileID）**存在冲突，属开发期临时妥协**。上线前必须把商品图换成云存储 fileID，届时 `<image>` 的 src 取值方式也要同步调整。负责人在验收时检查此项。
- 幂等要求：执行前先按 `name` 查重，已存在则跳过，避免反复插入产生脏数据。

### 库存扣减约定（已拍板：下单即扣，事务保护）
- `createOrder` 必须在 `db.startTransaction()` 内完成「库存扣减 + 订单写入」，任一步失败整体回滚。现有代码只校验不扣减（见该文件 TODO），并发下会超卖。
- 扣减用 `_.inc(-count)` 原子写法，**禁止**「先读出来再写回去」。
- 事务内重新校验库存，不足时返回带商品名与剩余库存的明确错误信息。
- 售后「重发货」走 `reshipCount` 累加，**不再二次扣库存**（首次下单时已扣）。

### 商家身份授予约定（已拍板：开发期手改数据库）
- `login` 云函数对新用户一律建档为 `role: 'buyer'`，**不做「申请成为商家」入口**（工作量不值，课程项目无需）。
- 需要商家账号时：云控制台 → `users` 集合 → 把目标记录的 `role` 改为 `seller` → 保存 → 开发者工具「清缓存」→「清除数据缓存」→ 重新编译。
- **答辩演示准备**：需两个微信号各自登录一次（生成两条 users 记录），再把其中一个改成 `seller`。启动页的「手动指定身份」按钮是开发期调试入口，**上线前需移除或隐藏**。

### 已知限制（答辩时主动说明，勿被问住）
1. **驳回无次数上限**：买家可无限次驳回发货照片让商家重拍，流程图该循环无出口。一期不做限制。
2. **售后无时间窗**：已完成订单可在任意时间发起售后，`applyReturn` 不校验时限。一期不做限制。
3. **AI 判定为终局且无申诉入口**：生鲜损坏责任认定本身是行业难题，模型准确率有限，误判无法纠正。一期 mock 规则更是简化实现。若二期接入真 AI，建议同步增加买家申诉 + 管理员仲裁通道。
4. **支付环节不存在**：下单直接进入待发货，无真实资金流转，`totalPrice` 仅为记录值。
5. **开发期技术债**（上线前必须处理，见上文各条 ⚠️ 标记）：发货/退货照片允许相册、商品图用网络占位 URL、启动页手动身份按钮、`updateOrderStatus` 已废弃未删除。

### 越权校验约定
- 买家侧云函数（`confirmShipment` / `confirmReceipt` / `applyReturn` / `resolveReturn`）必须校验订单 `userId === OPENID`。
- 商家侧云函数（`createProduct` / `updateProduct` / `shipOrder`）必须在云函数内查 `users` 集合确认 `role === 'seller'`，**不得信任前端传入的 role**（可被伪造）。
- 商家端订单列表改为 `getSellerOrders` 云函数返回，替代现有前端直查全量订单的写法（当前任何买家都能读到所有订单，属安全缺陷）。

### 团队协作约定
- **分支**：同伴 A 用 `feature/buyer`，同伴 B 用 `feature/seller`，完成后合并回 `main`。
- **目录边界**：A 只改 `sub-buyer/` 与买家侧云函数；B 只改 `sub-seller/` 与商家侧云函数。**互不触碰对方目录**。
- **禁止区**（只有项目负责人能改）：`app.json`、`app.js`、`utils/constant.js`、`utils/format.js`、`CLAUDE.md`、`project.config.json`。新页面由负责人预先注册进 `app.json` 并建好空骨架，同伴只填内容，从根本上避免合并冲突。