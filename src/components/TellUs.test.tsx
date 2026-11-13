// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CountsAsk, FeedbackDialog, FeedbackOffer } from './TellUs'

const mocks = vi.hoisted(() => ({ send: vi.fn(), open: true, gifted: vi.fn() }))

vi.mock('../lib/platform', () => ({ nativeApp: true, macApp: true, touchApp: false, deviceKind: () => 'mac' }))
vi.mock('../lib/feedback', async (actual) => ({
  ...(await actual<typeof import('../lib/feedback')>()),
  sendFeedback: (text: string) => mocks.send(text),
  giftStillOpen: async () => mocks.open,
  rememberGifted: () => mocks.gifted(),
}))

const WORDS = 'A word count for each chapter, please. '.repeat(6).trim()
const type = (text: string) => fireEvent.change(screen.getByLabelText('Your feedback'), { target: { value: text } })
const sendButton = () => screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement

function dialog(subscribed = false) {
  const onGift = vi.fn(() => Date.UTC(2026, 10, 22, 12))
  const onClose = vi.fn()
  render(<FeedbackDialog subscribed={subscribed} onGift={onGift} onClose={onClose} />)
  return { onGift, onClose }
}

beforeEach(() => {
  localStorage.clear()
  mocks.send = vi.fn(async () => {})
  mocks.gifted = vi.fn(async () => {})
  mocks.open = true
})

describe('asking about counts', () => {
  it('takes a yes or a no, and leaving it counts as no', () => {
    const onAnswer = vi.fn()
    render(<CountsAsk onAnswer={onAnswer} />)
    fireEvent.click(screen.getByRole('button', { name: 'Send counts' }))
    expect(onAnswer).toHaveBeenLastCalledWith(true)
    fireEvent.click(screen.getByRole('button', { name: 'No thanks' }))
    expect(onAnswer).toHaveBeenLastCalledWith(false)
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onAnswer).toHaveBeenCalledTimes(3)
    expect(onAnswer).toHaveBeenLastCalledWith(false)
  })
})

describe('the feedback offer', () => {
  it('offers the two weeks and says where the button is', () => {
    render(<FeedbackOffer gift onSend={() => {}} onLater={() => {}} />)
    expect(screen.getByRole('dialog').textContent).toMatch(/2 weeks of Nib Plus/)
    expect(screen.getByRole('dialog').textContent).toMatch(/everything but sync/)
    expect(screen.getByRole('dialog').textContent).toMatch(/Settings, under Send feedback/)
  })

  it('offers nothing to someone who already has Plus', () => {
    render(<FeedbackOffer gift={false} onSend={() => {}} onLater={() => {}} />)
    expect(screen.getByRole('dialog').textContent).not.toMatch(/2 weeks/)
  })
})

describe('the feedback form', () => {
  it('won’t send until there’s something to say', () => {
    dialog()
    expect(sendButton().disabled).toBe(true)
    type('hi')
    expect(sendButton().disabled).toBe(true)
    type(WORDS)
    expect(sendButton().disabled).toBe(false)
  })

  it('counts up to the 200 characters it asks for, leaving out spaces at the ends, and sends from there', () => {
    dialog()
    expect(screen.getByText('0 of at least 200 characters')).toBeTruthy()
    type(`  ${'x'.repeat(199)}  `)
    expect(screen.getByText('199 of at least 200 characters')).toBeTruthy()
    expect(sendButton().disabled).toBe(true)
    type('x'.repeat(200))
    expect(screen.getByText('200 characters')).toBeTruthy()
    expect(sendButton().disabled).toBe(false)
  })

  it('counts an emoji as one character, as the server does', () => {
    dialog()
    type('😀'.repeat(200))
    expect(screen.getByText('200 characters')).toBeTruthy()
  })

  it('says when there’s too much, and won’t send it', () => {
    dialog()
    type('x'.repeat(4001))
    expect(screen.getByText('4,001 characters: that’s over 4,000')).toBeTruthy()
    expect(sendButton().disabled).toBe(true)
  })

  it('tells a screen reader the count along with the field', () => {
    dialog()
    const count = document.getElementById(screen.getByLabelText('Your feedback').getAttribute('aria-describedby')!)
    expect(count?.textContent).toBe('0 of at least 200 characters')
  })

  it('gives the two weeks once the message has gone, and says until when', async () => {
    const { onGift } = dialog()
    await waitFor(() => expect(screen.getByRole('dialog').textContent).toMatch(/first message earns/))
    type(WORDS)
    fireEvent.click(sendButton())
    await screen.findByRole('status')
    expect(mocks.send).toHaveBeenCalledWith(WORDS)
    expect(onGift).toHaveBeenCalledTimes(1)
    expect(mocks.gifted).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('status').textContent).toMatch(/open until 22 November|open until November 22/)
  })

  it('gives nothing if the message didn’t go, and keeps the words', async () => {
    const { FeedbackError } = await vi.importActual<typeof import('../lib/feedback')>('../lib/feedback')
    mocks.send = vi.fn(async () => {
      throw new FeedbackError('Couldn’t reach Nib.')
    })
    const { onGift } = dialog()
    type(WORDS)
    fireEvent.click(sendButton())
    expect((await screen.findByRole('alert')).textContent).toBe('Couldn’t reach Nib.')
    expect(onGift).not.toHaveBeenCalled()
    expect((screen.getByLabelText('Your feedback') as HTMLTextAreaElement).value).toBe(WORDS)
  })

  it('gives nothing a second time', async () => {
    mocks.open = false
    const { onGift } = dialog()
    type(WORDS)
    fireEvent.click(sendButton())
    await screen.findByRole('status')
    expect(onGift).not.toHaveBeenCalled()
    expect(screen.getByRole('status').textContent).not.toMatch(/open until/)
  })

  it('gives nothing to someone who already has Plus', async () => {
    const { onGift } = dialog(true)
    type(WORDS)
    fireEvent.click(sendButton())
    await screen.findByRole('status')
    expect(onGift).not.toHaveBeenCalled()
  })

  it('won’t lose typed words to Escape or a tap outside', () => {
    const { onClose } = dialog()
    type(WORDS)
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('takes the keyboard on a Mac', () => {
    dialog()
    expect(document.activeElement).toBe(screen.getByLabelText('Your feedback'))
  })
})
