import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { EmptyState, LoadingState, QueryErrorState, StatusBadge } from './Common'
import type { UseQueryResult } from '@tanstack/react-query'

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

  it('renders loading state', () => {
    render(<LoadingState label="Loading rows..." />)
    expect(screen.getByText('Loading rows...')).toBeInTheDocument()
  })

  it('renders query error state', () => {
    const errorQuery = {
      isError: true,
      error: new Error('boom'),
    } as UseQueryResult<unknown, Error>
    render(<QueryErrorState title="Query failed" query={errorQuery} />)
    expect(screen.getByText('Query failed')).toBeInTheDocument()
    expect(screen.getByText('boom')).toBeInTheDocument()
  })
})
