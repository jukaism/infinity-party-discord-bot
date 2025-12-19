import type { ValidatedEventAPIGatewayProxyEvent } from '@libs/api-gateway'
import { formatJSONResponse } from '@libs/api-gateway'
import { Assignment, assignTasks, TaskAndLimit } from '@libs/assign'
// import { chunkString } from '@libs/chunkString'
import { middyfy } from '@libs/lambda'
import {
  InteractionResponseType,
  InteractionType,
  verifyKey,
} from 'discord-interactions'
import * as discordJs from 'discord.js'
import * as fb from 'firebase-admin'
import fetch from 'node-fetch'
import schema from './schema'
import * as config from '../../../config.json'

const token = config.discord.token
const appId = config.discord.appId
const rest: discordJs.REST = new discordJs.REST({ version: '10' }).setToken(
  token,
)

const sa: fb.ServiceAccount = {
  projectId: config.firebase.serviceAccount.projectId,
  privateKey: config.firebase.serviceAccount.privateKey,
  clientEmail: config.firebase.serviceAccount.clientEmail,
}

fb.initializeApp({ credential: fb.credential.cert(sa) })
const store = fb.firestore()
const channelRef = store.collection('channel')

const pinMessage = async (
  channelId: string,
  messageId: string,
): Promise<any> => {
  return await rest.put(discordJs.Routes.channelPin(channelId, messageId))
}
const postMessage = async (channelId: string, body: object): Promise<any> => {
  return await rest.post(discordJs.Routes.channelMessages(channelId), {
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    appendToFormData: true,
    passThroughBody: true,
  })
}
const patchMessage = async (
  channelId: string,
  messageId: string,
  body: object,
): Promise<any> => {
  return await rest.patch(
    discordJs.Routes.channelMessage(channelId, messageId),
    {
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      appendToFormData: true,
      passThroughBody: true,
    },
  )
}

