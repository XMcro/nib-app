// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const blog = vi.hoisted(() => ({ kept: {} as { site?: string; user?: string }, connect: vi.fn(), ghost: vi.fn(), micro: vi.fn(), forget: vi.fn() }))
vi.mock('../lib/blog', async (actual) => {
  const real = await actual<typeof import('../lib/blog')>()
  return { ...real, blogPlugin: { blog: async () => blog.kept, forget: blog.forget }, connectWordPress: blog.connect, connectGhost: blog.ghost, connectMicroblog: blog.micro }
})

const { BlogError } = await import('../lib/blog')
const { BlogPanel } = await import('./BlogPanel')

beforeEach(() => {
  blog.kept = {}
  blog.connect.mockReset()
  blog.ghost.mockReset()
  blog.micro.mockReset()
  blog.forget.mockReset().mockResolvedValue(undefined)
})
afterEach(cleanup)

describe('Settings → Your blog', () => {
  const fill = async () => {
    await userEvent.type(await screen.findByRole('textbox', { name: 'Address' }), 'blog.example')
    await userEvent.type(screen.getByRole('textbox', { name: 'Username' }), 'mara')
    await userEvent.type(screen.getByLabelText('Application password'), 'abcd efgh')
  }

  it('connects a WordPress blog by its address, a username and an application password, and then shows it', async () => {
    blog.connect.mockResolvedValue({ name: 'Mara Wells', site: 'https://blog.example' })
    render(<BlogPanel onBack={vi.fn()} />)
    const connect = await screen.findByRole<HTMLButtonElement>('button', { name: 'Connect' })
    expect(connect.disabled).toBe(true)
    await fill()
    await userEvent.click(connect)
    expect(blog.connect).toHaveBeenCalledWith('blog.example', 'mara', 'abcd efgh')
    expect(await screen.findByText('Connected to blog.example')).toBeTruthy()
    expect(screen.getByText('As mara')).toBeTruthy()
    expect(screen.queryByLabelText('Application password')).toBeNull()
  })

  it('says why a blog wasn’t connected, and keeps what was typed', async () => {
    blog.connect.mockRejectedValue(new BlogError('That blog didn’t take that username and application password.'))
    render(<BlogPanel onBack={vi.fn()} />)
    await fill()
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }))
    expect((await screen.findByRole('alert')).textContent).toBe('That blog didn’t take that username and application password.')
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Address' }).value).toBe('blog.example')
  })

  it('connects a Ghost site by its API URL and Admin API key, with no username', async () => {
    blog.ghost.mockResolvedValue({ site: 'https://ghost.example' })
    render(<BlogPanel onBack={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Ghost' }))
    expect(screen.getByRole('button', { name: 'Ghost' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.queryByRole('textbox', { name: 'Username' })).toBeNull()
    await userEvent.type(screen.getByRole('textbox', { name: 'API URL' }), 'ghost.example')
    await userEvent.type(screen.getByLabelText('Admin API key'), 'id:secret')
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }))
    expect(blog.ghost).toHaveBeenCalledWith('ghost.example', 'id:secret')
    expect(blog.connect).not.toHaveBeenCalled()
    expect(await screen.findByText('Connected to ghost.example')).toBeTruthy()
    expect(screen.queryByText(/^As /)).toBeNull()
  })

  it('connects Micro.blog by an app token alone', async () => {
    blog.micro.mockResolvedValue({ site: 'https://micro.blog' })
    render(<BlogPanel onBack={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Micro.blog' }))
    expect(screen.queryByRole('textbox')).toBeNull()
    await userEvent.type(screen.getByLabelText('App token'), 'token')
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }))
    expect(blog.micro).toHaveBeenCalledWith('token')
    expect(await screen.findByText('Connected to micro.blog')).toBeTruthy()
  })

  it('disconnects the one connected, forgetting its key', async () => {
    blog.kept = { site: 'https://blog.example', user: 'mara' }
    render(<BlogPanel onBack={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Disconnect' }))
    expect(blog.forget).toHaveBeenCalledOnce()
    expect(await screen.findByRole('button', { name: 'Connect' })).toBeTruthy()
  })

  it('says so when the key couldn’t be taken off, and still shows the blog as connected', async () => {
    blog.kept = { site: 'https://blog.example', user: 'mara' }
    blog.forget.mockRejectedValue(new Error('Keychain delete failed (-25308).'))
    render(<BlogPanel onBack={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Disconnect' }))
    expect((await screen.findByRole('alert')).textContent).toContain('still on this device')
    expect(screen.getByText('Connected to blog.example')).toBeTruthy()
  })

  it('without Nib Plus, is only for disconnecting a blog connected with it: no form before or after, and back once it’s gone', async () => {
    blog.kept = { site: 'https://blog.example', user: 'mara' }
    const onBack = vi.fn()
    render(<BlogPanel plus={false} onBack={onBack} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Disconnect' }))
    expect(blog.forget).toHaveBeenCalledOnce()
    expect(onBack).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button', { name: 'Connect' })).toBeNull()
  })
})
