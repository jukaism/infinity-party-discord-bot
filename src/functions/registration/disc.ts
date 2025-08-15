import { Assignment, assignTasks, TaskAndLimit } from '@libs/assign'
import * as discordJs from 'discord.js'
import * as fb from 'firebase-admin'
import fetch from 'node-fetch'
import * as config from '../../../config.json'

const token = config.discord.token
const rest: discordJs.REST = new discordJs.REST({ version: '10' }).setToken(
  token,
)

// const postMessage = async (channelId: string, body: object): Promise<any> => {
//   return await rest.post(discordJs.Routes.channelMessages(channelId), {
//     headers: {
//       'Content-Type': 'application/json',
//     },
//     body: JSON.stringify(body),
//     appendToFormData: true,
//     passThroughBody: true,
//   })
// }
const sa: fb.ServiceAccount = {
  projectId: config.firebase.serviceAccount.projectId,
  privateKey: config.firebase.serviceAccount.privateKey,
  clientEmail: config.firebase.serviceAccount.clientEmail,
}

fb.initializeApp({ credential: fb.credential.cert(sa) })
const store = fb.firestore()
const channelRef = store.collection('channel')
const registerCommand = async (guildId: string): Promise<any> => {
  const command = new discordJs.SlashCommandBuilder()
    .setName('pharos')
    .setDescription('Manage pharos event')
    .addSubcommandGroup(
      new discordJs.SlashCommandSubcommandGroupBuilder()
        .setName('participation')
        .setDescription('Manage user application')
        .addSubcommand((subcommand) =>
          subcommand
            .setName('start')
            .setDescription('Start accepting user applications'),
        ),
    )
    .toJSON()
  await rest.put(
    discordJs.Routes.applicationGuildCommands(config.discord.appId, guildId),
    {
      body: [command],
    },
  )
  return
}
const dummy: User[] = [
  {
    name: 'fujisan',
    roles: 'Wall,MapTrap',
    routes: '01,03',
    joined: 100,
  },
  {
    name: 'fuji3',
    roles: 'Wall,S40',
    routes: '01,03,05,06',
    joined: 16773397152061,
  },
  {
    name: 'fuji4',
    roles: 'Wall,S40',
    routes: '01,03,05,06',
    joined: 16773397152062,
  },
  {
    name: 'fuji5',
    roles: 'Wall,S40',
    routes: '01,03,05,06',
    joined: 16773397152063,
  },
  {
    name: 'fuji6',
    roles: 'Wall,S40',
    routes: '01,03,05,06',
    joined: 16773397152064,
  },
  {
    name: 'fuji7',
    roles: 'Wall,S40,S50',
    routes: '01,03,05,06',
    joined: 16773397152065,
  },
  {
    name: 'fuji8',
    roles: 'Wall,S40',
    routes: '01,03,05,06',
    joined: 16773397152066,
  },
  {
    name: 'fuji9',
    roles: 'S50',
    routes: '01,03,05,06',
    joined: 100,
  },
  {
    name: 'fuji10',
    roles: 'MapTrap',
    routes: '01,03,05,06',
    joined: 100,
  },
  {
    name: 'fuji11',
    roles: 'Wall,S40',
    routes: '01,03,05,06',
    joined: 100,
  },
  {
    name: 'fuji12',
    roles: 'Wall,S40',
    routes: '01,03,05,07,06',
    joined: 130,
  },
  {
    name: 'fuji2',
    roles: 'Wall,S40',
    routes: '01,03,05,10,12',
    joined: 100,
  },
]
const main = async () => {
  const users = await channelRef
    .doc('1095318531287035996')
    .collection('users')
    .orderBy('joined', 'asc')
    .get()
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
  console.warn(organization)
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
const formatParty = (users: User[]): string => {
  const roleLikes = users.map((u) => u.roles.split(','))
  const roleAssign: Assignment[] = assignTasks(roleLikes, roleLimits)
  const routeLikes = users.map((u) => u.routes.split(','))
  const routeAssign: Assignment[] = assignTasks(routeLikes, routeLimits)
  const routeWithUser: RouteWithUser[] = routeAssign.map((a) => {
    return {
      route: a[0],
      userIndex: typeof a[1][0] === 'number' ? a[1][0] : -1,
    }
  })
  const userRouteRole: UserRouteRole[] = routeWithUser.map((rwu) => {
    const userExists = 0 <= rwu.userIndex
    const name = userExists ? users[rwu.userIndex].name : '未割当'
    const targetRoleAssign = roleAssign.find((ra) =>
      ra[1].includes(rwu.userIndex),
    )
    const role = !!targetRoleAssign ? targetRoleAssign[0] : '未定'
    return {
      route: rwu.route,
      name,
      role,
    }
  })
  const walls = userRouteRole.filter((u) => u.role === 'Wall')
  const mapTraps = userRouteRole.filter((u) => u.role === 'MapTrap')
  const s40 = userRouteRole.filter((u) => u.role === 'S40')
  const s50 = userRouteRole.filter((u) => u.role === 'S50')
  const routeText = userRouteRole
    .map((urr) => {
      return `ルート${urr.route} - ${urr.name}`
    })
    .join('\n')
  const roleText = `壁 - ${walls
    .map((urr) => urr.name)
    .join(', ')}\n地図罠 - ${mapTraps
    .map((urr) => urr.name)
    .join(', ')}\n聖域40 - ${s40
    .map((urr) => urr.name)
    .join(', ')}\n聖域50 - ${s50.map((urr) => urr.name).join(', ')}`
  return routeText + '\n' + roleText
}

interface User {
  id?: string
  name: string
  roles: string
  routes: string
  joined?: number
}

interface RouteWithUser {
  route: string
  userIndex: number
}
interface UserRouteRole {
  route: string
  name: string
  role: string
}

main()
