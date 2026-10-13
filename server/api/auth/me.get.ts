import { getAuthedUser } from '../../utils/auth'

export default defineEventHandler((event) => {
  return getAuthedUser(event)
})