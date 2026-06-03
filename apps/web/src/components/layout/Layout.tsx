import Navbar from './Navbar'
import MobileNav from './MobileNav'

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-valor-dark flex flex-col">
      <Navbar />
      <main className="flex-1 container mx-auto px-4 py-6 max-w-6xl pb-20 md:pb-6">
        {children}
      </main>
      <MobileNav />
    </div>
  )
}
