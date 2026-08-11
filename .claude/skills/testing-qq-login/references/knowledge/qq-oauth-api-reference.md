# QQ互联 API 参考

## OAuth 2.0 端点

| 端点 | URL | 说明 |
|------|-----|------|
| 授权端点 | `https://graph.qq.com/oauth2.0/authorize` | 用户授权，获取 authorization code |
| Token 端点 | `https://graph.qq.com/oauth2.0/token` | 用 code 换取 access_token |
| OpenID 端点 | `https://graph.qq.com/oauth2.0/me` | 获取当前用户 openid |
| 用户信息 | `https://graph.qq.com/user/get_user_info` | 获取用户昵称、头像等 |

---

## 1. 授权端点 (authorize)

```
GET https://graph.qq.com/oauth2.0/authorize
```

| 参数 | 必填 | 说明 |
|------|------|------|
| `response_type` | 是 | 固定值 `code` |
| `client_id` | 是 | 应用 appId |
| `redirect_uri` | 是 | URL 编码的回调地址，必须与应用注册时完全一致 |
| `state` | 强烈建议 | 随机字符串，防 CSRF，回调时需校验 |
| `scope` | 否 | 授权范围，默认 `get_user_info`，多个用逗号分隔 |
| `display` | 否 | 仅 PC 网站接入有效，`mobile` 表示移动端 |

**示例：**
```
https://graph.qq.com/oauth2.0/authorize
  ?response_type=code
  &client_id=123456789
  &redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fapi%2Fqq%2Fcallback
  &state=a1b2c3d4e5f6
  &scope=get_user_info
```

**用户取消时回调：** `redirect_uri?error_code=200015&error_description=user cancel`

---

## 2. Token 端点 (token)

```
GET/POST https://graph.qq.com/oauth2.0/token
```

| 参数 | 必填 | 说明 |
|------|------|------|
| `grant_type` | 是 | 固定值 `authorization_code` |
| `client_id` | 是 | 应用 appId |
| `client_secret` | 是 | 应用 appKey（**仅服务器端使用**） |
| `code` | 是 | 上一步获取的授权码（一次性，用完即失效） |
| `redirect_uri` | 是 | 必须与上一步一致 |

**成功响应（query string 格式，非 JSON）：**
```
access_token=FE04F255A5C8E5F6A2D6E5B7C8D9E0F1&expires_in=7776000&refresh_token=REFRESH_TOKEN
```

| 字段 | 说明 |
|------|------|
| `access_token` | 访问令牌，约 30 天～3 个月有效 |
| `expires_in` | 有效期（秒） |
| `refresh_token` | 刷新令牌 |

> ⚠️ 响应是 query string 格式，不是 JSON。需要手动解析键值对。

**常见错误：**
```
error=100002&error_description=missing client_secret
```

---

## 3. OpenID 端点 (me)

```
GET https://graph.qq.com/oauth2.0/me
```

| 参数 | 必填 | 说明 |
|------|------|------|
| `access_token` | 是 | 上一步获取的 access_token |
| `unionid` | 否 | 传 `1` 表示同时获取 unionid（需单独申请权限） |
| `fmt` | 否 | 传 `json` 返回纯 JSON；**不传则默认返回 JSONP 格式** |

**默认响应（JSONP 格式）：**
```javascript
callback( {"client_id":"YOUR_APPID","openid":"YOUR_OPENID"} );
```

**使用 `?fmt=json` 时（纯 JSON）：**
```json
{"client_id":"YOUR_APPID","openid":"YOUR_OPENID"}
```

**带 unionid：**
```json
{
    "client_id": "YOUR_APPID",
    "openid": "YOUR_OPENID",
    "unionid": "YOUR_UNIONID"
}
```

### JSONP 解析

由于默认返回 JSONP，必须手动解析。**不要使用 `eval()`**。

```typescript
// 推荐：正则提取 JSON 部分
function parseJsonp(jsonp: string): string {
  const match = jsonp.match(/^\w+\(\s*(.+?)\s*\)[;]?$/);
  if (!match) throw new Error('Invalid JSONP response');
  return match[1];
}

const jsonStr = parseJsonp(response);
const { openid, client_id } = JSON.parse(jsonStr);
```

> 建议在请求 OpenID 端点时统一加 `?fmt=json` 参数，避免 JSONP 解析问题。

### OpenID 与 UnionID

| 标识 | 说明 |
|------|------|
| **openid** | 用户在每个应用下的唯一标识，**同一用户不同应用的 openid 不同** |
| **unionid** | 同一开发者名下多应用打通后的统一标识，**不同应用的 unionid 相同**（需申请，最多 60 个应用打通） |