const patchChannel = async (
  channelId: string,
  body: string,
): Promise<boolean> => {
  return new Promise<boolean>((resolve) => {
    fetch(discordJs.RouteBases.api + discordJs.Routes.channel(channelId), {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bot ${token}`,
      },
      body,
    })
      .then((response) => {
        if (response.ok) {
          resolve(true)
        } else {
          resolve(false)
          console.error(response)
        }
      })
      .catch((_) => {
        console.error('errord: patchChannel failed')
        resolve(false)
      })
  })
}
const noticeOrganization = async (
  channelId: string,
  composeId: string,
  organization: Organization,
  withPost: boolean,
): Promise<string | null> => {
  await channelRef.doc(channelId).update({ noticed: true })
  const prefix = withPost ? '規定人数に到達しました。' : ''
  let memberSatisfied = `${prefix}各メンバーは一度編成を確認してください。`
  const crushers = organization.members.filter((m) => !m.satisfied) // ここでは満足の対義語
  if (0 < crushers.length) {
    memberSatisfied += `\n\n希望が満たされなかったメンバーがいます。必要に応じて変更・交渉等を行って下さい。\n${crushers
      .map((c) => `<@${c.id}>`)
      .join('')}\nその他のメンバーも今後の変更に気を付けて下さい。`
  } else {
    memberSatisfied += `\nなお、希望が満たされなかったメンバーはいませんでした。`
  }
  const channel = await rest.get(discordJs.Routes.channel(channelId))
  const channelName: string = (channel as any).name
  if (typeof channelName === 'string') {
    const numex = /^＠[0-9]+/
    const newName =
      '＠編成中' + channelName.replace(numex, '').replace('＠編成中', '')
    if (channelName !== newName) {
      await patchChannel(channelId, JSON.stringify({ name: newName }))
    }
  }
  if (withPost) {
    await postMessage(channelId, {
      content: memberSatisfied,
      message_reference: {
        message_id: composeId,
      },
    })
    return null
  } else {
    return JSON.stringify({
      content: memberSatisfied,
    })
  }
}

const unauthorized = {
  statusCode: 401,
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ message: 'Unauthorized' }),
}
const PONG = {
  statusCode: 200,
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ type: InteractionResponseType.PONG }),
}
const publicKey = config.discord.publicKey

const registration: ValidatedEventAPIGatewayProxyEvent<typeof schema> = async (
  event,
) => {
  if ((event as unknown as any).source === 'serverless-plugin-warmup') {
    return PONG
  }
  const body: SlashCommandInteraction = event.body as any
  const channelId = body.channel_id

  try {
    let next: BodyWithNext | string = ''
    if (body.type === InteractionType.APPLICATION_COMMAND) {
      const postResult = await postMessage(channelId, {
        content: formatParty([]).string,
      })
      await channelRef.doc(channelId).set({
        commander: body.member.user.id,
        compose: postResult.id,
      })
      await pinMessage(channelId, postResult.id)
      next = participationMessage()
    } else {
      next = await buildNextMessage(body)
    }
    const responseBody = typeof next === 'string' ? next : next.bodyString
    const deleteNext = typeof next === 'string' ? false : next.delete
    const MAX_RETRY = 20
    let retryCount = 0
    let status = 200
    do {
      try {
        status = 200
        await rest.post(`/webhooks/${appId}/${body.token}`, {
          headers: {
            'Content-Type': 'application/json',
          },
          body: responseBody,
          appendToFormData: true,
          passThroughBody: true,
        })
      } catch (err) {
        if (err.status === 404) {
          status = 404
          retryCount++
          await new Promise((resolve) => setTimeout(resolve, 500))
        }
      }
    } while (retryCount < MAX_RETRY && status === 404)

    const ref = (body as any).message?.id
    if (deleteNext && ref) {
      await rest.delete(discordJs.Routes.channelMessage(channelId, ref))
    }
    const users = await channelRef
      .doc(channelId)
      .collection('users')
      .orderBy('joined', 'asc')
      .get()
    if (12 < users.docs.length) {
      const overed = users.docs.slice(12)
      for await (const u of overed) {
        await channelRef.doc(channelId).collection('users').doc(u.id).delete()
        await postMessage(channelId, {
          content: `定員オーバーです。${
            u.data().name
          }さんの情報は削除されました。`,
        })
      }
    }
    if (
      body.type !== InteractionType.APPLICATION_COMMAND &&
      typeof next !== 'string' &&
      !!next.updateParty
    ) {
      const ch = await channelRef.doc(channelId).get()
      const composeId = ch.data().compose
      const twelves = users.docs.slice(0, 12)
      const organization = formatParty(
        twelves.map((doc): User => {
          const u = doc.data() as User
          return {
            id: doc.id,
            name: u.name,
            roles: u.roles,
            routes: u.routes,
          }
        }),
      )
      const content: string = organization.string
      await patchMessage(channelId, composeId, {
        content,
      })
      const userCount = users.docs.length
      if (10 <= userCount) {
        await postMessage(channelId, {
          content: `現在${userCount}枠決定です。`,
          message_reference: {
            message_id: composeId,
          },
        })
        if (12 === userCount && !ch.data().noticed) {
          await noticeOrganization(channelId, composeId, organization, true)
        }
      }
    }
    return { statusCode: 201, body: '' }
  } catch (err) {
    console.error(err)
    return {
      statusCode: 500,
      body: JSON.stringify({ message: 'Unknown error' }),
    }
  }
}

interface User {
  id: string
  name: string
  roles: string
  routes: string
}
interface Member {
  id: string
  routeSatisfied: boolean
  roleSatisfied: boolean
  satisfied: boolean
}
interface Organization {
  string: string
  members: Member[]
}
const formatParty = (users: User[]): Organization => {
  const roleLikes = users.map((u) => u.roles.split(','))
  const roleAssign: Assignment[] = assignTasks(roleLikes, roleLimits)
  const routeLikes = users.map((u) => u.routes.split(','))
  const routeAssign: Assignment[] = assignTasks(routeLikes, routeLimits)
  const routeWithUser: RouteWithUser[] = routeAssign.map((a) => {
    const userIndex = typeof a[1][0] === 'number' ? a[1][0] : -1
    const targetUser = users[userIndex]
    return {
      uid: !!targetUser ? targetUser.id : '',
      route: a[0],
      userIndex,
    }
  })
  const userRouteRole: UserRouteRole[] = routeWithUser.map((rwu) => {
    const userExists = 0 <= rwu.userIndex
    const name = userExists ? users[rwu.userIndex].name : ''
    const targetRoleAssign = roleAssign.find((ra) =>
      ra[1].includes(rwu.userIndex),
    )
    const role = !!targetRoleAssign ? targetRoleAssign[0] : '未定'
    return {
      uid: rwu.uid,
      name,
      route: rwu.route,
      role,
    }
  })
  const members: Member[] = users.map((u) => {
    const assigned = userRouteRole.find((rwu) => rwu.uid === u.id)
    const routeSatisfied =
      u.routes === 'All' || u.routes.split(',').includes(assigned.route)
    const roleSatisfied =
      u.roles === 'All' || u.roles.split(',').includes(assigned.role)
    return {
      id: u.id,
      routeSatisfied,
      roleSatisfied,
      satisfied: routeSatisfied && roleSatisfied,
    }
  })
  const walls = userRouteRole.filter((u) => u.role === 'Wall')
  const mapTraps = userRouteRole.filter((u) => u.role === 'MapTrap')
  const s40 = userRouteRole.filter((u) => u.role === 'S40')
  const s50 = userRouteRole.filter((u) => u.role === 'S50')
  const routeText = userRouteRole
    .map((urr) => {
      return `ルート${urr.route} - ${urr.name}${routeBrokenSuffix(
        members,
        urr,
      )}`
    })
    .join('\n')
  const roleText = `壁 - ${walls
    .map((urr) => urr.name + roleBrokenSuffix(members, urr))
    .join(', ')}\n地図罠 - ${mapTraps
    .map((urr) => urr.name + roleBrokenSuffix(members, urr))
    .join(', ')}\n聖域40 - ${s40
    .map((urr) => urr.name + roleBrokenSuffix(members, urr))
    .join(', ')}\n聖域50 - ${s50
    .map((urr) => urr.name + roleBrokenSuffix(members, urr))
    .join(', ')}`
  const string = '```' + routeText + '\n' + roleText + '```'
  return {
    string,
    members,
  }
}

const roleBrokenSuffix = (members: Member[], urr: UserRouteRole): string => {
  const roleSatisfied = members.find((u) => u.id === urr.uid)?.roleSatisfied
  return roleSatisfied !== false ? '' : '💔'
}
const routeBrokenSuffix = (members: Member[], urr: UserRouteRole): string => {
  const routeSatisfied = members.find((u) => u.id === urr.uid)?.routeSatisfied
  return routeSatisfied !== false ? '' : '💔'
}

interface RouteWithUser {
  uid: string
  route: string
  userIndex: number
}
interface UserRouteRole {
  uid: string
  name: string
  route: string
  role: string
}

interface BodyWithNext {
  bodyString: string
  delete: boolean
  updateParty?: boolean
}
const buildNextMessage = async (
  interaction: SlashCommandInteraction | MessageInteraction,
): Promise<string | BodyWithNext> => {
  const editorId = interaction.member.user.id
  const customId = interaction.data.custom_id
  const channelId = interaction.channel_id
  const userRef = channelRef.doc(channelId).collection('users').doc(editorId)
  const editingUserRef = channelRef
    .doc(channelId)
    .collection('editingUsers')
    .doc(editorId)
  if (interaction.type === InteractionType.MESSAGE_COMPONENT) {
    if (customId.endsWith(editorId)) {
      if (customId.startsWith('role_')) {
        const selectedRoles: string[] = (interaction as any).data.values
        const roles = selectedRoles.includes('All')
          ? 'All'
          : selectedRoles.join()
        const roleInfo = roles.includes('All')
          ? 'All'
          : roleLimits
              .filter((r) => roles.includes(r[0]))
              .map((r) => roleDisplays[r[0]])
              .join()
        await editingUserRef.update({ roles })
        const prefix = `希望ロール: ${roleInfo}`
        return { bodyString: routeMessage(editorId, prefix), delete: true }
      } else if (customId.startsWith('route_')) {
        const selectedRoutes: string[] = (interaction as any).data.values
        const routeNumbers = selectedRoutes.map((route) =>
          route.replace(/\D/g, ''),
        )
        const routes = selectedRoutes.includes('All')
          ? 'All'
          : routeNumbers.slice().sort().join()
        await editingUserRef.update({ routes })
        const editingUser = await editingUserRef.get()
        const exists = await userRef.get()
        const displayName = editingUser.data().name
        const roles = editingUser.data().roles
        const roleInfo = roles.includes('All')
          ? 'All'
          : roleLimits
              .filter((r) => roles.includes(r[0]))
              .map((r) => roleDisplays[r[0]])
              .join()
        if (exists.exists) {
          // 変更
          await userRef.update(editingUser.data())
          return {
            bodyString: JSON.stringify({
              content: `<@${editorId}>${displayName}さんの登録変更を受け付けました。\n希望ロール: ${roleInfo}\n希望ルート: ${routes}`,
            }),
            delete: true,
            updateParty: true,
          }
        } else {
          // 新規
          await userRef.set({
            ...editingUser.data(),
            joined: new Date().getTime(),
          })
          return {
            bodyString: JSON.stringify({
              content: `<@${editorId}>${displayName}さんの参加を受け付けました。\n希望ロール: ${roleInfo}\n希望ルート: ${routes}`,
            }),
            delete: true,
            updateParty: true,
          }
        }
      }
    } else {
      return invalidUserError(editorId)
    }
  } else if (interaction.type === InteractionType.MODAL_SUBMIT) {
    const user = await userRef.get()
    const input_value = (
      interaction as MessageInteraction
    ).data.components[0].components[0].value.replaceAll('/', '')
    if (customId == 'member_join_modal') {
      if (user.exists) {
        return alreadyParticipatedError(editorId)
      }

      await editingUserRef.set({
        name: input_value,
      })
      const prefix = `${input_value}さんですね。`
      return roleMessage(editorId, prefix)
    } else if (customId == 'member_edit_modal') {
      if (!user.exists) {
        return notParticipatedError(editorId)
      }

      await editingUserRef.set({
        name: input_value,
      })
      const prefix = `${input_value}さんですね。`
      return roleMessage(editorId, prefix)
    } else if (customId == 'member_exit_modal') {
      if (!user.exists) {
        return notParticipatedError(editorId)
      }
      const name = user.data().name || '誰か'
      await userRef.delete()
      return {
        bodyString: JSON.stringify({
          content: `${name}さんが脱退しました。\n理由: ${input_value}`,
        }),
        delete: false,
        updateParty: true,
      }
    } else if (customId == 'member_kick_modal') {
      const commander = await channelRef.doc(channelId).get()
      if (commander.data()?.commander !== editorId) {
        return notCommanderError(editorId)
      }
      const targetUsers = await channelRef
        .doc(channelId)
        .collection('users')
        .where('name', '==', input_value)
        .limit(1)
        .get()
      if (targetUsers.empty) {
        return userNotFoundError(editorId)
      }
      const targetUser = targetUsers.docs[0]
      const targetUserRef = channelRef
        .doc(channelId)
        .collection('users')
        .doc(targetUser.id)
      await targetUserRef.delete()
      return {
        bodyString: JSON.stringify({
          content: `${input_value}さんが除名されました。`,
        }),
        delete: false,
        updateParty: true,
      }
    } else if (customId === 'management_modal') {
      const commander = await channelRef.doc(channelId).get()
      if (commander.data()?.commander !== editorId) {
        return notCommanderError(editorId)
      }

      // 複数カンマ区切りを許可: 入力を分割して全件検証する（形式チェック -> ルート番号チェック -> ロールチェック）
      const rawInputs: string[] = (input_value || '')
        .split(',')
        .map((s: string) => s.trim())
        .filter((s: string) => s.length > 0)

      if (rawInputs.length === 0) {
        return JSON.stringify({
          content:
            '入力が空です。正しい形式: 名前-ルート番号-ロール\n例: 富士-01-壁',
        })
      }

      const allowedRoutes = routeLimits.map((r) => r[0])

      let invalidRaw = ''
      let invalidReason: 'format' | 'route' | 'role' | null = null

      const roleKeyMap: { [key: string]: string } = {
        壁: 'Wall',
        地図罠: 'MapTrap',
        '40': 'S40',
        '50': 'S50',
        聖域40: 'S40',
        聖域50: 'S50',
      }
      const allowedRoleNames = Object.keys(roleKeyMap)
      const reserves: (User & { joined: 0 })[] = []
      const hasInvalid = rawInputs.some((raw) => {
        if (!/^(.+)-([0-9]{2})-(.+)$/.test(raw)) {
          invalidRaw = raw
          invalidReason = 'format'
          return true
        }
        const m = /^(.+)-([0-9]{2})-(.+)$/.exec(raw)
        const name = m[1].trim()
        if (!m) {
          invalidRaw = raw
          invalidReason = 'format'
          return true
        }
        const routeNumber = m[2]
        if (!allowedRoutes.includes(routeNumber)) {
          invalidRaw = routeNumber
          invalidReason = 'route'
          return true
        }
        const roleRaw = m[3].trim()
        if (!allowedRoleNames.includes(roleRaw)) {
          invalidRaw = roleRaw
          invalidReason = 'role'
          return true
        }
        reserves.push({
          joined: 0,
          id: `reserve${name}`,
          name,
          routes: routeNumber,
          roles: roleKeyMap[roleRaw] || '',
        })
        return false
      })
      if (hasInvalid) {
        if (invalidReason === 'format') {
          return JSON.stringify({
            content: `入力形式が不正です: "${invalidRaw}"。正しい形式: 名前-ルート番号-ロール\n例: 富士-01-壁`,
          })
        } else if (invalidReason === 'route') {
          return JSON.stringify({
            content: `無効なルート番号です: "${invalidRaw}"。使用可能な記載: ${allowedRoutes.join(
              ', ',
            )}`,
          })
        } else {
          return JSON.stringify({
            content: `無効なロールです: "${invalidRaw}"。使用可能な記載: ${allowedRoleNames.join(
              ', ',
            )}`,
          })
        }
      }
      for await (const reserve of reserves) {
        await channelRef
          .doc(channelId)
          .collection('users')
          .doc(reserve.id)
          .set(reserve)
      }

      // 成功レスポンス
      return {
        bodyString: JSON.stringify({
          content: `枠管理を受け付けました。`,
        }),
        delete: false,
        updateParty: true,
      }
    } else if (customId === 'member_organization_modal') {
      if (input_value === 'はい') {
        const users = await channelRef
          .doc(channelId)
          .collection('users')
          .orderBy('joined', 'asc')
          .get()
        const ch = await channelRef.doc(channelId).get()
        const composeId = ch.data().compose
        const twelves = users.docs.slice(0, 12)
        const organization = formatParty(
          twelves.map((doc): User => {
            const u = doc.data() as User
            return {
              id: doc.id,
              name: u.name,
              roles: u.roles,
              routes: u.routes,
            }
          }),
        )
        const message = await noticeOrganization(
          channelId,
          composeId,
          organization,
          false,
        )
        return message
      } else {
        return JSON.stringify({
          content: '「はい」が入力されなかったため、告知をキャンセルしました。',
        })
      }
    }
  }

  return JSON.stringify({ content: `hey! ${interaction.member.user.username}` })
}

const getUserCount = async (channelId: string): Promise<number> => {
  const users = await channelRef.doc(channelId).collection('users').get()
  return users.size
}

const alreadyParticipatedError = (userId: string): string => {
  return JSON.stringify({
    content: `<@${userId}>あなたは既に参加しています。`,
  })
}
const notParticipatedError = (userId: string): string => {
  return JSON.stringify({
    content: `<@${userId}>あなたは参加していません。`,
  })
}
const notCommanderError = (userId: string): string => {
  return JSON.stringify({
    content: `<@${userId}>あなたは募集主ではありません。`,
  })
}
const userNotFoundError = (userId: string): string => {
  return JSON.stringify({
    content: `<@${userId}>該当者が見付かりませんでした。`,
  })
}
const invalidUserError = (userId: string): string => {
  return JSON.stringify({
    content: `<@${userId}>ユーザが違います。`,
  })
}

const roleDisplays = {
  All: 'All',
  Wall: '壁',
  MapTrap: '地図罠',
  S40: '聖域40',
  S50: '聖域50',
}

const roleLimits: TaskAndLimit[] = [
  ['Wall', 1],
  ['MapTrap', 3],
  ['S40', 4],
  ['S50', 4],
]
const routeLimits: TaskAndLimit[] = [
  ['01', 1],
  ['02', 1],
  ['03', 1],
  ['04', 1],
  ['05', 1],
  ['06', 1],
  ['07', 1],
  ['08', 1],
  ['09', 1],
  ['10', 1],
  ['11', 1],
  ['12', 1],
]

const participationMessage = (): string => {
  const message = {
    content: '参加登録・変更は以下のボタンから行って下さい。',
    components: [
      {
        type: 1,
        components: [
          {
            type: 2,
            label: '参加する',
            style: 1,
            custom_id: 'member_join',
          },
          {
            type: 2,
            label: '登録変更',
            style: 3,
            custom_id: 'member_edit',
          },
          {
            type: 2,
            label: '脱退する',
            style: 2,
            custom_id: 'member_exit',
          },
          {
            type: 2,
            label: '除名する',
            style: 4,
            custom_id: 'member_kick',
          },
          {
            type: 2,
            label: '枠管理',
            style: 2,
            custom_id: 'management',
          },
          // {
          //   type: 2,
          //   label: '編成告知',
          //   style: 2,
          //   emoji: {
          //     id: null,
          //     name: '✅',
          //   },
          //   custom_id: 'member_organization',
          // },
        ],
      },
    ],
  }
  return JSON.stringify(message)
}

const roleMessage = (userId: string, prefix: string): string => {
  const message = {
    content: `<@${userId}>\n${prefix}\n希望ロールを3つまで選択してください。`,
    components: [
      {
        type: 1,
        components: [
          {
            type: 3,
            custom_id: `role_${userId}`,
            options: [
              {
                label: 'どれでもOK',
                value: 'All',
                description: '壁になる可能性もあります。',
              },
              {
                label: '壁',
                value: 'Wall',
                description: '1人。スクロールは自由に使える。',
              },
              {
                label: '地図・罠',
                value: 'MapTrap',
                description: '3人。主に地図表示・罠解除を行う。',
              },
              {
                label: '聖域40',
                value: 'S40',
                description: '4人。主に40番に聖域展開を行う。',
              },
              {
                label: '聖域50',
                value: 'S50',
                description: '4人。主に50番に聖域展開を行う。',
              },
            ],
            placeholder: 'Choose a role',
            min_values: 1,
            max_values: 3,
          },
        ],
      },
    ],
  }
  return JSON.stringify(message)
}

const routeMessage = (userId: string, prefix: string): string => {
  const message = {
    content: `<@${userId}>\n${prefix}\nルートを6つまで選択してください。`,
    components: [
      {
        type: 1,
        components: [
          {
            type: 3,
            custom_id: `route_${userId}`,
            options: [
              {
                label: 'どこでもOK',
                value: 'All',
                description: '',
              },
              ...[
                '01',
                '02',
                '03',
                '04',
                '05',
                '06',
                '07',
                '08',
                '09',
                '10',
                '11',
                '12',
              ].map((route) => {
                return {
                  label: 'ルート' + route,
                  value: 'route' + route,
                }
              }),
            ],
            placeholder: 'Route Options Survey',
            min_values: 1,
            max_values: 6,
          },
        ],
      },
    ],
  }
  return JSON.stringify(message)
}

export const main = middyfy(registration)

interface Component {
  custom_id: string
  type: number
  value: string
  components: Component[]
}

interface MessageInteraction {
  app_permissions: string
  application_id: string
  channel_id: string
  data: {
    component_type: number
    custom_id: string
    values: any[]
    components: Component[]
  }
  entitlement_sku_ids: string[]
  guild_id: string
  guild_locale: string
  id: string
  locale: string
  member: {
    avatar: string | null
    communication_disabled_until: string | null
    deaf: boolean
    flags: number
    is_pending: boolean
    joined_at: string
    mute: boolean
    nick: string | null
    pending: boolean
    permissions: string
    premium_since: string | null
    roles: string[]
    user: {
      avatar: string
      avatar_decoration: string | null
      discriminator: string
      display_name: string | null
      id: string
      public_flags: number
      username: string
    }
  }
  message: {
    attachments: any[]
    author: {
      avatar: string
      avatar_decoration: string | null
      bot: boolean
      discriminator: string
      display_name: string | null
      id: string
      public_flags: number
      username: string
    }
    channel_id: string
    components: {
      components: {
        custom_id: string
        max_values: number
        min_values: number
        options: {
          description: string
          label: string
          value: string
        }[]
        placeholder: string
        type: number
      }[]
      type: number
    }[]
    content: string
    edited_timestamp: string | null
    embeds: any[]
    flags: number
    id: string
    mention_everyone: boolean
    mention_roles: string[]
    mentions: any[]
    pinned: boolean
    timestamp: string
    tts: boolean
    type: number
  }
  token: string
  type: number
  version: number
}

interface Option {
  name: string
  type: number
  value?: string | number | boolean
  options?: Option[]
}
interface SlashCommandInteraction {
  id: string
  application_id: string
  type: number
  data: {
    id: string
    name: string
    options: Option[]
    guild_id: string
    type: InteractionType
    custom_id: string
  }
  guild_id: string
  channel_id: string
  member: {
    avatar?: string
    user: {
      id: string
      username: string
      discriminator: string
      avatar?: string
      avatar_decoration: string | null
      display_name: string | null
      bot?: boolean
      public_flags: number
    }
    roles: string[]
    premium_since?: string | null
    permissions: string
    pending?: boolean
    nick?: string | null
    mute: boolean
    joined_at: string
    deaf: boolean
  }
  token: string
  version: number
}
