import React, { useState } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { 
  LayoutDashboard, 
  Target, 
  BarChart3, 
  Settings, 
  Sparkles, 
  ChevronRight,
  Search,
  User,
  Bell
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const sidebarItems = [
  { icon: <LayoutDashboard size={20} />, label: 'Dashboard', path: '/app/dashboard' },
  { icon: <Target size={20} />, label: 'Campaigns', path: '/app/campaigns' },
  { icon: <BarChart3 size={20} />, label: 'Analytics', path: '/app/analytics' },
  { icon: <Settings size={20} />, label: 'Settings', path: '/app/settings' },
];

const AppLayout: React.FC = () => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const location = useLocation();

  return (
    <div className="flex h-screen bg-[#0A0A0A] text-white overflow-hidden font-inter">
      {/* Sidebar */}
      <motion.aside 
        initial={false}
        animate={{ width: isSidebarOpen ? 260 : 80 }}
        className="relative z-30 flex flex-col border-r border-white/5 bg-[#0D0D0D] shadow-2xl"
      >
        <div className="flex h-16 items-center px-6">
          <Link to="/" className="flex items-center gap-3 group">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary shadow-lg shadow-primary/20 group-hover:scale-110 transition-transform">
              <Sparkles size={18} className="text-white" />
            </div>
            {isSidebarOpen && (
              <motion.span 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-lg font-bold tracking-tight"
              >
                IntentFlow
              </motion.span>
            )}
          </Link>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-4 overflow-y-auto">
          {sidebarItems.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 transition-all duration-200 group relative ${
                  isActive 
                    ? 'bg-primary/10 text-primary' 
                    : 'text-white/40 hover:bg-white/5 hover:text-white'
                }`}
              >
                <div className={`${isActive ? 'text-primary' : 'group-hover:text-white'} transition-colors`}>
                  {item.icon}
                </div>
                {isSidebarOpen && (
                  <motion.span 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="text-sm font-medium"
                  >
                    {item.label}
                  </motion.span>
                )}
                {isActive && (
                  <motion.div 
                    layoutId="active-pill"
                    className="absolute left-0 top-2 bottom-2 w-1 bg-primary rounded-r-full"
                  />
                )}
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-white/5">
          <button 
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className="flex w-full items-center justify-center rounded-xl bg-white/5 py-2 text-white/40 hover:bg-white/10 hover:text-white transition-all"
          >
            {isSidebarOpen ? <ChevronRight className="rotate-180" size={18} /> : <ChevronRight size={18} />}
          </button>
        </div>
      </motion.aside>

      {/* Main Content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <header className="flex h-16 items-center justify-between border-b border-white/5 px-8 bg-[#0D0D0D]/50 backdrop-blur-xl">
          <div className="flex items-center gap-4 flex-1">
            <div className="relative max-w-md w-full group">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-white/20 group-focus-within:text-primary transition-colors" size={16} />
              <input 
                type="text" 
                placeholder="Search commands, campaigns..." 
                className="h-10 w-full rounded-xl bg-white/5 pl-10 pr-4 text-sm outline-none border border-transparent focus:border-primary/20 focus:bg-white/10 transition-all"
              />
            </div>
          </div>

          <div className="flex items-center gap-6">
            <button className="relative text-white/40 hover:text-white transition-colors">
              <Bell size={20} />
              <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-white border-2 border-[#0D0D0D]">
                3
              </span>
            </button>
            
            <div className="h-6 w-px bg-white/5" />

            <div className="flex items-center gap-3 pl-2">
              <div className="text-right hidden sm:block">
                <div className="text-sm font-bold leading-none mb-1">Saumya Mishra</div>
                <div className="text-[10px] text-white/30 font-bold uppercase tracking-widest">Workspace Admin</div>
              </div>
              <div className="h-10 w-10 rounded-xl bg-gradient-to-tr from-primary to-blue-500 p-0.5 shadow-lg shadow-primary/20">
                <div className="h-full w-full rounded-[9px] bg-[#0D0D0D] flex items-center justify-center">
                  <User size={20} className="text-white/70" />
                </div>
              </div>
            </div>
          </div>
        </header>

        {/* Content Area */}
        <main className="flex-1 overflow-y-auto p-8 relative">
          {/* Subtle Ambient Background */}
          <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-primary/5 blur-[120px] rounded-full pointer-events-none" />
          
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              className="relative z-10 h-full"
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
};

export default AppLayout;
