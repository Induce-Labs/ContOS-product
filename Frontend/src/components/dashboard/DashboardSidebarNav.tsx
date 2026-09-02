import { useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'

type DashboardSidebarNavProps = {
  projectId: string | null
  onNavigate?: () => void
}

type NavChild = {
  label: string
  href: string
  isActive: (pathname: string, panel: string | null) => boolean
}

type NavSection =
  | {
      id: string
      label: string
      kind: 'link'
      href: string
      isActive: (pathname: string) => boolean
    }
  | {
      id: string
      label: string
      kind: 'group'
      children: NavChild[]
    }

export function DashboardSidebarNav({ projectId, onNavigate }: DashboardSidebarNavProps) {
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    projects: true,
    content: true,
  })

  if (!projectId) {
    return (
      <nav className="flex-1 px-4 py-5">
        <p className="text-sm text-ink-muted">Create a project to unlock navigation.</p>
      </nav>
    )
  }

  const panel = searchParams.get('panel')
  const sections: NavSection[] = [
    {
      id: 'projects',
      label: 'Projects',
      kind: 'group',
      children: [
        {
          label: 'Profiling',
          href: `/dashboard/${projectId}/profiling`,
          isActive: (pathname) => pathname === `/dashboard/${projectId}/profiling`,
        },
        {
          label: 'Analytics',
          href: `/dashboard/${projectId}/analytics`,
          isActive: (pathname) => pathname === `/dashboard/${projectId}/analytics`,
        },
      ],
    },
    {
      id: 'overview',
      label: 'Overview',
      kind: 'link',
      href: `/dashboard/${projectId}`,
      isActive: (pathname) => pathname === `/dashboard/${projectId}`,
    },
    {
      id: 'content',
      label: 'Content Agent',
      kind: 'group',
      children: [
        {
          label: 'Chatbot',
          href: `/dashboard/${projectId}/agents`,
          isActive: (pathname, currentPanel) =>
            pathname === `/dashboard/${projectId}/agents` && currentPanel !== 'history',
        },
        {
          label: 'Chat History',
          href: `/dashboard/${projectId}/agents?panel=history`,
          isActive: (pathname, currentPanel) =>
            pathname === `/dashboard/${projectId}/agents` && currentPanel === 'history',
        },
        {
          label: 'Calendar',
          href: `/dashboard/${projectId}/calendar`,
          isActive: (pathname) => pathname === `/dashboard/${projectId}/calendar`,
        },
        {
          label: 'Insights',
          href: `/dashboard/${projectId}/insights`,
          isActive: (pathname) => pathname === `/dashboard/${projectId}/insights`,
        },
      ],
    },
  ]

  function toggleSection(id: string) {
    setOpenSections((current) => ({ ...current, [id]: !current[id] }))
  }

  return (
    <nav className="flex min-h-0 flex-1 flex-col px-3 py-4">
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto">
        {sections.map((section) => {
          if (section.kind === 'link') {
            const isActive = section.isActive(location.pathname)

            return (
              <Link
                key={section.id}
                to={section.href}
                onClick={onNavigate}
                className={`flex items-center rounded-full px-4 py-2.5 text-sm font-medium transition ${
                  isActive
                    ? 'bg-accent-primary text-white shadow-[0_8px_20px_rgba(116,79,185,0.28)]'
                    : 'text-ink-muted hover:bg-accent-primary-soft hover:text-ink'
                }`}
              >
                {section.label}
              </Link>
            )
          }

          const isOpen = openSections[section.id] !== false

          return (
            <div key={section.id}>
              <button
                type="button"
                onClick={() => toggleSection(section.id)}
                className="flex w-full items-center justify-between px-4 py-1.5 text-left text-xs font-semibold uppercase tracking-[0.16em] text-ink-muted"
              >
                {section.label}
                <span aria-hidden="true" className="text-[10px]">
                  {isOpen ? '▾' : '▸'}
                </span>
              </button>
              {isOpen ? (
                <div className="mt-1 space-y-1">
                  {section.children.map((child) => {
                    const isActive = child.isActive(location.pathname, panel)

                    return (
                      <Link
                        key={child.label}
                        to={child.href}
                        onClick={onNavigate}
                        className={`block rounded-full px-4 py-2 text-sm transition ${
                          isActive
                            ? 'bg-accent-primary text-white shadow-[0_8px_20px_rgba(116,79,185,0.28)]'
                            : 'text-ink-muted hover:bg-accent-primary-soft hover:text-ink'
                        }`}
                      >
                        {child.label}
                      </Link>
                    )
                  })}
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
    </nav>
  )
}
