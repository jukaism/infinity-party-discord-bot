import schema from './schema'
import { handlerPath } from '@libs/handler-resolver'

export default {
  handler: `${handlerPath(__dirname)}/handler.main`,
  timeout: 30,
  name: 'discordDataRegistration',
  events: [
    {
      http: {
        method: 'post',
        path: 'registration',
        request: {
          schemas: {
            'application/json': schema,
          },
        },
      },
    },
  ],
}
