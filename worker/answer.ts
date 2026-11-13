/** What a Durable Object answers a request with, for the route that asked to pass on or look at. */
export type Call = { status: number; body: unknown }

export const ok = (body: unknown): Call => ({ status: 200, body })

/** A request refused, and the status it's refused with. */
export class Refused extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** What `act` answers, or what it was refused with. */
export async function answered(act: () => Call | Promise<Call>): Promise<Call> {
  try {
    return await act()
  } catch (error) {
    if (error instanceof Refused) return { status: error.status, body: { error: error.message } }
    throw error
  }
}
