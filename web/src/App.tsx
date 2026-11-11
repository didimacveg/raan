import { lazy, Suspense } from 'react'
import Nav from './components/Nav'
import { useRoute } from './lib/router'
import TwinPage from './twin/TwinPage'

const CollisionPage = lazy(() => import('./pages/CollisionPage'))
const ManeuverPage = lazy(() => import('./pages/ManeuverPage'))
const IntelligencePage = lazy(() => import('./pages/IntelligencePage'))
const ResearchPage = lazy(() => import('./pages/ResearchPage'))
const CardPage = lazy(() => import('./pages/CardPage'))

export default function App() {
  const route = useRoute()
  const { path } = route
  if (path.startsWith('/card/')) {
    return (
      <Suspense fallback={null}>
        <CardPage id={path.slice(6)} />
      </Suspense>
    )
  }
  const bare = route.query.get('ui') === '0'
  return (
    <>
      {!bare && <Nav path={path} />}
      <Suspense fallback={null}>
        {path === '/collision' ? (
          <CollisionPage />
        ) : path === '/maneuvers' ? (
          <ManeuverPage route={route} />
        ) : path === '/intelligence' ? (
          <IntelligencePage />
        ) : path === '/research' ? (
          <ResearchPage />
        ) : (
          <TwinPage route={route} />
        )}
      </Suspense>
    </>
  )
}