> unionid 至少 36 字节，建议数据库字段预留 64 字节。

---

## 4. 用户信息端点 (get_user_info)

```
GET https://graph.qq.com/user/get_user_info
```

| 参数 | 必填 | 说明 |
|------|------|------|
| `access_token` | 是 | 有效的 access_token |
| `oauth_consumer_key` | 是 | 应用 appId |
| `openid` | 是 | 用户的 openid |

**成功响应：**
```json
{
    "ret": 0,
    "msg": "",
    "nickname": "用户昵称",
    "figureurl": "http://qzapp.qlogo.cn/qzapp/.../30",
    "figureurl_1": "http://qzapp.qlogo.cn/qzapp/.../50",
    "figureurl_2": "http://qzapp.qlogo.cn/qzapp/.../100",
    "figureurl_qq_1": "http://thirdqq.qlogo.cn/.../40",
    "figureurl_qq_2": "http://thirdqq.qlogo.cn/.../100",
    "gender": "男",
    "is_yellow_vip": "0",
    "vip": "0",
    "yellow_vip_level": "0",
    "level": "0",
    "is_yellow_year_vip": "0",
    "country": "中国",
    "province": "广东",
    "city": "深圳",
    "year": "1990"
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `ret` | number | 返回码，0 为成功 |
| `msg` | string | 错误信息 |
| `nickname` | string | 用户 QQ 空间昵称 |
| `figureurl` | string | 30×30 像素头像 URL |
| `figureurl_1` | string | 50×50 像素头像 URL |
| `figureurl_2` | string | 100×100 像素头像 URL |
| `figureurl_qq_1` | string | 40×40 像素 QQ 头像 URL |
| `figureurl_qq_2` | string | 100×100 像素 QQ 头像 URL |
| `gender` | string | 性别（"男"/"女"，获取不到默认"男"） |
| `is_yellow_vip` | string | 是否黄钻（"0"/"1"） |
| `vip` | string | 是否 QQ 会员（"0"/"1"） |
| `yellow_vip_level` | string | 黄钻等级 |
| `level` | string | QQ 等级 |
| `is_yellow_year_vip` | string | 是否年费黄钻 |
| `country` | string | ⚠️ 2022年后固定返回 "中国" |
| `province` | string | ⚠️ 2022年后固定返回 "广东" |
| `city` | string | ⚠️ 2022年后固定返回 "深圳" |
| `year` | string | ⚠️ 2022年后固定返回 "1990" |

### ⚠️ 隐私保护改造（2022年1月8日起生效）

以下字段不再返回用户真实数据，而是返回固定默认值：
- `country` → 固定 "中国"
- `province` → 固定 "广东"
- `city` → 固定 "深圳"
- `year` → 固定 "1990"

此为腾讯后台变更，无需更新 SDK。**不要在 UI 中依赖这些字段展示用户真实地理位置/年龄。**

---

## 5. 其他 API（需单独申请权限）

| API | 端点 | 功能 | 权限要求 |
|-----|------|------|----------|
| 会员信息 | `/user/get_vip_info` | QQ 会员基本信息 | 需申请 |
| 高级会员信息 | `/user/get_vip_rich_info` | QQ 会员高级信息 | 需申请 |
| 相册列表 | `/photo/list_album` | 获取 QQ 空间相册 | 需申请 |
| 上传照片 | `/photo/upload_pic` | 上传到 QQ 空间 | 需申请 |
| 新建相册 | `/photo/add_album` | 创建相册 | 需申请 |
| 发表说说 | `/shuoshuo/add_topic` | 发表 QQ 空间说说 | 需申请 |

---

## Scope 参数

`scope` 用于指定授权范围，多个接口用逗号分隔：

```
// 仅获取用户信息（默认）
scope=get_user_info

// 请求多个权限
scope=get_user_info,list_album,upload_pic,do_like
```

> 注意：授权项越多，用户越可能拒绝授权。只传入实际需要的接口。除 `get_user_info` 外大部分 API 需单独向腾讯申请权限。

---

## 参考来源

- QQ互联 API 列表: https://wiki.connect.qq.com/api列表
- OAuth 2.0 授权流程: https://wiki.connect.qq.com/oauth2-0简介
- 获取用户 OpenID: https://wiki.connect.qq.com/获取用户openid_oauth2-0
- 隐私保护改造: https://wiki.connect.qq.com/【qq互联】个人隐私保护改造-2
- SDK 下载: https://wiki.connect.qq.com/sdk下载
