// sub-buyer/pages/return-apply/return-apply.js —— 申请售后
//
// 【本次范围：仅页面骨架】
//   表单三项：退货原因输入框、照片选取（本地预览 + 删除）、提交按钮。
//   不含任何云函数调用，也不涉及 aiJudge —— 判责服务由负责人单独开发。
//   提交按钮当前只做本地校验 + 提示，真正的对接位置见 onSubmit 内的 TODO。
//
// 对接说明（aiJudge 就绪后按此接线，本页其余部分无需改动）：
//   1. 逐张 wx.cloud.uploadFile 上传 photos，收集 fileID 数组
//   2. wx.cloud.callFunction({ name: 'applyReturn', data: { orderId, photos: fileIDs } })
//   3. code === 0 时看返回的 liable：
//        true  → 订单转 5「售后中」，买家再到本页选择退款或重发货（resolveReturn）
//        false → 订单自动回退 4「已完成」，order-detail 会展示「售后未通过」
const MAX_REASON_LEN = 200

// 与 applyReturn 云函数的 MAX_PHOTOS 保持一致
const MAX_PHOTOS = 9

Page({
  data: {
    // 由 order-detail 传入，提交时要带给 applyReturn
    orderId: '',
    reason: '',
    photos: [],
    maxPhotos: MAX_PHOTOS,
    reasonMaxLen: MAX_REASON_LEN,
    submitting: false
  },

  onLoad(options) {
    this.setData({ orderId: (options && options.id) || '' })
  },

  onReasonInput(e) {
    const value = e.detail.value || ''
    // 超长直接截断，不弹提示打断输入
    this.setData({ reason: value.slice(0, MAX_REASON_LEN) })
  },

  /**
   * 选取退货照片。
   *
   * TODO(上线前)：按 CLAUDE.md「发货照片约定」，退货照片上线前需评估是否强制相机。
   * 若要强制，把 sourceType 改成 ['camera']。开发期保留 'album'，
   * 因为开发者工具模拟器调不起相机，否则本页写完立刻无法自测。
   */
  onChoosePhoto() {
    const remain = MAX_PHOTOS - this.data.photos.length
    if (remain <= 0) {
      wx.showToast({ title: `最多上传 ${MAX_PHOTOS} 张`, icon: 'none' })
      return
    }

    wx.chooseMedia({
      count: remain,
      mediaType: ['image'],
      sourceType: ['camera', 'album'],
      sizeType: ['compressed'],
      success: (res) => {
        const picked = (res.tempFiles || [])
          .map((file) => file.tempFilePath)
          .filter(Boolean)
        if (!picked.length) return

        this.setData({ photos: this.data.photos.concat(picked).slice(0, MAX_PHOTOS) })
      },
      fail: (err) => {
        // 用户主动取消不算错误，不打扰
        if (err && err.errMsg && err.errMsg.indexOf('cancel') !== -1) return
        console.error('[FreshBuy] 选取退货照片失败', err)
        wx.showToast({ title: '选取照片失败', icon: 'none' })
      }
    })
  },

  onPreview(e) {
    const src = e.currentTarget.dataset.src
    if (!src) return
    wx.previewImage({ current: src, urls: this.data.photos })
  },

  onRemovePhoto(e) {
    const index = Number(e.currentTarget.dataset.index)
    const photos = this.data.photos.slice()
    if (index < 0 || index >= photos.length) return

    photos.splice(index, 1)
    this.setData({ photos })
  },

  onSubmit() {
    if (this.data.submitting) return

    // ---- 本地校验：与 applyReturn 的入参要求对齐（照片至少 1 张、最多 9 张）----
    if (!this.data.photos.length) {
      wx.showToast({ title: '请至少上传 1 张退货照片', icon: 'none' })
      return
    }
    if (!this.data.reason.trim()) {
      wx.showToast({ title: '请填写退货原因', icon: 'none' })
      return
    }

    // ---- TODO(aiJudge 就绪后对接，其余逻辑本页已就绪) ----
    // this.setData({ submitting: true })
    // const fileIDs = await uploadPhotos(this.data.photos)   // wx.cloud.uploadFile 逐张传
    // const res = await wx.cloud.callFunction({
    //   name: 'applyReturn',
    //   data: { orderId: this.data.orderId, photos: fileIDs }
    // })
    // const result = res.result || {}
    // if (result.code !== 0) { wx.showToast({ title: result.msg || '提交失败', icon: 'none' }); return }
    // wx.showToast({ title: result.msg, icon: 'none' })   // 「判定为商家责任」/「售后未通过」
    // wx.navigateBack()                                   // 由 order-detail 重新拉取状态
    //
    // ⚠️ 对接前必须解决的一点：applyReturn 当前只接收 { orderId, photos }，
    //    **没有 reason 字段**，退货原因不会被落库。若要保留，需在 applyReturn 内
    //    把它写进 return 子对象（如 return.applyReason）。
    //    本页不擅自改云函数，故 reason 目前仅存在于本页表单状态中。
    wx.showModal({
      title: '表单校验通过',
      content: '退货申请提交流程待接入：applyReturn 云函数已就绪，需等 aiJudge 判责服务完成后对接。',
      showCancel: false
    })
  }
})
