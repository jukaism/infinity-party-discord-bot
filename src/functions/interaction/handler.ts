import { formatJSONResponse } from '@libs/api-gateway'
import { webcrypto } from 'node:crypto'
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda'
import {
  InvokeCommand,
  InvokeCommandInput,
  Lambda,
  LambdaClient,
} from '@aws-sdk/client-lambda'
import {
  InteractionResponseType,
  InteractionType,
  verifyKey,
} from 'discord-interactions'
import * as config from '../../../config.json'
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

const interaction = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  if ((event as unknown as any).source === 'serverless-plugin-warmup') {
    return PONG
  }

  const headers = event.headers
  const body = JSON.parse(event.body)
  const signature = headers['x-signature-ed25519']
  const timestamp = headers['x-signature-timestamp']
  const verified = await verifyKey(event.body, signature, timestamp, publicKey)

  if (!body || !signature || !timestamp || !publicKey) {
    return formatJSONResponse(unauthorized)
  }
  if (!verified) {
    return formatJSONResponse(unauthorized)
  }

  const customId = (body as any).data?.custom_id
  if (!!MODAL_VARIABLES[customId]) {
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
      },
      body: inputModal(customId as JoinButtonCustomId),
    }
  }

  if (
    [
      InteractionType.APPLICATION_COMMAND,
      InteractionType.MESSAGE_COMPONENT,
      InteractionType.MODAL_SUBMIT,
    ].includes((body as any).type)
  ) {
    const params: InvokeCommandInput = {
      FunctionName: 'discordDataRegistration',
      InvocationType: 'Event',
      Payload: new TextEncoder().encode(JSON.stringify(event)),
    }
    const command = new InvokeCommand(params)
    await new LambdaClient({ region: 'ap-northeast-1' }).send(command)
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
      }),
    }
  } else {
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ type: InteractionResponseType.PONG }),
    }
  }
}

export const main = interaction

const inputModal = (custom_id: JoinButtonCustomId): string => {
  const setting = MODAL_VARIABLES[custom_id] as ModalVariables
  const message = {
    title: setting.title,
    custom_id: setting.custom_id,
    components: [
      {
        type: 1,
        components: [
          {
            type: 4,
            custom_id: 'modal_input',
            label: setting.label,
            style: 1,
            min_length: 1,
            max_length: setting.max_length,
            placeholder: setting.placeholder,
            required: true,
          },
        ],
      },
    ],
  }
  return JSON.stringify({
    type: InteractionResponseType.MODAL,
    data: message,
  })
}
interface ModalVariables {
  title: string
  custom_id: string
  label: string
  placeholder: string
  max_length: number
}

const joinModal: ModalVariables = {
  title: '参加',
  custom_id: 'member_join_modal',
  label: 'PTでの呼び名を入力してください',
  placeholder: 'Fuji',
  max_length: 10,
}

const editModal: ModalVariables = {
  title: '登録変更',
  custom_id: 'member_edit_modal',
  label: 'PTでの呼び名を入力してください',
  placeholder: 'Fuji',
  max_length: 10,
}
const exitModal: ModalVariables = {
  title: '脱退',
  custom_id: 'member_exit_modal',
  label: '脱退理由を入力して下さい',
  placeholder: '家庭の事情により',
  max_length: 100,
}
const kickModal: ModalVariables = {
  title: '除名',
  custom_id: 'member_kick_modal',
  label: '除名する人の名前を入力してください',
  placeholder: 'Fuji',
  max_length: 10,
}
const organizationModal: ModalVariables = {
  title: '規定人数到達',
  custom_id: 'member_organization_modal',
  label:
    '規定人数到達を告知します。一部メンションが飛ぶため注意してください。「はい」で動作します。',
  placeholder: 'はい',
  max_length: 2,
}

const MODAL_VARIABLES = {
  member_join: joinModal,
  member_edit: editModal,
  member_exit: exitModal,
  member_kick: kickModal,
  member_organization: organizationModal,
} as const

type JoinButtonCustomId = keyof typeof MODAL_VARIABLES
