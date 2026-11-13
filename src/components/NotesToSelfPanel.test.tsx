// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { getSchema } from '@tiptap/core'
import { Node as PMNode } from '@tiptap/pm/model'
import { nibExtensions } from '../editor/extensions'
import { NotesToSelfPanel } from './NotesToSelfPanel'

const doc = (text: string) => PMNode.fromJSON(getSchema(nibExtensions(true)), { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })

describe('NotesToSelfPanel', () => {
  it('says how to add a note or a TK when there are none, and goes back', async () => {
    const onBack = vi.fn()
    render(<NotesToSelfPanel doc={doc('Nothing to do here.')} onBack={onBack} onShow={() => {}} />)
    expect(screen.getByText(/Select some words and choose Add a note to self, or write TK/)).toBeTruthy()
    await userEvent.click(screen.getByText('← Back'))
    expect(onBack).toHaveBeenCalledOnce()
  })

  it('shows each TK as written, and asks for its place by its row', async () => {
    const onShow = vi.fn()
    render(<NotesToSelfPanel doc={doc('Back by TKTK.')} onBack={() => {}} onShow={onShow} />)
    expect(screen.getByText('TKTK').tagName).toBe('STRONG')
    await userEvent.click(screen.getByRole('button', { name: 'Back by TKTK.' }))
    expect(onShow).toHaveBeenCalledWith('tk:0')
  })
})
