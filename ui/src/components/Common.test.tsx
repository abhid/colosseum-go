import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { EmptyState, StatusBadge } from './Common'

describe('Common components', () => {
  it('renders empty state content', () => {
    render(<EmptyState title="No data" body="Nothing here" />)
    expect(screen.getByText('No data')).toBeInTheDocument()
    expect(screen.getByText('Nothing here')).toBeInTheDocument()
  })

  it('renders status badge', () => {
    render(<StatusBadge status="running" />)
    expect(screen.getByText('running')).toBeInTheDocument()
  })
})
