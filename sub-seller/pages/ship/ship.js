// sub-seller/pages/ship/ship.js —— 发货拍照
// 【空骨架】由负责人预建，页面逻辑由同伴 B 填充。
// 本页职责：wx.chooseMedia 拍 3 张发货照片，不足 3 张禁用提交按钮。
//   TODO(上线前必改)：开发期 sourceType 用 ['camera', 'album']，因为开发者工具模拟器调不起相机；
//   上线前必须改回 ['camera'] 强制拍照。见 CLAUDE.md「发货照片约定」。
// 提交调 shipOrder 云函数，入参 { orderId, photos[3] }，成功后订单状态 1 -> 2。
Page({
  data: {},

  onLoad() {}
})
