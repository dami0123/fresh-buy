// cloudfunctions/login —— 登录鉴权
// 通过 getWXContext 拿到可信的 OPENID（不信任前端传入），据此查询 users 集合中的角色。
// 首次登录的用户自动落库为买家（role = 'buyer'）。
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const users = db.collection('users')

exports.main = async () => {
  const { OPENID, APPID, UNIONID } = cloud.getWXContext()

  try {
    const res = await users.where({ openid: OPENID }).limit(1).get()

    // 已注册用户：直接返回其身份
    if (res.data.length > 0) {
      const userInfo = res.data[0]
      return {
        code: 0,
        openid: OPENID,
        role: userInfo.role || 'buyer',
        userInfo
      }
    }

    // 新用户：创建默认买家记录
    const now = new Date()
    const newUser = {
      openid: OPENID,
      appid: APPID,
      unionid: UNIONID || '',
      role: 'buyer', // 商家身份需由管理端手动改为 'seller'
      phone: '',
      avatar: '',
      createTime: now,
      updateTime: now
    }

    const addRes = await users.add({ data: newUser })

    return {
      code: 0,
      openid: OPENID,
      role: newUser.role,
      userInfo: { ...newUser, _id: addRes._id }
    }
  } catch (err) {
    console.error('[login] 登录失败', err)
    return {
      code: -1,
      msg: '登录失败，请确认 users 集合已创建且权限配置正确',
      openid: OPENID // 即使数据库异常也返回 openid，便于前端定位问题
    }
  }
}
