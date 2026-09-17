// sub-buyer/pages/return-apply/return-apply.js —— 退货申请 / 售后
// 【空骨架】由负责人预建，页面逻辑由同伴 A 填充。
// 本页职责：
//   上传退货照片 -> 调 applyReturn（内部同步调 aiJudge）
//   展示 return.aiResult 与 return.liable
//   liable=true 时展示「退款 / 重发」选择，调 resolveReturn
//   liable=false 时展示「售后未通过」与理由（订单已自动回退到 4）
Page({
  data: {},

  onLoad() {}
})
